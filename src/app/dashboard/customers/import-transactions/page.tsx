"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  Upload,
  AlertTriangle,
} from "lucide-react";
import { normalizeTallyName } from "@/lib/tally-xml-parser";

type Step = "upload" | "parse" | "match" | "preview" | "importing" | "done";

interface PreviewSummary {
  totalVouchers: number;
  sales: number;
  receipts: number;
  debitNotes: number;
  creditNotes: number;
  matchedCustomers: Array<{
    customerId: string;
    customerName: string;
    customerCode: string;
    vouchers: number;
  }>;
  unmatchedCustomerNames: string[];
  duplicateVouchers: Array<{
    customerName: string;
    voucherNumber?: string;
    voucherDate: string;
  }>;
  customerClosings: Array<{
    customerId: string;
    customerName: string;
    openingBalance: number;
    totalDebit: number;
    totalCredit: number;
    expectedClosing: number;
  }>;
  invalidCount: number;
  duplicateCount: number;
  sampleVouchers: Array<{
    customerName: string;
    voucherDate: string;
    voucherType: string;
    voucherNumber?: string;
    debit: number;
    credit: number;
  }>;
}

export default function TransactionImportPage() {
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewSummary | null>(null);
  const [result, setResult] = useState<{
    imported: number;
    duplicates: number;
    skipped: number;
    errors: number;
    importBatchId?: string;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (!file) return;
    setError("");
    setLoading(true);
    setStep("parse");
    setFileName(file.name);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/tally/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to parse Tally file");
      setPreview(data as PreviewSummary);
      setStep("preview");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to parse Tally file",
      );
      setStep("upload");
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    if (!preview) return;
    setLoading(true);
    setStep("importing");
    try {
      const res = await fetch("/api/tally/import?execute=true", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vouchers: preview.sampleVouchers,
          sourceFileName: fileName,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      setResult(data);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
      setStep("preview");
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadReport = () => {
    if (!preview) return;
    const rows = [
      [
        "Customer",
        "Opening Balance",
        "Total Debit",
        "Total Credit",
        "Expected Closing",
      ],
      ...preview.customerClosings.map((row) => [
        row.customerName,
        row.openingBalance.toFixed(2),
        row.totalDebit.toFixed(2),
        row.totalCredit.toFixed(2),
        row.expectedClosing.toFixed(2),
      ]),
    ];
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tally-reconciliation.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const steps = useMemo(
    () => [
      { id: "upload", label: "1. Upload" },
      { id: "parse", label: "2. Parse" },
      { id: "match", label: "3. Match" },
      { id: "preview", label: "4. Preview" },
      { id: "importing", label: "5. Import" },
      { id: "done", label: "6. Done" },
    ],
    [],
  );

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Tally Transaction Import
          </h1>
          <p className="text-sm text-slate-500">
            Upload Tally XML or CSV and import transaction history into customer
            ledgers
          </p>
        </div>
        <Link
          href="/dashboard/customers"
          className="text-sm text-blue-600 hover:underline"
        >
          ← Back to Customers
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {steps.map((stepItem, index) => (
          <div key={stepItem.id} className="flex items-center">
            <div
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${step === stepItem.id ? "bg-blue-600 text-white" : ["parse", "match", "preview", "importing", "done"].includes(stepItem.id) && ["parse", "match", "preview", "importing", "done"].includes(step) ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-400"}`}
            >
              {stepItem.label}
            </div>
            {index < steps.length - 1 && (
              <ArrowRight className="h-3 w-3 text-slate-300 mx-1" />
            )}
          </div>
        ))}
      </div>

      {step === "upload" && (
        <div className="space-y-4">
          <div
            onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed border-slate-200 rounded-2xl p-16 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition-colors"
          >
            <FileText className="h-14 w-14 text-slate-300 mx-auto mb-4" />
            <p className="text-lg font-semibold text-slate-700">
              Upload Tally XML or CSV
            </p>
            <p className="text-sm text-slate-400 mt-1">
              Supports XML exports and CSV with customer, voucher date, type,
              amount columns
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".xml,.csv,text/xml,text/csv"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.[0]) handleFile(e.target.files[0]);
              }}
            />
          </div>
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
              {error}
            </div>
          )}
        </div>
      )}

      {(step === "parse" || loading) && (
        <div className="flex flex-col items-center justify-center py-24 bg-white rounded-2xl border border-slate-200">
          <Loader2 className="h-12 w-12 text-blue-500 animate-spin mb-4" />
          <h2 className="text-xl font-bold text-slate-900">
            Parsing Tally file...
          </h2>
          <p className="text-slate-500 mt-2 text-sm">
            Reading vouchers and matching customer ledger entries
          </p>
        </div>
      )}

      {step === "preview" && preview && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 bg-green-50 border border-green-200 px-3 py-1.5 rounded-lg">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span className="text-sm font-medium text-green-700">
                  {preview.totalVouchers} vouchers
                </span>
              </div>
              <div className="text-sm text-slate-500">
                {preview.sales} sales • {preview.receipts} receipts •{" "}
                {preview.debitNotes} debit notes • {preview.creditNotes} credit
                notes
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleDownloadReport}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg text-sm font-medium transition-colors"
              >
                <Download className="h-4 w-4" /> Report
              </button>
              <button
                onClick={handleImport}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition-colors"
              >
                <Upload className="h-4 w-4" /> Import Transactions
              </button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-sm text-slate-500">Matched Customers</p>
              <p className="mt-2 text-2xl font-bold text-slate-900">
                {preview.matchedCustomers.length}
              </p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-sm text-slate-500">Unmatched Customers</p>
              <p className="mt-2 text-2xl font-bold text-slate-900">
                {preview.unmatchedCustomerNames.length}
              </p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-sm text-slate-500">Duplicate Vouchers</p>
              <p className="mt-2 text-2xl font-bold text-slate-900">
                {preview.duplicateCount}
              </p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-sm text-slate-500">Invalid Vouchers</p>
              <p className="mt-2 text-2xl font-bold text-slate-900">
                {preview.invalidCount}
              </p>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-800">
                Expected closing balances
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase">
                      Customer
                    </th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-500 uppercase">
                      Opening
                    </th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-500 uppercase">
                      Debit
                    </th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-500 uppercase">
                      Credit
                    </th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-500 uppercase">
                      Closing
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {preview.customerClosings.map((row) => (
                    <tr key={row.customerId}>
                      <td className="px-4 py-2.5 font-medium text-slate-900">
                        {row.customerName}
                      </td>
                      <td className="px-4 py-2.5 text-right text-slate-600">
                        ₹{row.openingBalance.toFixed(2)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-rose-700">
                        ₹{row.totalDebit.toFixed(2)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-emerald-700">
                        ₹{row.totalCredit.toFixed(2)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold text-slate-900">
                        ₹{row.expectedClosing.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {preview.unmatchedCustomerNames.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
              <p className="font-semibold">Unmatched customers</p>
              <p>{preview.unmatchedCustomerNames.join(", ")}</p>
            </div>
          )}
        </div>
      )}

      {step === "done" && result && (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-6">
          <div className="h-16 w-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 className="h-8 w-8 text-green-600" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-900">
              Import Completed
            </h2>
            <p className="text-slate-500 mt-1">
              Imported {result.imported} ledger transactions to customer history
            </p>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-green-50 border border-green-100 rounded-xl p-4">
              <p className="text-3xl font-black text-green-600">
                {result.imported}
              </p>
              <p className="text-sm text-green-700 mt-1">Imported</p>
            </div>
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
              <p className="text-3xl font-black text-amber-600">
                {result.duplicates}
              </p>
              <p className="text-sm text-amber-700 mt-1">Duplicates</p>
            </div>
            <div className="bg-red-50 border border-red-100 rounded-xl p-4">
              <p className="text-3xl font-black text-red-600">
                {result.skipped}
              </p>
              <p className="text-sm text-red-700 mt-1">Skipped</p>
            </div>
          </div>
          <div className="flex justify-center gap-4">
            <button
              onClick={() => {
                setStep("upload");
                setPreview(null);
                setResult(null);
                setError("");
                setFileName("");
              }}
              className="px-4 py-2 text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl"
            >
              Import More
            </button>
            <Link
              href="/dashboard/customers"
              className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl"
            >
              View Customers
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
