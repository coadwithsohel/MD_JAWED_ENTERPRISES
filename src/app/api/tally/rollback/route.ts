import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { Prisma } from "@prisma/client";

export async function POST(req: NextRequest) {
  const { auth, error } = await requireRole(req, ["OWNER", "MANAGER"]);
  if (error) return error;

  try {
    const body = await req.json();
    const importBatchId = body.importBatchId as string | undefined;
    const execute = body.execute === true;

    if (!importBatchId) {
      return NextResponse.json(
        { error: "importBatchId is required" },
        { status: 400 },
      );
    }

    const batch = await prisma.tallyImportBatch.findUnique({
      where: { id: importBatchId },
      select: { id: true, originalFileName: true, status: true },
    });

    if (!batch) {
      return NextResponse.json(
        { error: "Import batch not found" },
        { status: 404 },
      );
    }

    const transactions = await prisma.customerLedgerTransaction.findMany({
      where: { importBatchId },
      select: { id: true, customerId: true, debit: true, credit: true },
    });

    const preview = {
      importBatchId,
      fileName: batch.originalFileName,
      transactionCount: transactions.length,
      affectedCustomers: new Set(transactions.map((t) => t.customerId)).size,
    };

    if (!execute) {
      return NextResponse.json({ ok: true, dryRun: true, preview });
    }

    await prisma.$transaction(async (tx) => {
      for (const txn of transactions) {
        const delta = Number(txn.debit) - Number(txn.credit);
        const customer = await tx.customer.findUnique({
          where: { id: txn.customerId },
          select: { currentBalance: true },
        });
        if (customer) {
          await tx.customer.update({
            where: { id: txn.customerId },
            data: {
              currentBalance: new Prisma.Decimal(
                Number(customer.currentBalance) - delta,
              ),
            },
          });
        }
      }

      await tx.customerLedgerTransaction.deleteMany({
        where: { importBatchId },
      });
      await tx.tallyVoucher.deleteMany({ where: { importBatchId } });
      await tx.tallyImportBatch.update({
        where: { id: importBatchId },
        data: {
          status: "FAILED",
          completedAt: new Date(),
          errorSummary: { rollbackBy: auth.userId },
        },
      });
      await tx.auditLog.create({
        data: {
          userId: auth.userId,
          action: "ROLLBACK",
          entityType: "TallyImportBatch",
          entityId: importBatchId,
          newData: { fileName: batch.originalFileName },
        },
      });
    });

    return NextResponse.json({ ok: true, executed: true, preview });
  } catch (err) {
    console.error("[POST /api/tally/rollback]", err);
    return NextResponse.json(
      { error: "Failed to rollback Tally import" },
      { status: 500 },
    );
  }
}
