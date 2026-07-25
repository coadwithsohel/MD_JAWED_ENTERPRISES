'use client';

import { useState, useEffect } from 'react';
import { X, Loader2, AlertCircle, Banknote, CheckCircle } from 'lucide-react';

const PAYMENT_MODES = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CHEQUE', 'OTHER'] as const;
type PaymentMode = typeof PAYMENT_MODES[number];

interface PaymentData {
  id: string;
  receiptNumber: string;
  customerId: string;
  amount: number;
  paymentDate: string; // ISO string
  paymentMode: PaymentMode;
  referenceNumber: string | null;
  notes: string | null;
  status: string;
  updatedAt: string; // ISO string — for optimistic concurrency
}

interface EditPaymentModalProps {
  paymentId: string;
  customerId: string;
  onSuccess: () => void;
  onClose: () => void;
}

function toISTDateString(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(iso));
}

function DiffRow({ label, oldVal, newVal }: { label: string; oldVal: string; newVal: string }) {
  if (oldVal === newVal) return null;
  return (
    <div className="flex items-start gap-3 text-sm py-1">
      <span className="text-slate-500 w-28 shrink-0">{label}</span>
      <span className="text-rose-600 line-through">{oldVal || '—'}</span>
      <span className="text-slate-400 shrink-0">→</span>
      <span className="text-emerald-700 font-medium">{newVal || '—'}</span>
    </div>
  );
}

