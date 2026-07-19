"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Printer,
  ArrowLeft,
  Phone,
  MessageCircle,
  Download,
  Share2,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import {
  buildInvoiceShareContext,
  downloadInvoicePdf,
  sendInvoicePdfOnWhatsApp,
  shareInvoicePdfFile,
  type InvoicePdfUiState,
} from "@/lib/invoice-pdf-client";

interface SaleItem {
  id: string;
  product: { name: string; sku: string; hsnCode?: string | null };
  quantity: number;
  unitPrice: string;
  discountAmount: string;
  gstPercent: string;
  gstAmount: string;
  lineTotal: string;
}

interface Sale {
  id: string;
  invoiceNumber: string;
  createdAt: string;
  dueDate?: string | null;
  customer?: {
    customerCode: string;
    fullName: string;
    mobile: string;
    alternateMobile?: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    pinCode?: string | null;
  } | null;
  createdBy: { fullName: string };
  saleItems: SaleItem[];
  subtotal: string;
  discountAmount: string;
  gstAmount: string;
  grandTotal: string;
  paidAmount: string;
  pendingAmount: string;
  saleType: string;
  status: string;
  paymentStatus: string;
  notes?: string | null;
  payments: Array<{
    id: string;
    amount: string;
    paymentMode: string;
    paymentDate: string;
    referenceNumber?: string | null;
  }>;
}

interface Settings {
  businessName: string;
  tagline?: string | null;
  ownerName?: string | null;
  supportPhone?: string | null;
  primaryAddress?: string | null;
  city?: string | null;
  state?: string | null;
  gstNumber?: string | null;
  currency: string;
  termsAndConditions?: string | null;
}

