'use client';

import { useState, useEffect, useRef } from 'react';
import { X, UserCheck, Loader2, AlertCircle } from 'lucide-react';

interface Props {
  customerId: string;
  customerName: string;
  customerCode: string;
  onSuccess: () => void;
  onClose: () => void;
}

export default function RestoreDialog({
  customerId,
  customerName,
  customerCode,
  onSuccess,
  onClose,
}: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const overlayRef = useRef<HTMLDivElement>(null);

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

  async function handleRestore() {
    setError('');
    setSaving(true);
    try {
      const res = await fetch(`/api/customers/${customerId}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to restore customer');
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
      aria-labelledby="restore-dialog-title"
      aria-describedby="restore-dialog-desc"
    >
      <div className="flex max-h-[calc(100dvh-24px)] w-[calc(100vw-24px)] max-w-md flex-col rounded-xl border border-slate-200 bg-white shadow-xl sm:w-full overflow-hidden">
        {/* Header */}
        <header className="shrink-0 flex items-center justify-between px-4 sm:px-6 py-4 border-b border-emerald-100 bg-emerald-50">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 bg-emerald-100 border border-emerald-200 rounded-xl flex items-center justify-center shrink-0">
              <UserCheck className="h-5 w-5 text-emerald-600" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 id="restore-dialog-title" className="text-base font-bold text-slate-900 truncate">
                Reactivate Customer
              </h2>
              <p id="restore-dialog-desc" className="text-xs text-slate-500 font-mono truncate">{customerCode}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            className="shrink-0 h-9 w-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-emerald-100 transition-all focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:outline-none"
            aria-label="Close dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Scrollable content */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
          <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-slate-800 break-words">{customerName}</p>
              <p className="text-xs text-slate-600 mt-1">
                Reactivating this customer will restore their access to new invoices and make them visible in the
                active customer list again.
              </p>
            </div>
          </div>

          {error && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl px-4 py-3 text-sm" role="alert" aria-live="assertive">
              {error}
            </div>
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
            Cancel
          </button>
          <button
            type="button"
            onClick={handleRestore}
            disabled={saving}
            className="w-full sm:w-auto px-5 py-3 sm:py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2 shadow-sm focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:outline-none min-h-[44px]"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin shrink-0" />}
            <UserCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="whitespace-nowrap">{saving ? 'Reactivating…' : 'Reactivate Customer'}</span>
          </button>
        </footer>
      </div>
    </div>
  );
}