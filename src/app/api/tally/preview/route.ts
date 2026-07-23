/**
 * POST /api/tally/preview
 *
 * Generates a detailed preview of a transaction import batch.
 * Fixed: duplicate detection excludes current batch, case-insensitive voucher type normalization.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { matchCustomer, buildCustomerLookup } from "@/features/import-export/matching";
import { normalizeMobile } from "@/features/import-export/amount-parser";

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
  const { error } = await requireAuth(req);
  if (error) return error;

  try {
    const body = await req.json().catch(() => ({}));
    const batchId = (body.batchId || req.nextUrl.searchParams.get("batchId") || "") as string;

    // Load persisted vouchers from DB
    const persistedVouchers = await prisma.tallyVoucher.findMany({
      where: { importBatchId: batchId },
      select: {
        id: true,
        customerName: true,
        mobile: true,
        voucherDate: true,
        dueDate: true,
        paymentDate: true,
        voucherType: true,
        voucherNumber: true,
        againstVoucherNumber: true,
        debit: true,
        credit: true,
        narration: true,
        reference: true,
        tallyGuid: true,
        tallyRemoteId: true,
        tallyMasterId: true,
        voucherKey: true,
        sourceFileName: true,
        isDuplicate: true,
        importStatus: true,
        errorMessage: true,
        matchedCustomerId: true,
        matchedCustomerName: true,
      },
      orderBy: { createdAt: "asc" },
    });

    if (!persistedVouchers.length) {
      return NextResponse.json(
        { error: "No vouchers found for this batch" },
        { status: 400 },
      );
    }

    // Load customers for matching
    const allCustomers = await prisma.customer.findMany({
      select: { id: true, fullName: true, customerCode: true, mobile: true, normalizedMobile: true },
    });
    const customerLookup = buildCustomerLookup(allCustomers);

    // Get existing keys for duplicate detection — ONLY from COMPLETED/IMPORTED records, NOT current batch
    const existingVouchers = await prisma.tallyVoucher.findMany({
      select: { voucherKey: true, tallyGuid: true, tallyRemoteId: true, tallyMasterId: true },
      where: {
        importBatchId: { not: batchId },
        importStatus: "IMPORTED",
      },
    });
    const existingKeys = new Set<string>();
    for (const v of existingVouchers) {
      if (v.voucherKey) existingKeys.add(v.voucherKey);
      if (v.tallyGuid) existingKeys.add(v.tallyGuid);
      if (v.tallyRemoteId) existingKeys.add(v.tallyRemoteId);
      if (v.tallyMasterId) existingKeys.add(v.tallyMasterId);
    }

    const matchedCustomersMap = new Map<string, {
      customerId: string;
      customerName: string;
      customerCode: string;
      vouchers: number;
    }>();
    const unmatchedCustomerNames: string[] = [];
    const duplicateVouchers: Array<{
      customerName: string;
      voucherNumber?: string;
      voucherDate: string;
    }> = [];
    const salesVouchers: Array<{ customerName: string; amount: number; voucherNumber?: string }> = [];
    const receiptVouchers: Array<{ customerName: string; amount: number; voucherNumber?: string }> = [];
    const customerClosings = new Map<string, { opening: number; debit: number; credit: number }>();
    let duplicateCount = 0;
    let invalidCount = 0;
    const seenKeysInBatch = new Set<string>();

    for (const voucher of persistedVouchers) {
      // Skip rows that were already marked as invalid by upload
      if (voucher.importStatus === "INVALID") {
        invalidCount++;
        continue;
      }

      const normalizedType = normalizeVoucherType(voucher.voucherType || "");
      const effectiveType = normalizedType || voucher.voucherType;

      // Duplicate detection against permanent COMPLETED records
      const sourceKey = voucher.voucherKey || voucher.tallyGuid || voucher.tallyRemoteId || voucher.tallyMasterId;
      let isDuplicate = false;
      if (sourceKey) {
        if (existingKeys.has(sourceKey) || seenKeysInBatch.has(sourceKey)) {
          isDuplicate = true;
        }
        seenKeysInBatch.add(sourceKey);
      }

      if (isDuplicate) {
        duplicateCount++;
        duplicateVouchers.push({
          customerName: voucher.customerName || "",
          voucherNumber: voucher.voucherNumber || undefined,
          voucherDate: voucher.voucherDate.toISOString().slice(0, 10),
        });
        continue;
      }

      // Customer matching
      let matchedCustomer: (typeof allCustomers)[number] | undefined;
      if (voucher.mobile) {
        const normalizedMob = normalizeMobile(voucher.mobile);
        if (normalizedMob) {
          matchedCustomer = allCustomers.find(
            (c) => c.mobile === normalizedMob || c.normalizedMobile === normalizedMob,
          );
        }
      }
      if (!matchedCustomer && voucher.customerName) {
        const normalizedName = voucher.customerName.toLowerCase().replace(/[^a-z0-9]/g, "");
        matchedCustomer = allCustomers.find(
          (c) => c.fullName.toLowerCase().replace(/[^a-z0-9]/g, "") === normalizedName,
        );
      }
      if (!matchedCustomer && voucher.customerName) {
        const normalizedName = voucher.customerName.toLowerCase().replace(/[^a-z0-9]/g, "");
        matchedCustomer = allCustomers.find((c) =>
          c.fullName.toLowerCase().replace(/[^a-z0-9]/g, "").includes(normalizedName) ||
          normalizedName.includes(c.fullName.toLowerCase().replace(/[^a-z0-9]/g, "")),
        );
      }

      if (matchedCustomer) {
        const existing = matchedCustomersMap.get(matchedCustomer.id);
        if (existing) {
          existing.vouchers += 1;
        } else {
          matchedCustomersMap.set(matchedCustomer.id, {
            customerId: matchedCustomer.id,
            customerName: matchedCustomer.fullName,
            customerCode: matchedCustomer.customerCode,
            vouchers: 1,
          });
        }

        if (!customerClosings.has(matchedCustomer.id)) {
          const dbCustomer = await prisma.customer.findUnique({
            where: { id: matchedCustomer.id },
            select: { openingBalance: true },
          });
          customerClosings.set(matchedCustomer.id, {
            opening: dbCustomer ? Number(dbCustomer.openingBalance) : 0,
            debit: 0,
            credit: 0,
          });
        }

        const closing = customerClosings.get(matchedCustomer.id)!;
        if (effectiveType === "SALES" || effectiveType === "DEBIT_NOTE") {
          closing.debit += Number(voucher.debit) || 0;
          if (effectiveType === "SALES") {
            salesVouchers.push({
              customerName: voucher.customerName || "",
              amount: Number(voucher.debit) || 0,
              voucherNumber: voucher.voucherNumber || undefined,
            });
          }
        } else if (effectiveType === "RECEIPT" || effectiveType === "CREDIT_NOTE") {
          closing.credit += Number(voucher.credit) || 0;
          if (effectiveType === "RECEIPT") {
            receiptVouchers.push({
              customerName: voucher.customerName || "",
              amount: Number(voucher.credit) || 0,
              voucherNumber: voucher.voucherNumber || undefined,
            });
          }
        }
      } else {
        unmatchedCustomerNames.push(voucher.customerName || "");
      }
    }

    const matchedCustomers = Array.from(matchedCustomersMap.values()).sort(
      (a, b) => a.customerName.localeCompare(b.customerName),
    );
    const customerClosingsList = Array.from(customerClosings.entries()).map(
      ([customerId, data]) => {
        const customer = allCustomers.find((entry) => entry.id === customerId);
        return {
          customerId,
          customerName: customer?.fullName || customerId,
          openingBalance: data.opening,
          totalDebit: data.debit,
          totalCredit: data.credit,
          expectedClosing: data.opening + data.debit - data.credit,
        };
      },
    );

    console.info("[tally/preview] previewed", {
      batchId,
      totalVouchers: persistedVouchers.length,
      matchedCustomers: matchedCustomers.length,
      unmatchedCustomers: [...new Set(unmatchedCustomerNames)].length,
      duplicateCount,
      invalidCount,
      salesCount: salesVouchers.length,
      receiptCount: receiptVouchers.length,
    });

    return NextResponse.json({
      ok: true,
      batchId,
      totalVouchers: persistedVouchers.length,
      sales: salesVouchers.length,
      receipts: receiptVouchers.length,
      debitNotes: 0,
      creditNotes: 0,
      matchedCustomers,
      unmatchedCustomerNames: [...new Set(unmatchedCustomerNames)].sort(),
      duplicateCount,
      invalidCount,
      duplicateVouchers: duplicateVouchers.slice(0, 50),
      customerClosings: customerClosingsList.sort((a, b) =>
        a.customerName.localeCompare(b.customerName),
      ),
      sampleVouchers: persistedVouchers.slice(0, 20).map((v) => ({
        customerName: v.customerName,
        voucherDate: v.voucherDate.toISOString().slice(0, 10),
        voucherType: v.voucherType,
        voucherNumber: v.voucherNumber,
        debit: Number(v.debit),
        credit: Number(v.credit),
      })),
      summary: {
        totalVouchers: persistedVouchers.length,
        sales: salesVouchers.length,
        receipts: receiptVouchers.length,
        debitNotes: 0,
        creditNotes: 0,
        matchedCustomers: matchedCustomers.length,
        unmatchedCustomers: [...new Set(unmatchedCustomerNames)].length,
        debitTotal: salesVouchers.reduce((s, v) => s + v.amount, 0),
        creditTotal: receiptVouchers.reduce((s, v) => s + v.amount, 0),
        duplicateVouchers: duplicateCount,
        invalidRows: invalidCount,
      },
      warnings: invalidCount > 0 ? [`${invalidCount} invalid rows found`] : [],
    });
  } catch (err) {
    console.error("[tally/preview]", {
      message: err instanceof Error ? err.message : "Unknown error",
    });
    return NextResponse.json(
      { error: "Server error processing preview", details: "The preview could not be generated." },
      { status: 500 },
    );
  }
}