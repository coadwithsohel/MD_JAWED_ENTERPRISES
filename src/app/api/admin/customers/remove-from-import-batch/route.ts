import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";

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

    const summary = {
      batchId: batch.id,
      batchFileName: batch.originalFileName,
      importedDate: batch.createdAt,
      totalCustomersLinked: 0,
      safeToDelete: 0,
      skipped: 0,
      customersWithInvoices: 0,
      customersWithPayments: 0,
      customersWithLedgerHistory: 0,
    };

    await prisma.auditLog.create({
      data: {
        userId: auth.userId,
        action:
          mode === "execute"
            ? "CUSTOMER_IMPORT_BATCH_CLEANUP_AUDIT"
            : "CUSTOMER_IMPORT_BATCH_CLEANUP_PREVIEW",
        entityType: "CustomerImportBatch",
        entityId: batch.id,
        oldData: { batchId: importBatchId, reason: reason ?? undefined },
        newData: {
          batchId: importBatchId,
          status: "audit-only",
          mode,
          note: "Customer import batch cleanup is now audit-only and does not remove customer records.",
        },
      },
    });

    if (mode === "preview") {
      return NextResponse.json({
        ok: true,
        mode: "preview",
        summary,
        skipped: [],
        message: "Preview only. No customer records were changed.",
      });
    }

    return NextResponse.json({
      ok: true,
      mode: "execute",
      deletedCount: 0,
      skippedCount: 0,
      summary,
      skipped: [],
      message:
        "Import-batch customer cleanup is audit-only. No customer records were removed.",
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
