import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { Decimal } from "@prisma/client/runtime/library";

const EditAdjustmentSchema = z.object({
  customerId: z.string().min(1),
  amount: z.number().positive("Amount must be greater than zero").optional(),
  transactionDate: z.string().optional(),
  referenceNumber: z.string().trim().optional().nullable(),
  particulars: z.string().trim().min(1).optional(),
  notes: z.string().trim().optional().nullable(),
  reason: z.string().trim().optional().nullable(),
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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { auth, error } = await requireRole(req, ["OWNER", "MANAGER"]);
  if (error) return error;
  const { id: adjustmentId } = await params;

  try {
    const body = await req.json();
    const parsed = EditAdjustmentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 422 }
      );
    }

    const {
      customerId,
      amount: newAmount,
      transactionDate: newTxnDate,
      referenceNumber: newRefNo,
      particulars: newParticulars,
      notes: newNotes,
      reason: newReason,
      updatedAt: clientUpdatedAt,
    } = parsed.data;

    // Load existing adjustment record
    const existing = await prisma.creditLedger.findUnique({
      where: { id: adjustmentId },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Adjustment entry not found" },
        { status: 404 }
      );
    }

    // Customer ownership check - cannot change customerId
    if (existing.customerId !== customerId) {
      return NextResponse.json(
        { error: "Adjustment does not belong to this customer" },
        { status: 403 }
      );
    }

    // Confirm entry type is adjustment
    if (
      !["MANUAL_DEBIT", "MANUAL_CREDIT", "ADJUSTMENT"].includes(
        existing.transactionType
      )
    ) {
      return NextResponse.json(
        { error: "Only manual adjustment entries can be edited through this route" },
        { status: 422 }
      );
    }

    // Disallow editing voided records
    if (existing.status === "VOIDED") {
      return NextResponse.json(
        { error: "Voided adjustments cannot be edited" },
        { status: 422 }
      );
    }

    // Optimistic concurrency check
    const serverUpdatedAt = existing.updatedAt.toISOString();
    if (serverUpdatedAt !== clientUpdatedAt) {
      return NextResponse.json(
        {
          error: "TRANSACTION_CHANGED",
          message:
            "Record was modified by another session. Please reload and try again.",
        },
        { status: 409 }
      );
    }

    const updateData: Record<string, unknown> = {};
    if (newAmount !== undefined) updateData.amount = new Decimal(newAmount);
    if (newTxnDate !== undefined) {
      const parsedDate = new Date(newTxnDate);
      updateData.accountingDate = parsedDate;
      updateData.createdAt = parsedDate;
    }
    if (newRefNo !== undefined) updateData.referenceNumber = newRefNo;
    if (newParticulars !== undefined) updateData.description = newParticulars;
    if (newNotes !== undefined) updateData.notes = newNotes;
    if (newReason !== undefined) updateData.reason = newReason;

    const result = await prisma.$transaction(async (tx) => {
      // Update canonical CreditLedger record (same ID, same customerId)
      const updatedAdjustment = await tx.creditLedger.update({
        where: { id: adjustmentId },
        data: updateData,
      });

      // Recalculate customer balance
      const newBalance = await recalcBalance(customerId, tx);

      // Audit Log
      await tx.auditLog.create({
        data: {
          userId: auth.userId,
          action: "MANUAL_ENTRY_UPDATED",
          entityType: "CreditLedger",
          entityId: adjustmentId,
          oldData: {
            amount: existing.amount.toString(),
            particulars: existing.description,
            referenceNumber: existing.referenceNumber,
            createdAt: existing.createdAt.toISOString(),
          } as object,
          newData: {
            ...updateData,
            editedBy: auth.userId,
          } as object,
        },
      });

      return { updatedAdjustment, newBalance };
    });

    return NextResponse.json({
      adjustment: result.updatedAdjustment,
      closingBalance: result.newBalance,
      message: "Adjustment updated successfully",
    });
  } catch (err) {
    console.error("[PATCH /api/adjustments/:id]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to edit adjustment" },
      { status: 500 }
    );
  }
}
