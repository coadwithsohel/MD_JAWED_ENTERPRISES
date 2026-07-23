// ─── Transaction Import Service ───────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { parseCsv, getCellValue } from "./csv-parser";
import { parseSignedAmount } from "./amount-parser";
import { parseStrictDate, optionalDate, dateStringToDate } from "./date-parser";
import { matchCustomer, buildCustomerLookup } from "./matching";
import { checkSourceKeyDuplicate, buildFallbackSignature } from "./duplicate-detection";
import type { VoucherType, ImportRowStatus, MatchStatus, DuplicateStatus } from "./types";
import { ValidationError, AuthError } from "./errors";

interface TransactionPreviewRow {
  rowNumber: number;
  customerName: string;
  mobile?: string;
  voucherDate: string;
  dueDate?: string | null;
  paymentDate?: string | null;
  voucherType: string;
  voucherNumber?: string;
  againstVoucherNumber?: string;
  debit: number;
  credit: number;
  narration?: string;
  sourceEntryKey?: string;
  sourceGuid?: string;
  matchStatus: MatchStatus;
  matchedCustomerId?: string;
  matchedCustomerName?: string;
  duplicateStatus: DuplicateStatus;
  validationStatus: ImportRowStatus;
  validationErrors: string[];
}

/**
 * Normalize voucher type from source text.
 */
function normalizeVoucherType(raw: string): VoucherType | null {
  const upper = raw.toUpperCase().trim();
  if (upper === "SALES" || upper === "SALE" || upper.includes("SALES") || upper === "SALES INVOICE" || upper.includes("SALES INVOICE")) return "SALES";
  if (upper === "RECEIPT" || upper.includes("RECEIPT")) return "RECEIPT";
  if (upper === "DEBIT NOTE" || upper === "DEBIT_NOTE" || upper.includes("DEBIT")) return "DEBIT_NOTE";
  if (upper === "CREDIT NOTE" || upper === "CREDIT_NOTE" || upper.includes("CREDIT")) return "CREDIT_NOTE";
  if (upper === "PAYMENT" || upper.includes("PAYMENT")) return "PAYMENT";
  if (upper === "JOURNAL" || upper.includes("JOURNAL") || upper === "ADJUSTMENT") return "JOURNAL";
  if (upper.includes("OPENING")) return "OPENING_BALANCE";
  return null;
}

const TRANSACTION_REQUIRED_HEADERS = ["customer name", "date", "voucher type"];

/**
 * Preview transaction import from CSV.
 */
