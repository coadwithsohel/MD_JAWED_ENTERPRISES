'use client';

import { useState } from 'react';
import { X, Loader2, AlertCircle, User, CheckCircle } from 'lucide-react';

interface CustomerData {
  id: string;
  fullName: string;
  mobile: string;
  alternateMobile?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pinCode?: string | null;
  creditLimit?: string; // formatted e.g. "₹50,000.00"
  openingBalance?: string;
  isActive: boolean;
  updatedAt: string; // ISO string — for optimistic concurrency
}

interface EditCustomerModalProps {
  customer: CustomerData;
  onSuccess: () => void;
  onClose: () => void;
}

/** Parse a formatted rupee string like "₹50,000.00" into a number. */
function parseRupees(formatted: string | undefined): string {
  if (!formatted) return '0';
  return formatted.replace(/[₹,\s]/g, '') || '0';
}

/** Render a diff row showing old vs new value */
function DiffRow({ label, oldVal, newVal }: { label: string; oldVal: string; newVal: string }) {
  if (oldVal === newVal) return null;
  return (
    <div className="flex items-start gap-3 text-sm py-1">
      <span className="text-slate-500 w-32 shrink-0">{label}</span>
      <span className="text-rose-600 line-through">{oldVal || '—'}</span>
      <span className="text-slate-400 shrink-0">→</span>
      <span className="text-emerald-700 font-medium">{newVal || '—'}</span>
    </div>
  );
}

