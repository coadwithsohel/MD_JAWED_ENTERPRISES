"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Search, ArrowRight, Loader2, Save } from "lucide-react";
import { formatINR } from "@/lib/money";

interface Customer {
  id: string;
  customerCode: string;
  fullName: string;
  mobile: string;
  currentBalance: number;
}

interface BulkRow {
  id: string; // local temporary id
  customerId: string;
  customerCode: string;
  customerName: string;
  currentBalance: number;
  amount: string;
  entryType: "PAYMENT" | "MANUAL_DEBIT" | "MANUAL_CREDIT";
  paymentMode: "CASH" | "UPI" | "CARD" | "BANK_TRANSFER" | "CHEQUE" | "OTHER";
  referenceNumber: string;
  notes: string;
}

function parseRupees(value: unknown): number {
  const normalized = String(value ?? "")
    .replace(/₹/g, "")
    .replace(/,/g, "")
    .trim();

  const amount = Number(normalized);

  if (!Number.isFinite(amount)) {
    throw new Error("Invalid amount");
  }

  return amount;
}

export default function BulkEntryPage() {
  const router = useRouter();

  const [entryDate, setEntryDate] = useState<string>(
    new Date().toISOString().split("T")[0],
  );
  const [defaultEntryType, setDefaultEntryType] = useState<
    "PAYMENT" | "MANUAL_DEBIT" | "MANUAL_CREDIT"
  >("PAYMENT");
  const [defaultPaymentMode, setDefaultPaymentMode] = useState<
    "CASH" | "UPI" | "CARD" | "BANK_TRANSFER" | "CHEQUE" | "OTHER"
  >("CASH");
  const [batchNotes, setBatchNotes] = useState<string>("");

  const [rows, setRows] = useState<BulkRow[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearchRow, setActiveSearchRow] = useState<string | null>(null);

  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [postResult, setPostResult] = useState<any>(null);
  const [error, setError] = useState("");

  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Add first empty row
    if (rows.length === 0) {
      handleAddRow();
    }
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setActiveSearchRow(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (searchQuery.length >= 2) {
      const delay = setTimeout(async () => {
        try {
          const res = await fetch(
            `/api/customers?search=${encodeURIComponent(searchQuery)}&limit=10`,
          );
          const data = await res.json();
          setCustomers(data.customers || []);
        } catch (e) {
          console.error(e);
        }
      }, 300);
      return () => clearTimeout(delay);
    } else {
      setCustomers([]);
    }
  }, [searchQuery]);

  const generateLocalId = () => Math.random().toString(36).substring(2, 9);

  const handleAddRow = () => {
    setRows((prev) => [
      ...prev,
      {
        id: generateLocalId(),
        customerId: "",
        customerCode: "",
        customerName: "",
        currentBalance: 0,
        amount: "",
        entryType: defaultEntryType,
        paymentMode: defaultPaymentMode,
        referenceNumber: "",
        notes: "",
      },
    ]);
  };

  const handleRemoveRow = (id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  const handleUpdateRow = (id: string, field: keyof BulkRow, value: any) => {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)),
    );
  };

  const selectCustomer = (rowId: string, customer: Customer) => {
    // Only warn about duplicate if they have the same entryType, else allow.
    // We will do a full check in validation.

    setRows((prev) =>
      prev.map((r) => {
        if (r.id === rowId) {
          return {
            ...r,
            customerId: customer.id,
            customerCode: customer.customerCode,
            customerName: customer.fullName,
            currentBalance: customer.currentBalance,
          };
        }
        return r;
      }),
    );
    setActiveSearchRow(null);
    setSearchQuery("");
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "Enter" && !isPreviewMode && !postResult) {
        validateAndPreview();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [rows, entryDate, isPreviewMode, postResult]);

  const validRows = rows.filter((r) => {
    if (!r.customerId) return false;
    try {
      return parseRupees(r.amount) > 0;
    } catch {
      return false;
    }
  });
  const totalAmount = validRows.reduce((sum, r) => sum + parseRupees(r.amount), 0);
  const invalidRowCount = rows.filter((r) => {
    if (!r.customerId) return false;
    try {
      return parseRupees(r.amount) <= 0;
    } catch {
      return true;
    }
  }).length;

  let summaryLabel = "Total Amount";
  if (validRows.length > 0) {
    const hasPayment = validRows.some(r => r.entryType === "PAYMENT");
    const hasDebit = validRows.some(r => r.entryType === "MANUAL_DEBIT");
    const hasCredit = validRows.some(r => r.entryType === "MANUAL_CREDIT");
    
    if (hasPayment && !hasDebit && !hasCredit) summaryLabel = "Total Received";
    else if (!hasPayment && hasDebit && !hasCredit) summaryLabel = "Total Debit";
    else if (!hasPayment && !hasDebit && hasCredit) summaryLabel = "Total Credit";
  } else {
    if (defaultEntryType === "PAYMENT") summaryLabel = "Total Received";
    else if (defaultEntryType === "MANUAL_DEBIT") summaryLabel = "Total Debit";
    else if (defaultEntryType === "MANUAL_CREDIT") summaryLabel = "Total Credit";
  }

  const validateAndPreview = () => {
    setError("");
    if (validRows.length === 0) {
      setError("Add at least one valid row with an amount greater than zero.");
      return;
    }

    const partial = rows.find(
      (r) => (r.customerId && !r.amount) || (!r.customerId && r.amount),
    );
    if (partial) {
      setError("Please complete or remove partially filled rows.");
      return;
    }

    if (invalidRowCount > 0) {
      setError(`There are ${invalidRowCount} rows with invalid amounts.`);
      return;
    }

    // Check duplicates based on business rules
    for (let i = 0; i < validRows.length; i++) {
      for (let j = i + 1; j < validRows.length; j++) {
        if (validRows[i].customerId === validRows[j].customerId) {
          if (validRows[i].entryType === validRows[j].entryType) {
            setError(
              `Customer ${validRows[i].customerName} already has a ${validRows[i].entryType} in Row ${i + 1} and ${j + 1}. Blocked as duplicate.`,
            );
            return;
          } else if (
            (validRows[i].entryType === "MANUAL_DEBIT" &&
              validRows[j].entryType === "MANUAL_CREDIT") ||
            (validRows[i].entryType === "MANUAL_CREDIT" &&
              validRows[j].entryType === "MANUAL_DEBIT") ||
            (validRows[i].entryType === "PAYMENT" &&
              validRows[j].entryType === "MANUAL_DEBIT") ||
            (validRows[i].entryType === "MANUAL_DEBIT" &&
              validRows[j].entryType === "PAYMENT")
          ) {
            // Mixed entries are allowed, just continue
          } else if (
            validRows[i].entryType === "PAYMENT" ||
            validRows[j].entryType === "PAYMENT"
          ) {
            // Let server handle payment + credit rules if any, or allow
          }
        }
      }
    }

    setIsPreviewMode(true);
  };

  const handleConfirm = async () => {
    setIsSubmitting(true);
    setError("");

    const idempotencyKey = `bulk-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    try {
      let batchType = "PAYMENT";
      const hasPayment = validRows.some((r) => r.entryType === "PAYMENT");
      const hasDebit = validRows.some((r) => r.entryType === "MANUAL_DEBIT");
      const hasCredit = validRows.some((r) => r.entryType === "MANUAL_CREDIT");

      if (hasDebit || hasCredit) {
        batchType = "MANUAL_ADJUSTMENT";
      }

      const payload = {
        idempotencyKey,
        entryDate,
        batchType,
        defaultPaymentMode:
          batchType === "MANUAL_ADJUSTMENT" ? null : defaultPaymentMode,
        notes: batchNotes,
        rows: validRows.map((r) => ({
          customerId: r.customerId,
          amount: parseRupees(r.amount),
          entryType: r.entryType,
          paymentMode: r.entryType === "PAYMENT" ? r.paymentMode : undefined,
          referenceNumber: r.referenceNumber || null,
          notes: r.notes || null,
        })),
      };

      const res = await fetch("/api/bulk-entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.message || "Failed to post batch");
        setIsSubmitting(false);
        return;
      }

      setPostResult(json.batch);
    } catch (e: any) {
      setError(e.message || "Network error");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (postResult) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-8 text-center shadow-sm">
          <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Save className="w-8 h-8 text-emerald-600" />
          </div>
          <h2 className="text-2xl font-bold text-emerald-900 mb-2">
            Batch Posted Successfully
          </h2>
          <p className="text-emerald-700 mb-6">
            Reference:{" "}
            <span className="font-mono font-medium">
              {postResult.batchReference}
            </span>
          </p>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8 text-left">
            <div className="bg-white p-4 rounded-lg shadow-sm border border-emerald-100">
              <div className="text-xs text-emerald-600 font-medium uppercase">
                Total Rows
              </div>
              <div className="text-2xl font-bold text-emerald-900">
                {postResult.rowCount}
              </div>
            </div>
            <div className="bg-white p-4 rounded-lg shadow-sm border border-emerald-100">
              <div className="text-xs text-emerald-600 font-medium uppercase">
                Total Amount
              </div>
              <div className="text-2xl font-bold text-emerald-900">
                {formatINR(Number(postResult.totalAmount))}
              </div>
            </div>
            <div className="bg-white p-4 rounded-lg shadow-sm border border-emerald-100">
              <div className="text-xs text-emerald-600 font-medium uppercase">
                Entry Date
              </div>
              <div className="text-lg font-bold text-emerald-900">
                {new Date(postResult.entryDate).toLocaleDateString("en-IN")}
              </div>
            </div>
            <div className="bg-white p-4 rounded-lg shadow-sm border border-emerald-100">
              <div className="text-xs text-emerald-600 font-medium uppercase">
                Type
              </div>
              <div className="text-lg font-bold text-emerald-900">
                {postResult.batchType === "PAYMENT" ? "Payment" : "Adjustment"}
              </div>
            </div>
          </div>

          <div className="flex gap-4 justify-center">
            <button
              onClick={() => router.push("/dashboard/bulk-entry/history")}
              className="px-6 py-2 bg-white border border-slate-300 text-slate-700 font-medium rounded-lg hover:bg-slate-50 transition-colors"
            >
              Batch History
            </button>
            <button
              onClick={() => {
                setPostResult(null);
                setIsPreviewMode(false);
                setRows([]);
                setBatchNotes("");
                handleAddRow();
              }}
              className="px-6 py-2 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition-colors"
            >
              New Bulk Entry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto pb-32">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-900">
          Bulk Payment Entry
        </h1>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm mb-6">
        <div className="p-5 border-b border-slate-100 grid grid-cols-1 md:grid-cols-4 gap-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Entry Type
            </label>
            <select
              className="w-full h-10 px-3 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm"
              value={defaultEntryType}
              onChange={(e) => {
                const type = e.target.value as any;
                setDefaultEntryType(type);
                setRows((prev) => prev.map((r) => ({ ...r, entryType: type })));
              }}
            >
              <option value="PAYMENT">Customer Payment</option>
              <option value="MANUAL_DEBIT">Manual Debit</option>
              <option value="MANUAL_CREDIT">Manual Credit</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Entry Date <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              className="w-full h-10 px-3 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Default Mode
            </label>
            <select
              className="w-full h-10 px-3 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm"
              value={defaultPaymentMode}
              onChange={(e) => {
                const mode = e.target.value as any;
                setDefaultPaymentMode(mode);
                setRows((prev) =>
                  prev.map((r) => ({ ...r, paymentMode: mode })),
                );
              }}
              disabled={defaultEntryType !== "PAYMENT"}
            >
              <option value="CASH">CASH</option>
              <option value="UPI">UPI</option>
              <option value="CARD">CARD</option>
              <option value="BANK_TRANSFER">BANK TRANSFER</option>
              <option value="CHEQUE">CHEQUE</option>
              <option value="OTHER">OTHER</option>
            </select>
          </div>
          <div className="md:col-span-1">
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Common Notes
            </label>
            <input
              type="text"
              placeholder="Added to all batch records (optional)"
              className="w-full h-10 px-3 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm"
              value={batchNotes}
              onChange={(e) => setBatchNotes(e.target.value)}
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 font-medium text-slate-500 w-12 text-center">
                  #
                </th>
                <th className="px-4 py-3 font-medium text-slate-500 min-w-[280px]">
                  Customer <span className="text-red-500">*</span>
                </th>
                <th className="px-4 py-3 font-medium text-slate-500">
                  Balance
                </th>
                <th className="px-4 py-3 font-medium text-slate-500 w-36">
                  Entry Type
                </th>
                <th className="px-4 py-3 font-medium text-slate-500 w-32">
                  Amount <span className="text-red-500">*</span>
                </th>
                <th className="px-4 py-3 font-medium text-slate-500 w-36">
                  Mode
                </th>
                <th className="px-4 py-3 font-medium text-slate-500 w-40">
                  Ref / Notes
                </th>
                <th className="px-4 py-3 font-medium text-slate-500 w-12 text-center"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row, index) => (
                <tr key={row.id} className="hover:bg-slate-50/50 group">
                  <td className="px-4 py-3 text-center text-slate-400 font-medium">
                    {index + 1}
                  </td>
                  <td className="px-4 py-3">
                    {row.customerId ? (
                      <div className="flex items-center justify-between bg-indigo-50 text-indigo-900 border border-indigo-100 px-3 py-2 rounded-md">
                        <div className="truncate">
                          <div className="font-medium text-sm">
                            {row.customerName}
                          </div>
                          <div className="text-xs text-indigo-700 opacity-80">
                            {row.customerCode}
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            handleUpdateRow(row.id, "customerId", "");
                            handleUpdateRow(row.id, "customerName", "");
                            handleUpdateRow(row.id, "customerCode", "");
                            handleUpdateRow(row.id, "currentBalance", 0);
                          }}
                          className="text-indigo-400 hover:text-indigo-600 p-1 ml-2"
                        >
                          <Search className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <div
                        className="relative"
                        ref={activeSearchRow === row.id ? searchRef : null}
                      >
                        <div className="relative">
                          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                          <input
                            type="text"
                            placeholder="Search name, code, mobile..."
                            className="w-full h-9 pl-9 pr-3 rounded-md border border-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                            value={
                              activeSearchRow === row.id ? searchQuery : ""
                            }
                            onFocus={() => {
                              setActiveSearchRow(row.id);
                              setSearchQuery("");
                            }}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") e.preventDefault();
                            }}
                          />
                        </div>
                        {activeSearchRow === row.id && customers.length > 0 && (
                          <div className="absolute z-10 w-[400px] mt-1 bg-white border border-slate-200 rounded-lg shadow-xl max-h-64 overflow-y-auto">
                            {customers.map((c) => (
                              <button
                                key={c.id}
                                className="w-full text-left px-4 py-2 hover:bg-slate-50 border-b border-slate-100 last:border-0 flex items-center justify-between"
                                onClick={() => selectCustomer(row.id, c)}
                              >
                                <div>
                                  <div className="font-medium text-slate-900">
                                    {c.fullName}
                                  </div>
                                  <div className="text-xs text-slate-500">
                                    {c.customerCode} · {c.mobile}
                                  </div>
                                </div>
                                <div
                                  className={`text-sm font-medium ${c.currentBalance > 0 ? "text-rose-600" : c.currentBalance < 0 ? "text-emerald-600" : "text-slate-500"}`}
                                >
                                  {c.currentBalance > 0
                                    ? formatINR(c.currentBalance)
                                    : c.currentBalance < 0
                                      ? formatINR(Math.abs(c.currentBalance)) +
                                        " (Adv)"
                                      : "₹0"}
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {row.customerId ? (
                      <div
                        className={`font-medium ${row.currentBalance > 0 ? "text-rose-600" : row.currentBalance < 0 ? "text-emerald-600" : "text-slate-500"}`}
                      >
                        {row.currentBalance > 0
                          ? formatINR(row.currentBalance)
                          : row.currentBalance < 0
                            ? formatINR(Math.abs(row.currentBalance)) + " (Adv)"
                            : "₹0"}
                      </div>
                    ) : (
                      <span className="text-slate-300">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      disabled={!row.customerId}
                      className="w-full h-9 px-2 rounded-md border border-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none text-sm disabled:bg-slate-50 disabled:text-slate-400"
                      value={row.entryType}
                      onChange={(e) =>
                        handleUpdateRow(row.id, "entryType", e.target.value)
                      }
                    >
                      <option value="PAYMENT">Payment</option>
                      <option value="MANUAL_DEBIT">Debit</option>
                      <option value="MANUAL_CREDIT">Credit</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      placeholder="0"
                      disabled={!row.customerId}
                      className="w-full h-9 px-3 rounded-md border border-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none text-sm disabled:bg-slate-50 disabled:text-slate-400 font-medium text-slate-900"
                      value={row.amount}
                      onChange={(e) =>
                        handleUpdateRow(row.id, "amount", e.target.value)
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          if (index === rows.length - 1 && row.amount) {
                            handleAddRow();
                          }
                        }
                      }}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <select
                      disabled={!row.customerId || row.entryType !== "PAYMENT"}
                      className="w-full h-9 px-2 rounded-md border border-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none text-sm disabled:bg-slate-50 disabled:text-slate-400 opacity-disabled"
                      value={row.paymentMode}
                      onChange={(e) =>
                        handleUpdateRow(row.id, "paymentMode", e.target.value)
                      }
                    >
                      <option value="CASH">CASH</option>
                      <option value="UPI">UPI</option>
                      <option value="CARD">CARD</option>
                      <option value="BANK_TRANSFER">BANK TRF</option>
                      <option value="CHEQUE">CHEQUE</option>
                      <option value="OTHER">OTHER</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="text"
                      placeholder="Ref / Notes"
                      disabled={!row.customerId}
                      className="w-full h-9 px-3 rounded-md border border-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none text-sm disabled:bg-slate-50 disabled:text-slate-400"
                      value={row.referenceNumber}
                      onChange={(e) =>
                        handleUpdateRow(
                          row.id,
                          "referenceNumber",
                          e.target.value,
                        )
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          if (index === rows.length - 1) {
                            handleAddRow();
                          }
                        }
                      }}
                    />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => handleRemoveRow(row.id)}
                      className="text-slate-400 hover:text-rose-500 transition-colors p-2"
                      title="Remove Row"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="p-3 border-t border-slate-200 bg-slate-50">
            <button
              onClick={handleAddRow}
              className="flex items-center gap-2 text-sm font-medium text-indigo-600 hover:text-indigo-800 transition-colors px-3 py-1.5 rounded-md hover:bg-indigo-100/50"
            >
              <Plus className="w-4 h-4" /> Add Row
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg text-sm font-medium flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={() => setError("")}
            className="text-rose-500 hover:text-rose-700"
          >
            ×
          </button>
        </div>
      )}

      <div className="fixed bottom-0 left-0 right-0 lg:left-64 bg-white border-t border-slate-200 p-4 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] z-40">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex gap-6 items-center">
            <div>
              <div className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-1">
                Valid Rows
              </div>
              <div className="text-xl font-bold text-slate-900">
                {validRows.length}
              </div>
            </div>
            <div className="w-px h-8 bg-slate-200"></div>
            <div>
              <div className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-1">
                {summaryLabel}
              </div>
              <div className="text-xl font-bold text-emerald-600">
                {formatINR(totalAmount)}
              </div>
            </div>
          </div>
          <button
            onClick={validateAndPreview}
            disabled={validRows.length === 0}
            className="w-full sm:w-auto px-8 py-2.5 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            Preview & Save <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {isPreviewMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h2 className="text-lg font-bold text-slate-900">
                Preview Batch Entry
              </h2>
              <button
                onClick={() => setIsPreviewMode(false)}
                disabled={isSubmitting}
                className="text-slate-400 hover:text-slate-600"
              >
                ×
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1">
              <div className="grid grid-cols-4 gap-4 mb-6 bg-slate-50 p-4 rounded-lg border border-slate-100">
                <div>
                  <div className="text-xs text-slate-500 mb-1">Entry Date</div>
                  <div className="font-semibold text-slate-900">
                    {new Date(entryDate).toLocaleDateString("en-IN")}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 mb-1">
                    Total Customers
                  </div>
                  <div className="font-semibold text-slate-900">
                    {validRows.length}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 mb-1">
                    Total Amount
                  </div>
                  <div className="font-semibold text-emerald-600">
                    {formatINR(totalAmount)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 mb-1">Notes</div>
                  <div
                    className="font-semibold text-slate-900 truncate"
                    title={batchNotes}
                  >
                    {batchNotes || "-"}
                  </div>
                </div>
              </div>

              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-2 font-medium text-slate-500">
                        Customer
                      </th>
                      <th className="px-4 py-2 font-medium text-slate-500 text-right">
                        Balance Before
                      </th>
                      <th className="px-4 py-2 font-medium text-slate-500 text-right">
                        Type
                      </th>
                      <th className="px-4 py-2 font-medium text-slate-500 text-right">
                        Amount
                      </th>
                      <th className="px-4 py-2 font-medium text-slate-500 text-right">
                        Balance After
                      </th>
                      <th className="px-4 py-2 font-medium text-slate-500">
                        Mode
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {validRows.map((row) => {
                      const amountNum = parseRupees(row.amount);
                      const currentBalNum = parseRupees(row.currentBalance);
                      let balanceAfter = currentBalNum;
                      if (row.entryType === "MANUAL_DEBIT") {
                        balanceAfter += amountNum;
                      } else {
                        balanceAfter -= amountNum;
                      }

                      return (
                        <tr key={row.id}>
                          <td className="px-4 py-2">
                            <div className="font-medium text-slate-900">
                              {row.customerName}
                            </div>
                            <div className="text-xs text-slate-500">
                              {row.customerCode}
                            </div>
                          </td>
                          <td className="px-4 py-2 text-right">
                            <span
                              className={
                                row.currentBalance > 0
                                  ? "text-rose-600"
                                  : row.currentBalance < 0
                                    ? "text-emerald-600"
                                    : ""
                              }
                            >
                              {row.currentBalance > 0
                                ? formatINR(row.currentBalance)
                                : row.currentBalance < 0
                                  ? formatINR(Math.abs(row.currentBalance)) +
                                    " (Adv)"
                                  : "₹0"}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-right">
                            <span
                              className={
                                row.entryType === "MANUAL_DEBIT"
                                  ? "font-medium text-rose-600"
                                  : "font-medium text-emerald-600"
                              }
                            >
                              {row.entryType === "PAYMENT"
                                ? "Payment"
                                : row.entryType === "MANUAL_DEBIT"
                                  ? "Debit"
                                  : "Credit"}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-right font-medium text-slate-700">
                            {formatINR(amountNum)}
                          </td>
                          <td className="px-4 py-2 text-right">
                            <span
                              className={
                                balanceAfter > 0
                                  ? "text-rose-600 font-medium"
                                  : balanceAfter < 0
                                    ? "text-emerald-600 font-medium"
                                    : "text-slate-500"
                              }
                            >
                              {balanceAfter > 0
                                ? formatINR(balanceAfter)
                                : balanceAfter < 0
                                  ? formatINR(Math.abs(balanceAfter)) + " (Adv)"
                                  : "₹0 (Cleared)"}
                            </span>
                          </td>
                          <td className="px-4 py-2">
                            {row.entryType === "PAYMENT" ? (
                              <span className="inline-block px-2 py-1 bg-slate-100 text-slate-700 text-xs font-medium rounded">
                                {row.paymentMode}
                              </span>
                            ) : (
                              <span className="text-slate-400">-</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-3">
              <button
                onClick={() => setIsPreviewMode(false)}
                disabled={isSubmitting}
                className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-200/50 rounded-lg transition-colors disabled:opacity-50"
              >
                Back to Edit
              </button>
              <button
                onClick={handleConfirm}
                disabled={isSubmitting}
                className="px-6 py-2 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Saving...
                  </>
                ) : (
                  "Confirm & Post Batch"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
