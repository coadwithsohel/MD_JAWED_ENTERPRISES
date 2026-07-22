'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Search, Plus, Loader2, X, UserPlus, Phone, MapPin,
  Users, UserX, CreditCard,
  ChevronRight, CheckCircle,
} from 'lucide-react';
import CustomerActionMenu from '@/components/customers/CustomerActionMenu';
import ChangeCreditLimitDialog from '@/components/customers/ChangeCreditLimitDialog';
import DeactivateDialog from '@/components/customers/DeactivateDialog';
import RestoreDialog from '@/components/customers/RestoreDialog';
import PermanentDeleteDialog from '@/components/customers/PermanentDeleteDialog';
import { toPaise, fromPaise, getCreditStatus, CREDIT_STATUS_LABELS, CREDIT_STATUS_COLORS } from '@/lib/money';

interface Customer {
  id: string; customerCode: string; fullName: string; mobile: string;
  alternateMobile?: string; email?: string; address?: string; city?: string;
  state?: string; creditLimit: string; openingBalance: string; currentBalance: string;
  isActive: boolean; deletedAt?: string | null;
  _count?: { sales: number; payments: number };
}

interface UserInfo { role: string; }

const initialForm = {
  fullName: '', mobile: '', alternateMobile: '', email: '',
  address: '', city: '', state: '', pinCode: '', creditLimit: '0', openingBalance: '0', notes: '',
};

type StatusFilter = 'active' | 'inactive' | 'all';
type CreditFilter = '' | 'exceeded' | 'near' | 'outstanding' | 'advance';

interface Toast { id: number; message: string; type: 'success' | 'error'; }

function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="fixed bottom-4 right-4 z-[100] space-y-2 w-full max-w-sm">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-start gap-3 px-4 py-3 rounded-xl shadow-lg text-sm font-medium border transition-all ${
            t.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
          role="status"
          aria-live="polite"
        >
          {t.type === 'success'
            ? <CheckCircle className="h-4 w-4 shrink-0 mt-0.5 text-emerald-500" />
            : <X className="h-4 w-4 shrink-0 mt-0.5 text-rose-500" />
          }
          <span className="flex-1">{t.message}</span>
          <button onClick={() => onDismiss(t.id)} className="shrink-0 opacity-60 hover:opacity-100 transition-opacity" aria-label="Dismiss">
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}

const STATUS_TABS: { value: StatusFilter; label: string; icon: React.ElementType }[] = [
  { value: 'active', label: 'Active', icon: Users },
  { value: 'inactive', label: 'Inactive', icon: UserX },
  { value: 'all', label: 'All', icon: Users },
];

const CREDIT_FILTERS: { value: CreditFilter; label: string }[] = [
  { value: '', label: 'All Credit Status' },
  { value: 'exceeded', label: 'Limit Exceeded' },
  { value: 'near', label: 'Near Limit' },
  { value: 'outstanding', label: 'Has Outstanding' },
  { value: 'advance', label: 'Has Advance' },
];