export default function EditCustomerModal({ customer, onSuccess, onClose }: EditCustomerModalProps) {
  // Form state — initialised from existing customer
  const [fullName, setFullName] = useState(customer.fullName);
  const [mobile, setMobile] = useState(customer.mobile);
  const [alternateMobile, setAlternateMobile] = useState(customer.alternateMobile ?? '');
  const [email, setEmail] = useState(customer.email ?? '');
  const [address, setAddress] = useState(customer.address ?? '');
  const [city, setCity] = useState(customer.city ?? '');
  const [state, setState] = useState(customer.state ?? '');
  const [pinCode, setPinCode] = useState(customer.pinCode ?? '');
  const [creditLimit, setCreditLimit] = useState(parseRupees(customer.creditLimit));
  const [openingBalance, setOpeningBalance] = useState(parseRupees(customer.openingBalance));
  const [isActive, setIsActive] = useState(customer.isActive);
  const [editReason, setEditReason] = useState('');

  const [stage, setStage] = useState<'form' | 'confirm'>('form');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // Build diff for confirmation screen
  const diffs = [
    { label: 'Name', old: customer.fullName, new: fullName },
    { label: 'Mobile', old: customer.mobile, new: mobile },
    { label: 'Alt. Mobile', old: customer.alternateMobile ?? '', new: alternateMobile },
    { label: 'Email', old: customer.email ?? '', new: email },
    { label: 'Address', old: customer.address ?? '', new: address },
    { label: 'City', old: customer.city ?? '', new: city },
    { label: 'State', old: customer.state ?? '', new: state },
    { label: 'Credit Limit', old: parseRupees(customer.creditLimit), new: creditLimit },
    { label: 'Opening Bal.', old: parseRupees(customer.openingBalance), new: openingBalance },
    { label: 'Status', old: customer.isActive ? 'Active' : 'Inactive', new: isActive ? 'Active' : 'Inactive' },
  ];

  const hasChanges = diffs.some((d) => d.old !== d.new);

  function handleNext(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    if (!fullName.trim()) { setFormError('Name is required'); return; }
    if (!mobile.trim()) { setFormError('Mobile is required'); return; }
    if (!editReason.trim()) { setFormError('Edit reason is required'); return; }
    if (!hasChanges) { setFormError('No changes detected'); return; }
    setStage('confirm');
  }

  async function handleSubmit() {
    setSaving(true);
    setFormError('');
    try {
      const res = await fetch(`/api/customers/${customer.id}/edit`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: fullName.trim(),
          mobile: mobile.trim(),
          alternateMobile: alternateMobile.trim() || null,
          email: email.trim() || null,
          address: address.trim() || null,
          city: city.trim() || null,
          state: state.trim() || null,
          pinCode: pinCode.trim() || null,
          creditLimit: parseFloat(creditLimit) || 0,
          openingBalance: parseFloat(openingBalance) || 0,
          isActive,
          editReason: editReason.trim(),
          updatedAt: customer.updatedAt,
        }),
      });
      const data = await res.json();
      if (res.status === 409) {
        setFormError('This record was modified in another session. Please close and reload.');
        setStage('form');
        return;
      }
      if (!res.ok) { setFormError(data.error || 'Failed to update customer'); setStage('form'); return; }
      onSuccess();
    } catch {
      setFormError('Network error. Please try again.');
      setStage('form');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Edit Customer">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 bg-blue-100 rounded-xl flex items-center justify-center">
              <User className="h-4 w-4 text-blue-600" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                {stage === 'form' ? 'Edit Customer' : 'Confirm Changes'}
              </h2>
              <p className="text-xs text-slate-500 truncate max-w-[200px]">{customer.fullName}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Error */}
        {formError && (
          <div className="mx-5 mt-4 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm flex items-center gap-2 shrink-0">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {formError}
          </div>
        )}

        {/* Form stage */}
        {stage === 'form' && (
          <form onSubmit={handleNext} className="p-5 space-y-3 overflow-y-auto flex-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor="ec-name">Full Name *</label>
                <input id="ec-name" value={fullName} onChange={(e) => setFullName(e.target.value)} required
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor="ec-mobile">Mobile *</label>
                <input id="ec-mobile" value={mobile} onChange={(e) => setMobile(e.target.value)} required
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor="ec-altmobile">Alternate Mobile</label>
                <input id="ec-altmobile" value={alternateMobile} onChange={(e) => setAlternateMobile(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor="ec-email">Email</label>
                <input id="ec-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor="ec-address">Address</label>
                <input id="ec-address" value={address} onChange={(e) => setAddress(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor="ec-city">City</label>
                <input id="ec-city" value={city} onChange={(e) => setCity(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor="ec-state">State</label>
                <input id="ec-state" value={state} onChange={(e) => setState(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor="ec-credit">Credit Limit (₹)</label>
                <input id="ec-credit" type="number" min="0" step="0.01" value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor="ec-opening">Opening Balance (₹)</label>
                <input id="ec-opening" type="number" step="0.01" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                <p className="text-xs text-slate-400 mt-0.5">Positive = customer owes us, negative = advance</p>
              </div>
              <div className="col-span-2 flex items-center gap-3">
                <input id="ec-active" type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                <label className="text-sm font-medium text-slate-700" htmlFor="ec-active">Customer is Active</label>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-100">
              <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor="ec-reason">Edit Reason * <span className="text-slate-400 font-normal">(required for audit log)</span></label>
              <input id="ec-reason" value={editReason} onChange={(e) => setEditReason(e.target.value)} required
                placeholder="e.g. Corrected mobile number, Updated address..."
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors">Cancel</button>
              <button type="submit" className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors">Review Changes</button>
            </div>
          </form>
        )}

        {/* Confirm stage */}
        {stage === 'confirm' && (
          <div className="p-5 flex-1 overflow-y-auto">
            <p className="text-sm text-slate-600 mb-4">Please confirm the following changes before saving:</p>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-1">
              {diffs.filter((d) => d.old !== d.new).map((d) => (
                <DiffRow key={d.label} label={d.label} oldVal={d.old} newVal={d.new} />
              ))}
              {!hasChanges && <p className="text-sm text-slate-400">No changes detected.</p>}
            </div>
            <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
              <span className="font-semibold">Reason: </span>{editReason}
            </div>
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => setStage('form')} className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors">Back</button>
              <button
                onClick={handleSubmit}
                disabled={saving || !hasChanges}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-60 flex items-center gap-2 transition-colors"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                {saving ? 'Saving…' : 'Confirm & Save'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
