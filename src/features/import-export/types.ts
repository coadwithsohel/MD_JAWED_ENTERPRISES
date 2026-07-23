// ─── Import/Export Core Types ────────────────────────────────────────────────

export type ImportType = "CUSTOMER" | "TRANSACTION";
export type VoucherType = "SALES" | "RECEIPT" | "CREDIT_NOTE" | "DEBIT_NOTE" | "PAYMENT" | "JOURNAL" | "OPENING_BALANCE";
export type PaymentStatus = "PAID" | "PARTIALLY_PAID" | "UNPAID" | "OVERDUE" | "PARTIALLY_PAID_OVERDUE" | "PAID_LATE" | "ADVANCE";

export type ImportBatchStatus =
  | "UPLOADED"
  | "VALIDATED"
  | "IMPORTING"
  | "COMPLETED"
  | "PARTIALLY_COMPLETED"
  | "FAILED";

export type ImportRowStatus =
  | "PARSED"
  | "VALID"
  | "INVALID"
  | "MATCHED"
  | "UNMATCHED"
  | "DUPLICATE"
  | "IMPORTED"
  | "FAILED"
  | "SKIPPED";

export type PaymentMode =
  | "CASH"
  | "BANK_TRANSFER"
  | "UPI"
  | "CARD"
  | "CHEQUE"
  | "NEFT"
  | "RTGS"
  | "IMPS"
  | "OTHER"
  | "UNKNOWN";

export type MatchStatus = "MATCHED" | "UNMATCHED" | "AMBIGUOUS" | "AUTO_MATCHED";
export type DuplicateStatus = "NONE" | "DUPLICATE" | "POSSIBLE_DUPLICATE";

// ─── API Response Types ──────────────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown[];
  };
}

export interface PreviewResponse {
  batchId: string;
  fileName: string;
  status: ImportBatchStatus;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  matchedRows: number;
  unmatchedRows: number;
  duplicateRows: number;
  rows: PreviewRow[];
}

export interface PreviewRow {
  rowNumber: number;
  customerName?: string;
  mobile?: string;
  date?: string;
  dueDate?: string;
  paymentDate?: string;
  voucherType?: VoucherType;
  voucherNumber?: string;
  againstVoucherNumber?: string;
  debit: number;
  credit: number;
  matchStatus: MatchStatus;
  matchedCustomerId?: string;
  matchedCustomerName?: string;
  duplicateStatus: DuplicateStatus;
  validationStatus: ImportRowStatus;
  validationErrors: string[];
}

export interface CommitResponse {
  batchId: string;
  totalRows: number;
  importedRows: number;
  skippedDuplicates: number;
  skippedInvalid: number;
  skippedUnmatched: number;
  failedRows: number;
  status: ImportBatchStatus;
}

export interface ExportFilters {
  status?: "active" | "inactive" | "all";
  dateFrom?: string;
  dateTo?: string;
  customerId?: string;
  customerIds?: string[];
  voucherType?: VoucherType;
  overdueOnly?: boolean;
  paidLate?: boolean;
  importBatchId?: string;
}

// ─── Customer Import ─────────────────────────────────────────────────────────

export interface CustomerImportRow {
  rowNumber: number;
  name: string;
  mobile: string;
  alternateMobile?: string | null;
  email?: string | null;
  city?: string | null;
  state?: string | null;
  address?: string | null;
  creditLimit: number;
  openingBalance: number;
}

export interface CustomerImportValidation {
  isValid: boolean;
  errors: string[];
  duplicateInFile: boolean;
  duplicateInDb: boolean;
  existingCustomerId?: string;
}

// ─── Transaction Import ──────────────────────────────────────────────────────

export interface TransactionImportRow {
  rowNumber: number;
  customerName: string;
  mobile?: string;
  voucherDate: string;
  dueDate?: string | null;
  paymentDate?: string | null;
  voucherType: VoucherType;
  voucherNumber?: string;
  againstVoucherNumber?: string;
  debit: number;
  credit: number;
  narration?: string;
  sourceEntryKey?: string;
  sourceGuid?: string;
  sourceRemoteId?: string;
  sourceVchKey?: string;
  sourceMasterId?: string;
  sourceFileName?: string;
}

export interface TransactionImportValidation {
  isValid: boolean;
  errors: string[];
  matchedCustomerId?: string;
  matchedCustomerName?: string;
  matchStatus: MatchStatus;
  duplicateStatus: DuplicateStatus;
  duplicateKey?: string;
}

// ─── Invoice & Receipt Types ────────────────────────────────────────────────

export interface InvoiceData {
  invoiceNumber: string;
  invoiceDate: string;
  dueDate?: string;
  subtotal: number;
  discount: number;
  taxAmount: number;
  totalAmount: number;
  narration?: string;
  items?: InvoiceItemData[];
  sourceEntryKey?: string;
  tallyGuid?: string;
  tallyRemoteId?: string;
  tallyVoucherKey?: string;
  tallyMasterId?: string;
  sourceFile?: string;
}

export interface InvoiceItemData {
  itemName: string;
  description?: string;
  quantity: number;
  unit?: string;
  rate: number;
  discount: number;
  taxRate?: number;
  taxAmount: number;
  lineAmount: number;
}

export interface ReceiptData {
  receiptNumber: string;
  receiptDate: string;
  amount: number;
  paymentMode: PaymentMode;
  referenceNumber?: string;
  bankLedger?: string;
  narration?: string;
  allocations?: ReceiptAllocationData[];
  sourceEntryKey?: string;
  tallyGuid?: string;
  tallyRemoteId?: string;
  tallyVoucherKey?: string;
  tallyMasterId?: string;
  sourceFile?: string;
}

export interface ReceiptAllocationData {
  invoiceId?: string;
  againstInvoiceNumber: string;
  allocatedAmount: number;
  allocationType: "Agst Ref" | "New Ref" | "Advance" | "On Account";
}

// ─── Tally XML Parsing ──────────────────────────────────────────────────────

export interface TallyVoucherInput {
  tallyGuid?: string;
  tallyRemoteId?: string;
  tallyMasterId?: string;
  voucherKey?: string;
  customerName: string;
  mobile?: string;
  voucherDate: string;
  dueDate?: string;
  paymentDate?: string;
  voucherType: VoucherType;
  voucherNumber?: string;
  againstVoucherNumber?: string;
  paymentStatus?: string;
  debit: number;
  credit: number;
  narration?: string;
  reference?: string;
  sourceFileName?: string;
  // Bill allocations for receipts
  billAllocations?: Array<{
    name: string;
    billType: string;
    amount: number;
  }>;
  // Inventory entries for sales
  inventoryEntries?: Array<{
    itemName: string;
    quantity: number;
    billedQty?: number;
    unit?: string;
    rate: number;
    amount: number;
    description?: string;
  }>;
  // Tally-specific fields
  ledgerEntries?: Array<{
    ledgerName: string;
    amount: number;
    isPartyLedger: boolean;
    isDeemedPositive: boolean;
  }>;
}

// ─── Overdue Types ──────────────────────────────────────────────────────────

export interface OverdueRecord {
  customerId: string;
  customerName: string;
  customerMobile: string;
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: Date;
  dueDate: Date;
  invoiceAmount: number;
  paidAmount: number;
  outstanding: number;
  daysOverdue: number;
  status: PaymentStatus;
  lastPaymentDate?: Date;
}

export interface CustomerOverdueSummary {
  customerId: string;
  customerName: string;
  totalOutstanding: number;
  totalOverdue: number;
  invoices: OverdueRecord[];
}