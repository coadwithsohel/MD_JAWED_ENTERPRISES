"use client";

import { useState, useEffect } from "react";
import { X, Trash2, Loader2, AlertCircle } from "lucide-react";

interface SaleItem {
  id?: string;
  productId: string;
  productName: string;
  productSku: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  gstPercent: number;
}

interface EditInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  invoice: {
    id: string;
    invoiceNumber: string;
    createdAt: string;
    saleDate?: string | null;
    dueDate?: string | null;
    notes?: string | null;
    updatedAt: string;
    customer?: {
      id: string;
      fullName: string;
      customerCode: string;
      mobile: string;
    } | null;
    saleItems: Array<{
      id: string;
      productId: string;
      product: { name: string; sku: string; sellingPrice: string; gstPercent: string };
      quantity: number;
      unitPrice: string;
      discountAmount: string;
      gstPercent: string;
    }>;
  };
}

interface ProductOption {
  id: string;
  name: string;
  sku: string;
  sellingPrice: string;
  gstPercent: string;
  stockQuantity: number;
}

export default function EditInvoiceModal({
  isOpen,
  onClose,
  onSuccess,
  invoice,
}: EditInvoiceModalProps) {
  const [invoiceNumber, setInvoiceNumber] = useState(invoice.invoiceNumber);
  const [saleDate, setSaleDate] = useState(
    invoice.saleDate
      ? new Date(invoice.saleDate).toISOString().split("T")[0]
      : new Date(invoice.createdAt).toISOString().split("T")[0]
  );
  const [dueDate, setDueDate] = useState(
    invoice.dueDate ? new Date(invoice.dueDate).toISOString().split("T")[0] : ""
  );
  const [notes, setNotes] = useState(invoice.notes ?? "");
  const [editReason, setEditReason] = useState("");
  const [items, setItems] = useState<SaleItem[]>([]);
  const [availableProducts, setAvailableProducts] = useState<ProductOption[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInvoiceNumber(invoice.invoiceNumber);
      setSaleDate(
        invoice.saleDate
          ? new Date(invoice.saleDate).toISOString().split("T")[0]
          : new Date(invoice.createdAt).toISOString().split("T")[0]
      );
      setDueDate(
        invoice.dueDate ? new Date(invoice.dueDate).toISOString().split("T")[0] : ""
      );
      setNotes(invoice.notes ?? "");
      setEditReason("");
      setError(null);

      // Load existing items
      setItems(
        invoice.saleItems.map((item) => ({
          id: item.id,
          productId: item.productId,
          productName: item.product.name,
          productSku: item.product.sku,
          quantity: item.quantity,
          unitPrice: parseFloat(item.unitPrice),
          discountAmount: parseFloat(item.discountAmount),
          gstPercent: parseFloat(item.gstPercent),
        }))
      );

      // Fetch active products for drop-down additions
      fetch("/api/products?active=true&limit=200")
        .then((res) => res.json())
        .then((data) => {
          setAvailableProducts(data.products ?? []);
        })
        .catch(() => {});
    }
  }, [isOpen, invoice]);

  if (!isOpen) return null;

  const updateItem = (index: number, field: keyof SaleItem, value: number) => {
    setItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const addItem = (product: ProductOption) => {
    const existingIndex = items.findIndex((i) => i.productId === product.id);
    if (existingIndex >= 0) {
      updateItem(existingIndex, "quantity", items[existingIndex].quantity + 1);
    } else {
      setItems((prev) => [
        ...prev,
        {
          productId: product.id,
          productName: product.name,
          productSku: product.sku,
          quantity: 1,
          unitPrice: parseFloat(product.sellingPrice),
          discountAmount: 0,
          gstPercent: parseFloat(product.gstPercent),
        },
      ]);
    }
  };

  const removeItem = (index: number) => {
    if (items.length <= 1) {
      setError("Invoice must contain at least one item.");
      return;
    }
    setError(null);
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  // Math totals
  const subtotal = items.reduce(
    (acc, i) => acc + Math.max(0, i.unitPrice * i.quantity - i.discountAmount),
    0
  );
  const totalGst = items.reduce(
    (acc, i) =>
      acc +
      Math.max(0, i.unitPrice * i.quantity - i.discountAmount) * (i.gstPercent / 100),
    0
  );
  const grandTotal = subtotal + totalGst;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    if (items.length === 0) {
      setError("Invoice must contain at least one item");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/invoices/${invoice.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceNumber: invoiceNumber.trim(),
          saleDate: saleDate ? new Date(saleDate).toISOString() : null,
          dueDate: dueDate ? new Date(dueDate).toISOString() : null,
          notes: notes.trim() || null,
          editReason: editReason.trim() || null,
          updatedAt: invoice.updatedAt,
          items: items.map((i) => ({
            id: i.id,
            productId: i.productId,
            quantity: Number(i.quantity),
            unitPrice: Number(i.unitPrice),
            discountAmount: Number(i.discountAmount || 0),
            gstPercent: Number(i.gstPercent || 0),
          })),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to update invoice");
      }

      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update invoice");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl overflow-hidden max-h-[90vh] flex flex-col my-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Edit Invoice</h2>
            <p className="text-xs text-slate-500 font-mono">ID: {invoice.id}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200/60 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
          {error && (
            <div className="flex items-start gap-2.5 p-3.5 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl">
              <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
              <div>{error}</div>
            </div>
          )}

          {/* Customer Snapshot (Locked) */}
          <div className="bg-blue-50/60 border border-blue-200/60 rounded-xl p-3.5 flex items-center justify-between text-sm">
            <div>
              <span className="text-xs font-semibold text-blue-600 uppercase tracking-wider block mb-0.5">
                Customer (Locked)
              </span>
              <p className="font-semibold text-slate-900">
                {invoice.customer?.fullName ?? "Walk-in Customer"}
              </p>
              {invoice.customer && (
                <p className="text-xs text-slate-500 font-mono">
                  {invoice.customer.customerCode} · {invoice.customer.mobile}
                </p>
              )}
            </div>
            <span className="text-xs font-medium text-slate-400 bg-white border border-slate-200 rounded-lg px-2.5 py-1">
              Immutable ID
            </span>
          </div>

          {/* Invoice Header Details */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Invoice Number
              </label>
              <input
                type="text"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                required
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Invoice Date
              </label>
              <input
                type="date"
                value={saleDate}
                onChange={(e) => setSaleDate(e.target.value)}
                required
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Due Date
              </label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
          </div>

          {/* Line Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold text-slate-900">Line Items</h3>
              {availableProducts.length > 0 && (
                <select
                  onChange={(e) => {
                    const prod = availableProducts.find((p) => p.id === e.target.value);
                    if (prod) addItem(prod);
                    e.target.value = "";
                  }}
                  defaultValue=""
                  className="text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white text-blue-600 font-semibold outline-none cursor-pointer"
                >
                  <option value="" disabled>
                    + Add Product to Invoice
                  </option>
                  {availableProducts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.sku}) — ₹{p.sellingPrice}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 text-slate-500 uppercase font-semibold">
                  <tr>
                    <th className="p-3">Product</th>
                    <th className="p-3 w-20 text-center">Qty</th>
                    <th className="p-3 w-28 text-right">Price (₹)</th>
                    <th className="p-3 w-24 text-right">Disc (₹)</th>
                    <th className="p-3 w-20 text-right">GST %</th>
                    <th className="p-3 w-28 text-right">Total (₹)</th>
                    <th className="p-3 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {items.map((item, idx) => {
                    const lineSub = Math.max(
                      0,
                      item.unitPrice * item.quantity - item.discountAmount
                    );
                    const lineTotal = lineSub + lineSub * (item.gstPercent / 100);

                    return (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="p-3">
                          <p className="font-semibold text-slate-900">
                            {item.productName}
                          </p>
                          <p className="text-[10px] text-slate-400 font-mono">
                            {item.productSku}
                          </p>
                        </td>
                        <td className="p-3 text-center">
                          <input
                            type="number"
                            min="1"
                            value={item.quantity}
                            onChange={(e) =>
                              updateItem(idx, "quantity", parseInt(e.target.value) || 1)
                            }
                            className="w-16 text-center border border-slate-300 rounded px-1 py-1 font-semibold"
                          />
                        </td>
                        <td className="p-3 text-right">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.unitPrice}
                            onChange={(e) =>
                              updateItem(
                                idx,
                                "unitPrice",
                                parseFloat(e.target.value) || 0
                              )
                            }
                            className="w-24 text-right border border-slate-300 rounded px-1 py-1"
                          />
                        </td>
                        <td className="p-3 text-right">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.discountAmount}
                            onChange={(e) =>
                              updateItem(
                                idx,
                                "discountAmount",
                                parseFloat(e.target.value) || 0
                              )
                            }
                            className="w-20 text-right border border-slate-300 rounded px-1 py-1 text-slate-600"
                          />
                        </td>
                        <td className="p-3 text-right">
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.1"
                            value={item.gstPercent}
                            onChange={(e) =>
                              updateItem(
                                idx,
                                "gstPercent",
                                parseFloat(e.target.value) || 0
                              )
                            }
                            className="w-16 text-right border border-slate-300 rounded px-1 py-1 text-slate-600"
                          />
                        </td>
                        <td className="p-3 text-right font-bold text-slate-900">
                          ₹{lineTotal.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                        </td>
                        <td className="p-3 text-center">
                          <button
                            type="button"
                            onClick={() => removeItem(idx)}
                            className="text-red-400 hover:text-red-600 transition-colors p-1"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Totals Summary */}
          <div className="bg-slate-50 rounded-xl p-4 flex flex-col items-end space-y-1 text-sm">
            <div className="flex justify-between w-64 text-slate-500 text-xs">
              <span>Subtotal:</span>
              <span>₹{subtotal.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between w-64 text-slate-500 text-xs">
              <span>Total GST:</span>
              <span>₹{totalGst.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between w-64 font-bold text-slate-900 border-t border-slate-200 pt-1 text-base">
              <span>Grand Total:</span>
              <span className="text-blue-600">
                ₹{grandTotal.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          {/* Notes & Reason */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Notes
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Optional invoice notes..."
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Edit Reason (Audit Log)
              </label>
              <textarea
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
                rows={2}
                placeholder="Reason for modifying this invoice..."
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
          </div>

          {/* Footer Buttons */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm rounded-xl transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Saving Changes...
                </>
              ) : (
                "Save Invoice Changes"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
