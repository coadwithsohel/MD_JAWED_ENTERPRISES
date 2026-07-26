import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { Decimal } from "@prisma/client/runtime/library";

const CreateAdjustmentSchema = z.object({
  customerId: z.string().min(1, "Customer ID is required"),
  entryType: z.enum(["DEBIT", "CREDIT"]),
  amount: z.number().positive("Amount must be greater than zero"),
  transactionDate: z.string().min(1, "Transaction date is required"),
  referenceNumber: z.string().trim().optional().nullable(),
  particulars: z.string().trim().min(1, "Particulars / description is required"),
  notes: z.string().trim().optional().nullable(),
  reason: z.string().trim().optional().nullable(),
  idempotencyKey: z.string().trim().optional().nullable(),
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

export async function POST(req: NextRequest) {
  const { auth, error } = await requireRole(req, ["OWNER", "MANAGER"]);
  if (error) return error;

  try {
    const body = await req.json();
    const parsed = CreateAdjustmentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 422 }
      );
    }

    const {
      customerId,
      entryType,
      amount,
      transactionDate,
      referenceNumber,
      particulars,
      notes,
      reason,
      idempotencyKey: rawIdempotencyKey,
    } = parsed.data;

    const headerKey = req.headers.get("x-idempotency-key");
    const idempotencyKey = rawIdempotencyKey || headerKey || null;

    // Verify customer exists
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, fullName: true },
    });
    if (!customer) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    // Server-side duplicate protection via idempotency key
    if (idempotencyKey) {
      const existing = await prisma.creditLedger.findUnique({
        where: { idempotencyKey },
      });
      if (existing) {
        return NextResponse.json({
          adjustment: existing,
          message: "Transaction already processed",
          duplicate: true,
        });
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const txnType = entryType === "DEBIT" ? "MANUAL_DEBIT" : "MANUAL_CREDIT";
      const txnDate = new Date(transactionDate);
      const amountDec = new Decimal(amount);

      // Create canonical CreditLedger adjustment entry
      const adjustment = await tx.creditLedger.create({
        data: {
          customerId,
          transactionType: txnType,
          direction: entryType,
          amount: amountDec,
          balanceAfter: new Decimal(0), // recalculated next
          description: particulars,
          referenceNumber: referenceNumber || null,
          notes: notes || null,
          reason: reason || null,
          status: "COMPLETED",
          idempotencyKey: idempotencyKey || undefined,
          createdById: auth.userId,
          accountingDate: txnDate,
          createdAt: txnDate,
        },
      });

      // Recalculate customer balance & update balanceAfter
      const newBalance = await recalcBalance(customerId, tx);
      await tx.creditLedger.update({
        where: { id: adjustment.id },
        data: { balanceAfter: newBalance },
      });

      // Audit Log
      await tx.auditLog.create({
        data: {
          userId: auth.userId,
          action: entryType === "DEBIT" ? "MANUAL_DEBIT_CREATED" : "MANUAL_CREDIT_CREATED",
          entityType: "CreditLedger",
          entityId: adjustment.id,
          oldData: undefined,
          newData: {
            customerId,
            entryType,
            amount: amount.toString(),
            transactionDate,
            particulars,
            referenceNumber,
            createdById: auth.userId,
          } as object,
        },
      });

      return { adjustment, newBalance };
    });

    return NextResponse.json({
      adjustment: result.adjustment,
      closingBalance: result.newBalance,
      message: `${entryType === "DEBIT" ? "Debit" : "Credit"} adjustment created successfully`,
    });
  } catch (err) {
    console.error("[POST /api/adjustments]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create manual entry" },
      { status: 500 }
    );
  }
}
