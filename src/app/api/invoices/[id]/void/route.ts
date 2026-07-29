import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { Decimal } from "@prisma/client/runtime/library";
import { rebuildCustomerPaymentAllocations } from "@/lib/payment-allocation";

const VoidInvoiceSchema = z.object({
  voidReason: z.string().trim().optional().nullable(),
  updatedAt: z.string(), // Optimistic concurrency token
});

async function recalcBalance(
  customerId: string,
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]
): Promise<Decimal> {
  const cust = await tx.customer.findUnique({
    where: { id: customerId },
    select: { openingBalance: true },
  });
  const openingBalance = cust?.openingBalance ?? new Decimal(0);

  const ledgerEntries = await tx.creditLedger.findMany({
    where: {
      customerId,
      status: { not: "VOIDED" },
      transactionType: { not: "OPENING_BALANCE" },
    },
    select: {
      transactionType: true,
      amount: true,
      direction: true,
    },
  });

  let totalDebit = new Decimal(0);
  let totalCredit = new Decimal(0);

  for (const entry of ledgerEntries) {
    const amt = entry.amount ?? new Decimal(0);
    const type = entry.transactionType;

    if (
      type === "CREDIT_SALE" ||
      type === "PAYMENT_REVERSAL" ||
      type === "MANUAL_DEBIT" ||
      (type === "ADJUSTMENT" && entry.direction !== "CREDIT")
    ) {
      totalDebit = totalDebit.add(amt);
    } else if (
      type === "PAYMENT_RECEIVED" ||
      type === "SALE_CANCELLED" ||
      type === "RETURN_CREDIT" ||
      type === "MANUAL_CREDIT" ||
      (type === "ADJUSTMENT" && entry.direction === "CREDIT")
    ) {
      totalCredit = totalCredit.add(amt);
    }
  }

  const closingBalance = openingBalance.add(totalDebit).sub(totalCredit);
  await tx.customer.update({
    where: { id: customerId },
    data: { currentBalance: closingBalance },
  });

  return closingBalance;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { auth, error } = await requireRole(req, ["OWNER", "MANAGER"]);
  if (error) return error;
  const { id: invoiceId } = await params;

  try {
    const body = await req.json();
    const parsed = VoidInvoiceSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 422 }
      );
    }

    const { voidReason: rawReason, updatedAt: clientUpdatedAt } = parsed.data;
    const voidReason = rawReason || null;

    // Load canonical record with items
    const existing = await prisma.sale.findUnique({
      where: { id: invoiceId },
      include: {
        saleItems: true,
      },
    });

    if (!existing) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    // Check if already voided
    if (existing.voidedAt != null || existing.status === "CANCELLED") {
      // If client retries due to a previous 57P01 disconnect during success, it recovers here.
      return NextResponse.json(
        { message: "This invoice is already voided (recovered)." },
        { status: 200 }
      );
    }

    // Concurrency check
    if (existing.updatedAt.toISOString() !== clientUpdatedAt) {
      return NextResponse.json(
        {
          error: "TRANSACTION_CHANGED",
          message:
            "Record was modified in another session. Please reload and try again.",
        },
        { status: 409 }
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      // 1. Mark sale as CANCELLED + record void metadata
      const voidedSale = await tx.sale.update({
        where: { id: invoiceId },
        data: {
          status: "CANCELLED",
          voidedAt: new Date(),
          voidReason,
          pendingAmount: new Decimal(0),
        },
      });

      // 2. Restore sold stock exactly once
      for (const item of existing.saleItems) {
        const product = await tx.product.findUnique({
          where: { id: item.productId },
        });

        if (product) {
          const newStock = product.stockQuantity + item.quantity;
          await tx.product.update({
            where: { id: item.productId },
            data: { stockQuantity: newStock },
          });

          await tx.inventoryMovement.create({
            data: {
              productId: item.productId,
              saleId: invoiceId,
              movementType: "SALE_CANCELLED",
              quantity: item.quantity,
              quantityBefore: product.stockQuantity,
              quantityAfter: newStock,
              reason: voidReason
                ? `Invoice ${existing.invoiceNumber} voided: ${voidReason}`
                : `Invoice ${existing.invoiceNumber} voided`,
              createdById: auth.userId,
            },
          });
        }
      }

      // 3. Zero-out & mark CreditLedger entry as VOIDED
      await tx.creditLedger.updateMany({
        where: { saleId: invoiceId, transactionType: "CREDIT_SALE" },
        data: { amount: new Decimal(0), status: "VOIDED", voidedAt: new Date(), voidReason },
      });

      // 4. Release linked payments so they remain active as customer advance / credit
      //    (Unlinks saleId from Payment records without deleting payments)
      await tx.payment.updateMany({
        where: { saleId: invoiceId },
        data: { saleId: null },
      });

      // 5. Cancel pending reminders for this sale
      await tx.reminder.updateMany({
        where: { saleId: invoiceId, status: "PENDING" },
        data: { status: "CANCELLED" },
      });

      // 6. Rebuild customer payment allocations & recalculate balance
      if (existing.customerId) {
        await rebuildCustomerPaymentAllocations(existing.customerId, tx);
        await recalcBalance(existing.customerId, tx);
      }

      // 7. Audit log
      await tx.auditLog.create({
        data: {
          userId: auth.userId,
          action: "INVOICE_VOIDED",
          entityType: "Sale",
          entityId: invoiceId,
          oldData: {
            status: existing.status,
            grandTotal: existing.grandTotal.toString(),
            invoiceNumber: existing.invoiceNumber,
          } as object,
          newData: {
            status: "CANCELLED",
            voidReason,
            voidedBy: auth.userId,
          } as object,
        },
      });
      return voidedSale;
    }, {
      maxWait: 5000,
      timeout: 30000,
    });

    return NextResponse.json({
      invoice: result,
      message:
        "Invoice voided successfully. Accounting and stock impact reversed.",
    });
  } catch (err: any) {
    console.error("[POST /api/invoices/:id/void]", err);
    
    const isConnectionError =
      err?.code === "P2010" ||
      err?.code === "P2024" ||
      err?.code === "P2028" ||
      err?.message?.includes("57P01") ||
      err?.message?.includes("terminating connection due to administrator command") ||
      err?.message?.includes("Connection pool is full");

    if (isConnectionError) {
      return NextResponse.json({ error: "Database is temporarily unavailable. Please retry." }, { status: 503 });
    }

    return NextResponse.json({ error: "Server error voiding invoice", detail: err.message, stack: err.stack }, { status: 500 });
  }
}
