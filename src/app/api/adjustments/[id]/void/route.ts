import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { Decimal } from "@prisma/client/runtime/library";

const VoidAdjustmentSchema = z.object({
  customerId: z.string().min(1),
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
  const { id: adjustmentId } = await params;

  try {
    const body = await req.json();
    const parsed = VoidAdjustmentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 422 }
      );
    }

    const { customerId, voidReason: rawReason, updatedAt: clientUpdatedAt } = parsed.data;
    const voidReason = rawReason || null;

    const existing = await prisma.creditLedger.findUnique({
      where: { id: adjustmentId },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Adjustment entry not found" },
        { status: 404 }
      );
    }

    if (existing.customerId !== customerId) {
      return NextResponse.json(
        { error: "Adjustment does not belong to this customer" },
        { status: 403 }
      );
    }

    if (existing.status === "VOIDED" || existing.voidedAt != null) {
      return NextResponse.json(
        { error: "This adjustment is already voided" },
        { status: 409 }
      );
    }

    if (existing.updatedAt.toISOString() !== clientUpdatedAt) {
      return NextResponse.json(
        {
          error: "TRANSACTION_CHANGED",
          message:
            "Record was modified by another session. Reload and try again.",
        },
        { status: 409 }
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      // 1. Mark adjustment as VOIDED + zero out amount
      const voidedAdjustment = await tx.creditLedger.update({
        where: { id: adjustmentId },
        data: {
          status: "VOIDED",
          amount: new Decimal(0),
          voidedAt: new Date(),
          voidReason,
        },
      });

      // 2. Recalculate customer balance
      const newBalance = await recalcBalance(customerId, tx);

      // 3. Audit Log
      await tx.auditLog.create({
        data: {
          userId: auth.userId,
          action: "MANUAL_ENTRY_VOIDED",
          entityType: "CreditLedger",
          entityId: adjustmentId,
          oldData: {
            amount: existing.amount.toString(),
            transactionType: existing.transactionType,
            particulars: existing.description,
          } as object,
          newData: {
            status: "VOIDED",
            voidReason,
            voidedBy: auth.userId,
            newCustomerBalance: newBalance.toString(),
          } as object,
        },
      });

      return { voidedAdjustment, newBalance };
    });

    return NextResponse.json({
      adjustment: result.voidedAdjustment,
      closingBalance: result.newBalance,
      message: "Adjustment entry voided successfully.",
    });
  } catch (err) {
    console.error("[POST /api/adjustments/:id/void]", err);
    return NextResponse.json(
      { error: "Server error voiding adjustment" },
      { status: 500 }
    );
  }
}