export async function previewTransactionImport(
  fileContent: string,
  fileName: string,
  userId: string,
): Promise<{
  batchId: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  matchedRows: number;
  unmatchedRows: number;
  duplicateRows: number;
  rows: TransactionPreviewRow[];
}> {
  // Verify user
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, isActive: true },
  });
  if (!user || !user.isActive) {
    throw new AuthError("Your session is no longer valid. Please sign in again.");
  }

  // Parse CSV
  const parsed = parseCsv(fileContent, TRANSACTION_REQUIRED_HEADERS);

  // Load customers for matching
  const allCustomers = await prisma.customer.findMany({
    where: { isActive: true, deletedAt: null },
    select: { id: true, fullName: true, mobile: true, normalizedMobile: true },
  });
  const customerLookup = buildCustomerLookup(allCustomers);

  // Load existing source keys for duplicate detection
  const existingVouchers = await prisma.tallyVoucher.findMany({
    select: { voucherKey: true, tallyGuid: true, tallyRemoteId: true, tallyMasterId: true },
    where: { importStatus: { not: "SKIPPED" } },
  });
  const existingKeys = new Set<string>();
  for (const v of existingVouchers) {
    if (v.voucherKey) existingKeys.add(v.voucherKey);
    if (v.tallyGuid) existingKeys.add(v.tallyGuid);
    if (v.tallyRemoteId) existingKeys.add(v.tallyRemoteId);
    if (v.tallyMasterId) existingKeys.add(v.tallyMasterId);
  }

  // Create batch
  const batch = await prisma.tallyImportBatch.create({
    data: {
      originalFileName: fileName,
      importedById: userId,
      status: "UPLOADED",
    },
  });

  const rows: TransactionPreviewRow[] = [];
  let validCount = 0;
  let invalidCount = 0;
  let matchedCount = 0;
  let unmatchedCount = 0;
  let duplicateCount = 0;

  for (let i = 0; i < parsed.rows.length; i++) {
    const row = parsed.rows[i];
    const rowNumber = i + 2;
    const errors: string[] = [];

    const customerName = getCellValue(row, ["Customer Name", "Customer Name", "Party Name"]);
    const mobile = getCellValue(row, ["Mobile", "Phone"]);
    const dateRaw = getCellValue(row, ["Date", "Voucher Date", "Transaction Date", "Effective Date"]);
    const dueDateRaw = getCellValue(row, ["Due Date"]);
    const paymentDateRaw = getCellValue(row, ["Payment Date"]);
    const voucherTypeRaw = getCellValue(row, ["Voucher Type", "Type"]);
    const voucherNumber = getCellValue(row, ["Voucher Number", "Invoice Number"]);
    const againstVoucherNumber = getCellValue(row, ["Against Voucher Number", "Against Invoice"]);
    const debitRaw = getCellValue(row, ["Debit"]);
    const creditRaw = getCellValue(row, ["Credit"]);
    const narration = getCellValue(row, ["Narration", "Particulars", "Description"]);
    const sourceEntryKey = getCellValue(row, ["Source Entry Key", "Source VCH Key"]);
    const sourceGuid = getCellValue(row, ["Source GUID", "GUID"]);
    const sourceRemoteId = getCellValue(row, ["Source Remote ID", "Remote ID"]);
    const sourceMasterId = getCellValue(row, ["Source Master ID", "Master ID"]);

    // Validate required fields
    if (!customerName) errors.push("Customer Name is required");
    if (!dateRaw) errors.push("Date is required");
    if (!voucherTypeRaw) errors.push("Voucher Type is required");

    // Parse date
    let voucherDate = "";
    if (dateRaw) {
      const dateResult = parseStrictDate(dateRaw);
      if (dateResult.isValid && dateResult.date) {
        voucherDate = dateResult.date;
      } else {
        errors.push(`Date: ${dateResult.error}`);
      }
    }

    // Parse optional dates
    let dueDate: string | null = null;
    if (dueDateRaw) {
      const ddResult = parseStrictDate(dueDateRaw);
      if (ddResult.isValid && ddResult.date) {
        dueDate = ddResult.date;
      } else {
        errors.push(`Due Date: ${ddResult.error}`);
      }
    }

    let paymentDate: string | null = null;
    if (paymentDateRaw) {
      const pdResult = parseStrictDate(paymentDateRaw);
      if (pdResult.isValid && pdResult.date) {
        paymentDate = pdResult.date;
      } else {
        errors.push(`Payment Date: ${pdResult.error}`);
      }
    }

    // Parse amounts
    let debit = 0;
    let credit = 0;

    if (debitRaw) {
      const debitResult = parseSignedAmount(debitRaw);
      if (debitResult.isValid && debitResult.value !== null) {
        debit = Math.abs(debitResult.value);
      } else {
        errors.push(`Debit: ${debitResult.error}`);
      }
    }

    if (creditRaw) {
      const creditResult = parseSignedAmount(creditRaw);
      if (creditResult.isValid && creditResult.value !== null) {
        credit = Math.abs(creditResult.value);
      } else {
        errors.push(`Credit: ${creditResult.error}`);
      }
    }

    // Validate amounts
    if (debit < 0) errors.push("Debit cannot be negative");
    if (credit < 0) errors.push("Credit cannot be negative");
    if (debit === 0 && credit === 0) errors.push("Both Debit and Credit cannot be zero");
    if (debit > 0 && credit > 0) errors.push("Both Debit and Credit cannot be positive");

    // Normalize voucher type
    let normalizedType: VoucherType | null = null;
    if (voucherTypeRaw) {
      normalizedType = normalizeVoucherType(voucherTypeRaw);
      if (!normalizedType) errors.push(`Unknown voucher type: "${voucherTypeRaw}"`);
    }

    // Customer matching
    let matchStatus: MatchStatus = "UNMATCHED";
    let matchedCustomerId: string | undefined;
    let matchedCustomerName: string | undefined;

    if (customerName) {
      const match = matchCustomer(mobile || null, customerName, customerLookup);
      matchStatus = match.status;
      matchedCustomerId = match.customerId || undefined;
      matchedCustomerName = match.customerName || undefined;
      if (matchStatus === "MATCHED" || matchStatus === "AUTO_MATCHED") matchedCount++;
      else unmatchedCount++;
    }

    // Duplicate detection
    let duplicateStatus: DuplicateStatus = "NONE";
    const key = sourceEntryKey || sourceGuid;
    if (key && existingKeys.has(key)) {
      duplicateStatus = "DUPLICATE";
      duplicateCount++;
      errors.push("Duplicate source entry key");
    }

    const validationStatus: ImportRowStatus = errors.length === 0 ? "VALID" : "INVALID";
    if (validationStatus === "VALID") validCount++;
    else invalidCount++;

    // Store as TallyVoucher
    await prisma.tallyVoucher.create({
      data: {
        importBatchId: batch.id,
        tallyGuid: sourceGuid || undefined,
        tallyRemoteId: sourceRemoteId || undefined,
        tallyMasterId: sourceMasterId || undefined,
        voucherKey: sourceEntryKey || undefined,
        sourceFileName: fileName,
        customerName: customerName || undefined,
        mobile: mobile || null,
        customerId: matchedCustomerId || undefined,
        matchedCustomerId: matchedCustomerId || null,
        matchedCustomerName: matchedCustomerName || null,
        voucherDate: voucherDate ? dateStringToDate(voucherDate) : new Date(),
        dueDate: dueDate ? dateStringToDate(dueDate) : null,
        paymentDate: paymentDate ? dateStringToDate(paymentDate) : null,
        voucherType: normalizedType || "JOURNAL",
        voucherNumber: voucherNumber || undefined,
        againstVoucherNumber: againstVoucherNumber || undefined,
        debit,
        credit,
        narration: narration || undefined,
        isDuplicate: duplicateStatus === "DUPLICATE",
        importStatus: validationStatus,
        errorMessage: errors.length > 0 ? errors.join("; ") : null,
      },
    });

    rows.push({
      rowNumber,
      customerName: customerName || "",
      mobile: mobile || undefined,
      voucherDate,
      dueDate: dueDate || null,
      paymentDate: paymentDate || null,
      voucherType: normalizedType || voucherTypeRaw,
      voucherNumber: voucherNumber || undefined,
      againstVoucherNumber: againstVoucherNumber || undefined,
      debit,
      credit,
      narration: narration || undefined,
      sourceEntryKey: sourceEntryKey || undefined,
      sourceGuid: sourceGuid || undefined,
      matchStatus,
      matchedCustomerId,
      matchedCustomerName,
      duplicateStatus,
      validationStatus,
      validationErrors: errors,
    });
  }

  // Update batch
  const totalValid = validCount;
  await prisma.tallyImportBatch.update({
    where: { id: batch.id },
    data: {
      status: totalValid > 0 ? "READY" : "FAILED",
      totalVouchers: parsed.rows.length,
      salesCount: rows.filter((r) => r.voucherType === "SALES").length,
      receiptCount: rows.filter((r) => r.voucherType === "RECEIPT").length,
      debitNoteCount: rows.filter((r) => r.voucherType === "DEBIT_NOTE").length,
      creditNoteCount: rows.filter((r) => r.voucherType === "CREDIT_NOTE").length,
      duplicateCount,
      errorCount: invalidCount,
      debitTotal: rows.reduce((sum, r) => sum + r.debit, 0),
      creditTotal: rows.reduce((sum, r) => sum + r.credit, 0),
    },
  });

  return {
    batchId: batch.id,
    totalRows: parsed.rows.length,
    validRows: validCount,
    invalidRows: invalidCount,
    matchedRows: matchedCount,
    unmatchedRows: unmatchedCount,
    duplicateRows: duplicateCount,
    rows,
  };
}