function CustomerCard({
  c,
  userInfo,
  onCreditLimit,
  onDeactivate,
  onReactivate,
  onDeletePermanently,
}: {
  c: Customer;
  userInfo: UserInfo | null;
  onCreditLimit: (c: Customer) => void;
  onDeactivate: (c: Customer) => void;
  onReactivate: (c: Customer) => void;
  onDeletePermanently: (c: Customer) => void;
}) {
  const router = useRouter();
  const balance = parseFloat(c.currentBalance);
  const isDebit = balance > 0;
  const isCredit = balance < 0;
  const isAdmin = userInfo?.role === 'OWNER';
  const canManage = isAdmin || userInfo?.role === 'MANAGER';

  const limitPaise = toPaise(c.creditLimit);
  const outstandingPaise = Math.max(0, toPaise(c.currentBalance));
  const creditStatus = getCreditStatus(limitPaise, outstandingPaise);

  return (
    <div className={`group bg-white border rounded-xl p-5 hover:shadow-md transition-all relative ${
      c.isActive ? 'border-slate-200 hover:border-slate-300' : 'border-slate-200 opacity-75'
    }`}>
      <div className="absolute top-3 right-3 z-10">
        <CustomerActionMenu
          customerId={c.id}
          customerName={c.fullName}
          isActive={c.isActive}
          isAdmin={isAdmin}
          canManage={canManage}
          onViewLedger={() => router.push(`/dashboard/customers/${c.id}`)}
          onEditCustomer={() => router.push(`/dashboard/customers/${c.id}`)}
          onChangeCreditLimit={() => onCreditLimit(c)}
          onDeactivate={() => onDeactivate(c)}
          onReactivate={() => onReactivate(c)}
          onDeletePermanently={() => onDeletePermanently(c)}
        />
      </div>

      <Link
        href={`/dashboard/customers/${c.id}`}
        className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 rounded-lg"
        aria-label={`View ledger for ${c.fullName}`}
      >
        <div className="flex items-start gap-3 pr-8">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <span className="font-mono text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded font-medium border border-blue-100">
                {c.customerCode}
              </span>
              {!c.isActive && (
                <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded border border-slate-200 font-medium">
                  Inactive
                </span>
              )}
              {limitPaise > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${CREDIT_STATUS_COLORS[creditStatus]}`}>
                  {CREDIT_STATUS_LABELS[creditStatus]}
                </span>
              )}
            </div>

            <p className="text-base font-semibold text-slate-900 truncate group-hover:text-blue-700 transition-colors">
              {c.fullName}
            </p>

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
                <p className="font-bold text-rose-600 tabular-nums text-sm">
                  {fromPaise(Math.round(balance * 100))}
                </p>
                <span className="text-xs font-bold bg-rose-50 text-rose-600 border border-rose-200 px-1.5 py-0.5 rounded">Dr</span>
              </>
            ) : isCredit ? (
              <>
                <p className="text-xs text-slate-400">Advance</p>
                <p className="font-bold text-emerald-600 tabular-nums text-sm">
                  {fromPaise(Math.abs(Math.round(balance * 100)))}
                </p>
                <span className="text-xs font-bold bg-emerald-50 text-emerald-600 border border-emerald-200 px-1.5 py-0.5 rounded">Cr</span>
              </>
            ) : (
              <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-lg">Cleared ✓</span>
            )}

            {limitPaise > 0 && (
              <p className="text-xs text-slate-400 mt-0.5">Limit: {fromPaise(limitPaise)}</p>
            )}
            <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-blue-400 transition-colors mt-1" aria-hidden="true" />
          </div>
        </div>
      </Link>
    </div>
  );
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [creditFilter, setCreditFilter] = useState<CreditFilter>('');

  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [dialog, setDialog] = useState<'credit' | 'deactivate' | 'restore' | 'permDelete' | null>(null);

  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);

  const [refreshKey, setRefreshKey] = useState(0);
  function refreshCustomers() {
    setRefreshKey((k) => k + 1);
  }

  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastIdRef = useRef(0);

  function showToast(message: string, type: 'success' | 'error' = 'success') {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => { if (d.user) setUserInfo({ role: d.user.role }); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Reset page when filters change - done in event handlers via setPage(1)

  useEffect(() => {
    const controller = new AbortController();

    async function loadCustomers() {
      try {
        await Promise.resolve();
        setLoading(true);

        const params = new URLSearchParams({
          page: String(page),
          limit: '24',
          status: statusFilter,
        });
        if (debouncedSearch) params.set('search', debouncedSearch);
        if (creditFilter) params.set('creditStatus', creditFilter);

        const res = await fetch(`/api/customers?${params}`, {
          signal: controller.signal,
        });
        const data = await res.json();

        if (!controller.signal.aborted) {
          setCustomers(data.customers ?? []);
          setTotal(data.total ?? 0);
        }
      } catch {
        if (!controller.signal.aborted) {
          setCustomers([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void loadCustomers();

    return () => {
      controller.abort();
    };
  }, [page, debouncedSearch, statusFilter, creditFilter, refreshKey]);

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
      showToast('Customer added successfully.');
      refreshCustomers();
    } catch { setFormError('Network error. Please try again.'); }
    finally { setSaving(false); }
  };

  function openDialog(type: typeof dialog, customer: Customer) {
    setSelectedCustomer(customer);
    setDialog(type);
  }

  function closeDialog() {
    setDialog(null);
    setSelectedCustomer(null);
  }

  function onDialogSuccess(msg: string) {
    closeDialog();
    showToast(msg);
    refreshCustomers();
  }

  const PAGES = Math.ceil(total / 24);

  return (
    <div className="space-y-6">
      <ToastContainer toasts={toasts} onDismiss={(id) => setToasts((p) => p.filter((t) => t.id !== id))} />

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Customers</h1>
          <p className="text-sm text-slate-500">{total} {statusFilter === 'all' ? 'total' : statusFilter} customers</p>
        </div>
        <button
          onClick={() => { setShowModal(true); setFormError(''); }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors shadow-sm"
        >
          <Plus className="h-4 w-4" /> Add Customer
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1">
          {STATUS_TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.value}
                onClick={() => { setStatusFilter(tab.value); setPage(1); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  statusFilter === tab.value
                    ? 'bg-white text-blue-700 shadow-sm border border-slate-200'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {tab.label}
              </button>
            );
          })}
        </div>

        <select
          value={creditFilter}
          onChange={(e) => { setCreditFilter(e.target.value as CreditFilter); setPage(1); }}
          className="px-3 py-1.5 text-sm border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 bg-white text-slate-700"
          aria-label="Filter by credit status"
        >
          {CREDIT_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>

        {creditFilter && (
          <div className="flex items-center gap-1.5">
            <CreditCard className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
            <span className="text-xs text-slate-500">
              {CREDIT_FILTERS.find((f) => f.value === creditFilter)?.label}
            </span>
          </div>
        )}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute inset-y-0 left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <input
          value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, mobile, code, city..."
          className="block w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
          aria-label="Search customers"
        />
        {search && (
          <button onClick={() => { setSearch(''); setDebouncedSearch(''); setPage(1); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" aria-label="Clear search">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {statusFilter === 'inactive' && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-700">
          <UserX className="h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            Showing deactivated customers. Use the action menu (⋮) to reactivate or permanently delete them.
          </p>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 text-blue-500 animate-spin" /></div>
      ) : customers.length === 0 ? (
        <div className="text-center py-20">
          <UserPlus className="h-12 w-12 text-slate-200 mx-auto mb-3" />
          <p className="text-slate-500 font-medium">
            {debouncedSearch ? 'No customers match your search' : statusFilter === 'inactive' ? 'No inactive customers' : 'No customers yet'}
          </p>
          {!debouncedSearch && statusFilter === 'active' && (
            <button onClick={() => setShowModal(true)} className="mt-4 text-blue-600 hover:underline text-sm">
              Add your first customer
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {customers.map((c) => (
              <CustomerCard
                key={c.id}
                c={c}
                userInfo={userInfo}
                onCreditLimit={(cust) => openDialog('credit', cust)}
                onDeactivate={(cust) => openDialog('deactivate', cust)}
                onReactivate={(cust) => openDialog('restore', cust)}
                onDeletePermanently={(cust) => openDialog('permDelete', cust)}
              />
            ))}
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

      {dialog === 'credit' && selectedCustomer && (
        <ChangeCreditLimitDialog
          customerId={selectedCustomer.id}
          customerName={selectedCustomer.fullName}
          customerCode={selectedCustomer.customerCode}
          currentCreditLimit={selectedCustomer.creditLimit}
          currentOutstandingRaw={Math.max(0, toPaise(selectedCustomer.currentBalance))}
          onSuccess={() => onDialogSuccess('Credit limit updated successfully.')}
          onClose={closeDialog}
        />
      )}

      {dialog === 'deactivate' && selectedCustomer && (
        <DeactivateDialog
          customerId={selectedCustomer.id}
          customerName={selectedCustomer.fullName}
          customerCode={selectedCustomer.customerCode}
          mobile={selectedCustomer.mobile}
          stats={{
            invoiceCount: selectedCustomer._count?.sales ?? 0,
            paymentCount: selectedCustomer._count?.payments ?? 0,
            outstandingPaise: toPaise(selectedCustomer.currentBalance),
          }}
          onSuccess={() => onDialogSuccess('Customer deactivated. Financial history has been preserved.')}
          onClose={closeDialog}
        />
      )}

      {dialog === 'restore' && selectedCustomer && (
        <RestoreDialog
          customerId={selectedCustomer.id}
          customerName={selectedCustomer.fullName}
          customerCode={selectedCustomer.customerCode}
          onSuccess={() => onDialogSuccess('Customer restored successfully.')}
          onClose={closeDialog}
        />
      )}

      {dialog === 'permDelete' && selectedCustomer && (
        <PermanentDeleteDialog
          customerId={selectedCustomer.id}
          customerName={selectedCustomer.fullName}
          customerCode={selectedCustomer.customerCode}
          safetyCounts={{
            invoiceCount: selectedCustomer._count?.sales ?? 0,
            paymentCount: selectedCustomer._count?.payments ?? 0,
            ledgerCount: 0,
            reminderCount: 0,
            hasOutstanding: toPaise(selectedCustomer.currentBalance) !== 0,
            outstandingLabel: fromPaise(Math.abs(toPaise(selectedCustomer.currentBalance))),
          }}
          onSuccess={() => {
            closeDialog();
            showToast('Customer permanently deleted.');
            refreshCustomers();
          }}
          onClose={closeDialog}
        />
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-slate-200 sticky top-0 bg-white rounded-t-2xl">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 bg-blue-100 rounded-xl flex items-center justify-center">
                  <UserPlus className="h-5 w-5 text-blue-600" />
                </div>
                <h2 className="text-lg font-bold">Add New Customer</h2>
              </div>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600 p-1">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {formError && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{formError}</div>
              )}
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