import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { toPaise } from "@/lib/money";

export async function GET(req: NextRequest) {
  const { error } = await requireRole(req, ["OWNER", "MANAGER"]);
  if (error) return error;

  try {
    const customers = await prisma.customer.findMany({
      select: {
        id: true,
        fullName: true,
        mobile: true,
        address: true,
        creditLimit: true,
        openingBalance: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: "asc" }],
    });

    const header = [
      "id",
      "name",
      "mobile",
      "address",
      "creditLimit",
      "openingBalance",
      "status",
      "createdAt",
    ].join(",");
    const rows = customers.map((customer) => {
      const values = [
        customer.id,
        `"${(customer.fullName ?? "").replace(/"/g, '""')}"`,
        `"${(customer.mobile ?? "").replace(/"/g, '""')}"`,
        `"${(customer.address ?? "").replace(/"/g, '""')}"`,
        toPaise(customer.creditLimit),
        toPaise(customer.openingBalance),
        customer.isActive ? "active" : "inactive",
        customer.createdAt.toISOString(),
      ];
      return values.join(",");
    });

    const csv = [header, ...rows].join("\n");
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="customer-backup-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (error) {
    console.error("[GET /api/admin/customers/export-backup]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
