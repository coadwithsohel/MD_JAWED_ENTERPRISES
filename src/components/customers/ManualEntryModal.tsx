"use client";

import { useState, useEffect } from "react";
import { X, Loader2, PlusCircle, ArrowUpRight, ArrowDownLeft } from "lucide-react";

interface ManualEntryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  customer: {
    id: string;
    fullName: string;
    customerCode: string;
    mobile: string;
  };
  initialData?: {
    id: string;
    entryType: "DEBIT" | "CREDIT";
    amount: number;
    transactionDate: string;
    referenceNumber?: string | null;
    particulars: string;
    notes?: string | null;
    reason?: string | null;
    recordUpdatedAt?: string | null;
  } | null;
}

export default function ManualEntryModal({
  isOpen,
  onClose,
  onSuccess,
  customer,
  initialData,
}: ManualEntryModalProps) {
  const isEditing = !!initialData;
  const [entryType, setEntryType] = useState<"DEBIT" | "CREDIT">("DEBIT");
  const [amount, setAmount] = useState("");
  const [transactionDate, setTransactionDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [referenceNumber, setReferenceNumber] = useState("");
  const [particulars, setParticulars] = useState("");
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (initialData) {
        setEntryType(initialData.entryType);
        setAmount(String(initialData.amount));
        setTransactionDate(
          new Date(initialData.transactionDate).toISOString().split("T")[0]
        );
        setReferenceNumber(initialData.referenceNumber ?? "");
        setParticulars(initialData.particulars);
        setNotes(initialData.notes ?? "");
        setReason(initialData.reason ?? "");
      } else {
        setEntryType("DEBIT");
        setAmount("");
        setTransactionDate(new Date().toISOString().split("T")[0]);
        setReferenceNumber("");
        setParticulars("");
        setNotes("");
        setReason("");
      }
      setError(null);
    }
  }, [isOpen, initialData]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      setError("Amount must be greater than zero");
      return;
    }

    if (!particulars.trim()) {
      setError("Particulars / description is required");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const url = isEditing
        ? `/api/adjustments/${initialData.id}`
        : `/api/adjustments`;
      const method = isEditing ? "PATCH" : "POST";

      const idempotencyKey = isEditing
        ? undefined
        : `adj-${customer.id}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: customer.id,
          entryType,
          amount: numAmount,
          transactionDate: new Date(transactionDate).toISOString(),
          referenceNumber: referenceNumber.trim() || null,
          particulars: particulars.trim(),
          notes: notes.trim() || null,
          reason: reason.trim() || null,
          idempotencyKey,
          updatedAt: initialData?.recordUpdatedAt ?? undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to save manual entry");
      }

      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save manual entry");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50">
          <div className="flex items-center gap-2">
            <PlusCircle className="h-5 w-5 text-blue-600" />
            <h2 className="text-base font-bold text-slate-900">
              {isEditing ? "Edit Manual Entry" : "Add Manual Customer Entry"}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200/60 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Customer info (Locked) */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex items-center justify-between text-xs">
            <div>
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
                Customer (Locked)
              </span>
              <p className="font-semibold text-slate-900 text-sm">{customer.fullName}</p>
              <p className="text-slate-500 font-mono">
                {customer.customerCode} · {customer.mobile}
              </p>
            </div>
            <span className="text-slate-400 bg-white border border-slate-200 rounded px-2 py-0.5 font-medium text-[11px]">
              Preselected
            </span>
          </div>

          {/* Entry Type Toggle */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Entry Type
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setEntryType("DEBIT")}
                disabled={isEditing}
                className={`flex items-center justify-center gap-2 p-3 rounded-xl border text-xs font-bold transition-all ${
                  entryType === "DEBIT"
                    ? "bg-red-50 border-red-300 text-red-700 ring-2 ring-red-500/20"
                    : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                } ${isEditing ? "opacity-60 cursor-not-allowed" : ""}`}
              >
                <ArrowUpRight className="h-4 w-4 text-red-600" />
                <div className="text-left">
                  <p>Debit Adjustment</p>
                  <p className="text-[10px] font-normal text-slate-500">
                    Customer owes us more
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setEntryType("CREDIT")}
                disabled={isEditing}
                className={`flex items-center justify-center gap-2 p-3 rounded-xl border text-xs font-bold transition-all ${
                  entryType === "CREDIT"
                    ? "bg-green-50 border-green-300 text-green-700 ring-2 ring-green-500/20"
                    : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                } ${isEditing ? "opacity-60 cursor-not-allowed" : ""}`}
              >
                <ArrowDownLeft className="h-4 w-4 text-green-600" />
                <div className="text-left">
                  <p>Credit Adjustment</p>
                  <p className="text-[10px] font-normal text-slate-500">
                    Customer owes us less
                  </p>
                </div>
              </button>
            </div>
          </div>

          {/* Amount & Date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Amount (₹) *
              </label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 500"
                required
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-semibold focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Transaction Date *
              </label>
              <input
                type="date"
                value={transactionDate}
                onChange={(e) => setTransactionDate(e.target.value)}
                required
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
          </div>

          {/* Particulars & Ref # */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Particulars / Description *
              </label>
              <input
                type="text"
                value={particulars}
                onChange={(e) => setParticulars(e.target.value)}
                placeholder={
                  entryType === "DEBIT"
                    ? "e.g. Old balance carry forward"
                    : "e.g. Discount adjustment"
                }
                required
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Reference Number
              </label>
              <input
                type="text"
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
                placeholder="Optional ref / voucher #"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Notes / Reason
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional internal notes..."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 outline-none"
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
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-xl transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving Entry...
                </>
              ) : isEditing ? (
                "Update Entry"
              ) : (
                "Save Entry"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
