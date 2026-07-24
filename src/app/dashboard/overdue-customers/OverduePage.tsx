'use client';

import { useState } from 'react';
import { AlertTriangle, Phone, MessageCircle, Search, X, ArrowRight } from 'lucide-react';
import Link from 'next/link';

interface OverdueInvoice {
  id: string; invoiceNumber: string;
  customer?: {
    id: string; customerCode: string; fullName: string; mobile: string;
    alternateMobile?: string | null; city?: string | null;
  } | null;
  createdAt: string; dueDate?: string | null;
  daysOverdue: number; grandTotal: string; paidAmount: string; pendingAmount: string;
  saleType: string; paymentStatus: string;
}

interface OverdueCustomer {
  customer: {
    id: string; customerCode: string; fullName: string; mobile: string;
    alternateMobile?: string | null; city?: string | null;
  } | null;
  overdueInvoiceCount: number;
  totalOverdueAmount: string;
  oldestDueDate: string;
  maxDaysOverdue: number;
}

interface OverduePageData {
  invoices: OverdueInvoice[];
  customers: OverdueCustomer[];
  total: number;
}

export default function OverduePage({ initialData }: { initialData: OverduePageData }) {
  const [view, setView] = useState<'customers' | 'invoices'>('customers');
  const [search, setSearch] = useState('');

  const fmt = (n: string | number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(parseFloat(String(n)));

  const fmtDate = (d: string) =>
    new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

  const filteredCustomers = initialData.customers.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      c.customer?.fullName.toLowerCase().includes(q) ||
      c.customer?.mobile.includes(q) ||
      c.customer?.customerCode.toLowerCase().includes(q)
    );
  });

  const filteredInvoices = initialData.invoices.filter((i) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      i.invoiceNumber.toLowerCase().includes(q) ||
      i.customer?.fullName.toLowerCase().includes(q) ||
      i.customer?.mobile.includes(q)
    );
  });

  const totalOverdue = initialData.invoices.reduce((sum, i) => sum + parseFloat(i.pendingAmount), 0);

  const daysBadgeColor = (days: number) => {
    if (days <= 7) return 'bg-amber-100 text-amber-800';
    if (days <= 15) return 'bg-orange-100 text-orange-800';
    if (days <= 30) return 'bg-red-100 text-red-800';
    return 'bg-red-200 text-red-900 font-bold';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-6 w-6 text-amber-500" />
            <h1 className="text-2xl font-bold text-slate-900">Overdue Customers</h1>
          </div>
          <p className="text-sm text-slate-500 mt-0.5">
            {initialData.customers.length} customers · {initialData.invoices.length} invoices · {fmt(totalOverdue)} total pending
          </p>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Overdue', value: fmt(totalOverdue), color: 'text-red-600' },
          { label: 'Customers', value: String(initialData.customers.length), color: 'text-orange-600' },
          { label: 'Invoices', value: String(initialData.invoices.length), color: 'text-amber-600' },
          { label: 'Critical (>30d)', value: String(initialData.invoices.filter((i) => i.daysOverdue > 30).length), color: 'text-red-700' },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
            <p className="text-xs text-slate-500">{s.label}</p>
            <p className={`text-2xl font-bold ${s.color} mt-1`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* View Toggle + Search */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <div className="flex bg-white border border-slate-200 rounded-xl p-1">
          <button onClick={() => setView('customers')} className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${view === 'customers' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>Customer View</button>
          <button onClick={() => setView('invoices')} className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${view === 'invoices' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>Invoice View</button>
        </div>
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search customer or invoice..." className="block w-full pl-10 pr-4 py-2 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white" />
          {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"><X className="h-4 w-4" /></button>}
        </div>
      </div>

      {/* Customer Summary View */}
      {view === 'customers' && (
        <div className="space-y-3">
          {filteredCustomers.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-xl border border-slate-200">
              <AlertTriangle className="h-10 w-10 text-slate-200 mx-auto mb-3" />
              <p className="text-slate-500 font-medium">No overdue customers found</p>
            </div>
          ) : filteredCustomers.map((oc) => {
            const c = oc.customer;
            if (!c) return null;
            const whatsappMsg = encodeURIComponent(`Dear ${c.fullName}, you have outstanding dues of ₹${parseFloat(oc.totalOverdueAmount).toLocaleString('en-IN')} at MD Javed Enterprises. Please make the payment at the earliest. Thank you.`);
            return (
              <div key={c.id} className="bg-white border border-amber-100 rounded-xl p-5 hover:shadow-md transition-shadow">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-mono text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded">{c.customerCode}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${daysBadgeColor(oc.maxDaysOverdue)}`}>
                        {oc.maxDaysOverdue} days overdue
                      </span>
                    </div>
                    <p className="text-base font-bold text-slate-900">{c.fullName}</p>
                    <p className="text-sm text-slate-500 flex items-center gap-1 mt-0.5"><Phone className="h-3 w-3" />{c.mobile}</p>
                    {c.city && <p className="text-xs text-slate-400 mt-0.5">{c.city}</p>}
                    <p className="text-xs text-slate-400 mt-1">{oc.overdueInvoiceCount} overdue invoice{oc.overdueInvoiceCount !== 1 ? 's' : ''} · Oldest due: {fmtDate(oc.oldestDueDate)}</p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <div className="text-right">
                      <p className="text-xs text-slate-400">Total Overdue</p>
                      <p className="text-2xl font-black text-red-600">{fmt(oc.totalOverdueAmount)}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                      <a href={`tel:${c.mobile}`} className="flex items-center gap-1 text-xs px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors font-medium">
                        <Phone className="h-3 w-3" /> Call
                      </a>
                      <a href={`https://wa.me/91${c.mobile}?text=${whatsappMsg}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs px-3 py-1.5 bg-green-50 text-green-700 rounded-lg hover:bg-green-100 transition-colors font-medium">
                        <MessageCircle className="h-3 w-3" /> WhatsApp
                      </a>
                      <Link href={`/dashboard/customers/${c.id}`} className="flex items-center gap-1 text-xs px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors font-medium">
                        View <ArrowRight className="h-3 w-3" />
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Invoice View */}
      {view === 'invoices' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  {['Invoice', 'Customer', 'Due Date', 'Days Overdue', 'Total', 'Paid', 'Pending', 'Actions'].map((h) => (
                    <th key={h} className="px-5 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100">
                {filteredInvoices.length === 0 ? (
                  <tr><td colSpan={8} className="py-12 text-center text-slate-400 text-sm">No overdue invoices found</td></tr>
                ) : filteredInvoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3 whitespace-nowrap font-mono text-sm font-semibold text-blue-600">{inv.invoiceNumber}</td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      <p className="text-sm font-medium text-slate-900">{inv.customer?.fullName ?? '—'}</p>
                      <p className="text-xs text-slate-400">{inv.customer?.mobile}</p>
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap text-sm text-slate-500">{inv.dueDate ? fmtDate(inv.dueDate) : '—'}</td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${daysBadgeColor(inv.daysOverdue)}`}>{inv.daysOverdue}d</span>
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap text-sm font-semibold text-slate-900">{fmt(inv.grandTotal)}</td>
                    <td className="px-5 py-3 whitespace-nowrap text-sm text-green-700">{fmt(inv.paidAmount)}</td>
                    <td className="px-5 py-3 whitespace-nowrap text-sm font-bold text-red-600">{fmt(inv.pendingAmount)}</td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        {inv.customer && (
                          <>
                            <a href={`tel:${inv.customer.mobile}`} className="text-xs p-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100" title="Call"><Phone className="h-3 w-3" /></a>
                            <a href={`https://wa.me/91${inv.customer.mobile}`} target="_blank" rel="noopener noreferrer" className="text-xs p-1.5 bg-green-50 text-green-600 rounded-lg hover:bg-green-100" title="WhatsApp"><MessageCircle className="h-3 w-3" /></a>
                          </>
                        )}
                        <Link href={`/dashboard/invoices/${inv.id}`} className="text-xs px-2 py-1 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200">View</Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
