import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import {
  generateInvoicePdf,
  isValidInvoiceId,
  sanitizeInvoiceFilename,
} from "@/lib/invoice-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> },
) {
  try {
    const { error } = await requireAuth(req);
    if (error) return error;

    const { invoiceId } = await params;

    if (!invoiceId || !isValidInvoiceId(invoiceId)) {
      return NextResponse.json({ error: "Invalid invoice id" }, { status: 400 });
    }

    const sale = await prisma.sale.findUnique({
      where: { id: invoiceId },
      select: {
        invoiceNumber: true,
        createdAt: true,
        dueDate: true,
        subtotal: true,
        discountAmount: true,
        gstAmount: true,
        grandTotal: true,
        paidAmount: true,
        pendingAmount: true,
        paymentStatus: true,
        saleType: true,
        notes: true,
        customer: {
          select: {
            fullName: true,
            mobile: true,
            customerCode: true,
            alternateMobile: true,
            address: true,
            city: true,
            state: true,
            pinCode: true,
          },
        },
        createdBy: { select: { fullName: true } },
        saleItems: {
          select: {
            quantity: true,
            unitPrice: true,
            discountAmount: true,
            gstPercent: true,
            gstAmount: true,
            lineTotal: true,
            product: {
              select: { name: true, sku: true, hsnCode: true },
            },
          },
        },
        payments: {
          orderBy: { paymentDate: "desc" },
          select: {
            amount: true,
            paymentMode: true,
            paymentDate: true,
            referenceNumber: true,
          },
        },
      },
    });

    if (!sale) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    const settings = await prisma.shopSettings.findFirst({
      select: {
        businessName: true,
        tagline: true,
        ownerName: true,
        supportPhone: true,
        supportEmail: true,
        primaryAddress: true,
        city: true,
        state: true,
        pinCode: true,
        gstNumber: true,
        termsAndConditions: true,
      },
    });

    const pdfBuffer = await generateInvoicePdf(
      {
        invoiceNumber: sale.invoiceNumber,
        createdAt: sale.createdAt,
        dueDate: sale.dueDate,
        customer: sale.customer,
        createdBy: sale.createdBy,
        saleItems: sale.saleItems.map((item) => ({
          product: item.product,
          quantity: item.quantity,
          unitPrice: item.unitPrice.toString(),
          discountAmount: item.discountAmount.toString(),
          gstPercent: item.gstPercent.toString(),
          gstAmount: item.gstAmount.toString(),
          lineTotal: item.lineTotal.toString(),
        })),
        subtotal: sale.subtotal.toString(),
        discountAmount: sale.discountAmount.toString(),
        gstAmount: sale.gstAmount.toString(),
        grandTotal: sale.grandTotal.toString(),
        paidAmount: sale.paidAmount.toString(),
        pendingAmount: sale.pendingAmount.toString(),
        paymentStatus: sale.paymentStatus,
        saleType: sale.saleType,
        notes: sale.notes,
        payments: sale.payments.map((payment) => ({
          amount: payment.amount.toString(),
          paymentMode: payment.paymentMode,
          paymentDate: payment.paymentDate,
          referenceNumber: payment.referenceNumber,
        })),
      },
      settings,
    );

    if (!pdfBuffer || pdfBuffer.length === 0) {
      throw new Error("Generated PDF is empty");
    }

    const filename = sanitizeInvoiceFilename(sale.invoiceNumber);

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(pdfBuffer.length),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("[GET /api/invoices/[invoiceId]/pdf]", err);
    const message =
      err instanceof Error ? err.message : "Failed to generate invoice PDF";
    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}