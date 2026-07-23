import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const { auth, error } = await requireAuth(req);
  if (error) return error;

  try {
    const type = req.nextUrl.searchParams.get("type"); // 'CUSTOMER' | 'TRANSACTION' | null

    const customerBatches = await prisma.customerImportBatch.findMany({
      select: {
        id: true,
        originalFileName: true,
        totalRows: true,
        validRows: true,
        importedRows: true,
        skippedRows: true,
        failedRows: true,
        status: true,
        createdAt: true,
        completedAt: true,
        importedBy: {
          select: { fullName: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    const tallyBatches = await prisma.tallyImportBatch.findMany({
      select: {
        id: true,
        originalFileName: true,
        totalVouchers: true,
        salesCount: true,
        receiptCount: true,
        duplicateCount: true,
        skippedCount: true,
        errorCount: true,
        status: true,
        createdAt: true,
        completedAt: true,
        importedBy: {
          select: { fullName: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    const batches = [
      ...customerBatches.map((b) => ({
        id: b.id,
        type: "CUSTOMER" as const,
        fileName: b.originalFileName,
        totalRows: b.totalRows,
        validRows: b.validRows,
        importedRows: b.importedRows,
        skippedRows: b.skippedRows,
        failedRows: b.failedRows,
        status: b.status,
        createdBy: b.importedBy.fullName,
        createdAt: b.createdAt,
        completedAt: b.completedAt,
      })),
      ...tallyBatches.map((b) => ({
        id: b.id,
        type: "TRANSACTION" as const,
        fileName: b.originalFileName,
        totalRows: b.totalVouchers,
        validRows: b.totalVouchers - b.errorCount,
        importedRows: b.totalVouchers - b.skippedCount - b.errorCount - b.duplicateCount,
        skippedRows: b.skippedCount,
        failedRows: b.errorCount,
        status: b.status,
        createdBy: b.importedBy.fullName,
        createdAt: b.createdAt,
        completedAt: b.completedAt,
      })),
    ];

    batches.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return NextResponse.json({ success: true, data: batches });
  } catch (err) {
    console.error("[import/batches]", err);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "Unable to load import batches." } },
      { status: 500 },
    );
  }
}