// ─── Customer Export Service ──────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import * as XLSX from "xlsx";
import type { ExportFilters } from "./types";

export interface CustomerExportRow {
  customerCode: string;
  fullName: string;
  mobile: string;
  alternateMobile: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  address: string | null;
  creditLimit: number;
  openingBalance: number;
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
  balanceType: string;
  status: string;
  createdAt: string;
}

/**
 * Export customers as CSV string.
 */
export async function exportCustomersCsv(filters: ExportFilters = {}): Promise<string> {
  const customers = await fetchCustomers(filters);
  const headers = [
    "Customer ID", "Name", "Mobile", "Alternate Mobile", "Email",
    "City", "State", "Address", "Credit Limit", "Opening Balance",
    "Total Debit", "Total Credit", "Closing Balance", "Balance Type",
    "Status", "Created Date",
  ];

  const rows = customers.map((c) => [
    sanitizeCsvCell(c.customerCode),
    sanitizeCsvCell(c.fullName),
    formatMobileCsv(c.mobile),
    sanitizeCsvCell(c.alternateMobile || ""),
    sanitizeCsvCell(c.email || ""),
    sanitizeCsvCell(c.city || ""),
    sanitizeCsvCell(c.state || ""),
    sanitizeCsvCell(c.address || ""),
    c.creditLimit.toString(),
    c.openingBalance.toString(),
    c.totalDebit.toString(),
    c.totalCredit.toString(),
    c.closingBalance.toString(),
    c.balanceType,
    c.status,
    c.createdAt,
  ]);

  return generateCsv(headers, rows);
}

/**
 * Export customers as XLSX workbook buffer.
 */
export async function exportCustomersXlsx(filters: ExportFilters = {}): Promise<Buffer> {
  const customers = await fetchCustomers(filters);
  const headers = [
    "Customer ID", "Name", "Mobile", "Alternate Mobile", "Email",
    "City", "State", "Address", "Credit Limit", "Opening Balance",
    "Total Debit", "Total Credit", "Closing Balance", "Balance Type",
    "Status", "Created Date",
  ];

  const data = customers.map((c) => ({
    "Customer ID": c.customerCode,
    "Name": c.fullName,
    "Mobile": c.mobile,
    "Alternate Mobile": c.alternateMobile || "",
    "Email": c.email || "",
    "City": c.city || "",
    "State": c.state || "",
    "Address": c.address || "",
    "Credit Limit": c.creditLimit,
    "Opening Balance": c.openingBalance,
    "Total Debit": c.totalDebit,
    "Total Credit": c.totalCredit,
    "Closing Balance": c.closingBalance,
    "Balance Type": c.balanceType,
    "Status": c.status,
    "Created Date": c.createdAt,
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Customers");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

async function fetchCustomers(filters: ExportFilters): Promise<CustomerExportRow[]> {
  const where: Record<string, unknown> = {};

  if (filters.status === "active") where.isActive = true;
  else if (filters.status === "inactive") where.isActive = false;

  if (filters.customerId) where.id = filters.customerId;
  if (filters.customerIds && filters.customerIds.length > 0) {
    where.id = { in: filters.customerIds };
  }

  const customers = await prisma.customer.findMany({
    where: where as Record<string, unknown>,
    select: {
      id: true,
      customerCode: true,
      fullName: true,
      mobile: true,
      normalizedMobile: true,
      alternateMobile: true,
      email: true,
      city: true,
      state: true,
      address: true,
      creditLimit: true,
      openingBalance: true,
      currentBalance: true,
      isActive: true,
      createdAt: true,
    },
    orderBy: { fullName: "asc" },
  });

  const rows: CustomerExportRow[] = [];

  for (const c of customers) {
    // Calculate totals
    const ledgerEntries = await prisma.creditLedger.findMany({
      where: { customerId: c.id },
      select: { transactionType: true, amount: true },
    });

    let totalDebit = 0;
    let totalCredit = 0;

    for (const l of ledgerEntries) {
      const amt = Number(l.amount);
      switch (l.transactionType) {
        case "CREDIT_SALE":
        case "PAYMENT_REVERSAL":
          totalDebit += amt;
          break;
        case "PAYMENT_RECEIVED":
        case "SALE_CANCELLED":
        case "RETURN_CREDIT":
          totalCredit += amt;
          break;
        case "ADJUSTMENT":
          totalDebit += amt;
          break;
        default:
          break;
      }
    }

    const closingBalance = Number(c.openingBalance) + totalDebit - totalCredit;
    const balanceType = closingBalance > 0 ? "Dr" : closingBalance < 0 ? "Cr" : "Nil";

    rows.push({
      customerCode: c.customerCode,
      fullName: c.fullName,
      mobile: c.mobile,
      alternateMobile: c.alternateMobile,
      email: c.email,
      city: c.city,
      state: c.state,
      address: c.address,
      creditLimit: Number(c.creditLimit),
      openingBalance: Number(c.openingBalance),
      totalDebit,
      totalCredit,
      closingBalance,
      balanceType,
      status: c.isActive ? "Active" : "Inactive",
      createdAt: c.createdAt.toISOString().slice(0, 10),
    });
  }

  return rows;
}

/**
 * Generate CSV from headers and rows.
 */
function generateCsv(headers: string[], rows: string[][]): string {
  const lines: string[] = [
    headers.map((h) => `"${h}"`).join(","),
    ...rows.map((row) => row.join(",")),
  ];
  return lines.join("\n");
}

/**
 * Sanitize a cell value for CSV export (prevent formula injection).
 */
function sanitizeCsvCell(value: string): string {
  if (["+", "-", "=", "@", "\t", "\r"].some((c) => value.startsWith(c))) {
    return `'${value}`;
  }
  return value;
}

/**
 * Format mobile as text (prevent Excel from treating as number).
 */
function formatMobileCsv(mobile: string): string {
  return mobile;
}