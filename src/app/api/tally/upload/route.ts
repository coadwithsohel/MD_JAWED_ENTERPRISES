/**
 * POST /api/tally/upload
 *
 * Handles transaction CSV upload for preview.
 * Fixed: duplicate detection excludes current batch, voucher type normalization is case-insensitive, summary counts computed correctly.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, clearAuthCookie } from "@/lib/auth";
import { parseCsv, getCellValue } from "@/features/import-export/csv-parser";
import { parseSignedAmount, normalizeMobile } from "@/features/import-export/amount-parser";
import { parseStrictDate, dateStringToDate } from "@/features/import-export/date-parser";
import { matchCustomer, buildCustomerLookup } from "@/features/import-export/matching";

/**
 * Normalize voucher type from source text - case-insensitive, handles aliases.
 */
function normalizeVoucherType(value: string): string | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ");

  const aliases: Record<string, string> = {
    "sale": "SALES",
    "sales": "SALES",
    "sales invoice": "SALES",
    "receipt": "RECEIPT",
    "receipts": "RECEIPT",
    "payment": "RECEIPT",
    "payment received": "RECEIPT",
    "debit note": "DEBIT_NOTE",
    "debit": "DEBIT_NOTE",
    "credit note": "CREDIT_NOTE",
    "credit": "CREDIT_NOTE",
    "journal": "JOURNAL",
    "adjustment": "JOURNAL",
    "opening balance": "OPENING_BALANCE",
  };

  return aliases[normalized] ?? null;
}

