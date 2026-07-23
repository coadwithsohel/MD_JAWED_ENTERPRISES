// ─── Transaction Export Service ───────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import * as XLSX from "xlsx";
import type { ExportFilters } from "./types";

export interface TransactionExportRow {
  transactionId: string;
  customerName: string;
  mobile: string;
  transactionDate: string;
  dueDate: string | null;
  paymentDate: string | null;
  voucherType: string;
  voucherNumber: string | null;
  againstVoucherNumber: string | null;
  debit: number;
  credit: number;
  narration: string | null;
  sourceEntryKey: string | null;
  sourceFile: string | null;
  importBatchId: string | null;
  createdAt: string;
}

/**
 * Export transactions as CSV string.
 */
export async function exportTransactionsCsv(filters: ExportFilters = {}): Promise<string> {
  const transactions = await fetchTransactions(filters);
  const headers = [
    "Transaction ID", "Customer Name", "Mobile", "Transaction Date",
    "Due Date", "Payment Date", "Voucher Type", "Voucher Number",
    "Against Voucher Number", "Debit", "Credit", "Narration",
    "Source Entry Key", "Source File", "Import Batch ID", "Created Date",
  ];

  const rows = transactions.map((t) => [
    sanitizeCsvCell(t.transactionId),
    sanitizeCsvCell(t.customerName),
    formatMobileCsv(t.mobile),
    t.transactionDate,
    t.dueDate || "",
    t.paymentDate || "",
    sanitizeCsvCell(t.voucherType),
    sanitizeCsvCell(t.voucherNumber || ""),
    sanitizeCsvCell(t.againstVoucherNumber || ""),
    t.debit.toString(),
    t.credit.toString(),
    sanitizeCsvCell(t.narration || ""),
    sanitizeCsvCell(t.sourceEntryKey || ""),
    sanitizeCsvCell(t.sourceFile || ""),
    sanitizeCsvCell(t.importBatchId || ""),
    t.createdAt,
  ]);

  return generateCsv(headers, rows);
}

/**
 * Export transactions as XLSX workbook buffer.
 */
export async function exportTransactionsXlsx(filters: ExportFilters = {}): Promise<Buffer> {
  const transactions = await fetchTransactions(filters);

  const data = transactions.map((t) => ({
    "Transaction ID": t.transactionId,
    "Customer Name": t.customerName,
    "Mobile": t.mobile,
    "Transaction Date": t.transactionDate,
    "Due Date": t.dueDate || "",
    "Payment Date": t.paymentDate || "",
    "Voucher Type": t.voucherType,
    "Voucher Number": t.voucherNumber || "",
    "Against Voucher Number": t.againstVoucherNumber || "",
    "Debit": t.debit,
    "Credit": t.credit,
    "Narration": t.narration || "",
    "Source Entry Key": t.sourceEntryKey || "",
    "Source File": t.sourceFile || "",
    "Import Batch ID": t.importBatchId || "",
    "Created Date": t.createdAt,
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Transactions");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

async function fetchTransactions(filters: ExportFilters): Promise<TransactionExportRow[]> {
  const where: Record<string, unknown> = {};

  if (filters.dateFrom) {
    where.transactionDate = { ...(where.transactionDate as Record<string, unknown> || {}), gte: new Date(filters.dateFrom) };
  }
  if (filters.dateTo) {
    where.transactionDate = { ...(where.transactionDate as Record<string, unknown> || {}), lte: new Date(filters.dateTo) };
  }
  if (filters.voucherType) where.voucherType = filters.voucherType;
  if (filters.importBatchId) where.importBatchId = filters.importBatchId;

  if (filters.customerId) where.customerId = filters.customerId;
  if (filters.customerIds && filters.customerIds.length > 0) {
    where.customerId = { in: filters.customerIds };
  }

  // For overdue-only filtering, we filter after fetching
  const transactions = await prisma.customerLedgerTransaction.findMany({
    where: where as Record<string, unknown>,
    include: {
      customer: {
        select: { fullName: true, mobile: true },
      },
    },
    orderBy: { transactionDate: "desc" },
    take: 10000,
  });

  let rows: TransactionExportRow[] = transactions.map((t) => {
    const tx = t as Record<string, unknown>;
    return {
      transactionId: t.id,
      customerName: t.customer.fullName,
      mobile: t.customer.mobile,
      transactionDate: (t.transactionDate as Date).toISOString().slice(0, 10),
      dueDate: tx.dueDate ? new Date(tx.dueDate as string | Date).toISOString().slice(0, 10) : null,
      paymentDate: null,
      voucherType: t.voucherType,
      voucherNumber: t.voucherNumber,
      againstVoucherNumber: (tx.againstReference as string) || null,
      debit: Number(t.debit),
      credit: Number(t.credit),
      narration: t.particulars,
      sourceEntryKey: (tx.sourceVchKey as string) || null,
      sourceFile: null,
      importBatchId: t.importBatchId,
      createdAt: (t.createdAt as Date).toISOString().slice(0, 10),
    };
  });

  // Apply overdue filter if needed
  if (filters.overdueOnly) {
    const today = new Date();
    rows = rows.filter((r) => {
      if (!r.dueDate) return false;
      const due = new Date(r.dueDate);
      return due < today && r.debit > r.credit;
    });
  }

  if (filters.paidLate) {
    rows = rows.filter((r) => r.dueDate && r.debit === 0);
  }

  return rows;
}

function generateCsv(headers: string[], rows: string[][]): string {
  const lines: string[] = [
    headers.map((h) => `"${h}"`).join(","),
    ...rows.map((row) => row.join(",")),
  ];
  return lines.join("\n");
}

function sanitizeCsvCell(value: string): string {
  if (["+", "-", "=", "@", "\t", "\r"].some((c) => value.startsWith(c))) {
    return `'${value}`;
  }
  return value;
}

function formatMobileCsv(mobile: string): string {
  return mobile;
}