'use client';

import { useState, useEffect, useRef } from 'react';
import { X, CreditCard, AlertTriangle, Loader2, TrendingUp } from 'lucide-react';
import { parseSafeDecimal, toPaise, fromPaise, getCreditStatus, CREDIT_STATUS_LABELS, CREDIT_STATUS_COLORS } from '@/lib/money';

interface Props {
  customerId: string;
  customerName: string;
  customerCode: string;
  currentCreditLimit: string; // formatted INR string OR numeric string
  currentOutstanding: string; // formatted INR string OR numeric string
  currentOutstandingRaw: number; // raw paise
  onSuccess: (newLimit: string) => void;
  onClose: () => void;
}

export default function ChangeCreditLimitDialog({
  customerId,
  customerName,
  customerCode,
  currentCreditLimit,
  currentOutstanding,
  currentOutstandingRaw,
  onSuccess,
  onClose,
}: Props) {
  const [newLimit, setNewLimit] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState('');

  const overlayRef = useRef<HTMLDivElement>(null);

  // Parse current limit and outstanding to paise for calculations
  const currentLimitPaise = toPaise(currentCreditLimit.replace(/[₹,\s]/g, ''));
  const outstandingPaise = currentOutstandingRaw;

  // Live preview calculations
  const parsedLimit = newLimit.trim() !== '' ? parseSafeDecimal(newLimit) : null;
  const newLimitPaise = parsedLimit !== null ? Math.round(parsedLimit * 100) : null;
  const availablePaise = newLimitPaise !== null ? newLimitPaise - outstandingPaise : null;
  const isBelowOutstanding = newLimitPaise !== null && newLimitPaise > 0 && newLimitPaise < outstandingPaise;
  const isLimitExact = newLimitPaise !== null && newLimitPaise === outstandingPaise;
  const creditStatus = newLimitPaise !== null
    ? getCreditStatus(newLimitPaise, outstandingPaise)
    : getCreditStatus(currentLimitPaise, outstandingPaise);

  function validateField(val: string): string {
    if (val.trim() === '') return 'Credit limit is required';
    const parsed = parseSafeDecimal(val);
    if (parsed === null) return 'Enter a valid amount (e.g. 50000 or 50000.00)';
    if (parsed > 9_99_99_999.99) return 'Credit limit cannot exceed ₹9,99,99,999';
    return '';
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const ferr = validateField(newLimit);
    if (ferr) { setFieldError(ferr); return; }
    setFieldError('');
    setError('');
    setSaving(true);

    try {
      const res = await fetch(`/api/customers/${customerId}/credit-limit`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creditLimit: newLimit.trim().replace(/,/g, ''),
          reason: reason.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to update credit limit');
        return;
      }
      onSuccess(data.customer?.creditLimit ?? newLimit);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  // Close on Escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !saving) {
        onClose();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, saving]);

  // Focus trap
  useEffect(() => {
    const el = document.getElementById('new-credit-limit');
    el?.focus();
  }, []);

  // Click outside to close (on overlay only)
  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === overlayRef.current && !saving) {
      onClose();
    }
  }

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="credit-limit-dialog-title"
      aria-describedby="credit-limit-dialog-desc"
    >
      <div className="flex max-h-[calc(100dvh-24px)] w-[calc(100vw-24px)] max-w-lg flex-col rounded-xl border border-slate-200 bg-white shadow-xl sm:w-full overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200">
        {/* Header - sticky */}
        <header className="shrink-0 flex items-center justify-between px-4 sm:px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 bg-emerald-50 border border-emerald-100 rounded-xl flex items-center justify-center shrink-0">
              <CreditCard className="h-5 w-5 text-emerald-600" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 id="credit-limit-dialog-title" className="text-base font-bold text-slate-900 truncate">Change Credit Limit</h2>
              <p id="credit-limit-dialog-desc" className="text-xs text-slate-500 font-mono truncate">{customerCode}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            className="shrink-0 h-9 w-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:outline-none"
            aria-label="Close dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Scrollable middle content */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
          {/* Customer summary */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
            <p className="text-sm font-semibold text-slate-800 break-words">{customerName}</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <p className="text-slate-400 mb-0.5">Current Limit</p>
                <p className="font-semibold text-slate-700 tabular-nums break-words">
                  {currentLimitPaise > 0 ? fromPaise(currentLimitPaise) : 'No Limit'}
                </p>
              </div>
              <div>
                <p className="text-slate-400 mb-0.5">Outstanding</p>
                <p className={`font-semibold tabular-nums break-words ${outstandingPaise > 0 ? 'text-rose-700' : 'text-slate-700'}`}>
                  {fromPaise(outstandingPaise)}
                </p>
              </div>
              <div>
                <p className="text-slate-400 mb-0.5">Credit Status</p>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold border ${CREDIT_STATUS_COLORS[creditStatus]}`}>
                  {CREDIT_STATUS_LABELS[creditStatus]}
                </span>
              </div>
            </div>
          </div>

          {/* Live preview when editing */}
          {newLimitPaise !== null && (
            <div className={`rounded-xl p-4 border text-xs space-y-2 ${
              isBelowOutstanding
                ? 'bg-amber-50 border-amber-200'
                : isLimitExact
                ? 'bg-orange-50 border-orange-200'
                : availablePaise !== null && availablePaise < 0
                ? 'bg-rose-50 border-rose-200'
                : 'bg-emerald-50 border-emerald-200'
            }`}>
              <p className="font-semibold text-slate-700">Preview</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <p className="text-slate-400">New Limit</p>
                  <p className="font-semibold tabular-nums text-slate-800 break-words">{fromPaise(newLimitPaise)}</p>
                </div>
                <div>
                  <p className="text-slate-400">Outstanding</p>
                  <p className="font-semibold tabular-nums text-rose-700 break-words">{fromPaise(outstandingPaise)}</p>
                </div>
                <div className="sm:col-span-2">
                  {availablePaise !== null && availablePaise >= 0 ? (
                    <>
                      <p className="text-slate-400">Available Credit</p>
                      <p className="font-bold tabular-nums text-emerald-700 break-words">{fromPaise(availablePaise)}</p>
                    </>
                  ) : availablePaise !== null ? (
                    <>
                      <p className="text-slate-400">Credit Limit Exceeded By</p>
                      <p className="font-bold tabular-nums text-rose-700 break-words">{fromPaise(Math.abs(availablePaise))}</p>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          )}

          {/* Warning: new limit below outstanding */}
          {isBelowOutstanding && (
            <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" aria-hidden="true" />
              <p className="break-words whitespace-normal">
                The new limit (<strong>{fromPaise(newLimitPaise!)}</strong>) is below the current outstanding balance ({fromPaise(outstandingPaise)}). This will immediately put the account into <strong>Limit Exceeded</strong> status.
              </p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl px-4 py-3 text-sm" role="alert" aria-live="assertive">
              {error}
            </div>
          )}

          {/* New limit field */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5" htmlFor="new-credit-limit">
              New Credit Limit (₹)
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-medium pointer-events-none select-none">₹</span>
              <input
                id="new-credit-limit"
                type="text"
                inputMode="decimal"
                value={newLimit}
                onChange={(e) => {
                  setNewLimit(e.target.value);
                  setFieldError(validateField(e.target.value));
                }}
                placeholder="0.00"
                className={`w-full pl-8 pr-4 py-3 border rounded-xl text-base sm:text-sm font-medium focus:ring-2 focus:ring-emerald-500 outline-none transition-all ${
                  fieldError ? 'border-rose-400 bg-rose-50' : 'border-slate-300 bg-white'
                }`}
                aria-describedby={fieldError ? 'credit-limit-error' : undefined}
                autoFocus
              />
            </div>
            {fieldError && (
              <p id="credit-limit-error" className="mt-1 text-xs text-rose-600 break-words">{fieldError}</p>
            )}
            <p className="mt-1 text-xs text-slate-400">
              Enter 0 to remove the credit limit. Maximum: ₹9,99,99,999
            </p>
          </div>

          {/* Reason field */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5" htmlFor="credit-limit-reason">
              Reason / Note <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <textarea
              id="credit-limit-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              rows={2}
              placeholder="e.g. Limit increased after payment review"
              className="w-full px-3 py-3 border border-slate-300 rounded-xl text-base sm:text-sm focus:ring-2 focus:ring-emerald-500 outline-none resize-none"
            />
            <p className="mt-1 text-xs text-slate-400 text-right">{reason.length}/500</p>
          </div>

          {/* Credit status info */}
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-700 space-y-1">
            <p className="font-semibold flex items-center gap-1.5"><TrendingUp className="h-3 w-3" aria-hidden="true" />Credit Status Rules</p>
            <p><span className="font-medium">Available</span> — usage below 80%</p>
            <p><span className="font-medium">Near Limit</span> — usage 80%–99%</p>
            <p><span className="font-medium">Limit Reached</span> — usage exactly 100%</p>
            <p><span className="font-medium">Limit Exceeded</span> — usage above 100%</p>
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
            type="submit"
            onClick={handleSubmit}
            disabled={saving || !!fieldError}
            className="w-full sm:w-auto px-5 py-3 sm:py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2 shadow-sm focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:outline-none min-h-[44px]"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin shrink-0" />}
            <span className="whitespace-nowrap">{saving ? 'Updating…' : 'Update Credit Limit'}</span>
          </button>
        </footer>
      </div>
    </div>
  );
}