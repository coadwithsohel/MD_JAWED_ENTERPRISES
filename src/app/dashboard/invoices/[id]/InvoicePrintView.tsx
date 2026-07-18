"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Printer, ArrowLeft, Phone, MessageCircle } from "lucide-react";

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

function normalizeMobile(mobile: string): string {
  return mobile.replace(/\D/g, "").replace(/^91/, "");
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
  const openPrintView = () => {
    const printUrl = `${pathname}?print=1`;
    window.location.href = printUrl;
  };

  const sendInvoiceOnWhatsApp = () => {
    const mobile = sale.customer?.mobile
      ? normalizeMobile(sale.customer.mobile)
      : "";
    if (!mobile) return;

    const customerName = sale.customer?.fullName || "Customer";
    const businessName = settings?.businessName ?? "MD JAVED ENTERPRISES";
    const invoiceLink = `${window.location.origin}${pathname}`;
    const message = [
      `Hello ${customerName},`,
      `Thank you for shopping at ${businessName}.`,
      `Invoice No: ${sale.invoiceNumber}`,
      `Date: ${fmtDate(sale.createdAt)}`,
      `Grand Total: ${fmt(sale.grandTotal)}`,
      `Paid: ${fmt(sale.paidAmount)}`,
      sale.pendingAmount && parseFloat(sale.pendingAmount) > 0
        ? `Pending: ${fmt(sale.pendingAmount)}`
        : `Pending: ₹0.00`,
      `View invoice: ${invoiceLink}`,
    ].join("\n");

    const whatsappUrl = `https://wa.me/91${mobile}?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <>
      {/* Print Controls — hidden on print */}
      <div className="no-print mb-6 flex items-center justify-between">
        <Link
          href="/dashboard/invoices"
          className="flex items-center gap-2 text-slate-600 hover:text-slate-900 text-sm font-medium"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Sales History
        </Link>
        <div className="flex items-center gap-3">
          {sale.customer?.mobile ? (
            <button
              onClick={sendInvoiceOnWhatsApp}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm"
            >
              <MessageCircle className="h-4 w-4" /> Send on WhatsApp
            </button>
          ) : null}
          <button
            onClick={openPrintView}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm"
          >
            <Printer className="h-4 w-4" /> Print Invoice
          </button>
        </div>
      </div>

      {/* Invoice — visible always, printed cleanly */}
      <div
        id="invoice"
        className="bg-white rounded-2xl border border-slate-200 shadow-sm max-w-4xl mx-auto p-8 print:shadow-none print:border-none print:rounded-none print:p-0 print:max-w-full"
      >
        {/* Header */}
        <div className="flex items-start justify-between pb-6 border-b border-slate-200 mb-6">
          <div>
            <h1 className="text-3xl font-black text-slate-900 tracking-tight">
              {settings?.businessName ?? "MD JAVED ENTERPRISES"}
            </h1>
            {settings?.tagline && (
              <p className="text-slate-500 text-sm mt-0.5">
                {settings.tagline}
              </p>
            )}
            {settings?.primaryAddress && (
              <p className="text-slate-500 text-sm mt-1">
                {settings.primaryAddress}
                {settings.city ? `, ${settings.city}` : ""}
                {settings.state ? `, ${settings.state}` : ""}
              </p>
            )}
            {settings?.supportPhone && (
              <p className="text-slate-500 text-sm flex items-center gap-1 mt-0.5">
                <Phone className="h-3 w-3" /> {settings.supportPhone}
              </p>
            )}
            {settings?.gstNumber && (
              <p className="text-slate-500 text-xs mt-1">
                GSTIN: {settings.gstNumber}
              </p>
            )}
          </div>
          <div className="text-right">
            <h2 className="text-2xl font-bold text-blue-600">INVOICE</h2>
            <p className="text-slate-900 font-mono font-bold text-lg">
              {sale.invoiceNumber}
            </p>
            <p className="text-slate-500 text-sm mt-1">
              {fmtDate(sale.createdAt)} at {fmtTime(sale.createdAt)}
            </p>
            <span
              className={`inline-block mt-2 px-3 py-0.5 rounded-full text-xs font-semibold ${
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
        <div className="grid grid-cols-2 gap-6 mb-6">
          <div>
            <h3 className="text-xs font-semibold text-slate-400 uppercase mb-2">
              Bill To
            </h3>
            {sale.customer ? (
              <>
                <p className="text-sm font-semibold text-slate-900">
                  {sale.customer.fullName}
                </p>
                <p className="text-xs text-slate-500 font-mono">
                  {sale.customer.customerCode}
                </p>
                <p className="text-sm text-slate-600 flex items-center gap-1 mt-0.5">
                  <Phone className="h-3 w-3" />
                  {sale.customer.mobile}
                </p>
                {sale.customer.alternateMobile && (
                  <p className="text-xs text-slate-500">
                    {sale.customer.alternateMobile}
                  </p>
                )}
                {sale.customer.address && (
                  <p className="text-sm text-slate-600 mt-0.5">
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
              <p className="text-sm text-slate-500 italic">Walk-in Customer</p>
            )}
          </div>
          <div className="text-right">
            <div className="inline-block text-left">
              <h3 className="text-xs font-semibold text-slate-400 uppercase mb-2">
                Sale Details
              </h3>
              <table className="text-sm">
                <tbody>
                  <tr>
                    <td className="text-slate-500 pr-4">Type</td>
                    <td className="font-medium text-slate-900">
                      {sale.saleType}
                    </td>
                  </tr>
                  <tr>
                    <td className="text-slate-500 pr-4">Date</td>
                    <td className="font-medium text-slate-900">
                      {fmtDate(sale.createdAt)}
                    </td>
                  </tr>
                  {sale.dueDate && (
                    <tr>
                      <td className="text-slate-500 pr-4">Due Date</td>
                      <td className="font-semibold text-red-600">
                        {fmtDate(sale.dueDate)}
                      </td>
                    </tr>
                  )}
                  <tr>
                    <td className="text-slate-500 pr-4">Billed By</td>
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
        <div className="mb-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 rounded-lg">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">
                  #
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">
                  Product
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">
                  HSN
                </th>
                <th className="text-center px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">
                  Qty
                </th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">
                  Rate
                </th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">
                  GST
                </th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">
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
                    <p className="text-xs text-slate-400 font-mono">
                      {item.product.sku}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">
                    {item.product.hsnCode || "—"}
                  </td>
                  <td className="px-4 py-3 text-center text-slate-900 font-medium">
                    {item.quantity}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-900">
                    ₹{parseFloat(item.unitPrice).toLocaleString("en-IN")}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-500 text-xs">
                    {item.gstPercent}%<br />
                    <span className="text-slate-400">
                      {fmt(item.gstAmount)}
                    </span>
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
        <div className="flex justify-end mb-6">
          <div className="w-72 space-y-2">
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
            <div className="flex justify-between text-base font-bold text-slate-900 pt-2 border-t border-slate-200">
              <span>Grand Total</span>
              <span className="text-blue-600">{fmt(sale.grandTotal)}</span>
            </div>
            <div className="flex justify-between text-sm text-green-700 font-medium">
              <span>Amount Paid</span>
              <span>{fmt(sale.paidAmount)}</span>
            </div>
            {parseFloat(sale.pendingAmount) > 0 && (
              <div className="flex justify-between text-sm font-bold text-red-600 bg-red-50 px-3 py-2 rounded-lg">
                <span>Amount Pending</span>
                <span>{fmt(sale.pendingAmount)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Payments */}
        {sale.payments.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-slate-700 mb-2">
              Payment History
            </h3>
            <div className="space-y-1">
              {sale.payments.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between text-sm bg-green-50 border border-green-100 rounded-lg px-3 py-2"
                >
                  <span className="text-green-800">
                    {p.paymentMode}{" "}
                    {p.referenceNumber ? `(${p.referenceNumber})` : ""}
                  </span>
                  <div className="text-right">
                    <span className="font-semibold text-green-900">
                      {fmt(p.amount)}
                    </span>
                    <span className="text-green-600 text-xs ml-2">
                      {fmtDate(p.paymentDate)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="border-t border-slate-200 pt-6 grid grid-cols-2 gap-6">
          <div>
            {settings?.termsAndConditions && (
              <>
                <p className="text-xs font-semibold text-slate-500 uppercase mb-1">
                  Terms & Conditions
                </p>
                <p className="text-xs text-slate-400">
                  {settings.termsAndConditions}
                </p>
              </>
            )}
            <p className="text-xs text-slate-400 mt-3">
              Thank you for your business! 🙏
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-400 mb-8">Authorized Signatory</p>
            <p className="text-xs font-semibold text-slate-700 border-t border-slate-300 pt-1 inline-block min-w-[120px]">
              {settings?.businessName ?? "MD Javed Enterprises"}
            </p>
          </div>
        </div>

        {sale.notes && (
          <div className="mt-4 bg-slate-50 rounded-lg p-3">
            <p className="text-xs font-semibold text-slate-500 mb-1">Notes</p>
            <p className="text-sm text-slate-600">{sale.notes}</p>
          </div>
        )}
      </div>
    </>
  );
}
