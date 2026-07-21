'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Trash2, AlertTriangle, Loader2, ShieldAlert } from 'lucide-react';

interface CustomerSafetyCounts {
  invoiceCount: number;
  paymentCount: number;
  ledgerCount: number;
  reminderCount: number;
  hasOutstanding: boolean;
  outstandingLabel: string;
}

interface Props {
  customerId: string;
  customerName: string;
  customerCode: string;
  safetyCounts: CustomerSafetyCounts;
  onSuccess: () => void;
  onClose: () => void;
}

export default function PermanentDeleteDialog({
  customerId,
  customerName,
  customerCode,
  safetyCounts,
  onSuccess,
  onClose,
}: Props) {
  const [confirmation, setConfirmation] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const overlayRef = useRef<HTMLDivElement>(null);

  // Check if permanent delete is safe (all counts zero, no outstanding)
  const hasRecords =
    safetyCounts.invoiceCount > 0 ||
    safetyCounts.paymentCount > 0 ||
    safetyCounts.ledgerCount > 0 ||
    safetyCounts.reminderCount > 0 ||
    safetyCounts.hasOutstanding;

  const isConfirmed = confirmation.trim() === 'DELETE';

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !saving) {
        onClose();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, saving]);

  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === overlayRef.current && !saving) {
      onClose();
    }
  }

  async function handleDelete() {
    if (!isConfirmed) return;
    setError('');
    setSaving(true);
    try {
      const res = await fetch(`/api/customers/${customerId}/permanent`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmation: 'DELETE',
          reason: reason.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.reason ?? data.error ?? 'Failed to delete customer');
        return;
      }
      onSuccess();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="perm-delete-dialog-title"
      aria-describedby="perm-delete-dialog-desc"
    >
      <div className="flex max-h-[calc(100dvh-24px)] w-[calc(100vw-24px)] max-w-lg flex-col rounded-xl border border-slate-200 bg-white shadow-xl sm:w-full overflow-hidden">
        {/* Header */}
        <header className="shrink-0 flex items-center justify-between px-4 sm:px-6 py-4 border-b border-rose-100 bg-rose-50">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 bg-rose-100 border border-rose-200 rounded-xl flex items-center justify-center shrink-0">
              <ShieldAlert className="h-5 w-5 text-rose-600" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 id="perm-delete-dialog-title" className="text-base font-bold text-rose-900 truncate">
                Permanent Delete
              </h2>
              <p id="perm-delete-dialog-desc" className="text-xs text-rose-600 font-mono truncate">{customerCode}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            className="shrink-0 h-9 w-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-rose-100 transition-all focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:outline-none"
            aria-label="Close dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Scrollable content */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
          {/* Blocked: has records */}
          {hasRecords && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 space-y-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-5 w-5 text-rose-500 shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <p className="text-sm font-bold text-rose-800">Permanent deletion is not allowed</p>
                  <p className="text-xs text-rose-700 mt-1">
                    This customer cannot be permanently deleted because they have financial records:
                  </p>
                </div>
              </div>
              <ul className="text-xs text-rose-700 space-y-1 ml-7">
                {safetyCounts.invoiceCount > 0 && (
                  <li>&bull; {safetyCounts.invoiceCount} invoice(s)</li>
                )}
                {safetyCounts.paymentCount > 0 && (
                  <li>&bull; {safetyCounts.paymentCount} payment(s)</li>
                )}
                {safetyCounts.ledgerCount > 0 && (
                  <li>&bull; {safetyCounts.ledgerCount} ledger entry/entries</li>
                )}
                {safetyCounts.reminderCount > 0 && (
                  <li>&bull; {safetyCounts.reminderCount} reminder(s)</li>
                )}
                {safetyCounts.hasOutstanding && (
                  <li>&bull; Outstanding balance: {safetyCounts.outstandingLabel}</li>
                )}
              </ul>
              <p className="text-xs text-rose-600 font-medium ml-7">
                Use {'"'}Deactivate Customer{'"'} instead to hide the customer while preserving all records.
              </p>
            </div>
          )}

          {/* Safe to delete */}
          {!hasRecords && (
            <>
              <div className="bg-rose-50 border border-rose-200 rounded-xl p-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-5 w-5 text-rose-500 shrink-0 mt-0.5" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-bold text-rose-800">This action cannot be undone</p>
                    <p className="text-xs text-rose-700 mt-1">
                      You are about to permanently delete <strong>{customerName}</strong> ({customerCode}).
                      This will erase the customer record completely.
                    </p>
                  </div>
                </div>
              </div>

              {/* Reason */}
              <div>
                <label htmlFor="delete-reason" className="block text-sm font-medium text-slate-700 mb-1.5">
                  Reason <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <textarea
                  id="delete-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={500}
                  rows={2}
                  placeholder="e.g. Duplicate customer record, created in error..."
                  className="w-full px-3 py-3 border border-slate-300 rounded-xl text-base sm:text-sm focus:ring-2 focus:ring-rose-500 outline-none resize-none"
                />
                <p className="mt-1 text-xs text-slate-400 text-right">{reason.length}/500</p>
              </div>

              {/* Confirmation */}
              <div>
                <label htmlFor="delete-confirmation" className="block text-sm font-medium text-slate-700 mb-1.5">
                  Type <span className="font-mono font-bold text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded">DELETE</span> to confirm
                </label>
                <input
                  id="delete-confirmation"
                  type="text"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  placeholder="DELETE"
                  className={`w-full px-3 py-3 border rounded-xl text-base sm:text-sm font-mono focus:ring-2 focus:ring-rose-500 outline-none transition-all ${
                    confirmation.length > 0 && !isConfirmed
                      ? 'border-rose-300 bg-rose-50'
                      : isConfirmed
                      ? 'border-emerald-300 bg-emerald-50'
                      : 'border-slate-300'
                  }`}
                  autoFocus
                />
              </div>

              {/* Error */}
              {error && (
                <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl px-4 py-3 text-sm" role="alert" aria-live="assertive">
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <footer className="shrink-0 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end px-4 sm:px-6 py-4 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="w-full sm:w-auto px-4 py-3 sm:py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:outline-none disabled:opacity-50"
          >
            {hasRecords ? 'Close' : 'Cancel'}
          </button>
          {!hasRecords && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={!isConfirmed || saving}
              className="w-full sm:w-auto px-5 py-3 sm:py-2 text-sm font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-sm focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:outline-none min-h-[44px]"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin shrink-0" />}
              <Trash2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="whitespace-nowrap">{saving ? 'Deleting...' : 'Delete Permanently'}</span>
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}