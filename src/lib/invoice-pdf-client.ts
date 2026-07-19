"use client";

import { formatDate, formatINR } from "@/lib/utils";

export type InvoicePdfUiState =
  | "idle"
  | "loading"
  | "sharing"
  | "downloaded"
  | "cancelled"
  | "error";

export interface InvoicePdfShareContext {
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  customerMobile?: string;
  businessName: string;
  invoiceDate: string;
  grandTotal: string | number;
  paidAmount: string | number;
  pendingAmount: string | number;
}

export function normalizeMobileForWhatsApp(mobile: string): string {
  return mobile.replace(/\D/g, "").replace(/^91/, "");
}

export function buildWhatsAppInvoiceMessage(ctx: InvoicePdfShareContext): string {
  const pending =
    parseFloat(String(ctx.pendingAmount)) > 0
      ? formatINR(ctx.pendingAmount)
      : "₹0.00";

  return [
    `Hello ${ctx.customerName},`,
    `Thank you for shopping at ${ctx.businessName}.`,
    `Invoice No: ${ctx.invoiceNumber}`,
    `Date: ${ctx.invoiceDate}`,
    `Grand Total: ${formatINR(ctx.grandTotal)}`,
    `Paid: ${formatINR(ctx.paidAmount)}`,
    `Pending: ${pending}`,
    "Please find your invoice PDF attached.",
  ].join("\n");
}

export function openWhatsAppWithMessage(mobile: string, message: string): void {
  const normalized = normalizeMobileForWhatsApp(mobile);
  if (!normalized) return;
  const whatsappUrl = `https://wa.me/91${normalized}?text=${encodeURIComponent(message)}`;
  window.open(whatsappUrl, "_blank", "noopener,noreferrer");
}

export function downloadPdfBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function parseFilenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const match = header.match(/filename="([^"]+)"/i);
  return match?.[1] ?? null;
}

export async function fetchInvoicePdfBlob(
  invoiceId: string,
): Promise<{ blob: Blob; filename: string }> {
  const response = await fetch(
    `/api/invoices/${encodeURIComponent(invoiceId)}/pdf`,
    {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
    },
  );

  if (!response.ok) {
    const contentType = response.headers.get("content-type");
    let details = "";

    if (contentType?.includes("application/json")) {
      const data = await response.json().catch(() => null);
      details = data?.error || data?.message || "";
    } else {
      details = await response.text().catch(() => "");
    }

    throw new Error(
      `PDF request failed with status ${response.status}${
        details ? `: ${details}` : ""
      }`,
    );
  }

  const contentType = response.headers.get("content-type");
  if (!contentType?.includes("application/pdf")) {
    const text = await response.text();
    throw new Error(
      `Expected PDF but received ${contentType || "unknown content type"}: ${text.slice(0, 200)}`,
    );
  }

  const blob = await response.blob();

  if (blob.size === 0) {
    throw new Error("Received an empty PDF file");
  }

  const filename =
    parseFilenameFromDisposition(response.headers.get("Content-Disposition")) ??
    `invoice-${invoiceNumberToFilename(invoiceId)}.pdf`;

  return { blob, filename };
}

function invoiceNumberToFilename(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function blobToPdfFile(blob: Blob, filename: string): File {
  return new File([blob], filename, { type: "application/pdf" });
}

function canSharePdfFile(file: File): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [file] })
  );
}

export async function downloadInvoicePdf(
  invoiceId: string,
): Promise<{ filename: string }> {
  const { blob, filename } = await fetchInvoicePdfBlob(invoiceId);
  downloadPdfBlob(blob, filename);
  return { filename };
}

export async function shareInvoicePdfFile(
  ctx: InvoicePdfShareContext,
): Promise<"shared" | "downloaded" | "cancelled"> {
  const { blob, filename } = await fetchInvoicePdfBlob(ctx.invoiceId);
  const file = blobToPdfFile(blob, filename);

  if (canSharePdfFile(file)) {
    try {
      await navigator.share({
        files: [file],
        title: `Invoice ${ctx.invoiceNumber}`,
        text: `Invoice ${ctx.invoiceNumber} from ${ctx.businessName}`,
      });
      return "shared";
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return "cancelled";
      }
      throw err;
    }
  }

  downloadPdfBlob(blob, filename);
  return "downloaded";
}

export async function sendInvoicePdfOnWhatsApp(
  ctx: InvoicePdfShareContext,
): Promise<"shared" | "downloaded" | "cancelled"> {
  const { blob, filename } = await fetchInvoicePdfBlob(ctx.invoiceId);
  const file = blobToPdfFile(blob, filename);
  const message = buildWhatsAppInvoiceMessage(ctx);

  if (canSharePdfFile(file)) {
    try {
      await navigator.share({
        files: [file],
        title: `Invoice ${ctx.invoiceNumber}`,
        text: message,
      });
      return "shared";
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return "cancelled";
      }
      throw err;
    }
  }

  downloadPdfBlob(blob, filename);

  if (ctx.customerMobile) {
    openWhatsAppWithMessage(ctx.customerMobile, message);
  }

  return "downloaded";
}

export function buildInvoiceShareContext(params: {
  invoiceId: string;
  invoiceNumber: string;
  createdAt: string;
  customerName?: string | null;
  customerMobile?: string | null;
  businessName?: string | null;
  grandTotal: string | number;
  paidAmount: string | number;
  pendingAmount: string | number;
}): InvoicePdfShareContext {
  return {
    invoiceId: params.invoiceId,
    invoiceNumber: params.invoiceNumber,
    customerName: params.customerName ?? "Customer",
    customerMobile: params.customerMobile ?? undefined,
    businessName: params.businessName ?? "MD JAVED ENTERPRISES",
    invoiceDate: formatDate(params.createdAt),
    grandTotal: params.grandTotal,
    paidAmount: params.paidAmount,
    pendingAmount: params.pendingAmount,
  };
}
