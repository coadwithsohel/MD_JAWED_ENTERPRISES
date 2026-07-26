import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { Decimal } from "@prisma/client/runtime/library";
import { rebuildCustomerPaymentAllocations } from "@/lib/payment-allocation";

const EditInvoiceSchema = z.object({
  invoiceNumber: z.string().trim().min(1).optional(),
  saleDate: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  editReason: z.string().trim().optional().nullable(),
  updatedAt: z.string(), // Optimistic concurrency token
  items: z
    .array(
      z.object({
        id: z.string().optional(),
        productId: z.string().min(1),
        quantity: z.number().int().positive("Quantity must be positive"),
        unitPrice: z.number().nonnegative("Unit price must be non-negative"),
        discountAmount: z.number().nonnegative().optional().default(0),
        gstPercent: z.number().nonnegative().optional().default(0),
      })
    )
    .min(1, "Invoice must contain at least one item"),
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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { auth, error } = await requireRole(req, ["OWNER", "MANAGER"]);
  if (error) return error;
  const { id: invoiceId } = await params;

  try {
    const body = await req.json();
    const parsed = EditInvoiceSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 422 }
      );
    }

    const {
      invoiceNumber: newInvoiceNumber,
      saleDate: newSaleDate,
      dueDate: newDueDate,
      notes: newNotes,
      editReason: rawReason,
      updatedAt: clientUpdatedAt,
      items: newItems,
    } = parsed.data;

    const editReason = rawReason || null;

    // 1. Fetch existing canonical invoice record
    const existing = await prisma.sale.findUnique({
      where: { id: invoiceId },
      include: {
        saleItems: {
          include: {
            product: true,
          },
        },
      },
    });

    if (!existing) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    // 2. Cannot edit voided invoices
    if (existing.status === "CANCELLED" || existing.voidedAt != null) {
      return NextResponse.json(
        { error: "Voided invoices cannot be edited." },
        { status: 422 }
      );
    }

    // 3. Optimistic concurrency check
    const serverUpdatedAt = existing.updatedAt.toISOString();
    if (serverUpdatedAt !== clientUpdatedAt) {
      return NextResponse.json(
        {
          error: "TRANSACTION_CHANGED",
          message:
            "This invoice was modified in another session. Please reload and try again.",
        },
        { status: 409 }
      );
    }

    // 4. Validate invoice number uniqueness if changed
    if (
      newInvoiceNumber &&
      newInvoiceNumber !== existing.invoiceNumber
    ) {
      const duplicate = await prisma.sale.findUnique({
        where: { invoiceNumber: newInvoiceNumber },
      });
      if (duplicate && duplicate.id !== invoiceId) {
        return NextResponse.json(
          { error: `Invoice number '${newInvoiceNumber}' already exists.` },
          { status: 422 }
        );
      }
    }

    // 5. Execute atomic transaction
    const result = await prisma.$transaction(async (tx) => {
      // Map old items by id and productId
      const existingItemsMap = new Map(existing.saleItems.map((i) => [i.id, i]));
      const existingItemsByProduct = new Map(
        existing.saleItems.map((i) => [i.productId, i])
      );

      // Track item IDs processed
      const processedOldItemIds = new Set<string>();

      let subtotalAcc = new Decimal(0);
      let gstAcc = new Decimal(0);

      // Process new/updated items
      for (const newItem of newItems) {
        // Match existing item by id or productId
        const matchedOld =
          (newItem.id ? existingItemsMap.get(newItem.id) : null) ??
          existingItemsByProduct.get(newItem.productId);

        const oldQty = matchedOld ? matchedOld.quantity : 0;
        const qtyDiff = oldQty - newItem.quantity; // positive = returned to stock, negative = deducted from stock

        const product = await tx.product.findUnique({
          where: { id: newItem.productId },
        });

        if (!product) {
          throw new Error(`Product ID '${newItem.productId}' not found`);
        }

        // Apply exact stock quantity difference
        if (qtyDiff !== 0) {
          const newStock = product.stockQuantity + qtyDiff;
          if (newStock < 0) {
            throw new Error(
              `Insufficient stock for '${product.name}'. Available: ${product.stockQuantity}, Required additional: ${Math.abs(qtyDiff)}`
            );
          }

          await tx.product.update({
            where: { id: product.id },
            data: { stockQuantity: newStock },
          });

          // Log inventory movement for exact difference
          await tx.inventoryMovement.create({
            data: {
              productId: product.id,
              saleId: invoiceId,
              movementType: qtyDiff > 0 ? "CUSTOMER_RETURN" : "SALE",
              quantity: Math.abs(qtyDiff),
              quantityBefore: product.stockQuantity,
              quantityAfter: newStock,
              reason: editReason
                ? `Invoice ${existing.invoiceNumber} edited: ${editReason}`
                : `Invoice ${existing.invoiceNumber} edited item quantity`,
              createdById: auth.userId,
            },
          });
        }

        // Calculate line math
        const unitPriceDec = new Decimal(newItem.unitPrice);
        const discountDec = new Decimal(newItem.discountAmount);
        const gstPercentDec = new Decimal(newItem.gstPercent);

        const rawLineSub = unitPriceDec
          .mul(newItem.quantity)
          .sub(discountDec);
        const lineSubtotal = Decimal.max(rawLineSub, new Decimal(0));
        const lineGst = lineSubtotal.mul(gstPercentDec).div(100);
        const lineTotal = lineSubtotal.add(lineGst);

        subtotalAcc = subtotalAcc.add(lineSubtotal);
        gstAcc = gstAcc.add(lineGst);

        if (matchedOld) {
          processedOldItemIds.add(matchedOld.id);
          await tx.saleItem.update({
            where: { id: matchedOld.id },
            data: {
              quantity: newItem.quantity,
              unitPrice: unitPriceDec,
              discountAmount: discountDec,
              gstPercent: gstPercentDec,
              gstAmount: lineGst,
              lineTotal,
            },
          });
        } else {
          await tx.saleItem.create({
            data: {
              saleId: invoiceId,
              productId: newItem.productId,
              quantity: newItem.quantity,
              unitPrice: unitPriceDec,
              purchasePriceSnapshot: product.purchasePrice,
              discountAmount: discountDec,
              gstPercent: gstPercentDec,
              gstAmount: lineGst,
              lineTotal,
            },
          });
        }
      }

      // Process removed items
      for (const oldItem of existing.saleItems) {
        if (!processedOldItemIds.has(oldItem.id)) {
          // Restore stock for deleted item
          const product = await tx.product.findUnique({
            where: { id: oldItem.productId },
          });
          if (product) {
            const newStock = product.stockQuantity + oldItem.quantity;
            await tx.product.update({
              where: { id: product.id },
              data: { stockQuantity: newStock },
            });

            await tx.inventoryMovement.create({
              data: {
                productId: product.id,
                saleId: invoiceId,
                movementType: "CUSTOMER_RETURN",
                quantity: oldItem.quantity,
                quantityBefore: product.stockQuantity,
                quantityAfter: newStock,
                reason: `Invoice ${existing.invoiceNumber} item removed`,
                createdById: auth.userId,
              },
            });
          }

          await tx.saleItem.delete({
            where: { id: oldItem.id },
          });
        }
      }

      const grandTotal = subtotalAcc.add(gstAcc);

      // Update canonical Sale record
      const updatedSale = await tx.sale.update({
        where: { id: invoiceId },
        data: {
          invoiceNumber: newInvoiceNumber ?? existing.invoiceNumber,
          saleDate: newSaleDate ? new Date(newSaleDate) : existing.saleDate,
          dueDate: newDueDate !== undefined ? (newDueDate ? new Date(newDueDate) : null) : existing.dueDate,
          notes: newNotes !== undefined ? newNotes : existing.notes,
          subtotal: subtotalAcc,
          gstAmount: gstAcc,
          grandTotal,
        },
      });

      // Update linked CreditLedger entry for this sale (if credit/partial sale)
      if (existing.customerId) {
        await tx.creditLedger.updateMany({
          where: { saleId: invoiceId, transactionType: "CREDIT_SALE" },
          data: { amount: grandTotal },
        });

        // Rebuild payment allocation for customer to safely update paid/pending/paymentStatus
        await rebuildCustomerPaymentAllocations(existing.customerId, tx);

        // Recalculate customer balance
        await recalcBalance(existing.customerId, tx);
      }

      // Audit Log
      await tx.auditLog.create({
        data: {
          userId: auth.userId,
          action: "INVOICE_UPDATED",
          entityType: "Sale",
          entityId: invoiceId,
          oldData: {
            invoiceNumber: existing.invoiceNumber,
            grandTotal: existing.grandTotal.toString(),
            saleDate: existing.saleDate?.toISOString() ?? existing.createdAt.toISOString(),
            notes: existing.notes,
            itemCount: existing.saleItems.length,
          } as object,
          newData: {
            invoiceNumber: updatedSale.invoiceNumber,
            grandTotal: grandTotal.toString(),
            editReason,
            editedBy: auth.userId,
            itemCount: newItems.length,
          } as object,
        },
      });

      return updatedSale;
    });

    return NextResponse.json({
      invoice: result,
      message: "Invoice updated successfully",
    });
  } catch (err) {
    console.error("[PATCH /api/invoices/:id]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to edit invoice" },
      { status: 500 }
    );
  }
}
