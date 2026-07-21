import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { toPaise } from "@/lib/money";

const schema = z
  .object({
    importBatchId: z.string().trim().min(1, "Import batch ID is required"),
    confirmation: z.string().trim().optional().nullable(),
    mode: z.enum(["preview", "execute"]).default("preview"),
    reason: z.string().trim().max(500).optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (
      data.mode === "execute" &&
      data.confirmation !== "REMOVE FROM IMPORT BATCH"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Confirmation text must be exactly "REMOVE FROM IMPORT BATCH"',
        path: ["confirmation"],
      });
    }
  });

export async function POST(req: NextRequest) {
  const { auth, error } = await requireRole(req, ["OWNER", "MANAGER"]);
  if (error) return error;

  try {
    const body = await req.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request" },
        { status: 400 },
      );
    }

    const { importBatchId, reason, mode } = parsed.data;
    const batch = await prisma.customerImportBatch.findUnique({
      where: { id: importBatchId },
      select: { id: true, originalFileName: true, createdAt: true },
    });

    if (!batch) {
      return NextResponse.json(
        { error: "Import batch not found" },
        { status: 404 },
      );
    }

    const rows = await prisma.customerImportRow.findMany({
      where: { importBatchId, customerId: { not: null } },
      select: {
        customerId: true,
        customer: {
          select: {
            id: true,
            fullName: true,
            openingBalance: true,
            currentBalance: true,
            _count: {
              select: {
                sales: true,
                payments: true,
                ledgers: true,
                reminders: true,
                importRows: true,
                tallyVouchers: true,
              },
            },
          },
        },
      },
    });

    const customers = rows.map((row) => row.customer).filter(Boolean) as Array<{
      id: string;
      fullName: string;
      openingBalance: unknown;
      currentBalance: unknown;
      _count: {
        sales: number;
        payments: number;
        ledgers: number;
        ledgerTransactions: number;
        reminders: number;
        importRows: number;
        tallyVouchers: number;
      };
    }>;

    const safeToDelete: string[] = [];
    const skipped: Array<{ id: string; fullName: string; reason: string }> = [];
    for (const customer of customers) {
      const issues: string[] = [];
      if (customer._count.sales > 0) issues.push("invoices");
      if (customer._count.payments > 0) issues.push("payments");
      if (customer._count.ledgers > 0) issues.push("ledgerEntries");
      if (
        customer._count.reminders > 0 ||
        customer._count.importRows > 0 ||
        customer._count.tallyVouchers > 0
      )
        issues.push("otherReferences");
      if (
        toPaise(customer.openingBalance) !== 0 ||
        toPaise(customer.currentBalance) !== 0
      )
        issues.push("nonZeroBalance");

      if (issues.length === 0) {
        safeToDelete.push(customer.id);
      } else {
        skipped.push({
          id: customer.id,
          fullName: customer.fullName,
          reason: issues.join(", "),
        });
      }
    }

    const summary = {
      batchId: batch.id,
      batchFileName: batch.originalFileName,
      importedDate: batch.createdAt,
      totalCustomersLinked: customers.length,
      safeToDelete: safeToDelete.length,
      skipped: skipped.length,
      customersWithInvoices: customers.filter(
        (customer) => customer._count.sales > 0,
      ).length,
      customersWithPayments: customers.filter(
        (customer) => customer._count.payments > 0,
      ).length,
      customersWithLedgerHistory: customers.filter(
        (customer) =>
          customer._count.ledgers + customer._count.ledgerTransactions > 0,
      ).length,
    };

    if (mode === "preview") {
      return NextResponse.json({
        ok: true,
        mode: "preview",
        summary,
        skipped,
        message: "Preview only. No customer records were changed.",
      });
    }

    const deletedIds: string[] = [];
    await prisma.$transaction(async (tx) => {
      for (const customerId of safeToDelete) {
        await tx.customerImportRow.updateMany({
          where: { importBatchId, customerId },
          data: { customerId: null },
        });
        await tx.auditLog.create({
          data: {
            userId: auth.userId,
            action: "CUSTOMER_IMPORT_BATCH_REMOVED",
            entityType: "Customer",
            entityId: customerId,
            oldData: { batchId: importBatchId, reason: reason ?? undefined },
            newData: { batchId: importBatchId, mode: "execute" },
          },
        });
        await tx.customer.delete({ where: { id: customerId } });
        deletedIds.push(customerId);
      }
    });

    return NextResponse.json({
      ok: true,
      mode: "execute",
      deletedCount: deletedIds.length,
      skippedCount: skipped.length,
      summary,
      skipped,
      message:
        "Only empty customers linked to the selected batch were removed.",
    });
  } catch (error) {
    console.error(
      "[POST /api/admin/customers/remove-from-import-batch]",
      error,
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
