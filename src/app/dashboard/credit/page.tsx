'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search, Loader2, ArrowUpRight, ArrowDownRight, Phone, X, IndianRupee, Plus } from 'lucide-react';

interface LedgerEntry {
  id: string; createdAt: string; transactionType: string; amount: string;
  balanceAfter: string; description?: string | null;
  customer: { id: string; customerCode: string; fullName: string; mobile: string };
  sale?: { invoiceNumber: string } | null;
}

interface Customer { id: string; fullName: string; mobile: string; customerCode: string; currentBalance: string; }

export default function CreditPage() {
  const [ledgers, setLedgers] = useState<LedgerEntry[]>([]);
  const [summary, setSummary] = useState({ totalPending: 0, customersWithDues: 0, recentPaymentsAmount: 0, recentPaymentsCount: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [paymentForm, setPaymentForm] = useState({ amount: '', paymentMode: 'CASH', referenceNumber: '', notes: '' });
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { const t = setTimeout(() => setDebouncedSearch(search), 300); return () => clearTimeout(t); }, [search]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/credit${debouncedSearch ? `?search=${encodeURIComponent(debouncedSearch)}` : ''}`);
      const data = await res.json();
      setLedgers(data.ledgers ?? []);
      setSummary(data.summary ?? { totalPending: 0, customersWithDues: 0 });
    } catch {} finally { setLoading(false); }
  }, [debouncedSearch]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchData(); }, [fetchData]);

  const fetchCustomersWithDues = async (q: string) => {
    if (!q.trim()) { setCustomers([]); return; }
    try {
      const res = await fetch(`/api/customers?search=${encodeURIComponent(q)}&limit=10`);
      const data = await res.json();
      setCustomers((data.customers ?? []).filter((c: Customer) => parseFloat(c.currentBalance) > 0));
    } catch {}
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (!selectedCustomer) { setFormError('Please select a customer'); return; }
    if (!paymentForm.amount || Number(paymentForm.amount) <= 0) { setFormError('Enter a valid amount'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: selectedCustomer.id,
          amount: Number(paymentForm.amount),
          paymentMode: paymentForm.paymentMode,
          referenceNumber: paymentForm.referenceNumber || null,
          notes: paymentForm.notes || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setFormError(data.error || 'Failed to record payment'); return; }
      setShowModal(false);
      setSelectedCustomer(null);
      setPaymentForm({ amount: '', paymentMode: 'CASH', referenceNumber: '', notes: '' });
      fetchData();
    } catch { setFormError('Network error'); }
    finally { setSaving(false); }
  };

  const fmt = (n: number | string) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(parseFloat(String(n)));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-2xl font-bold text-slate-900">Credit Management</h1>
        <button onClick={() => { setShowModal(true); setFormError(''); }} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold">
          <Plus className="h-4 w-4" /> Record Payment
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-slate-500">Total Outstanding</h3>
            <span className="h-9 w-9 rounded-xl bg-orange-100 flex items-center justify-center text-orange-600"><ArrowUpRight className="h-4 w-4" /></span>
          </div>
          <p className="text-3xl font-bold text-orange-600">{fmt(summary.totalPending)}</p>
          <p className="mt-1 text-sm text-slate-500">Across {summary.customersWithDues} customers</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-slate-500">Recent Payments</h3>
            <span className="h-9 w-9 rounded-xl bg-green-100 flex items-center justify-center text-green-600"><ArrowDownRight className="h-4 w-4" /></span>
          </div>
          <p className="text-3xl font-bold text-green-600">
            {fmt(summary.recentPaymentsAmount)}
          </p>
          <p className="mt-1 text-sm text-slate-500">{summary.recentPaymentsCount} payments received</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Ledger Transactions</h2>
          <div className="relative max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search customer..." className="pl-10 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none w-full" />
            {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"><X className="h-4 w-4" /></button>}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>{['Date', 'Customer', 'Type', 'Amount', 'Balance After', 'Invoice', 'Contact'].map((h) => (
                <th key={h} className="px-5 py-3 text-left text-xs font-medium text-slate-500 uppercase whitespace-nowrap">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={7} className="py-12 text-center"><Loader2 className="h-8 w-8 text-blue-500 animate-spin mx-auto" /></td></tr>
              ) : ledgers.length === 0 ? (
                <tr><td colSpan={7} className="py-12 text-center text-slate-400 text-sm">No credit transactions found.</td></tr>
              ) : ledgers.map((l) => (
                <tr key={l.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3 text-sm text-slate-500 whitespace-nowrap">
                    {new Date(l.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}
                  </td>
                  <td className="px-5 py-3 whitespace-nowrap">
                    <p className="text-sm font-medium text-slate-900">{l.customer?.fullName}</p>
                    <p className="text-xs text-slate-400 font-mono">{l.customer?.customerCode}</p>
                  </td>
                  <td className="px-5 py-3 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${l.transactionType === 'CREDIT_SALE' || l.transactionType === 'OPENING_BALANCE' ? 'bg-orange-100 text-orange-800' : 'bg-green-100 text-green-800'}`}>
                      {l.transactionType === 'CREDIT_SALE' ? '↑ Credit Sale' : l.transactionType === 'PAYMENT_RECEIVED' ? '↓ Payment' : l.transactionType.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className={`px-5 py-3 whitespace-nowrap text-sm font-bold ${l.transactionType === 'PAYMENT_RECEIVED' ? 'text-green-700' : 'text-orange-700'}`}>
                    {l.transactionType === 'PAYMENT_RECEIVED' ? '−' : '+'}{fmt(l.amount)}
                  </td>
                  <td className="px-5 py-3 whitespace-nowrap text-sm text-slate-700">{fmt(l.balanceAfter)}</td>
                  <td className="px-5 py-3 whitespace-nowrap text-sm text-slate-500">{l.sale?.invoiceNumber ?? '—'}</td>
                  <td className="px-5 py-3 whitespace-nowrap">
                    <a href={`tel:${l.customer?.mobile}`} className="p-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 inline-flex items-center"><Phone className="h-3 w-3" /></a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 bg-green-100 rounded-xl flex items-center justify-center"><IndianRupee className="h-5 w-5 text-green-600" /></div>
                <h2 className="text-lg font-bold">Record Payment</h2>
              </div>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={handleRecordPayment} className="p-6 space-y-4">
              {formError && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{formError}</div>}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Customer *</label>
                <input value={customerSearch} onChange={(e) => { setCustomerSearch(e.target.value); fetchCustomersWithDues(e.target.value); }} placeholder="Search customer with dues..." className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                {customers.length > 0 && !selectedCustomer && (
                  <div className="border border-slate-200 rounded-lg overflow-hidden max-h-40 overflow-y-auto mt-1">
                    {customers.map((c) => (
                      <button key={c.id} type="button" onClick={() => { setSelectedCustomer(c); setCustomerSearch(''); setCustomers([]); }} className="w-full px-3 py-2 text-left hover:bg-blue-50 text-sm border-b border-slate-100 last:border-0">
                        <span className="font-medium">{c.fullName}</span>
                        <span className="text-slate-500 ml-2 text-xs">{c.mobile}</span>
                        <span className="float-right text-orange-600 font-semibold text-xs">₹{parseFloat(c.currentBalance).toLocaleString('en-IN')}</span>
                      </button>
                    ))}
                  </div>
                )}
                {selectedCustomer && (
                  <div className="mt-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 flex items-center justify-between">
                    <div>
                      <span className="text-sm font-medium text-blue-900">{selectedCustomer.fullName}</span>
                      <span className="text-xs text-orange-600 ml-2">Due: {fmt(selectedCustomer.currentBalance)}</span>
                    </div>
                    <button type="button" onClick={() => setSelectedCustomer(null)} className="text-blue-400 hover:text-blue-600"><X className="h-4 w-4" /></button>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Amount (₹) *</label>
                <input required type="number" min="1" step="0.01" value={paymentForm.amount} onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="0.00" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Payment Mode *</label>
                <select value={paymentForm.paymentMode} onChange={(e) => setPaymentForm({ ...paymentForm, paymentMode: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                  {['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CHEQUE'].map((m) => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
                </select>
              </div>
              {paymentForm.paymentMode !== 'CASH' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Reference / UTR Number</label>
                  <input value={paymentForm.referenceNumber ?? ''} onChange={(e) => setPaymentForm({ ...paymentForm, referenceNumber: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                <input value={paymentForm.notes ?? ''} onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Optional..." />
              </div>
              <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg">Cancel</button>
                <button type="submit" disabled={saving} className="px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg disabled:opacity-60 flex items-center gap-2">
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {saving ? 'Recording...' : 'Record Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
