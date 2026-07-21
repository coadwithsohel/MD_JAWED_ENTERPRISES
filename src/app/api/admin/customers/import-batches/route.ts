import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const { error } = await requireRole(req, ["OWNER", "MANAGER"]);
  if (error) return error;

  try {
    const batches = await prisma.customerImportBatch.findMany({
      select: {
        id: true,
        originalFileName: true,
        createdAt: true,
        status: true,
      },
      orderBy: [{ createdAt: "desc" }],
    });

    return NextResponse.json({ ok: true, batches });
  } catch (err) {
    console.error("[GET /api/admin/customers/import-batches]", err);
    return NextResponse.json(
      { error: "Unable to load import batches" },
      { status: 500 },
    );
  }
}
