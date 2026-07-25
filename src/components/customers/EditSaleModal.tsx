'use client';

import { useState, useEffect } from 'react';
import { X, Loader2, AlertCircle, ReceiptText, CheckCircle } from 'lucide-react';

interface SaleData {
  id: string;
  invoiceNumber: string;
  customerId: string;
  saleDate?: string | null;  // ISO string from saleDate field
  createdAt: string;          // ISO string — fallback display date
  notes?: string | null;
  dueDate?: string | null;
  grandTotal: string;         // formatted "₹X,XXX.00"
  pendingAmount: string;
  paidAmount: string;
  paymentStatus: string;
  updatedAt: string;          // ISO string — for optimistic concurrency
}

interface EditSaleModalProps {
  saleId: string;
  customerId: string;
  onSuccess: () => void;
  onClose: () => void;
}

function toISTDateString(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(iso));
}

function parseRupees(formatted: string | undefined | null): string {
  if (!formatted) return '';
  return formatted.replace(/[₹,\s]/g, '') || '';
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

export default function EditSaleModal({ saleId, customerId, onSuccess, onClose }: EditSaleModalProps) {
  const [sale, setSale] = useState<SaleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // Form state
  const [saleDate, setSaleDate] = useState('');
  const [notes, setNotes] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [debitAmount, setDebitAmount] = useState('');
  const [editReason, setEditReason] = useState('');

  const [stage, setStage] = useState<'form' | 'confirm'>('form');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // Load sale details
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/sales/${saleId}`);
        if (!res.ok) { setLoadError('Failed to load sale'); setLoading(false); return; }
        const data = await res.json();
        const s = data.sale;
        if (!cancelled) {
          setSale({
            id: s.id,
            invoiceNumber: s.invoiceNumber,
            customerId: s.customerId,
            saleDate: s.saleDate,
            createdAt: s.createdAt,
            notes: s.notes,
            dueDate: s.dueDate,
            grandTotal: s.grandTotal,
            pendingAmount: s.pendingAmount,
            paidAmount: s.paidAmount,
            paymentStatus: s.paymentStatus,
            updatedAt: s.updatedAt,
          });
          const displayDate = s.saleDate ?? s.createdAt;
          setSaleDate(toISTDateString(displayDate));
          setNotes(s.notes ?? '');
          setDueDate(toISTDateString(s.dueDate));
          setDebitAmount(parseRupees(String(s.grandTotal)));
          setLoading(false);
        }
      } catch {
        if (!cancelled) { setLoadError('Network error'); setLoading(false); }
      }
    }
    load();
    return () => { cancelled = true; };
  }, [saleId]);

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
        <div className="bg-white rounded-2xl shadow-2xl p-8 flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
          <span className="text-sm text-slate-600">Loading sale details…</span>
        </div>
      </div>
    );
  }

  if (loadError || !sale) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
        <div className="bg-white rounded-2xl shadow-2xl p-8 text-center">
          <AlertCircle className="h-8 w-8 text-rose-500 mx-auto mb-3" />
          <p className="text-sm text-slate-600 mb-4">{loadError || 'Sale not found'}</p>
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg">Close</button>
        </div>
      </div>
    );
  }

  const oldSaleDate = toISTDateString(sale.saleDate ?? sale.createdAt);
  const oldDebit = parseRupees(String(sale.grandTotal));
  const oldNotes = sale.notes ?? '';
  const oldDueDate = toISTDateString(sale.dueDate);

  const diffs = [
    { label: 'Invoice Date', old: oldSaleDate, new: saleDate },
    { label: 'Amount (₹)', old: oldDebit, new: debitAmount },
    { label: 'Due Date', old: oldDueDate, new: dueDate },
    { label: 'Notes', old: oldNotes, new: notes },
  ];
  const hasChanges = diffs.some((d) => d.old !== d.new);

  function handleNext(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    if (!debitAmount || Number(debitAmount) <= 0) { setFormError('Amount must be positive'); return; }
    if (!editReason.trim()) { setFormError('Edit reason is required'); return; }
    if (!hasChanges) { setFormError('No changes detected'); return; }
    setStage('confirm');
  }

  async function handleSubmit() {
    if (!sale) return;
    setSaving(true);
    setFormError('');
    try {
      const body: Record<string, unknown> = {
        customerId,
        editReason: editReason.trim(),
        updatedAt: sale.updatedAt,
      };
      if (saleDate !== oldSaleDate) body.saleDate = saleDate || null;
      if (notes !== oldNotes) body.notes = notes || null;
      if (dueDate !== oldDueDate) body.dueDate = dueDate || null;
      if (debitAmount !== oldDebit) body.debitAmount = parseFloat(debitAmount);

      const res = await fetch(`/api/sales/${saleId}/edit`, {
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
      if (!res.ok) { setFormError(data.error || 'Failed to update sale'); setStage('form'); return; }
      onSuccess();
    } catch {
      setFormError('Network error. Please try again.');
      setStage('form');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Edit Sale">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 bg-blue-100 rounded-xl flex items-center justify-center">
              <ReceiptText className="h-4 w-4 text-blue-600" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                {stage === 'form' ? 'Edit Sale' : 'Confirm Changes'}
              </h2>
              <p className="text-xs text-slate-500 font-mono">{sale.invoiceNumber}</p>
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

        {/* Immutable fields notice */}
        <div className="mx-5 mt-4 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-500 shrink-0">
          Immutable: Invoice # <span className="font-mono font-semibold text-slate-700">{sale.invoiceNumber}</span> · Customer ID · Import Keys
        </div>

        {stage === 'form' && (
          <form onSubmit={handleNext} className="p-5 space-y-3 overflow-y-auto flex-1">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor="es-date">Invoice Date</label>
              <input id="es-date" type="date" value={saleDate} onChange={(e) => setSaleDate(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor="es-amount">
                Debit Amount (₹) *
                {sale.paidAmount && Number(sale.paidAmount) > 0 && (
                  <span className="ml-2 text-amber-600 font-normal">Min: ₹{parseRupees(String(sale.paidAmount))} (already paid)</span>
                )}
              </label>
              <input id="es-amount" type="number" min="0.01" step="0.01" value={debitAmount} onChange={(e) => setDebitAmount(e.target.value)} required
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor="es-due">Due Date</label>
              <input id="es-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor="es-notes">Notes</label>
              <textarea id="es-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none" />
            </div>
            <div className="pt-2 border-t border-slate-100">
              <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor="es-reason">Edit Reason * <span className="text-slate-400 font-normal">(required for audit)</span></label>
              <input id="es-reason" value={editReason} onChange={(e) => setEditReason(e.target.value)} required placeholder="e.g. Corrected amount per invoice..."
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors">Cancel</button>
              <button type="submit" className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors">Review Changes</button>
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
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-60 flex items-center gap-2 transition-colors">
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
