import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { exportCustomersCsv, exportCustomersXlsx } from "@/features/import-export/customer-export";
import type { ExportFilters } from "@/features/import-export/types";

export async function GET(req: NextRequest) {
  const { auth, error } = await requireAuth(req);
  if (error) return error;

  try {
    const format = req.nextUrl.searchParams.get("format") || "csv";
    const status = req.nextUrl.searchParams.get("status") || undefined;
    const customerId = req.nextUrl.searchParams.get("customerId") || undefined;

    const filters: ExportFilters = {};
    if (status) filters.status = status as "active" | "inactive" | "all";
    if (customerId) filters.customerId = customerId;

    if (format === "xlsx") {
      const buffer = await exportCustomersXlsx(filters);
      const uint8 = new Uint8Array(buffer);
      return new NextResponse(uint8, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="customers-export.xlsx"`,
        },
      });
    }

    const csv = await exportCustomersCsv(filters);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="customers-export.csv"`,
      },
    });
  } catch (err) {
    console.error("[export/customers]", err);
    return NextResponse.json(
      { success: false, error: { code: "EXPORT_FAILED", message: "Failed to export customers." } },
      { status: 500 },
    );
  }
}
