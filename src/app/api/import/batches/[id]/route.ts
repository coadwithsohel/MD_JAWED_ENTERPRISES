import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } },
) {
  const { auth, error } = await requireAuth(req);
  if (error) return error;

  const { id } = await params;

  try {
    // Try customer batch first
    const customerBatch = await prisma.customerImportBatch.findUnique({
      where: { id },
      include: {
        importedBy: { select: { fullName: true } },
        rows: {
          orderBy: { rowNumber: "asc" },
          take: 200,
        },
      },
    });

    if (customerBatch) {
      return NextResponse.json({
        success: true,
        data: {
          type: "CUSTOMER",
          ...customerBatch,
        },
      });
    }

    // Try tally batch
    const tallyBatch = await prisma.tallyImportBatch.findUnique({
      where: { id },
      include: {
        importedBy: { select: { fullName: true } },
        vouchers: {
          orderBy: { createdAt: "asc" },
          take: 200,
        },
      },
    });

    if (tallyBatch) {
      return NextResponse.json({
        success: true,
        data: {
          type: "TRANSACTION",
          ...tallyBatch,
        },
      });
    }

    return NextResponse.json(
      { success: false, error: { code: "BATCH_NOT_FOUND", message: "Import batch not found." } },
      { status: 404 },
    );
  } catch (err) {
    console.error("[import/batches/[id]]", err);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "Unable to load import batch." } },
      { status: 500 },
    );
  }
}