import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";

const DeleteInvoiceSchema = z.object({
  confirmPermanentDelete: z.literal(true),
  reason: z.string().trim().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Admin / OWNER only
  const { auth, error } = await requireRole(req, ["OWNER"]);
  if (error) return error;
  const { id: invoiceId } = await params;

  try {
    const body = await req.json();
    const parsed = DeleteInvoiceSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 422 }
      );
    }

    const existing = await prisma.sale.findUnique({
      where: { id: invoiceId },
      include: {
        payments: true,
        inventoryMovements: true,
      },
    });

    if (!existing) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    // Block deletion if linked payments exist
    if (existing.payments.length > 0) {
      return NextResponse.json(
        {
          error:
            "Cannot permanently delete invoice with linked payments. Void the invoice instead to preserve audit history.",
        },
        { status: 422 }
      );
    }

    // Execute atomic transaction
    await prisma.$transaction(async (tx) => {
      // 1. Audit Log before deletion
      await tx.auditLog.create({
        data: {
          userId: auth.userId,
          action: "INVOICE_HARD_DELETED",
          entityType: "Sale",
          entityId: invoiceId,
          oldData: {
            invoiceNumber: existing.invoiceNumber,
            grandTotal: existing.grandTotal.toString(),
            customerId: existing.customerId,
            createdAt: existing.createdAt.toISOString(),
          } as object,
          newData: { deletedBy: auth.userId, reason: parsed.data.reason } as object,
        },
      });

      // 2. Delete linked CreditLedger entries
      await tx.creditLedger.deleteMany({
        where: { saleId: invoiceId },
      });

      // 3. Delete linked SaleItems
      await tx.saleItem.deleteMany({
        where: { saleId: invoiceId },
      });

      // 4. Delete linked InventoryMovements
      await tx.inventoryMovement.deleteMany({
        where: { saleId: invoiceId },
      });

      // 5. Delete Sale record
      await tx.sale.delete({
        where: { id: invoiceId },
      });
    });

    return NextResponse.json({
      message: "Invoice permanently deleted.",
    });
  } catch (err) {
    console.error("[POST /api/invoices/:id/delete]", err);
    return NextResponse.json(
      { error: "Server error deleting invoice" },
      { status: 500 }
    );
  }
}
