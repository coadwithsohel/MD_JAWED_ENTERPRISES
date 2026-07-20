'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Search, Plus, Loader2, X, UserPlus, Phone, MapPin, ChevronRight } from 'lucide-react';

interface Customer {
  id: string; customerCode: string; fullName: string; mobile: string;
  alternateMobile?: string; email?: string; address?: string; city?: string;
  state?: string; creditLimit: string; openingBalance: string; currentBalance: string; isActive: boolean;
}

const initialForm = {
  fullName: '', mobile: '', alternateMobile: '', email: '',
  address: '', city: '', state: '', pinCode: '', creditLimit: '0', openingBalance: '0', notes: '',
};

function CustomerCard({ c }: { c: Customer }) {
  const balance = parseFloat(c.currentBalance);
  const isDebit = balance > 0;
  const isCredit = balance < 0;
  return (
    <Link
      href={`/dashboard/customers/${c.id}`}
      className="group block bg-white border border-slate-200 rounded-xl p-5 hover:shadow-md hover:border-slate-300 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
      aria-label={`View ledger for ${c.fullName}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded font-medium border border-blue-100">{c.customerCode}</span>
            {!c.isActive && <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded border border-slate-200">Inactive</span>}
          </div>
          <p className="mt-1.5 text-base font-semibold text-slate-900 truncate group-hover:text-blue-700 transition-colors">{c.fullName}</p>
          <div className="flex items-center gap-1 mt-1 text-sm text-slate-500">
            <Phone className="h-3 w-3" aria-hidden="true" /> {c.mobile}
            {c.alternateMobile && <span className="ml-2 text-slate-400">/ {c.alternateMobile}</span>}
          </div>
          {c.city && (
            <div className="flex items-center gap-1 mt-0.5 text-xs text-slate-400">
              <MapPin className="h-3 w-3" aria-hidden="true" /> {c.city}{c.state && `, ${c.state}`}
            </div>
          )}
        </div>
        <div className="text-right flex-shrink-0 flex flex-col items-end gap-1">
          {isDebit ? (
            <>
              <p className="text-xs text-slate-400">Outstanding</p>
              <p className="font-bold text-rose-600 tabular-nums text-sm">₹{balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
              <span className="text-xs font-bold bg-rose-50 text-rose-600 border border-rose-200 px-1.5 py-0.5 rounded">Dr</span>
            </>
          ) : isCredit ? (
            <>
              <p className="text-xs text-slate-400">Advance</p>
              <p className="font-bold text-emerald-600 tabular-nums text-sm">₹{Math.abs(balance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
              <span className="text-xs font-bold bg-emerald-50 text-emerald-600 border border-emerald-200 px-1.5 py-0.5 rounded">Cr</span>
            </>
          ) : (
            <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-lg">Cleared ✓</span>
          )}
          {parseFloat(c.creditLimit) > 0 && (
            <p className="text-xs text-slate-400 mt-0.5">Limit: ₹{parseFloat(c.creditLimit).toLocaleString('en-IN')}</p>
          )}
          <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-blue-400 transition-colors mt-1" aria-hidden="true" />
        </div>
      </div>
    </Link>
  );
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setPage(1); }, [debouncedSearch]);

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '24' });
      if (debouncedSearch) params.set('search', debouncedSearch);
      const res = await fetch(`/api/customers?${params}`);
      const data = await res.json();
      setCustomers(data.customers ?? []);
      setTotal(data.total ?? 0);
    } catch { setCustomers([]); }
    finally { setLoading(false); }
  }, [page, debouncedSearch]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchCustomers(); }, [fetchCustomers]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setSaving(true);
    try {
      const res = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, creditLimit: Number(form.creditLimit), openingBalance: Number(form.openingBalance) }),
      });
      const data = await res.json();
      if (!res.ok) { setFormError(data.error || 'Failed to create customer'); return; }
      setShowModal(false);
      setForm(initialForm);
      fetchCustomers();
    } catch { setFormError('Network error. Please try again.'); }
    finally { setSaving(false); }
  };

  const PAGES = Math.ceil(total / 24);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Customers</h1>
          <p className="text-sm text-slate-500">{total} customers total</p>
        </div>
        <button onClick={() => { setShowModal(true); setFormError(''); }} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors shadow-sm">
          <Plus className="h-4 w-4" /> Add Customer
        </button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute inset-y-0 left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <input
          value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, mobile, code, city..."
          className="block w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
        />
        {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>}
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 text-blue-500 animate-spin" /></div>
      ) : customers.length === 0 ? (
        <div className="text-center py-20">
          <UserPlus className="h-12 w-12 text-slate-200 mx-auto mb-3" />
          <p className="text-slate-500 font-medium">{debouncedSearch ? 'No customers match your search' : 'No customers yet'}</p>
          {!debouncedSearch && <button onClick={() => setShowModal(true)} className="mt-4 text-blue-600 hover:underline text-sm">Add your first customer</button>}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {customers.map((c) => <CustomerCard key={c.id} c={c} />)}
          </div>
          {PAGES > 1 && (
            <div className="flex items-center justify-center gap-2">
              <button onClick={() => setPage(page - 1)} disabled={page === 1} className="px-3 py-1.5 rounded-lg border border-slate-200 text-sm disabled:opacity-50 hover:bg-slate-50">Prev</button>
              <span className="text-sm text-slate-600">Page {page} of {PAGES}</span>
              <button onClick={() => setPage(page + 1)} disabled={page === PAGES} className="px-3 py-1.5 rounded-lg border border-slate-200 text-sm disabled:opacity-50 hover:bg-slate-50">Next</button>
            </div>
          )}
        </>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-slate-200 sticky top-0 bg-white rounded-t-2xl">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 bg-blue-100 rounded-xl flex items-center justify-center"><UserPlus className="h-5 w-5 text-blue-600" /></div>
                <h2 className="text-lg font-bold">Add New Customer</h2>
              </div>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600 p-1"><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {formError && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{formError}</div>}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Full Name *</label>
                  <input required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="e.g. Sohel Khan" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Mobile * <span className="text-slate-400 font-normal">(10 digits)</span></label>
                  <input required type="tel" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="9876543210" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Alternate Mobile</label>
                  <input type="tel" value={form.alternateMobile ?? ''} onChange={(e) => setForm({ ...form, alternateMobile: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                  <input type="email" value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Address</label>
                  <input value={form.address ?? ''} onChange={(e) => setForm({ ...form, address: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Street / Colony" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">City</label>
                  <input value={form.city ?? ''} onChange={(e) => setForm({ ...form, city: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">State</label>
                  <input value={form.state ?? ''} onChange={(e) => setForm({ ...form, state: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Credit Limit (₹)</label>
                  <input type="number" min="0" value={form.creditLimit} onChange={(e) => setForm({ ...form, creditLimit: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Opening Balance (₹)</label>
                  <input type="number" min="0" value={form.openingBalance} onChange={(e) => setForm({ ...form, openingBalance: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                  <input value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors">Cancel</button>
                <button type="submit" disabled={saving} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-60 flex items-center gap-2">
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {saving ? 'Saving...' : 'Add Customer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
