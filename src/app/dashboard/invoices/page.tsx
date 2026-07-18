"use client";

import { useState, useEffect } from "react";
import { Search, Loader2, FileText, X, MessageCircle } from "lucide-react";
import Link from "next/link";

interface Sale {
  id: string;
  invoiceNumber: string;
  createdAt: string;
  customer: { fullName: string; mobile: string; customerCode: string } | null;
  createdBy: { fullName: string } | null;
  subtotal: string;
  gstAmount: string;
  discountAmount: string;
  grandTotal: string;
  paidAmount: string;
  pendingAmount: string;
  saleType: string;
  status: string;
  paymentStatus: string;
}

function normalizeMobile(mobile: string): string {
  return mobile.replace(/\D/g, "").replace(/^91/, "");
}

export default function InvoicesPage() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const LIMIT = 20;

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
    }, 0);
    return () => clearTimeout(t);
  }, [debouncedSearch]);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();

    requestAnimationFrame(() => {
      if (alive) setLoading(true);
    });

    void (async () => {
      try {
        const params = new URLSearchParams({
          page: String(page),
          limit: String(LIMIT),
        });
        if (debouncedSearch) params.set("search", debouncedSearch);
        const res = await fetch(`/api/sales?${params}`, {
          signal: controller.signal,
        });
        const data = await res.json();
        if (!alive) return;
        setSales(data.sales ?? []);
        setTotal(data.total ?? 0);
      } catch {
        if (!alive) return;
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
      controller.abort();
    };
  }, [page, debouncedSearch]);

  const fmt = (n: string | number) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(parseFloat(String(n)));
  const PAGES = Math.ceil(total / LIMIT);

  const saleTypeBadge = (t: string) =>
    ({
      CASH: "bg-green-100 text-green-700",
      CREDIT: "bg-orange-100 text-orange-700",
      PARTIAL: "bg-amber-100 text-amber-700",
    })[t] ?? "bg-slate-100 text-slate-600";
  const statusBadge = (s: string) =>
    ({
      PAID: "bg-green-100 text-green-700",
      PARTIALLY_PAID: "bg-amber-100 text-amber-700",
      UNPAID: "bg-red-100 text-red-700",
      OVERDUE: "bg-red-200 text-red-800",
    })[s] ?? "bg-slate-100 text-slate-600";

  const sendInvoiceOnWhatsApp = (sale: Sale) => {
    if (!sale.customer?.mobile) return;

    const mobile = normalizeMobile(sale.customer.mobile);
    if (!mobile) return;

    const invoiceUrl = `${window.location.origin}/dashboard/invoices/${sale.id}`;
    const message = [
      `Hello ${sale.customer.fullName},`,
      `Thank you for shopping at MD Javed Enterprises.`,
      `Invoice No: ${sale.invoiceNumber}`,
      `Date: ${new Date(sale.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Kolkata" })}`,
      `Grand Total: ${fmt(sale.grandTotal)}`,
      `Paid: ${fmt(sale.paidAmount)}`,
      `Pending: ${parseFloat(sale.pendingAmount) > 0 ? fmt(sale.pendingAmount) : "₹0"}`,
      `View invoice: ${invoiceUrl}`,
    ].join("\n");

    window.open(
      `https://wa.me/91${mobile}?text=${encodeURIComponent(message)}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Sales History</h1>
          <p className="text-sm text-slate-500">{total} total invoices</p>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search invoice, customer..."
          className="block w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-8 w-8 text-blue-500 animate-spin" />
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  {[
                    "Invoice",
                    "Date",
                    "Customer",
                    "Type",
                    "Grand Total",
                    "Paid",
                    "Pending",
                    "Payment Status",
                    "",
                  ].map((h) => (
                    <th
                      key={h}
                      className="px-5 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100">
                {sales.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-16 text-center">
                      <FileText className="h-10 w-10 text-slate-200 mx-auto mb-2" />
                      <p className="text-slate-400 text-sm">
                        {debouncedSearch ? "No sales found" : "No sales yet"}
                      </p>
                    </td>
                  </tr>
                ) : (
                  sales.map((s) => (
                    <tr
                      key={s.id}
                      className="hover:bg-slate-50 transition-colors"
                    >
                      <td className="px-5 py-3 whitespace-nowrap">
                        <span className="font-mono text-sm font-semibold text-blue-600">
                          {s.invoiceNumber}
                        </span>
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap text-sm text-slate-500">
                        {new Date(s.createdAt).toLocaleDateString("en-IN", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                          timeZone: "Asia/Kolkata",
                        })}
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        <p className="text-sm font-medium text-slate-900">
                          {s.customer?.fullName ?? "Walk-in"}
                        </p>
                        {s.customer && (
                          <p className="text-xs text-slate-400 font-mono">
                            {s.customer.customerCode}
                          </p>
                        )}
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-medium ${saleTypeBadge(s.saleType)}`}
                        >
                          {s.saleType}
                        </span>
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap text-sm font-bold text-slate-900">
                        {fmt(s.grandTotal)}
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap text-sm text-green-700 font-medium">
                        {fmt(s.paidAmount)}
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap text-sm text-red-600 font-medium">
                        {parseFloat(s.pendingAmount) > 0
                          ? fmt(s.pendingAmount)
                          : "—"}
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusBadge(s.paymentStatus)}`}
                        >
                          {s.paymentStatus}
                        </span>
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap text-right">
                        <div className="flex items-center justify-end gap-2">
                          {s.customer?.mobile ? (
                            <button
                              onClick={() => sendInvoiceOnWhatsApp(s)}
                              className="inline-flex items-center gap-1 text-xs px-3 py-1.5 bg-green-50 text-green-700 rounded-lg hover:bg-green-100 transition-colors font-medium"
                              title="Send invoice on WhatsApp"
                            >
                              <MessageCircle className="h-3 w-3" /> WhatsApp
                            </button>
                          ) : null}
                          <Link
                            href={`/dashboard/invoices/${s.id}`}
                            className="text-xs text-blue-600 hover:underline font-medium"
                          >
                            View
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {PAGES > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage(page - 1)}
            disabled={page === 1}
            className="px-3 py-1.5 rounded-lg border border-slate-200 text-sm disabled:opacity-50 hover:bg-slate-50"
          >
            Prev
          </button>
          <span className="text-sm text-slate-600">
            Page {page} of {PAGES}
          </span>
          <button
            onClick={() => setPage(page + 1)}
            disabled={page === PAGES}
            className="px-3 py-1.5 rounded-lg border border-slate-200 text-sm disabled:opacity-50 hover:bg-slate-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
