"use client";

import { useState, useEffect } from "react";
import {
  Loader2,
  Save,
  CheckCircle2,
  Download,
  UserCheck,
  UserX,
  Trash2,
  ShieldAlert,
  AlertTriangle,
  AlertOctagon,
} from "lucide-react";

interface Settings {
  businessName: string;
  tagline: string;
  ownerName: string;
  supportPhone: string;
  whatsappNumber: string;
  supportEmail: string;
  primaryAddress: string;
  city: string;
  state: string;
  pinCode: string;
  gstNumber: string;
  invoicePrefix: string;
  defaultCreditDays: number;
  termsAndConditions: string;
  currency: string;
}

type InputFieldProps = {
  label: string;
  value: string;
  onChange: (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => void;
  type?: string;
  placeholder?: string;
};

function InputField({
  label,
  value,
  onChange,
  type = "text",
  placeholder = "",
}: InputFieldProps) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
      />
    </div>
  );
}

const defaultSettings: Settings = {
  businessName: "",
  tagline: "",
  ownerName: "",
  supportPhone: "",
  whatsappNumber: "",
  supportEmail: "",
  primaryAddress: "",
  city: "",
  state: "",
  pinCode: "",
  gstNumber: "",
  invoicePrefix: "",
  defaultCreditDays: 15,
  termsAndConditions: "",
  currency: "INR",
};