export default function InvoicePrintView({
  sale,
  settings,
}: {
  sale: Sale;
  settings: Settings | null;
}) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const shouldPrint = searchParams.get("print") === "1";

  const [pdfState, setPdfState] = useState<InvoicePdfUiState>("idle");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const actionInFlight = useRef(false);

  useEffect(() => {
    if (shouldPrint) {
      setTimeout(() => window.print(), 500);
    }
  }, [shouldPrint]);

  const fmt = (n: string | number) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      minimumFractionDigits: 2,
    }).format(parseFloat(String(n)));

  const fmtDate = (d: string) =>
    new Date(d).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "Asia/Kolkata",
    });

  const fmtTime = (d: string) =>
    new Date(d).toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Kolkata",
    });

  const shareContext = buildInvoiceShareContext({
    invoiceId: sale.id,
    invoiceNumber: sale.invoiceNumber,
    createdAt: sale.createdAt,
    customerName: sale.customer?.fullName,
    customerMobile: sale.customer?.mobile,
    businessName: settings?.businessName,
    grandTotal: sale.grandTotal,
    paidAmount: sale.paidAmount,
    pendingAmount: sale.pendingAmount,
  });

  const isBusy = pdfState === "loading" || pdfState === "sharing";

  const runPdfAction = async (
    mode: "download" | "share" | "whatsapp",
    nextState: "loading" | "sharing",
  ) => {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setPdfState(nextState);
    setStatusMessage(null);

    try {
      if (mode === "download") {
        const { filename } = await downloadInvoicePdf(sale.id);
        setPdfState("downloaded");
        setStatusMessage(`PDF downloaded: ${filename}`);
      } else if (mode === "share") {
        const result = await shareInvoicePdfFile(shareContext);
        if (result === "shared") {
          setPdfState("idle");
          setStatusMessage("Invoice PDF shared successfully.");
        } else if (result === "cancelled") {
          setPdfState("cancelled");
          setStatusMessage("Share cancelled.");
        } else {
          setPdfState("downloaded");
          setStatusMessage(
            "File sharing is not supported on this device. The PDF has been downloaded.",
          );
        }
      } else {
        const result = await sendInvoicePdfOnWhatsApp(shareContext);
        if (result === "shared") {
          setPdfState("idle");
          setStatusMessage("Choose WhatsApp in the share sheet to send the PDF.");
        } else if (result === "cancelled") {
          setPdfState("cancelled");
          setStatusMessage("Share cancelled.");
        } else {
          setPdfState("downloaded");
          setStatusMessage(
            sale.customer?.mobile
              ? "PDF downloaded. WhatsApp opened — please attach the downloaded PDF manually."
              : "PDF downloaded. File sharing is not supported on this device.",
          );
        }
      }
    } catch (err) {
      setPdfState("error");
      setStatusMessage(
        err instanceof Error ? err.message : "Failed to process invoice PDF",
      );
    } finally {
      actionInFlight.current = false;
      setTimeout(() => {
        setPdfState((current) =>
          current === "downloaded" ||
          current === "error" ||
          current === "cancelled"
            ? "idle"
            : current,
        );
        setStatusMessage(null);
      }, 6000);
    }
  };

  const openPrintView = () => {
    window.location.href = `${pathname}?print=1`;
  };

  const statusTone =
    pdfState === "error"
      ? "border-red-200 bg-red-50 text-red-800"
      : pdfState === "cancelled"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-green-200 bg-green-50 text-green-800";

  return (
    <>
      {/* Print Controls — hidden on print */}
      <div className="no-print mb-6 space-y-3">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <Link
            href="/dashboard/invoices"
            className="flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="h-4 w-4" /> Back to Sales History
          </Link>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <button
              onClick={() => runPdfAction("download", "loading")}
              disabled={isBusy}
              className="flex items-center gap-2 rounded-xl bg-slate-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pdfState === "loading" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Download PDF
            </button>
            <button
              onClick={openPrintView}
              disabled={isBusy}
              className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Printer className="h-4 w-4" /> Print Invoice
            </button>
            <button
              onClick={() => runPdfAction("share", "sharing")}
              disabled={isBusy}
              className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pdfState === "sharing" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Share2 className="h-4 w-4" />
              )}
              Share PDF
            </button>
            {sale.customer?.mobile ? (
              <button
                onClick={() => runPdfAction("whatsapp", "sharing")}
                disabled={isBusy}
                className="flex items-center gap-2 rounded-xl bg-green-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pdfState === "sharing" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <MessageCircle className="h-4 w-4" />
                )}
                Send PDF on WhatsApp
              </button>
            ) : null}
          </div>
        </div>

        {statusMessage ? (
          <div
            className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${statusTone}`}
          >
            {pdfState === "error" ? (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <p>{statusMessage}</p>
          </div>
        ) : null}
      </div>

      {/* Invoice — visible always, printed cleanly */}
      <div
        id="invoice"
        className="mx-auto max-w-4xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm print:max-w-full print:rounded-none print:border-none print:p-0 print:shadow-none"
      >
        {/* Header */}
        <div className="mb-6 flex items-start justify-between border-b border-slate-200 pb-6">
          <div>
            <h1 className="text-3xl font-black tracking-tight text-slate-900">
              {settings?.businessName ?? "MD JAVED ENTERPRISES"}
            </h1>
            {settings?.tagline && (
              <p className="mt-0.5 text-sm text-slate-500">{settings.tagline}</p>
            )}
            {settings?.primaryAddress && (
              <p className="mt-1 text-sm text-slate-500">
                {settings.primaryAddress}
                {settings.city ? `, ${settings.city}` : ""}
                {settings.state ? `, ${settings.state}` : ""}
              </p>
            )}
            {settings?.supportPhone && (
              <p className="mt-0.5 flex items-center gap-1 text-sm text-slate-500">
                <Phone className="h-3 w-3" /> {settings.supportPhone}
              </p>
            )}
            {settings?.gstNumber && (
              <p className="mt-1 text-xs text-slate-500">
                GSTIN: {settings.gstNumber}
              </p>
            )}
          </div>
          <div className="text-right">
            <h2 className="text-2xl font-bold text-blue-600">INVOICE</h2>
            <p className="font-mono text-lg font-bold text-slate-900">
              {sale.invoiceNumber}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {fmtDate(sale.createdAt)} at {fmtTime(sale.createdAt)}
            </p>
            <span
              className={`mt-2 inline-block rounded-full px-3 py-0.5 text-xs font-semibold ${
                sale.paymentStatus === "PAID"
                  ? "bg-green-100 text-green-800"
                  : sale.paymentStatus === "PARTIALLY_PAID"
                    ? "bg-amber-100 text-amber-800"
                    : "bg-red-100 text-red-800"
              }`}
            >
              {sale.paymentStatus}
            </span>
          </div>
        </div>

        {/* Bill To */}
        <div className="mb-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase text-slate-400">
              Bill To
            </h3>
            {sale.customer ? (
              <>
                <p className="text-sm font-semibold text-slate-900">
                  {sale.customer.fullName}
                </p>
                <p className="font-mono text-xs text-slate-500">
                  {sale.customer.customerCode}
                </p>
                <p className="mt-0.5 flex items-center gap-1 text-sm text-slate-600">
                  <Phone className="h-3 w-3" />
                  {sale.customer.mobile}
                </p>
                {sale.customer.alternateMobile && (
                  <p className="text-xs text-slate-500">
                    {sale.customer.alternateMobile}
                  </p>
                )}
                {sale.customer.address && (
                  <p className="mt-0.5 text-sm text-slate-600">
                    {sale.customer.address}
                  </p>
                )}
                {sale.customer.city && (
                  <p className="text-sm text-slate-600">
                    {sale.customer.city}
                    {sale.customer.state ? `, ${sale.customer.state}` : ""}
                    {sale.customer.pinCode ? ` - ${sale.customer.pinCode}` : ""}
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm italic text-slate-500">Walk-in Customer</p>
            )}
          </div>
          <div className="sm:text-right">
            <div className="inline-block text-left">
              <h3 className="mb-2 text-xs font-semibold uppercase text-slate-400">
                Sale Details
              </h3>
              <table className="text-sm">
                <tbody>
                  <tr>
                    <td className="pr-4 text-slate-500">Type</td>
                    <td className="font-medium text-slate-900">{sale.saleType}</td>
                  </tr>
                  <tr>
                    <td className="pr-4 text-slate-500">Date</td>
                    <td className="font-medium text-slate-900">
                      {fmtDate(sale.createdAt)}
                    </td>
                  </tr>
                  {sale.dueDate && (
                    <tr>
                      <td className="pr-4 text-slate-500">Due Date</td>
                      <td className="font-semibold text-red-600">
                        {fmtDate(sale.dueDate)}
                      </td>
                    </tr>
                  )}
                  <tr>
                    <td className="pr-4 text-slate-500">Billed By</td>
                    <td className="font-medium text-slate-900">
                      {sale.createdBy.fullName}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Items Table */}
        <div className="mb-6 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="rounded-lg bg-slate-50">
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-slate-500">
                  #
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-slate-500">
                  Product
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-slate-500">
                  HSN
                </th>
                <th className="px-4 py-2.5 text-center text-xs font-semibold uppercase text-slate-500">
                  Qty
                </th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase text-slate-500">
                  Rate
                </th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase text-slate-500">
                  GST
                </th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase text-slate-500">
                  Total
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sale.saleItems.map((item, i) => (
                <tr key={item.id}>
                  <td className="px-4 py-3 text-slate-400">{i + 1}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">
                      {item.product.name}
                    </p>
                    <p className="font-mono text-xs text-slate-400">
                      {item.product.sku}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {item.product.hsnCode || "—"}
                  </td>
                  <td className="px-4 py-3 text-center font-medium text-slate-900">
                    {item.quantity}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-900">
                    ₹{parseFloat(item.unitPrice).toLocaleString("en-IN")}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-slate-500">
                    {item.gstPercent}%<br />
                    <span className="text-slate-400">{fmt(item.gstAmount)}</span>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-900">
                    {fmt(item.lineTotal)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="mb-6 flex justify-end">
          <div className="w-full max-w-xs space-y-2 sm:w-72">
            <div className="flex justify-between text-sm text-slate-500">
              <span>Subtotal</span>
              <span>{fmt(sale.subtotal)}</span>
            </div>
            {parseFloat(sale.discountAmount) > 0 && (
              <div className="flex justify-between text-sm text-green-600">
                <span>Discount</span>
                <span>−{fmt(sale.discountAmount)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm text-slate-500">
              <span>GST</span>
              <span>{fmt(sale.gstAmount)}</span>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-bold text-slate-900">
              <span>Grand Total</span>
              <span className="text-blue-600">{fmt(sale.grandTotal)}</span>
            </div>
            <div className="flex justify-between text-sm font-medium text-green-700">
              <span>Amount Paid</span>
              <span>{fmt(sale.paidAmount)}</span>
            </div>
            {parseFloat(sale.pendingAmount) > 0 && (
              <div className="flex justify-between rounded-lg bg-red-50 px-3 py-2 text-sm font-bold text-red-600">
                <span>Amount Pending</span>
                <span>{fmt(sale.pendingAmount)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Payments */}
        {sale.payments.length > 0 && (
          <div className="mb-6">
            <h3 className="mb-2 text-sm font-semibold text-slate-700">
              Payment History
            </h3>
            <div className="space-y-1">
              {sale.payments.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between rounded-lg border border-green-100 bg-green-50 px-3 py-2 text-sm"
                >
                  <span className="text-green-800">
                    {p.paymentMode}{" "}
                    {p.referenceNumber ? `(${p.referenceNumber})` : ""}
                  </span>
                  <div className="text-right">
                    <span className="font-semibold text-green-900">
                      {fmt(p.amount)}
                    </span>
                    <span className="ml-2 text-xs text-green-600">
                      {fmtDate(p.paymentDate)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="grid grid-cols-1 gap-6 border-t border-slate-200 pt-6 sm:grid-cols-2">
          <div>
            {settings?.termsAndConditions && (
              <>
                <p className="mb-1 text-xs font-semibold uppercase text-slate-500">
                  Terms & Conditions
                </p>
                <p className="text-xs text-slate-400">
                  {settings.termsAndConditions}
                </p>
              </>
            )}
            <p className="mt-3 text-xs text-slate-400">
              Thank you for your business!
            </p>
          </div>
          <div className="sm:text-right">
            <p className="mb-8 text-xs text-slate-400">Authorized Signatory</p>
            <p className="inline-block min-w-[120px] border-t border-slate-300 pt-1 text-xs font-semibold text-slate-700">
              {settings?.businessName ?? "MD Javed Enterprises"}
            </p>
          </div>
        </div>

        {sale.notes && (
          <div className="mt-4 rounded-lg bg-slate-50 p-3">
            <p className="mb-1 text-xs font-semibold text-slate-500">Notes</p>
            <p className="text-sm text-slate-600">{sale.notes}</p>
          </div>
        )}
      </div>
    </>
  );
}
