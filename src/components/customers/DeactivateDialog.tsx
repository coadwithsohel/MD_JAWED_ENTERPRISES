'use client';

import { useState, useEffect, useRef } from 'react';
import { X, UserX, AlertTriangle, Loader2, FileText, Wallet, AlertCircle } from 'lucide-react';
import { fromPaise, toPaise } from '@/lib/money';

interface CustomerStats {
  invoiceCount: number;
  paymentCount: number;
  outstandingPaise: number; // positive = owes us, negative = advance
}

interface Props {
  customerId: string;
  customerName: string;
  customerCode: string;
  mobile: string;
  stats: CustomerStats;
  onSuccess: () => void;
  onClose: () => void;
}

export default function DeactivateDialog({
  customerId,
  customerName,
  customerCode,
  mobile,
  stats,
  onSuccess,
  onClose,
}: Props) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const overlayRef = useRef<HTMLDivElement>(null);

  const hasOutstanding = stats.outstandingPaise > 0;
  const hasAdvance = stats.outstandingPaise < 0;
  const hasRecords = stats.invoiceCount > 0 || stats.paymentCount > 0;

  // Trap focus
  useEffect(() => {
    const el = document.getElementById('deactivate-reason');
    el?.focus();
  }, []);

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

  async function handleDeactivate() {
    setError('');
    setSaving(true);
    try {
      const res = await fetch(`/api/customers/${customerId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to deactivate customer');
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
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="deactivate-dialog-title"
      aria-describedby="deactivate-dialog-desc"
    >
      <div className="flex max-h-[calc(100dvh-24px)] w-[calc(100vw-24px)] max-w-lg flex-col rounded-xl border border-slate-200 bg-white shadow-xl sm:w-full overflow-hidden">
        {/* Header - sticky */}
        <header className="shrink-0 flex items-center justify-between px-4 sm:px-6 py-4 border-b border-amber-100 bg-amber-50">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 bg-amber-100 border border-amber-200 rounded-xl flex items-center justify-center shrink-0">
              <UserX className="h-5 w-5 text-amber-600" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 id="deactivate-dialog-title" className="text-base font-bold text-slate-900 truncate">
                Deactivate Customer
              </h2>
              <p id="deactivate-dialog-desc" className="text-xs text-slate-500 font-mono truncate">{customerCode}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            className="shrink-0 h-9 w-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-amber-100 transition-all focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:outline-none"
            aria-label="Close dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Scrollable middle content */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
          {/* Customer info */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2">
            <p className="text-sm font-semibold text-slate-800 break-words">{customerName}</p>
            <p className="text-xs text-slate-500">{mobile}</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs pt-1">
              <div>
                <p className="text-slate-400 mb-0.5 flex items-center gap-1">
                  <FileText className="h-3 w-3 shrink-0" aria-hidden="true" /> Invoices
                </p>
                <p className="font-semibold text-slate-700">{stats.invoiceCount}</p>
              </div>
              <div>
                <p className="text-slate-400 mb-0.5 flex items-center gap-1">
                  <Wallet className="h-3 w-3 shrink-0" aria-hidden="true" /> Payments
                </p>
                <p className="font-semibold text-slate-700">{stats.paymentCount}</p>
              </div>
              <div>
                <p className="text-slate-400 mb-0.5">Balance</p>
                <p className={`font-semibold tabular-nums break-words ${
                  hasOutstanding ? 'text-rose-700' : hasAdvance ? 'text-emerald-700' : 'text-slate-500'
                }`}>
                  {stats.outstandingPaise === 0 ? 'Cleared' : fromPaise(Math.abs(stats.outstandingPaise))}
                  {hasOutstanding && <span className="ml-1 text-xs">Dr</span>}
                  {hasAdvance && <span className="ml-1 text-xs">Cr</span>}
                </p>
              </div>
            </div>
          </div>

          {/* Outstanding balance warning */}
          {hasOutstanding && (
            <div className="flex items-start gap-3 bg-rose-50 border border-rose-200 rounded-xl p-3 text-sm text-rose-800">
              <AlertCircle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" aria-hidden="true" />
              <p className="break-words whitespace-normal">
                This customer has an outstanding balance of <strong>{fromPaise(stats.outstandingPaise)}</strong>.
                Their financial records must be preserved.
                You can deactivate the customer, but permanent deletion is not allowed while this balance exists.
              </p>
            </div>
          )}

          {/* Advance balance warning */}
          {hasAdvance && (
            <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" aria-hidden="true" />
              <p className="break-words whitespace-normal">
                This customer has an advance/credit balance of <strong>{fromPaise(Math.abs(stats.outstandingPaise))}</strong>.
                Consider refunding or adjusting before deactivating.
              </p>
            </div>
          )}

          {/* Info: records preserved */}
          {hasRecords && (
            <div className="flex items-start gap-3 bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-700">
              <AlertCircle className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" aria-hidden="true" />
              <p className="break-words whitespace-normal">
                All {stats.invoiceCount > 0 ? `${stats.invoiceCount} invoice(s)` : ''}{stats.invoiceCount > 0 && stats.paymentCount > 0 ? ' and ' : ''}{stats.paymentCount > 0 ? `${stats.paymentCount} payment(s)` : ''} will be preserved.
                The customer will be hidden from active lists but will remain visible in historical records and ledgers.
              </p>
            </div>
          )}

          {/* Warning: will be hidden */}
          <div className="flex items-start gap-3 bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-600">
            <AlertTriangle className="h-4 w-4 text-slate-400 shrink-0 mt-0.5" aria-hidden="true" />
            <p className="break-words whitespace-normal">
              The customer will be hidden from the active customer list and cannot be selected when creating new invoices
              until reactivated.
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl px-4 py-3 text-sm" role="alert" aria-live="assertive">
              {error}
            </div>
          )}

          {/* Reason field */}
          <div>
            <label htmlFor="deactivate-reason" className="block text-sm font-medium text-slate-700 mb-1.5">
              Reason <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <textarea
              id="deactivate-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              rows={2}
              placeholder="e.g. Customer closed their account, no longer active..."
              className="w-full px-3 py-3 border border-slate-300 rounded-xl text-base sm:text-sm focus:ring-2 focus:ring-amber-500 outline-none resize-none"
            />
            <p className="mt-1 text-xs text-slate-400 text-right">{reason.length}/500</p>
          </div>
        </div>

        {/* Footer - sticky */}
        <footer className="shrink-0 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end px-4 sm:px-6 py-4 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="w-full sm:w-auto px-4 py-3 sm:py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:outline-none disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDeactivate}
            disabled={saving}
            className="w-full sm:w-auto px-5 py-3 sm:py-2 text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2 shadow-sm focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:outline-none min-h-[44px]"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin shrink-0" />}
            <UserX className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="whitespace-nowrap">{saving ? 'Deactivating…' : 'Deactivate Customer'}</span>
          </button>
        </footer>
      </div>
    </div>
  );
}

/** Convenience hook: fetch customer stats for the dialog */
export function useCustomerStats(customerId: string | null) {
  const [stats, setStats] = useState<CustomerStats | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!customerId) return;
<<<<<<< HEAD
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetch(`/api/customers/${customerId}`)
      .then((r) => r.json())
      .then((data) => {
=======

    const controller = new AbortController();

    async function loadStats() {
      try {
        await Promise.resolve();
        setLoading(true);

        const res = await fetch(`/api/customers/${customerId}`, {
          signal: controller.signal,
        });
        const data = await res.json();
>>>>>>> 96ee175d7fd0837b69320708123c41bc2a663c57
        const c = data.customer;

        if (!controller.signal.aborted && c) {
          setStats({
            invoiceCount: c.sales?.length ?? 0,
            paymentCount: c.payments?.length ?? 0,
            outstandingPaise: toPaise(c.currentBalance),
          });
        }
      } catch {
        // Ignore abort errors
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void loadStats();

    return () => {
      controller.abort();
    };
  }, [customerId]);

  return { stats, loading };
}