export default function SettingsPage() {
  const [form, setForm] = useState<Settings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [userRole, setUserRole] = useState<string | null>(null);
  const [bulkLoading, setBulkLoading] = useState<string | null>(null);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewSummary, setPreviewSummary] = useState<string | null>(null);
  const [showBulkDialog, setShowBulkDialog] = useState<
    "deactivate" | "restore" | "delete" | null
  >(null);
  const [confirmationText, setConfirmationText] = useState("");
  const [reason, setReason] = useState("");
  const [understood, setUnderstood] = useState(false);

  // ─── Delete All Business Data states ──────────────────────────────────────
  const [showDataResetDialog, setShowDataResetDialog] = useState(false);
  const [dataResetPreview, setDataResetPreview] = useState<Record<string, number> | null>(null);
  const [dataResetPreviewLoading, setDataResetPreviewLoading] = useState(false);
  const [dataResetConfirmation, setDataResetConfirmation] = useState("");
  const [dataResetReason, setDataResetReason] = useState("");
  const [dataResetAcknowledged, setDataResetAcknowledged] = useState(false);
  const [dataResetExecuting, setDataResetExecuting] = useState(false);
  const [dataResetMessage, setDataResetMessage] = useState<string | null>(null);
  const [dataResetError, setDataResetError] = useState<string | null>(null);
  const [dataResetDownloadBackup, setDataResetDownloadBackup] = useState(false);
  const [dataResetComplete, setDataResetComplete] = useState(false);
  const [dataResetResult, setDataResetResult] = useState<Record<string, unknown> | null>(null);
  const [dataResetPreviewCounts, setDataResetPreviewCounts] = useState<Record<string, number> | null>(null);
  const [dataResetShowPreview, setDataResetShowPreview] = useState(true);
  const [dataResetExecuted, setDataResetExecuted] = useState(false);
  const [dataResetVerification, setDataResetVerification] = useState<Record<string, unknown> | null>(null);
  const [dataResetDeletedCounts, setDataResetDeletedCounts] = useState<Record<string, number> | null>(null);
  const [dataResetStep, setDataResetStep] = useState<"idle" | "preview" | "confirm" | "done">("idle");
  const [dataResetDeletionDone, setDataResetDeletionDone] = useState(false);
  const [dataResetBackupDownloaded, setDataResetBackupDownloaded] = useState(false);
  const [dataResetBackupLoading, setDataResetBackupLoading] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        if (d.settings) {
          const s = d.settings;
          setForm({
            businessName: s.businessName ?? "",
            tagline: s.tagline ?? "",
            ownerName: s.ownerName ?? "",
            supportPhone: s.supportPhone ?? "",
            whatsappNumber: s.whatsappNumber ?? "",
            supportEmail: s.supportEmail ?? "",
            primaryAddress: s.primaryAddress ?? "",
            city: s.city ?? "",
            state: s.state ?? "",
            pinCode: s.pinCode ?? "",
            gstNumber: s.gstNumber ?? "",
            invoicePrefix: s.invoicePrefix ?? "",
            defaultCreditDays: s.defaultCreditDays ?? 15,
            termsAndConditions: s.termsAndConditions ?? "",
            currency: s.currency ?? "INR",
          });
        }
      })
      .finally(() => setLoading(false));

    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        if (d.user?.role) {
          setUserRole(d.user.role);
        }
      })
      .catch(() => setUserRole(null));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to save");
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  };

  const handleFieldChange =
    <K extends keyof Settings>(key: K) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setForm((prev) => ({ ...prev, [key]: e.target.value }));
    };

  const getFieldValue = <K extends keyof Settings>(key: K) =>
    (form[key] ?? "") as string;

  const isAdmin = userRole === "OWNER" || userRole === "MANAGER";

  const loadPreviewForAction = async (
    action: "deactivate" | "restore" | "delete",
  ) => {
    setBulkError(null);
    setPreviewSummary(null);
    setPreviewLoading(true);

    try {
      let endpoint = "";
      const body: Record<string, unknown> = { mode: "preview" };
      if (action === "deactivate") {
        endpoint = "/api/admin/customers/deactivate-all";
      } else if (action === "restore") {
        endpoint = "/api/admin/customers/restore-all";
      } else if (action === "delete") {
        endpoint = "/api/admin/customers/permanent-delete-empty";
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Preview failed");
      }

      if (action === "deactivate") {
        const count = data.summary?.totalActiveCustomers ?? 0;
        setPreviewSummary(
          `Preview: ${count} active customers will be deactivated.`,
        );
      } else if (action === "restore") {
        const count = data.inactiveCustomerCount ?? 0;
        setPreviewSummary(
          `Preview: ${count} inactive customers will be restored.`,
        );
      } else if (action === "delete") {
        const summary = data.summary ?? {};
        const eligible = summary.eligibleForDeletion ?? 0;
        const blocked = summary.totalCustomersChecked - eligible;
        const parts = [
          `Preview: ${eligible} empty customers are eligible for permanent deletion.`,
        ];
        if (blocked > 0) {
          parts.push(
            `Blocked: ${blocked} customers have financial or import references (${summary.blockedBecauseOfInvoices ?? 0} invoices, ${summary.blockedBecauseOfPayments ?? 0} payments, ${summary.blockedBecauseOfLedgerEntries ?? 0} ledger entries, ${summary.blockedBecauseOfLedgerTransactions ?? 0} ledger transactions, ${summary.blockedBecauseOfNonZeroBalance ?? 0} balances, ${summary.blockedBecauseOfOtherReferences ?? 0} other references).`,
          );
        }
        setPreviewSummary(parts.join(" "));
      }
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setPreviewLoading(false);
    }
  };

  const openBulkDialog = async (
    action: "deactivate" | "restore" | "delete",
  ) => {
    setShowBulkDialog(action);
    setConfirmationText("");
    setReason("");
    setUnderstood(false);
    setPreviewSummary(null);
    setBulkError(null);
    setBulkMessage(null);
    await loadPreviewForAction(action);
  };

  const runBulkAction = async (action: "deactivate" | "restore" | "delete") => {
    if (!isAdmin) {
      setBulkError("Only admins can use customer data management actions.");
      return;
    }

    setBulkError(null);
    setBulkMessage(null);
    setBulkLoading(action);

    try {
      let endpoint = "";
      let body: Record<string, unknown> = {
        mode: "preview",
        confirmation: "",
        reason,
      };
      if (action === "deactivate") {
        endpoint = "/api/admin/customers/deactivate-all";
        body = {
          mode: "execute",
          confirmation: confirmationText,
          reason,
          understood,
        };
      } else if (action === "restore") {
        endpoint = "/api/admin/customers/restore-all";
        body = { mode: "execute", confirmation: confirmationText };
      } else if (action === "delete") {
        endpoint = "/api/admin/customers/permanent-delete-empty";
        body = { mode: "execute", confirmation: confirmationText, reason };
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Action failed");
      }
      setBulkMessage(data.message || "Action completed.");
      setConfirmationText("");
      setReason("");
      setUnderstood(false);
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBulkLoading(null);
    }
  };

  const handleBackupDownload = async () => {
    setBulkError(null);
    setBulkMessage(null);
    setBulkLoading("backup");
    try {
      const res = await fetch("/api/admin/customers/export-backup");
      if (!res.ok) throw new Error("Backup download failed");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `customer-backup-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
      setBulkMessage("Customer backup downloaded.");
    } catch (err) {
      setBulkError(
        err instanceof Error ? err.message : "Backup download failed",
      );
    } finally {
      setBulkLoading(null);
    }
  };

  if (loading)
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );

  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Settings</h1>

      {bulkMessage && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {bulkMessage}
        </div>
      )}
      {bulkError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {bulkError}
        </div>
      )}

      {isAdmin && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-amber-100 p-2 text-amber-700">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Customer Data Management
              </h2>
              <p className="text-sm text-slate-500">
                Safe admin-only tools for bulk customer lifecycle actions. These
                operations preserve financial history unless a permanent-delete
                action is explicitly confirmed.
              </p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <button
              type="button"
              onClick={handleBackupDownload}
              disabled={bulkLoading === "backup"}
              className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-left transition hover:border-blue-300 hover:bg-blue-50"
            >
              <Download className="mt-0.5 h-5 w-5 text-blue-600" />
              <span>
                <span className="block font-semibold text-slate-900">
                  Export Customer Backup
                </span>
                <span className="text-sm text-slate-500">
                  Download a CSV of customer identifiers and balances without
                  secrets.
                </span>
              </span>
            </button>

            <button
              type="button"
              onClick={() => void openBulkDialog("deactivate")}
              className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-left transition hover:border-amber-300 hover:bg-amber-50"
            >
              <UserX className="mt-0.5 h-5 w-5 text-amber-600" />
              <span>
                <span className="block font-semibold text-slate-900">
                  Deactivate All Customers
                </span>
                <span className="text-sm text-slate-500">
                  Soft-deactivate all active customers and preserve their
                  ledgers and invoices.
                </span>
              </span>
            </button>

            <button
              type="button"
              onClick={() => void openBulkDialog("restore")}
              className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-left transition hover:border-emerald-300 hover:bg-emerald-50"
            >
              <UserCheck className="mt-0.5 h-5 w-5 text-emerald-600" />
              <span>
                <span className="block font-semibold text-slate-900">
                  Restore Inactive Customers
                </span>
                <span className="text-sm text-slate-500">
                  Re-activate inactive customers without touching financial
                  history.
                </span>
              </span>
            </button>

            <button
              type="button"
              onClick={() => void openBulkDialog("delete")}
              className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-left transition hover:border-rose-400"
            >
              <Trash2 className="mt-0.5 h-5 w-5 text-rose-600" />
              <span>
                <span className="block font-semibold text-slate-900">
                  Permanently Delete Empty Customers
                </span>
                <span className="text-sm text-slate-500">
                  Delete only customers with no invoices, payments, ledger
                  history, or balances.
                </span>
              </span>
            </button>
          </div>

          {/* ─── Delete All Business Data ─────────────────────────────────── */}
          <div className="border-t border-red-200 pt-4 mt-2">
            <div className="flex items-start gap-3 mb-3">
              <div className="rounded-xl bg-red-100 p-2 text-red-700">
                <AlertOctagon className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Dangerous Zone — Delete All Business Data
                </h3>
                <p className="text-sm text-slate-500">
                  Permanently delete ALL customers, invoices, payments, ledger
                  records, balances, and import data. This action cannot be
                  undone. Admin users and settings are preserved.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowDataResetDialog(true);
                setDataResetStep("idle");
                setDataResetPreview(null);
                setDataResetConfirmation("");
                setDataResetReason("");
                setDataResetAcknowledged(false);
                setDataResetMessage(null);
                setDataResetError(null);
                setDataResetDeletionDone(false);
                setDataResetBackupDownloaded(false);
                setDataResetPreviewCounts(null);
                setDataResetDeletedCounts(null);
                setDataResetVerification(null);
                setDataResetExecuted(false);
                setDataResetComplete(false);
                setDataResetResult(null);
                setDataResetShowPreview(true);
                setDataResetExecuting(false);
                setDataResetBackupLoading(false);
                // Load preview immediately
                setDataResetPreviewLoading(true);
                fetch("/api/admin/data-reset", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    action: "DELETE_ALL_BUSINESS_DATA",
                    mode: "preview",
                    confirmation: "",
                    reason: "preview",
                    acknowledged: false,
                  }),
                })
                  .then((r) => r.json())
                  .then((d) => {
                    if (d.success && d.data) {
                      setDataResetPreview(d.data);
                      setDataResetPreviewCounts({
                        customers: d.data.customers ?? 0,
                        invoices: d.data.invoices ?? 0,
                        payments: d.data.payments ?? 0,
                        ledgerEntries: d.data.ledgerEntries ?? 0,
                        ledgerTransactions: d.data.ledgerTransactions ?? 0,
                        balances: d.data.balances ?? 0,
                        importBatches: d.data.importBatches ?? 0,
                        stagingRows: d.data.stagingRows ?? 0,
                      });
                      setDataResetStep("preview");
                    } else {
                      setDataResetError(d.error || "Preview failed");
                    }
                  })
                  .catch((err) => {
                    setDataResetError(err.message || "Preview failed");
                  })
                  .finally(() => setDataResetPreviewLoading(false));
              }}
              className="flex items-center gap-2 rounded-xl border-2 border-red-300 bg-red-50 px-5 py-3 text-left font-semibold text-red-700 transition hover:border-red-500 hover:bg-red-100"
            >
              <AlertOctagon className="h-5 w-5" />
              <span>Delete All Business Data</span>
            </button>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Business Info */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-4">
          <h2 className="text-base font-semibold text-slate-900 pb-2 border-b border-slate-100">
            Business Information
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <InputField
                label="Business Name"
                value={getFieldValue("businessName")}
                onChange={handleFieldChange("businessName")}
                placeholder="MD Javed Enterprises"
              />
            </div>
            <div className="sm:col-span-2">
              <InputField
                label="Tagline"
                value={getFieldValue("tagline")}
                onChange={handleFieldChange("tagline")}
                placeholder="Mobiles • Electronics • Appliances"
              />
            </div>
            <InputField
              label="Owner Name"
              value={getFieldValue("ownerName")}
              onChange={handleFieldChange("ownerName")}
              placeholder="Md Javed"
            />
            <InputField
              label="GST Number"
              value={getFieldValue("gstNumber")}
              onChange={handleFieldChange("gstNumber")}
              placeholder="27ABCDE1234F1Z5"
            />
          </div>
        </div>

        {/* Contact */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-4">
          <h2 className="text-base font-semibold text-slate-900 pb-2 border-b border-slate-100">
            Contact Information
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <InputField
              label="Support Phone"
              value={getFieldValue("supportPhone")}
              onChange={handleFieldChange("supportPhone")}
              type="tel"
              placeholder="7020231921"
            />
            <InputField
              label="WhatsApp Number"
              value={getFieldValue("whatsappNumber")}
              onChange={handleFieldChange("whatsappNumber")}
              type="tel"
              placeholder="7020231921"
            />
            <div className="sm:col-span-2">
              <InputField
                label="Support Email"
                value={getFieldValue("supportEmail")}
                onChange={handleFieldChange("supportEmail")}
                type="email"
                placeholder="support@example.com"
              />
            </div>
          </div>
        </div>

        {/* Address */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-4">
          <h2 className="text-base font-semibold text-slate-900 pb-2 border-b border-slate-100">
            Address
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <InputField
                label="Street Address"
                value={getFieldValue("primaryAddress")}
                onChange={handleFieldChange("primaryAddress")}
                placeholder="Shop No. 5, Main Road"
              />
            </div>
            <InputField
              label="City"
              value={getFieldValue("city")}
              onChange={handleFieldChange("city")}
              placeholder="Nagpur"
            />
            <InputField
              label="State"
              value={getFieldValue("state")}
              onChange={handleFieldChange("state")}
              placeholder="Maharashtra"
            />
            <InputField
              label="PIN Code"
              value={getFieldValue("pinCode")}
              onChange={handleFieldChange("pinCode")}
              placeholder="440001"
            />
          </div>
        </div>

        {/* Invoice Settings */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-4">
          <h2 className="text-base font-semibold text-slate-900 pb-2 border-b border-slate-100">
            Invoice Settings
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <InputField
              label="Invoice Prefix"
              value={getFieldValue("invoicePrefix")}
              onChange={handleFieldChange("invoicePrefix")}
              placeholder="INV"
            />
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Default Credit Days
              </label>
              <input
                type="number"
                min="1"
                max="365"
                value={form.defaultCreditDays}
                onChange={(e) =>
                  setForm({
                    ...form,
                    defaultCreditDays: Number(e.target.value),
                  })
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Terms & Conditions
              </label>
              <textarea
                value={form.termsAndConditions}
                onChange={(e) =>
                  setForm({ ...form, termsAndConditions: e.target.value })
                }
                rows={3}
                placeholder="All goods once sold will not be taken back..."
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none"
              />
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
            {error}
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors disabled:opacity-60"
          >
            {saved ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-green-300" /> Saved!
              </>
            ) : saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4" /> Save Settings
              </>
            )}
          </button>
        </div>
      </form>

      {showBulkDialog && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-amber-100 p-2 text-amber-700">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900">
                    {showBulkDialog === "deactivate" &&
                      "Deactivate All Customers"}
                    {showBulkDialog === "restore" &&
                      "Restore All Inactive Customers"}
                    {showBulkDialog === "delete" &&
                      "Permanently Delete Empty Customers"}
                  </h3>
                  <p className="text-sm text-slate-500">
                    This action requires an explicit confirmation.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowBulkDialog(null);
                  setConfirmationText("");
                  setReason("");
                  setUnderstood(false);
                }}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                ✕
              </button>
            </div>
            <div className="space-y-4 p-5">
              {previewLoading && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">
                  Loading preview…
                </div>
              )}
              {previewSummary && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-3 text-sm text-blue-700">
                  {previewSummary}
                </div>
              )}
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Reason
                </label>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="Enter a reason for this admin action"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Confirmation text
                </label>
                <input
                  value={confirmationText}
                  onChange={(e) => setConfirmationText(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder={
                    showBulkDialog === "deactivate"
                      ? "DEACTIVATE ALL CUSTOMERS"
                      : showBulkDialog === "restore"
                        ? "RESTORE ALL CUSTOMERS"
                        : showBulkDialog === "delete"
                          ? "DELETE EMPTY CUSTOMERS"
                          : "REMOVE FROM IMPORT BATCH"
                  }
                />
              </div>
              {showBulkDialog === "deactivate" && (
                <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={understood}
                    onChange={(e) => setUnderstood(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    I understand that all active customers will be hidden from
                    normal customer lists.
                  </span>
                </label>
              )}
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                <p className="font-semibold text-slate-700">Safety note</p>
                <p>
                  These actions are server-authorized and run only after
                  confirmation. They will not delete invoices, payments, ledger
                  history, or audit records unless the permanent-delete flow is
                  explicitly executed.
                </p>
              </div>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowBulkDialog(null);
                    setConfirmationText("");
                    setReason("");
                    setUnderstood(false);
                  }}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void runBulkAction(showBulkDialog)}
                  disabled={
                    bulkLoading !== null ||
                    confirmationText.trim().length === 0 ||
                    (showBulkDialog === "deactivate" && !understood)
                  }
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {bulkLoading ? (
                    <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                  ) : null}
                  {showBulkDialog === "deactivate"
                    ? "Confirm Deactivate"
                    : showBulkDialog === "restore"
                      ? "Confirm Restore"
                      : "Confirm Delete"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Delete All Business Data Dialog ──────────────────────────────── */}
      {showDataResetDialog && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-red-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-red-200 bg-red-50 px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-red-100 p-2 text-red-700">
                  <AlertOctagon className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900">
                    Delete All Business Data
                  </h3>
                  <p className="text-sm text-red-600">
                    This action is irreversible. All business records will be
                    permanently deleted.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowDataResetDialog(false);
                  setDataResetConfirmation("");
                  setDataResetReason("");
                  setDataResetAcknowledged(false);
                  setDataResetMessage(null);
                  setDataResetError(null);
                }}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 p-5 max-h-[70vh] overflow-y-auto">
              {/* Error */}
              {dataResetError && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {dataResetError}
                </div>
              )}

              {/* Success message */}
              {dataResetMessage && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  {dataResetMessage}
                </div>
              )}

              {/* Preview Loading */}
              {dataResetPreviewLoading && (
                <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading preview…
                </div>
              )}

              {/* Preview Counts */}
              {dataResetPreviewCounts && !dataResetDeletionDone && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
                  <p className="mb-2 text-sm font-semibold text-red-800">
                    ⚠️ This action will permanently delete all customers,
                    invoices, payments, ledger records, balances and import
                    data. This cannot be undone.
                  </p>
                  <div className="grid grid-cols-2 gap-2 text-sm text-red-700">
                    <span>Customers: {dataResetPreviewCounts.customers}</span>
                    <span>Invoices: {dataResetPreviewCounts.invoices}</span>
                    <span>Payments: {dataResetPreviewCounts.payments}</span>
                    <span>Ledger Entries: {dataResetPreviewCounts.ledgerEntries}</span>
                    <span>Ledger Transactions: {dataResetPreviewCounts.ledgerTransactions}</span>
                    <span>Balances: {dataResetPreviewCounts.balances}</span>
                    <span>Import Batches: {dataResetPreviewCounts.importBatches}</span>
                    <span>Staging Rows: {dataResetPreviewCounts.stagingRows}</span>
                  </div>
                  <p className="mt-2 text-xs text-red-600">
                    Blocked: 0 — All financial references will be deleted as
                    part of this action.
                  </p>
                </div>
              )}

              {/* Deletion Result */}
              {dataResetDeletionDone && dataResetDeletedCounts && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
                  <p className="mb-2 text-sm font-semibold text-emerald-800">
                    ✅ All business data has been permanently deleted.
                  </p>
                  <div className="grid grid-cols-2 gap-2 text-sm text-emerald-700">
                    <span>Customers deleted: {dataResetDeletedCounts.customers}</span>
                    <span>Invoices deleted: {dataResetDeletedCounts.invoices}</span>
                    <span>Payments deleted: {dataResetDeletedCounts.payments}</span>
                    <span>Ledger entries deleted: {dataResetDeletedCounts.ledgerEntries}</span>
                    <span>Ledger transactions deleted: {dataResetDeletedCounts.ledgerTransactions}</span>
                    <span>Import batches deleted: {dataResetDeletedCounts.importBatches}</span>
                    <span>Staging rows deleted: {dataResetDeletedCounts.stagingRows}</span>
                  </div>
                </div>
              )}

              {/* Verification */}
              {dataResetDeletionDone && dataResetVerification && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
                  <p className="mb-2 text-sm font-semibold text-blue-800">
                    🔍 Post-deletion verification
                  </p>
                  <div className="grid grid-cols-2 gap-2 text-sm text-blue-700">
                    <span>Customers remaining: {String(dataResetVerification.customersRemaining ?? "?")}</span>
                    <span>Financial records remaining: {String(dataResetVerification.financialRecordsRemaining ?? "?")}</span>
                    <span>Orphan records: {String(dataResetVerification.orphanRecordsRemaining ?? "?")}</span>
                    <span>Admin users remaining: {String(dataResetVerification.adminUsersRemaining ?? "?")}</span>
                  </div>
                </div>
              )}

              {/* Confirmation Form — only show before deletion */}
              {!dataResetDeletionDone && !dataResetPreviewLoading && (
                <>
                  {/* Backup Option */}
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <label className="flex items-start gap-2 text-sm text-slate-600">
                      <input
                        type="checkbox"
                        checked={dataResetBackupDownloaded}
                        onChange={(e) => setDataResetBackupDownloaded(e.target.checked)}
                        className="mt-0.5"
                      />
                      <span>
                        <span className="font-semibold text-slate-700">
                          Download backup before deletion
                        </span>
                        <br />
                        A JSON file containing all customers, invoices,
                        payments, ledger entries, and import data will be
                        downloaded before deletion proceeds.
                      </span>
                    </label>
                    {dataResetBackupDownloaded && !dataResetBackupLoading && (
                      <button
                        type="button"
                        onClick={async () => {
                          setDataResetBackupLoading(true);
                          try {
                            const res = await fetch("/api/admin/data-reset");
                            if (!res.ok) throw new Error("Backup download failed");
                            const blob = await res.blob();
                            const url = window.URL.createObjectURL(blob);
                            const anchor = document.createElement("a");
                            anchor.href = url;
                            anchor.download = `business-backup-${new Date().toISOString().slice(0, 10)}.json`;
                            document.body.appendChild(anchor);
                            anchor.click();
                            anchor.remove();
                            window.URL.revokeObjectURL(url);
                            setDataResetMessage("Backup downloaded successfully.");
                          } catch (err) {
                            setDataResetError(
                              err instanceof Error
                                ? err.message
                                : "Backup download failed",
                            );
                          } finally {
                            setDataResetBackupLoading(false);
                          }
                        }}
                        className="mt-2 rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100"
                      >
                        {dataResetBackupLoading ? (
                          <>
                            <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
                            Downloading…
                          </>
                        ) : (
                          "Download Backup Now"
                        )}
                      </button>
                    )}
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">
                      Reason <span className="text-red-500">*</span>
                    </label>
                    <input
                      value={dataResetReason}
                      onChange={(e) => setDataResetReason(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 outline-none"
                      placeholder="Enter a reason for this destructive action"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">
                      Type{" "}
                      <span className="font-mono text-red-600">
                        DELETE ALL BUSINESS DATA
                      </span>{" "}
                      to confirm <span className="text-red-500">*</span>
                    </label>
                    <input
                      value={dataResetConfirmation}
                      onChange={(e) => setDataResetConfirmation(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 outline-none"
                      placeholder="DELETE ALL BUSINESS DATA"
                    />
                  </div>

                  <label className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700">
                    <input
                      type="checkbox"
                      checked={dataResetAcknowledged}
                      onChange={(e) => setDataResetAcknowledged(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span>
                      I acknowledge that this action is irreversible and all
                      business data will be permanently deleted. Admin users,
                      login credentials, and application settings will be
                      preserved.
                    </span>
                  </label>
                </>
              )}
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-200 px-5 py-4">
              <button
                type="button"
                onClick={() => {
                  setShowDataResetDialog(false);
                  setDataResetConfirmation("");
                  setDataResetReason("");
                  setDataResetAcknowledged(false);
                  setDataResetMessage(null);
                  setDataResetError(null);
                }}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
              >
                {dataResetDeletionDone ? "Close" : "Cancel"}
              </button>

              {!dataResetDeletionDone && (
                <button
                  type="button"
                  disabled={
                    dataResetExecuting ||
                    dataResetConfirmation !== "DELETE ALL BUSINESS DATA" ||
                    dataResetReason.trim().length === 0 ||
                    !dataResetAcknowledged
                  }
                  onClick={async () => {
                    setDataResetExecuting(true);
                    setDataResetError(null);
                    setDataResetMessage(null);

                    try {
                      const res = await fetch("/api/admin/data-reset", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          action: "DELETE_ALL_BUSINESS_DATA",
                          mode: "execute",
                          confirmation: dataResetConfirmation,
                          reason: dataResetReason,
                          acknowledged: dataResetAcknowledged,
                        }),
                      });
                      const data = await res.json();
                      if (!res.ok) {
                        throw new Error(data.error || "Deletion failed");
                      }

                      if (data.success && data.data) {
                        setDataResetDeletedCounts(data.data.deleted);
                        setDataResetVerification(data.data.verification);
                        setDataResetDeletionDone(true);
                        setDataResetMessage(
                          "All business data has been permanently deleted.",
                        );

                        // Refresh the page after a short delay to clear all caches
                        setTimeout(() => {
                          window.location.reload();
                        }, 2000);
                      } else {
                        throw new Error(data.error || "Unexpected response");
                      }
                    } catch (err) {
                      setDataResetError(
                        err instanceof Error
                          ? err.message
                          : "Deletion failed",
                      );
                    } finally {
                      setDataResetExecuting(false);
                    }
                  }}
                  className="flex items-center gap-2 rounded-lg bg-red-600 px-5 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {dataResetExecuting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Deleting…
                    </>
                  ) : (
                    <>
                      <AlertOctagon className="h-4 w-4" />
                      Permanently Delete All Business Data
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
