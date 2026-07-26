"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";

interface VoidInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  invoice: {
    id: string;
    invoiceNumber: string;
    grandTotal: string;
    updatedAt: string;
    customerName?: string | null;
  };
}

export default function VoidInvoiceModal({
  isOpen,
  onClose,
  onSuccess,
  invoice,
}: VoidInvoiceModalProps) {
  const [voidReason, setVoidReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleVoid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/invoices/${invoice.id}/void`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          voidReason: voidReason.trim() || null,
          updatedAt: invoice.updatedAt,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to void invoice");
      }

      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to void invoice");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-amber-50/50">
          <div className="flex items-center gap-2 text-amber-700 font-bold text-base">
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
            Void Invoice Confirmation
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleVoid} className="p-5 space-y-4">
          <p className="text-sm font-medium text-slate-800">
            Void this invoice? This will reverse its accounting and stock impact.
          </p>

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs space-y-1">
            <p className="text-slate-500">
              Invoice:{" "}
              <span className="font-mono font-bold text-slate-900">
                {invoice.invoiceNumber}
              </span>
            </p>
            {invoice.customerName && (
              <p className="text-slate-500">
                Customer:{" "}
                <span className="font-semibold text-slate-900">
                  {invoice.customerName}
                </span>
              </p>
            )}
            <p className="text-slate-500">
              Total Amount:{" "}
              <span className="font-bold text-slate-900">
                ₹{parseFloat(invoice.grandTotal).toLocaleString("en-IN")}
              </span>
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Reason for Voiding (Optional)
            </label>
            <textarea
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              rows={2}
              placeholder="e.g. Wrong items billed, customer cancelled order..."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-amber-500 outline-none"
            />
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2.5">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs rounded-xl transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Voiding Invoice...
                </>
              ) : (
                "Void Invoice"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
