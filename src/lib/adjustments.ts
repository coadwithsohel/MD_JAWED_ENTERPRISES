import { Decimal } from "@prisma/client/runtime/library";
import { Prisma } from "@prisma/client";

type PrismaTx = Prisma.TransactionClient;

export async function recalcBalance(
  customerId: string,
  tx: PrismaTx
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

export async function processCanonicalAdjustment(
  tx: PrismaTx,
  data: {
    customerId: string;
    entryType: "DEBIT" | "CREDIT";
    amount: Decimal;
    transactionDate: Date;
    referenceNumber: string | null;
    particulars: string;
    notes: string | null;
    reason: string | null;
    idempotencyKey?: string | null;
    createdById: string;
    bulkBatchId?: string | null;
  }
) {
  const {
    customerId,
    entryType,
    amount,
    transactionDate,
    referenceNumber,
    particulars,
    notes,
    reason,
    idempotencyKey,
    createdById,
    bulkBatchId,
  } = data;

  const txnType = entryType === "DEBIT" ? "MANUAL_DEBIT" : "MANUAL_CREDIT";

  // Create canonical CreditLedger adjustment entry
  const adjustment = await tx.creditLedger.create({
    data: {
      customerId,
      transactionType: txnType,
      direction: entryType,
      amount,
      balanceAfter: new Decimal(0), // recalculated next
      description: particulars,
      referenceNumber: referenceNumber || null,
      notes: notes || null,
      reason: reason || null,
      status: "COMPLETED",
      idempotencyKey: idempotencyKey || undefined,
      createdById,
      accountingDate: transactionDate,
      createdAt: transactionDate,
      bulkBatchId: bulkBatchId || null,
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
      userId: createdById,
      action: bulkBatchId
        ? (entryType === "DEBIT" ? "BULK_MANUAL_DEBIT_CREATED" : "BULK_MANUAL_CREDIT_CREATED")
        : (entryType === "DEBIT" ? "MANUAL_DEBIT_CREATED" : "MANUAL_CREDIT_CREATED"),
      entityType: "CreditLedger",
      entityId: adjustment.id,
      oldData: undefined,
      newData: {
        customerId,
        entryType,
        amount: amount.toString(),
        transactionDate: transactionDate.toISOString(),
        particulars,
        referenceNumber,
        createdById,
        bulkBatchId,
      } as object,
    },
  });

  return { adjustment, newBalance };
}