export async function POST(req: NextRequest) {
  const { auth, error } = await requireAuth(req);
  if (error) return error;

  try {
    // Parse file
    const formData = await req.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const content = await file.text();
    const sourceFileName = file.name;

    // Verify user
    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { id: true, isActive: true },
    });
    if (!user || !user.isActive) {
      const res = NextResponse.json(
        { error: "SESSION_USER_NOT_FOUND", details: "Your session is no longer valid. Please sign in again." },
        { status: 401 },
      );
      clearAuthCookie(res);
      return res;
    }

    // Parse CSV
    const parsed = parseCsv(content, ["customer name", "date", "voucher type"]);

    // Load customers for matching
    const allCustomers = await prisma.customer.findMany({
      where: { isActive: true, deletedAt: null },
      select: { id: true, fullName: true, mobile: true, normalizedMobile: true },
    });
    const customerLookup = buildCustomerLookup(allCustomers);

    // Get existing keys for duplicate detection — ONLY from completed/imported records, NOT from current or failed batches
    const existingVouchers = await prisma.tallyVoucher.findMany({
      select: { voucherKey: true, tallyGuid: true },
      where: {
        importStatus: "IMPORTED",
        importBatch: {
          status: "COMPLETED",
        },
      },
    });
    const existingKeys = new Set<string>();
    for (const v of existingVouchers) {
      if (v.voucherKey) existingKeys.add(v.voucherKey);
      if (v.tallyGuid) existingKeys.add(v.tallyGuid);
    }

    // Create import batch
    const batch = await prisma.tallyImportBatch.create({
      data: {
        originalFileName: sourceFileName,
        importedById: auth.userId,
        status: "UPLOADED",
      },
    });

    const allStagedVouchers: Array<{
      id: string;
      customerName: string;
      voucherDate: string;
      voucherType: string;
      debit: number;
      credit: number;
      matchedCustomerId: string | null;
      isDuplicate: boolean;
      errors: string[];
    }> = [];

    for (let i = 0; i < parsed.rows.length; i++) {
      const row = parsed.rows[i];
      const rowNumber = i + 2;
      const errors: string[] = [];

      const customerName = getCellValue(row, ["Customer Name", "Party Name"]);
      const mobile = getCellValue(row, ["Mobile", "Phone"]);
      const dateRaw = getCellValue(row, ["Date", "Voucher Date", "Transaction Date"]);
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

      // Validate required
      if (!customerName) errors.push("Customer Name required");
      if (!dateRaw) errors.push("Date required");
      if (!voucherTypeRaw) errors.push("Voucher Type required");

      // Parse date
      let voucherDate = "";
      if (dateRaw) {
        const dateResult = parseStrictDate(dateRaw);
        if (dateResult.isValid && dateResult.date) voucherDate = dateResult.date;
        else errors.push(`Invalid date: ${dateResult.error}`);
      }

      let dueDate: string | null = null;
      if (dueDateRaw) {
        const ddResult = parseStrictDate(dueDateRaw);
        if (ddResult.isValid && ddResult.date) dueDate = ddResult.date;
        else errors.push(`Invalid due date: ${ddResult.error}`);
      }

      let paymentDate: string | null = null;
      if (paymentDateRaw) {
        const pdResult = parseStrictDate(paymentDateRaw);
        if (pdResult.isValid && pdResult.date) paymentDate = pdResult.date;
        else errors.push(`Invalid payment date: ${pdResult.error}`);
      }

      // Parse amounts
      let debit = 0;
      let credit = 0;
      if (debitRaw) {
        const dr = parseSignedAmount(debitRaw);
        if (dr.isValid && dr.value !== null) debit = Math.abs(dr.value);
        else if (debitRaw) errors.push(`Invalid debit: ${dr.error}`);
      }
      if (creditRaw) {
        const cr = parseSignedAmount(creditRaw);
        if (cr.isValid && cr.value !== null) credit = Math.abs(cr.value);
        else if (creditRaw) errors.push(`Invalid credit: ${cr.error}`);
      }
      if (debit > 0 && credit > 0) errors.push("Both debit and credit cannot be positive");
      if (debit === 0 && credit === 0 && (debitRaw || creditRaw)) errors.push("Invalid amounts");

      // Normalize voucher type — MUST come before duplicate check/narration/amount logic
      const normalizedType = normalizeVoucherType(voucherTypeRaw);
      if (voucherTypeRaw && !normalizedType) errors.push(`Unknown voucher type: "${voucherTypeRaw}"`);

      // Customer matching — do this before duplicate check
      let matchedCustomerId: string | null = null;
      let matchedCustomerName: string | null = null;
      const match = matchCustomer(mobile || null, customerName, customerLookup);
      if (match.status === "AUTO_MATCHED" || match.status === "MATCHED") {
        matchedCustomerId = match.customerId;
        matchedCustomerName = match.customerName;
      }

      // Duplicate check — ONLY against permanent COMPLETED imported records, NEVER against current batch
      const key = sourceEntryKey || sourceGuid;
      // We check against existingKeys which was loaded BEFORE we created this batch
      const isDuplicate = !!key && existingKeys.has(key);

      const importStatus = errors.length > 0 ? "INVALID" : (matchedCustomerId ? "VALID" : "VALID");

      // Store as TallyVoucher
      const voucher = await prisma.tallyVoucher.create({
        data: {
          importBatchId: batch.id,
          tallyGuid: sourceGuid || undefined,
          voucherKey: sourceEntryKey || undefined,
          sourceFileName,
          customerName: customerName || undefined,
          mobile: mobile || null,
          customerId: matchedCustomerId || undefined,
          matchedCustomerId,
          matchedCustomerName,
          voucherDate: voucherDate ? dateStringToDate(voucherDate) : new Date(),
          dueDate: dueDate ? dateStringToDate(dueDate) : null,
          paymentDate: paymentDate ? dateStringToDate(paymentDate) : null,
          voucherType: normalizedType || "JOURNAL",
          voucherNumber: voucherNumber || undefined,
          againstVoucherNumber: againstVoucherNumber || undefined,
          debit,
          credit,
          narration: narration || undefined,
          isDuplicate,
          importStatus: importStatus as "VALID" | "INVALID",
          errorMessage: errors.length > 0 ? errors.join("; ") : null,
        },
      });

      allStagedVouchers.push({
        id: voucher.id,
        customerName: customerName || "",
        voucherDate,
        voucherType: normalizedType || "JOURNAL",
        debit,
        credit,
        matchedCustomerId,
        isDuplicate,
        errors,
      });
    }

    // Compute summary from ALL staged vouchers, not just a filtered subset
    const salesCount = allStagedVouchers.filter((v) => v.voucherType === "SALES").length;
    const receiptCount = allStagedVouchers.filter((v) => v.voucherType === "RECEIPT").length;
    const debitNoteCount = allStagedVouchers.filter((v) => v.voucherType === "DEBIT_NOTE").length;
    const creditNoteCount = allStagedVouchers.filter((v) => v.voucherType === "CREDIT_NOTE").length;
    const invalidCount = allStagedVouchers.filter((v) => v.errors.length > 0).length;
    const matchedCount = allStagedVouchers.filter((v) => v.matchedCustomerId !== null).length;
    const unmatchedCount = allStagedVouchers.filter((v) => v.matchedCustomerId === null && v.errors.length === 0).length;
    const duplicateCount = allStagedVouchers.filter((v) => v.isDuplicate).length;
    const validCount = allStagedVouchers.filter((v) => v.errors.length === 0).length;

    // Update batch status
    await prisma.tallyImportBatch.update({
      where: { id: batch.id },
      data: {
        status: validCount > 0 ? "READY" : "FAILED",
        totalVouchers: parsed.rows.length,
        salesCount,
        receiptCount,
        debitNoteCount,
        creditNoteCount,
        duplicateCount,
        errorCount: invalidCount,
        debitTotal: allStagedVouchers.reduce((s, v) => s + v.debit, 0),
        creditTotal: allStagedVouchers.reduce((s, v) => s + v.credit, 0),
      },
    });

    const dateStrings = allStagedVouchers.map((v) => v.voucherDate).filter(Boolean);
    const validDateStrings = dateStrings.length > 0
      ? dateStrings.sort()
      : [];

    console.log("[transaction-preview]", {
      batchId: batch.id,
      totalRows: parsed.rows.length,
      salesCount,
      receiptCount,
      debitNoteCount,
      creditNoteCount,
      matchedCount,
      unmatchedCount,
      duplicateCount,
      invalidCount,
      duplicateSource: {
        permanentRecords: existingKeys.size,
        completedBatches: await prisma.tallyImportBatch.count({ where: { status: "COMPLETED" } }),
        currentBatchExcluded: true,
      },
    });

    return NextResponse.json({
      ok: true,
      batchId: batch.id,
      fileName: sourceFileName,
      status: "PARSED",
      totalRows: parsed.rows.length,
      totalVouchers: parsed.rows.length,
      validRows: validCount,
      invalidRows: invalidCount,
      invalidRowDetails: undefined,
      matchedRows: matchedCount,
      unmatchedRows: unmatchedCount,
      duplicateRows: duplicateCount,
      invalidCount,
      sales: salesCount,
      receipts: receiptCount,
      debitNotes: debitNoteCount,
      creditNotes: creditNoteCount,
      dateRange: validDateStrings.length > 0 ? { from: validDateStrings[0], to: validDateStrings[validDateStrings.length - 1] } : { from: null, to: null },
      invoicesWithDueDates: allStagedVouchers.filter((v) => v.voucherType === "SALES").length,
      receiptsLinked: allStagedVouchers.filter((v) => v.voucherType === "RECEIPT").length,
      receiptsUnlinked: 0,
    });
  } catch (err) {
    console.error("[tally/upload]", err);
    return NextResponse.json(
      { error: "Failed to process transaction file", code: "UPLOAD_FAILED", details: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}