'use client';

import { useState } from 'react';
import { X, Loader2, AlertTriangle, Ban } from 'lucide-react';

interface VoidTarget {
  id: string;
  type: 'Sale' | 'Payment';
  label: string;     // e.g. "Invoice #INV-0042" or "Receipt #REC-0015"
  amount: string;    // e.g. "₹5,000.00"
  date: string;      // formatted display date
  updatedAt: string; // ISO string — for optimistic concurrency
  customerId: string;
}

interface VoidConfirmModalProps {
  target: VoidTarget;
  onSuccess: () => void;
  onClose: () => void;
}

export default function VoidConfirmModal({ target, onSuccess, onClose }: VoidConfirmModalProps) {
  const [voidReason, setVoidReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleVoid(e: React.FormEvent) {
    e.preventDefault();
    if (!voidReason.trim()) { setError('Void reason is required'); return; }
    setSaving(true);
    setError('');

    const endpoint = target.type === 'Sale'
      ? `/api/sales/${target.id}/void`
      : `/api/payments/${target.id}/void`;

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voidReason: voidReason.trim(),
          updatedAt: target.updatedAt,
          customerId: target.customerId,
        }),
      });
      const data = await res.json();
      if (res.status === 409) {
        setError(data.error === 'TRANSACTION_CHANGED'
          ? 'This record was modified in another session. Close and reload.'
          : data.error || 'Conflict — please reload and try again.');
        return;
      }
      if (!res.ok) { setError(data.error || 'Failed to void transaction'); return; }
      onSuccess();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`Void ${target.type}`}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 bg-amber-100 rounded-xl flex items-center justify-center">
              <Ban className="h-4 w-4 text-amber-600" aria-hidden="true" />
            </div>
            <h2 className="text-base font-bold text-slate-900">Void {target.type}</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Warning notice */}
        <div className="m-5 bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex gap-3 items-start">
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="text-sm text-amber-900 space-y-1">
              <p className="font-semibold">This action cannot be undone.</p>
              <p>Voiding this transaction will:</p>
              <ul className="list-disc list-inside ml-1 space-y-0.5 text-amber-800">
                <li>Set its ledger contribution to <strong>₹0</strong></li>
                <li>Recalculate the customer&apos;s balance</li>
                <li>Preserve the record in audit history</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Transaction details */}
        <div className="mx-5 bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm">
          <div className="flex justify-between items-center mb-2">
            <span className="text-slate-500">Transaction</span>
            <span className="font-mono font-medium text-slate-800">{target.label}</span>
          </div>
          <div className="flex justify-between items-center mb-2">
            <span className="text-slate-500">Amount</span>
            <span className="font-semibold text-slate-800">{target.amount}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-slate-500">Date</span>
            <span className="text-slate-700">{target.date}</span>
          </div>
        </div>

        {error && (
          <div className="mx-5 mt-3 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleVoid} className="p-5 pt-4">
          <label className="block text-xs font-medium text-slate-700 mb-1.5" htmlFor="void-reason">
            Void Reason * <span className="text-slate-400 font-normal">(required for audit log)</span>
          </label>
          <textarea
            id="void-reason"
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
            rows={2}
            required
            placeholder="e.g. Entered in wrong account, Tally mismatch..."
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 outline-none resize-none"
          />
          <div className="flex justify-end gap-3 mt-4">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg disabled:opacity-60 flex items-center gap-2 transition-colors"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
              {saving ? 'Voiding…' : 'Void Transaction'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
