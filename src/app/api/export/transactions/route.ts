import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { exportTransactionsCsv, exportTransactionsXlsx } from "@/features/import-export/transaction-export";
import type { ExportFilters } from "@/features/import-export/types";

export async function GET(req: NextRequest) {
  const { auth, error } = await requireAuth(req);
  if (error) return error;

  try {
    const format = req.nextUrl.searchParams.get("format") || "csv";
    const dateFrom = req.nextUrl.searchParams.get("dateFrom") || undefined;
    const dateTo = req.nextUrl.searchParams.get("dateTo") || undefined;
    const customerId = req.nextUrl.searchParams.get("customerId") || undefined;
    const voucherType = req.nextUrl.searchParams.get("voucherType") || undefined;
    const importBatchId = req.nextUrl.searchParams.get("importBatchId") || undefined;

    const filters: ExportFilters = {};
    if (dateFrom) filters.dateFrom = dateFrom;
    if (dateTo) filters.dateTo = dateTo;
    if (customerId) filters.customerId = customerId;
    if (voucherType) filters.voucherType = voucherType as ExportFilters["voucherType"];
    if (importBatchId) filters.importBatchId = importBatchId;

    if (format === "xlsx") {
      const buffer = await exportTransactionsXlsx(filters);
      const uint8 = new Uint8Array(buffer);
      return new NextResponse(uint8, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="transactions-export.xlsx"`,
        },
      });
    }

    const csv = await exportTransactionsCsv(filters);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="transactions-export.csv"`,
      },
    });
  } catch (err) {
    console.error("[export/transactions]", err);
    return NextResponse.json(
      { success: false, error: { code: "EXPORT_FAILED", message: "Failed to export transactions." } },
      { status: 500 },
    );
  }
}