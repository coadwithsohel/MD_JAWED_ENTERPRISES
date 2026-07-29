'use client';

import { useState } from 'react';
import { AlertTriangle, Phone, MessageCircle, Search, X, ArrowRight, Clock } from 'lucide-react';
import Link from 'next/link';

interface OverdueCustomer {
  customer: {
    id: string; customerCode: string; fullName: string; mobile: string;
    alternateMobile?: string | null; city?: string | null;
  } | null;
  totalOverdueAmount: string;
  latestActivityDate: string;
  nextReminderDate: string;
  daysOverdue: number;
  daysSinceActivity: number;
}

interface OverduePageData {
  invoices: unknown[];
  customers: OverdueCustomer[];
  total: number;
  summary?: {
    overdueCustomers: number;
    overdueInvoices: number;
    totalOverdueAmount: number | string;
    criticalOverdueInvoices?: number;
  };
}

export default function OverduePage({ initialData }: { initialData: OverduePageData }) {
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

  const totalOverdue = initialData.summary?.totalOverdueAmount ?? initialData.customers.reduce((sum, c) => sum + parseFloat(c.totalOverdueAmount), 0);
  const totalCustomersCount = initialData.summary?.overdueCustomers ?? initialData.customers.length;
  const criticalCount = initialData.summary?.criticalOverdueInvoices ?? initialData.customers.filter((c) => c.daysOverdue > 30).length;

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
            <Clock className="h-6 w-6 text-amber-500" />
            <h1 className="text-2xl font-bold text-slate-900">Payment Reminders</h1>
          </div>
          <p className="text-sm text-slate-500 mt-0.5">
            {totalCustomersCount} customers due for follow-up · {fmt(totalOverdue)} total pending
          </p>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Pending Amount', value: fmt(totalOverdue), color: 'text-red-600' },
          { label: 'Reminder Customers', value: String(totalCustomersCount), color: 'text-orange-600' },
          { label: 'Critical Follow-ups (>30d)', value: String(criticalCount), color: 'text-red-700' },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
            <p className="text-xs text-slate-500">{s.label}</p>
            <p className={`text-2xl font-bold ${s.color} mt-1`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search customer..." className="block w-full pl-10 pr-4 py-2 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white" />
          {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"><X className="h-4 w-4" /></button>}
        </div>
      </div>

      {/* Customer Summary View */}
      <div className="space-y-3">
        {filteredCustomers.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-xl border border-slate-200">
            <AlertTriangle className="h-10 w-10 text-slate-200 mx-auto mb-3" />
            <p className="text-slate-500 font-medium">No customers due for follow-up found</p>
          </div>
        ) : filteredCustomers.map((oc) => {
          const c = oc.customer;
          if (!c) return null;
          const whatsappMsg = encodeURIComponent(`Dear ${c.fullName}, you have outstanding dues of ?${parseFloat(oc.totalOverdueAmount).toLocaleString('en-IN')} at MD Javed Enterprises. Please make the payment at the earliest. Thank you.`);
          return (
            <div key={c.id} className="bg-white border border-amber-100 rounded-xl p-5 hover:shadow-md transition-shadow">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-mono text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded">{c.customerCode}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${daysBadgeColor(oc.daysOverdue)}`}>
                      {oc.daysOverdue} days since reminder
                    </span>
                  </div>
                  <p className="text-base font-bold text-slate-900">{c.fullName}</p>
                  <p className="text-sm text-slate-500 flex items-center gap-1 mt-0.5"><Phone className="h-3 w-3" />{c.mobile}</p>
                  {c.city && <p className="text-xs text-slate-400 mt-0.5">{c.city}</p>}
                  <p className="text-xs text-slate-400 mt-1">
                    Last Activity: {fmtDate(oc.latestActivityDate)} ({oc.daysSinceActivity} days ago)
                    <br />
                    Reminder Date: {fmtDate(oc.nextReminderDate)}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <div className="text-right">
                    <p className="text-xs text-slate-400">Total Outstanding</p>
                    <p className="text-2xl font-black text-red-600">{fmt(oc.totalOverdueAmount)}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    <a href={`tel:${c.mobile}`} className="flex items-center gap-1 text-xs px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors font-medium">
                      <Phone className="h-3 w-3" /> Call
                    </a>
                    <a href={`https://wa.me/91${c.mobile}?text=${whatsappMsg}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs px-3 py-1.5 bg-green-50 text-green-700 rounded-lg hover:bg-green-100 transition-colors font-medium">
                      <MessageCircle className="h-3 w-3" /> WhatsApp
                    </a>
                    <Link href={`/dashboard/customers/${c.id}?returnTo=${encodeURIComponent("/dashboard/overdue-customers")}`} className="flex items-center gap-1 text-xs px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors font-medium">
                      View Ledger <ArrowRight className="h-3 w-3" />
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

