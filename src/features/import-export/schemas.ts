// ─── Zod Schemas for Import/Export Validation ─────────────────────────────

import { z } from "zod";

// ─── Customer Import Schema ─────────────────────────────────────────────────

export const CustomerImportRowSchema = z.object({
  name: z.string().min(1, "Name is required"),
  mobile: z.string().min(1, "Mobile is required"),
  alternateMobile: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  creditLimit: z.number().finite().min(0).default(0),
  openingBalance: z.number().finite().default(0),
});

export const CustomerImportBatchSchema = z.object({
  customers: z.array(CustomerImportRowSchema).min(1, "At least one customer is required"),
});

// ─── Transaction Import Schema ──────────────────────────────────────────────

export const TransactionImportRowSchema = z.object({
  customerName: z.string().min(1, "Customer Name is required"),
  mobile: z.string().optional().nullable(),
  voucherDate: z.string().min(1, "Date is required"),
  dueDate: z.string().optional().nullable(),
  paymentDate: z.string().optional().nullable(),
  voucherType: z.enum([
    "SALES", "RECEIPT", "CREDIT_NOTE", "DEBIT_NOTE", "PAYMENT", "JOURNAL", "OPENING_BALANCE",
  ]),
  voucherNumber: z.string().optional().nullable(),
  againstVoucherNumber: z.string().optional().nullable(),
  debit: z.number().finite().default(0),
  credit: z.number().finite().default(0),
  narration: z.string().optional().nullable(),
  sourceEntryKey: z.string().optional().nullable(),
  sourceGuid: z.string().optional().nullable(),
  sourceRemoteId: z.string().optional().nullable(),
  sourceVchKey: z.string().optional().nullable(),
  sourceMasterId: z.string().optional().nullable(),
  sourceFileName: z.string().optional().nullable(),
});

export const TransactionImportBatchSchema = z.object({
  transactions: z.array(TransactionImportRowSchema).min(1, "At least one transaction is required"),
});

// ─── Commit Schema ──────────────────────────────────────────────────────────

export const CommitSchema = z.object({
  batchId: z.string().min(1, "batchId is required"),
});

// ─── Export Filter Schema ───────────────────────────────────────────────────

export const ExportFilterSchema = z.object({
  status: z.enum(["active", "inactive", "all"]).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  customerId: z.string().optional(),
  customerIds: z.array(z.string()).optional(),
  voucherType: z.string().optional(),
  overdueOnly: z.coerce.boolean().optional(),
  paidLate: z.coerce.boolean().optional(),
  importBatchId: z.string().optional(),
});