/**
 * Commit a transaction import batch.
 */
export async function commitTransactionImport(
  batchId: string,
  userId: string,
): Promise<{
  batchId: string;
  totalRows: number;
  importedRows: number;
  skippedDuplicates: number;
  skippedInvalid: number;
  skippedUnmatched: number;
  failedRows: number;
  status: string;
}> {
  // Verify user
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, isActive: true },
  });
  if (!user || !user.isActive) {
    throw new AuthError("Your session is no longer valid. Please sign in again.");
  }

  // Load batch
  const batch = await prisma.tallyImportBatch.findUnique({
    where: { id: batchId },
    include: {
      vouchers: {
        where: {
          importStatus: { in: ["VALID", "PARSED", "MATCHED"] },
          customerId: { not: null },
          isDuplicate: false,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!batch) {
    throw new ValidationError(`Import batch not found: ${batchId}`);
  }

  if (batch.status === "COMPLETED" || batch.status === "IMPORTING") {
    throw new ValidationError(`Batch ${batchId} has already been processed.`);
  }

  // Mark as importing
  await prisma.tallyImportBatch.update({
    where: { id: batchId },
    data: { status: "IMPORTING" },
  });

  const stagedVouchers = batch.vouchers;
  let importedRows = 0;
  let skippedInvalid = 0;
  let skippedUnmatched = 0;
  let failedRows = 0;

  const CHUNK_SIZE = 50;

  for (let i = 0; i < stagedVouchers.length; i += CHUNK_SIZE) {
    const chunk = stagedVouchers.slice(i, i + CHUNK_SIZE);

    for (const voucher of chunk) {
      try {
        if (!voucher.customerId) {
          await prisma.tallyVoucher.update({
            where: { id: voucher.id },
            data: { importStatus: "SKIPPED", errorMessage: "No matched customer" },
          });
          skippedUnmatched++;
          continue;
        }

        // Determine debit/credit
        const isDebit = Number(voucher.debit) > 0;
        const amount = isDebit ? Number(voucher.debit) : Number(voucher.credit);

        if (amount <= 0) {
          await prisma.tallyVoucher.update({
            where: { id: voucher.id },
            data: { importStatus: "SKIPPED", errorMessage: "Zero amount" },
          });
          skippedInvalid++;
          continue;
        }

        // Get customer balance
        const customer = await prisma.customer.findUnique({
          where: { id: voucher.customerId },
          select: { currentBalance: true },
        });
        if (!customer) {
          await prisma.tallyVoucher.update({
            where: { id: voucher.id },
            data: { importStatus: "FAILED", errorMessage: "Customer not found" },
          });
          failedRows++;
          continue;
        }

        const currentPaise = Math.round(Number(customer.currentBalance) * 100);
        const amountPaise = Math.round(amount * 100);
        const newBalancePaise = isDebit
          ? currentPaise + amountPaise
          : currentPaise - amountPaise;
        const newBalance = newBalancePaise / 100;

        // Create CreditLedger entry
        const ledgerEntry = await prisma.creditLedger.create({
          data: {
            customerId: voucher.customerId,
            transactionType: isDebit ? "CREDIT_SALE" : "PAYMENT_RECEIVED",
            amount,
            balanceAfter: newBalance,
            description: `Import ${voucher.voucherType} — ${voucher.voucherNumber || voucher.narration || ""}`.trim(),
            createdAt: voucher.voucherDate,
          },
        });

        const v = voucher as Record<string, unknown>;

        // Create CustomerLedgerTransaction
        await prisma.customerLedgerTransaction.create({
          data: {
            customerId: v.customerId as string,
            transactionDate: v.voucherDate as Date,
            dueDate: v.dueDate as Date | null,
            voucherType: v.voucherType as string,
            voucherNumber: (v.voucherNumber as string) || undefined,
            againstReference: (v.againstVoucherNumber as string) || undefined,
            particulars: `Import ${v.voucherType as string} — ${v.voucherNumber || v.narration || ""}`.trim(),
            debit: isDebit ? amount : 0,
            credit: isDebit ? 0 : amount,
            sourceSystem: "TALLY",
            sourceGuid: (v.tallyGuid as string) || undefined,
            sourceRemoteId: (v.tallyRemoteId as string) || undefined,
            sourceVchKey: (v.voucherKey as string) || undefined,
            sourceMasterId: (v.tallyMasterId as string) || undefined,
            importBatchId: batchId,
          },
        });

        // Update customer balance
        await prisma.customer.update({
          where: { id: voucher.customerId },
          data: { currentBalance: newBalance },
        });

        // Mark voucher as imported
        await prisma.tallyVoucher.update({
          where: { id: voucher.id },
          data: {
            importStatus: "IMPORTED",
            customerId: voucher.customerId,
            ledgerEntryId: ledgerEntry.id,
          },
        });

        importedRows++;
      } catch (err) {
        await prisma.tallyVoucher.update({
          where: { id: voucher.id },
          data: {
            importStatus: "FAILED",
            errorMessage: err instanceof Error ? err.message : "Unknown error",
          },
        });
        failedRows++;
      }
    }
  }

  // Update batch
  const status = failedRows > 0 ? "PARTIALLY_COMPLETED" : "COMPLETED";
  await prisma.tallyImportBatch.update({
    where: { id: batchId },
    data: {
      status,
      totalVouchers: stagedVouchers.length,
      skippedCount: skippedInvalid + skippedUnmatched,
      errorCount: failedRows,
      completedAt: new Date(),
    },
  });

  const duplicateSkipped = 0;

  // Audit log
  try {
    await prisma.auditLog.create({
      data: {
        userId,
        action: "IMPORT",
        entityType: "TallyImportBatch",
        entityId: batchId,
        newData: {
          importedRows,
          duplicateSkipped,
          skippedInvalid,
          skippedUnmatched,
          failedRows,
        },
      },
    });
  } catch {
    // Non-critical
  }

  return {
    batchId,
    totalRows: stagedVouchers.length,
    importedRows,
    skippedDuplicates: duplicateSkipped,
    skippedInvalid,
    skippedUnmatched,
    failedRows,
    status,
  };
}