export default function EditPaymentModal({ paymentId, customerId, onSuccess, onClose }: EditPaymentModalProps) {
  const [payment, setPayment] = useState<PaymentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // Form state
  const [paymentDate, setPaymentDate] = useState('');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('CASH');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [amount, setAmount] = useState('');
  const [editReason, setEditReason] = useState('');

  const [stage, setStage] = useState<'form' | 'confirm'>('form');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/payments/${paymentId}`);
        if (!res.ok) { setLoadError('Failed to load payment'); setLoading(false); return; }
        const data = await res.json();
        const p = data.payment;
        if (!cancelled) {
          setPayment({
            id: p.id,
            receiptNumber: p.receiptNumber,
            customerId: p.customerId,
            amount: Number(p.amount),
            paymentDate: p.paymentDate,
            paymentMode: p.paymentMode as PaymentMode,
            referenceNumber: p.referenceNumber,
            notes: p.notes,
            status: p.status,
            updatedAt: p.updatedAt,
          });
          setPaymentDate(toISTDateString(p.paymentDate));
          setPaymentMode(p.paymentMode);
          setReferenceNumber(p.referenceNumber ?? '');
          setNotes(p.notes ?? '');
          setAmount(String(Number(p.amount)));
          setLoading(false);
        }
      } catch {
        if (!cancelled) { setLoadError('Network error'); setLoading(false); }
      }
    }
    load();
    return () => { cancelled = true; };
  }, [paymentId]);

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
        <div className="bg-white rounded-2xl shadow-2xl p-8 flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />
          <span className="text-sm text-slate-600">Loading payment details…</span>
        </div>
      </div>
    );
  }

  if (loadError || !payment) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
        <div className="bg-white rounded-2xl shadow-2xl p-8 text-center">
          <AlertCircle className="h-8 w-8 text-rose-500 mx-auto mb-3" />
          <p className="text-sm text-slate-600 mb-4">{loadError || 'Payment not found'}</p>
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg">Close</button>
        </div>
      </div>
    );
  }

  const oldDate = toISTDateString(payment.paymentDate);
  const oldAmount = String(payment.amount);
  const oldMode = payment.paymentMode;
  const oldRef = payment.referenceNumber ?? '';
  const oldNotes = payment.notes ?? '';

  const diffs = [
    { label: 'Payment Date', old: oldDate, new: paymentDate },
    { label: 'Amount (₹)', old: oldAmount, new: amount },
    { label: 'Mode', old: oldMode, new: paymentMode },
    { label: 'Reference #', old: oldRef, new: referenceNumber },
    { label: 'Notes', old: oldNotes, new: notes },
  ];
  const hasChanges = diffs.some((d) => d.old !== d.new);

  function handleNext(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    if (!amount || Number(amount) <= 0) { setFormError('Amount must be positive'); return; }
    if (!editReason.trim()) { setFormError('Edit reason is required'); return; }
    if (!hasChanges) { setFormError('No changes detected'); return; }
    setStage('confirm');
  }

  async function handleSubmit() {
    if (!payment) return;
    setSaving(true);
    setFormError('');
    try {
      const body: Record<string, unknown> = {
        customerId,
        editReason: editReason.trim(),
        updatedAt: payment.updatedAt,
      };
      if (paymentDate !== oldDate) body.paymentDate = paymentDate;
      if (amount !== oldAmount) body.amount = parseFloat(amount);
      if (paymentMode !== oldMode) body.paymentMode = paymentMode;
      if (referenceNumber !== oldRef) body.referenceNumber = referenceNumber || null;
      if (notes !== oldNotes) body.notes = notes || null;

      const res = await fetch(`/api/payments/${paymentId}/edit`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.status === 409) {
        setFormError('TRANSACTION_CHANGED: Record was modified in another session. Close and reload.');
        setStage('form');
        return;
      }
      if (!res.ok) { setFormError(data.error || 'Failed to update payment'); setStage('form'); return; }
      onSuccess();
    } catch {
      setFormError('Network error. Please try again.');
      setStage('form');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Edit Payment">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 bg-emerald-100 rounded-xl flex items-center justify-center">
              <Banknote className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                {stage === 'form' ? 'Edit Payment' : 'Confirm Changes'}
              </h2>
              <p className="text-xs text-slate-500 font-mono">{payment.receiptNumber}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        {formError && (
          <div className="mx-5 mt-4 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm flex items-center gap-2 shrink-0">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {formError}
          </div>
        )}

        <div className="mx-5 mt-4 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-500 shrink-0">
          Immutable: Receipt # <span className="font-mono font-semibold text-slate-700">{payment.receiptNumber}</span> · Customer ID
        </div>

        {stage === 'form' && (
          <form onSubmit={handleNext} className="p-5 space-y-3 overflow-y-auto flex-1">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor="ep-date">Payment Date *</label>
                <input id="ep-date" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} required
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor="ep-amount">Amount (₹) *</label>
                <input id="ep-amount" type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor="ep-mode">Payment Mode *</label>
                <select id="ep-mode" value={paymentMode} onChange={(e) => setPaymentMode(e.target.value as PaymentMode)} required
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none bg-white">
                  {PAYMENT_MODES.map((m) => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor="ep-ref">Reference #</label>
                <input id="ep-ref" value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)}
                  placeholder="UTR / Cheque no."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor="ep-notes">Notes</label>
                <textarea id="ep-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none resize-none" />
              </div>
            </div>
            <div className="pt-2 border-t border-slate-100">
              <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor="ep-reason">Edit Reason * <span className="text-slate-400 font-normal">(required for audit)</span></label>
              <input id="ep-reason" value={editReason} onChange={(e) => setEditReason(e.target.value)} required placeholder="e.g. Corrected payment date..."
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />
            </div>
            <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors">Cancel</button>
              <button type="submit" className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors">Review Changes</button>
            </div>
          </form>
        )}

        {stage === 'confirm' && (
          <div className="p-5 flex-1 overflow-y-auto">
            <p className="text-sm text-slate-600 mb-4">Confirm the following changes:</p>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-1">
              {diffs.filter((d) => d.old !== d.new).map((d) => (
                <DiffRow key={d.label} label={d.label} oldVal={d.old} newVal={d.new} />
              ))}
            </div>
            <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 text-sm text-amber-800">
              <span className="font-semibold">Reason: </span>{editReason}
            </div>
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => setStage('form')} className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors">Back</button>
              <button onClick={handleSubmit} disabled={saving}
                className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-60 flex items-center gap-2 transition-colors">
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
