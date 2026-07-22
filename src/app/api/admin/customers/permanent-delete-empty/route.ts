import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { getCustomerDeletionEligibility } from "@/lib/customer-delete-safety";

const schema = z
  .object({
    confirmation: z.string().trim().optional().nullable(),
    reason: z.string().trim().max(500).optional().nullable(),
    mode: z.enum(["preview", "execute"]).default("preview"),
  })
  .superRefine((data, ctx) => {
    if (
      data.mode === "execute" &&
      data.confirmation !== "DELETE EMPTY CUSTOMERS"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Confirmation text must be exactly "DELETE EMPTY CUSTOMERS"',
        path: ["confirmation"],
      });
    }
  });

export async function POST(req: NextRequest) {
  const { auth, error } = await requireRole(req, ["OWNER"]);
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

    const { reason, mode } = parsed.data;

    const customers = await prisma.customer.findMany({
      where: {},
      select: {
        id: true,
        fullName: true,
        customerCode: true,
        openingBalance: true,
        currentBalance: true,
        _count: {
          select: {
            sales: true,
            payments: true,
            ledgers: true,
            ledgerTransactions: true,
            reminders: true,
            importRows: true,
            tallyVouchers: true,
          },
        },
      },
    });

    const eligibleIds: string[] = [];
    const blockedBy: Record<string, number> = {
      invoices: 0,
      payments: 0,
      ledgerEntries: 0,
      ledgerTransactions: 0,
      nonZeroBalance: 0,
      otherReferences: 0,
    };
    const blockedDetails: Array<{
      customerId: string;
      customerCode: string;
      reasons: string[];
    }> = [];

    for (const customer of customers) {
      const eligibility = getCustomerDeletionEligibility(customer);
      if (eligibility.isEligible) {
        eligibleIds.push(customer.id);
        continue;
      }

      blockedDetails.push({
        customerId: customer.id,
        customerCode: customer.customerCode,
        reasons: eligibility.reasons,
      });

      if (eligibility.reasons.includes("invoices")) blockedBy.invoices += 1;
      if (eligibility.reasons.includes("payments")) blockedBy.payments += 1;
      if (eligibility.reasons.includes("ledgerEntries"))
        blockedBy.ledgerEntries += 1;
      if (eligibility.reasons.includes("ledgerTransactions"))
        blockedBy.ledgerTransactions += 1;
      if (eligibility.reasons.includes("nonZeroBalance"))
        blockedBy.nonZeroBalance += 1;
      if (eligibility.reasons.includes("otherReferences"))
        blockedBy.otherReferences += 1;
    }

    const summary = {
      totalCustomersChecked: customers.length,
      eligibleForDeletion: eligibleIds.length,
      blockedBecauseOfInvoices: blockedBy.invoices,
      blockedBecauseOfPayments: blockedBy.payments,
      blockedBecauseOfLedgerEntries: blockedBy.ledgerEntries,
      blockedBecauseOfLedgerTransactions: blockedBy.ledgerTransactions,
      blockedBecauseOfNonZeroBalance: blockedBy.nonZeroBalance,
      blockedBecauseOfOtherReferences: blockedBy.otherReferences,
      blockedCustomerSample: blockedDetails.slice(0, 10),
    };

    if (mode === "preview") {
      return NextResponse.json({
        ok: true,
        mode: "preview",
        summary,
        message: "Preview only. No customer records were changed.",
      });
    }

    const deletedIds: string[] = [];
    const failedIds: string[] = [];
    const CHUNK_SIZE = 50;

    for (let index = 0; index < eligibleIds.length; index += CHUNK_SIZE) {
      const chunk = eligibleIds.slice(index, index + CHUNK_SIZE);
      try {
        const chunkDeleted = await prisma.$transaction(async (tx) => {
          // Import records are audit metadata. Preserve them but detach the
          // nullable customer reference before deleting the customer.
          await tx.customerImportRow.updateMany({
            where: { customerId: { in: chunk } },
            data: { customerId: null },
          });
          await tx.tallyVoucher.updateMany({
            where: { customerId: { in: chunk } },
            data: { customerId: null },
          });

          for (const customerId of chunk) {
            await tx.auditLog.create({
              data: {
                userId: auth.userId,
                action: "CUSTOMER_BULK_PERMANENT_DELETED",
                entityType: "Customer",
                entityId: customerId,
                oldData: { reason: reason ?? undefined },
                newData: { deletedBy: auth.userId, mode: "execute" },
              },
            });
          }

          const result = await tx.customer.deleteMany({
            where: { id: { in: chunk } },
          });
          return result.count;
        });

        if (chunkDeleted === chunk.length) deletedIds.push(...chunk);
        else failedIds.push(...chunk);
      } catch (chunkError) {
        failedIds.push(...chunk);
        console.error("[permanent-delete-empty] chunk failed", {
          chunkStart: index,
          chunkSize: chunk.length,
          code:
            typeof chunkError === "object" &&
            chunkError !== null &&
            "code" in chunkError
              ? String((chunkError as { code?: unknown }).code)
              : undefined,
          message:
            chunkError instanceof Error
              ? chunkError.message
              : "Unknown deletion error",
        });
      }
    }

    return NextResponse.json({
      ok: true,
      mode: "execute",
      deletedCount: deletedIds.length,
      skippedCount: customers.length - deletedIds.length,
      failedCount: failedIds.length,
      summary,
      message: "Eligible empty customers were permanently deleted.",
    });
  } catch (error) {
    console.error("[POST /api/admin/customers/permanent-delete-empty]", error);
    const message =
      error instanceof Error && "code" in error
        ? `Delete failed: ${String((error as { code?: string }).code ?? error.message)}`
        : "Delete failed while processing customer deletions.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
