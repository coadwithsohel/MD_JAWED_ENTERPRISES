import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { LedgerTransactionType, Prisma } from "@prisma/client";

/**
 * POST /api/tally/import
 *
 * Imports validated Tally vouchers into both TallyVoucher records and CreditLedger.
 * Duplicate detection based on tallyGuid.
 * Dry-run by default — requires `?execute=true` to actually import.
 *
 * Body: { vouchers: TallyVoucherInput[], importBatchId?: string }
 */

interface TallyVoucherInput {
  tallyGuid?: string;
  tallyRemoteId?: string;
  tallyMasterId?: string;
  voucherKey?: string;
  customerName: string;
  mobile?: string;
  voucherDate: string;
  voucherType:
    | "SALES"
    | "RECEIPT"
    | "DEBIT_NOTE"
    | "CREDIT_NOTE"
    | "OPENING_BALANCE";
  voucherNumber?: string;
  debit?: number;
  credit?: number;
  narration?: string;
  reference?: string;
  sourceFileName?: string;
}

function toPaise(value: unknown): number {
  if (value == null) return 0;
  const f = parseFloat(String(value));
  if (!isFinite(f)) return 0;
  return Math.round(f * 100);
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function normalizeMobile(value: string): string {
  return value.replace(/\D/g, "").trim();
}

async function importVouchers(
  vouchers: TallyVoucherInput[],
  userId: string,
  batchId: string,
) {
  const results = {
    imported: 0,
    duplicates: 0,
    skipped: 0,
    errors: 0,
    errorDetails: [] as string[],
    importedIds: [] as string[],
    debitTotal: 0,
    creditTotal: 0,
  };

  // Get all customers for matching
  const allCustomers = await prisma.customer.findMany({
    select: { id: true, fullName: true, mobile: true },
  });
  const nameIndex = new Map<string, string>();
  const mobileIndex = new Map<string, string>();
  for (const c of allCustomers) {
    const key = normalizeName(c.fullName);
    if (!nameIndex.has(key)) nameIndex.set(key, c.id);
    if (c.mobile) {
      const mobileKey = normalizeMobile(c.mobile);
      if (!mobileIndex.has(mobileKey)) mobileIndex.set(mobileKey, c.id);
    }
  }

  const existingKeys = new Set<string>();
  const guidVouchers = vouchers.filter((v) => v.tallyGuid || v.voucherKey);
  if (guidVouchers.length > 0) {
    const existing = await prisma.tallyVoucher.findMany({
      where: {
        OR: [
          {
            voucherKey: {
              in: guidVouchers
                .map((v) => v.voucherKey)
                .filter(Boolean) as string[],
            },
          },
          {
            tallyGuid: {
              in: guidVouchers
                .map((v) => v.tallyGuid)
                .filter(Boolean) as string[],
            },
          },
        ],
      },
      select: { voucherKey: true, tallyGuid: true },
    });
    for (const e of existing) {
      if (e.voucherKey) existingKeys.add(e.voucherKey);
      if (e.tallyGuid) existingKeys.add(e.tallyGuid);
    }
  }

  // Process in a transaction
  const seenKeys = new Set<string>();

  await prisma.$transaction(async (tx) => {
    for (const v of vouchers) {
      try {
        // Validate
        if (!v.customerName || !v.voucherDate || !v.voucherType) {
          results.skipped++;
          continue;
        }
        const d = new Date(v.voucherDate);
        if (isNaN(d.getTime())) {
          results.skipped++;
          continue;
        }

        const sourceKey = v.voucherKey || v.tallyGuid;
        if (
          sourceKey &&
          (existingKeys.has(sourceKey) || seenKeys.has(sourceKey))
        ) {
          results.duplicates++;
          continue;
        }
        if (sourceKey) {
          seenKeys.add(sourceKey);
        }

        let customerId = undefined as string | undefined;
        if (v.mobile) {
          customerId = mobileIndex.get(normalizeMobile(v.mobile));
        }

        const normalizedInput = normalizeName(v.customerName);
        if (!customerId) {
          customerId = nameIndex.get(normalizedInput);
        }
        if (!customerId) {
          for (const [key, cid] of nameIndex) {
            if (
              key.includes(normalizedInput) ||
              normalizedInput.includes(key)
            ) {
              customerId = cid;
              break;
            }
          }
        }
        if (!customerId) {
          results.skipped++;
          results.errorDetails.push(`Customer not matched: ${v.customerName}`);
          continue;
        }

        // Map voucher type to ledger transaction type
        let ledgerType: string;
        let amount: number;
        let isDebit: boolean;

        switch (v.voucherType) {
          case "SALES":
            ledgerType = "CREDIT_SALE";
            amount = v.debit || 0;
            isDebit = true;
            break;
          case "RECEIPT":
            ledgerType = "PAYMENT_RECEIVED";
            amount = v.credit || 0;
            isDebit = false;
            break;
          case "DEBIT_NOTE":
            ledgerType = "ADJUSTMENT";
            amount = v.debit || 0;
            isDebit = true;
            break;
          case "CREDIT_NOTE":
            ledgerType = "RETURN_CREDIT";
            amount = v.credit || 0;
            isDebit = false;
            break;
          default:
            results.skipped++;
            continue;
        }

        if (amount <= 0) {
          results.skipped++;
          continue;
        }

        // Get customer's current balance for balanceAfter calculation
        const customer = await tx.customer.findUnique({
          where: { id: customerId },
          select: { currentBalance: true, openingBalance: true },
        });
        if (!customer) {
          results.skipped++;
          continue;
        }

        const currentPaise = toPaise(customer.currentBalance);
        const amountPaise = toPaise(amount);

        // Calculate new balance
        const newBalancePaise = isDebit
          ? currentPaise + amountPaise
          : currentPaise - amountPaise;
        const newBalance = newBalancePaise / 100;

        // Create CreditLedger entry
        const ledgerEntry = await tx.creditLedger.create({
          data: {
            customerId,
            transactionType: ledgerType as LedgerTransactionType,
            amount,
            balanceAfter: newBalance,
            description:
              `Tally ${v.voucherType} — ${v.voucherNumber || v.narration || ""}`.trim(),
            createdAt: d,
          },
        });

        await tx.customerLedgerTransaction.create({
          data: {
            customerId,
            transactionDate: d,
            voucherType: v.voucherType,
            voucherNumber: v.voucherNumber || null,
            particulars:
              `Tally ${v.voucherType} — ${v.voucherNumber || v.narration || ""}`.trim(),
            debit: isDebit ? amount : 0,
            credit: isDebit ? 0 : amount,
            sourceSystem: "TALLY",
            sourceGuid: v.tallyGuid || null,
            sourceRemoteId: v.tallyRemoteId || null,
            sourceVchKey: v.voucherKey || null,
            sourceMasterId: v.tallyMasterId || null,
            importBatchId: batchId,
          },
        });

        // Update customer currentBalance
        await tx.customer.update({
          where: { id: customerId },
          data: { currentBalance: newBalance },
        });

        // Create TallyVoucher record
        const tallyVoucher = await tx.tallyVoucher.create({
          data: {
            importBatchId: batchId,
            tallyGuid: v.tallyGuid || null,
            tallyRemoteId: v.tallyRemoteId || null,
            tallyMasterId: v.tallyMasterId || null,
            voucherKey: v.voucherKey || null,
            sourceFileName: v.sourceFileName || null,
            customerName: v.customerName,
            customerId,
            voucherDate: d,
            voucherType: v.voucherType,
            voucherNumber: v.voucherNumber || null,
            debit: isDebit ? amount : 0,
            credit: isDebit ? 0 : amount,
            narration: v.narration || null,
            reference: v.reference || null,
            importStatus: "CREATED",
            ledgerEntryId: ledgerEntry.id,
          },
        });

        results.imported++;
        results.importedIds.push(tallyVoucher.id);
        if (isDebit) results.debitTotal += amount;
        else results.creditTotal += amount;

        // Mark source key as used (prevents duplicate in this same batch)
        if (sourceKey) {
          existingKeys.add(sourceKey);
        }
      } catch (err) {
        results.errors++;
        results.errorDetails.push(
          `Error processing ${v.customerName}/${v.voucherNumber}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Update batch record
    await tx.tallyImportBatch.update({
      where: { id: batchId },
      data: {
        totalVouchers: vouchers.length,
        salesCount: vouchers.filter((v) => v.voucherType === "SALES").length,
        receiptCount: vouchers.filter((v) => v.voucherType === "RECEIPT")
          .length,
        debitNoteCount: vouchers.filter((v) => v.voucherType === "DEBIT_NOTE")
          .length,
        creditNoteCount: vouchers.filter((v) => v.voucherType === "CREDIT_NOTE")
          .length,
        duplicateCount: results.duplicates,
        skippedCount: results.skipped,
        errorCount: results.errors,
        debitTotal: results.debitTotal,
        creditTotal: results.creditTotal,
        status: results.errors > 0 ? "PARTIALLY_COMPLETED" : "COMPLETED",
        errorSummary:
          results.errorDetails.length > 0
            ? { errors: results.errorDetails }
            : Prisma.JsonNull,
        completedAt: new Date(),
      },
    });
  });

  return results;
}

export async function GET(req: NextRequest) {
  const { error } = await requireAuth(req);
  if (error) return error;

  try {
    const batches = await prisma.tallyImportBatch.findMany({
      select: {
        id: true,
        originalFileName: true,
        createdAt: true,
        status: true,
      },
      orderBy: [{ createdAt: "desc" }],
    });

    return NextResponse.json({ ok: true, batches });
  } catch (err) {
    console.error("[GET /api/tally/import]", err);
    return NextResponse.json(
      { error: "Unable to load import batches" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const { auth, error } = await requireAuth(req);
  if (error) return error;

  const isExecute = req.nextUrl.searchParams.get("execute") === "true";

  try {
    const body = await req.json().catch(() => ({}));
    const batchId = (body.batchId ||
      req.nextUrl.searchParams.get("batchId") ||
      "") as string;
    let vouchers: TallyVoucherInput[] = Array.isArray(body.vouchers)
      ? body.vouchers
      : [];

    if (!vouchers.length && batchId) {
      const persistedVouchers = await prisma.tallyVoucher.findMany({
        where: { importBatchId: batchId },
        select: {
          customerName: true,
          voucherDate: true,
          voucherType: true,
          voucherNumber: true,
          debit: true,
          credit: true,
          narration: true,
          reference: true,
          tallyGuid: true,
          tallyRemoteId: true,
          tallyMasterId: true,
          voucherKey: true,
        },
      });

      vouchers = persistedVouchers.map((voucher) => ({
        customerName: voucher.customerName || "",
        voucherDate: voucher.voucherDate.toISOString().slice(0, 10),
        voucherType: voucher.voucherType as TallyVoucherInput["voucherType"],
        voucherNumber: voucher.voucherNumber || undefined,
        debit: Number(voucher.debit) || 0,
        credit: Number(voucher.credit) || 0,
        narration: voucher.narration || undefined,
        reference: voucher.reference || undefined,
        tallyGuid: voucher.tallyGuid || undefined,
        tallyRemoteId: voucher.tallyRemoteId || undefined,
        tallyMasterId: voucher.tallyMasterId || undefined,
        voucherKey: voucher.voucherKey || undefined,
      }));
    }

    if (!Array.isArray(vouchers) || vouchers.length === 0) {
      return NextResponse.json(
        { error: "vouchers array is required and must not be empty" },
        { status: 400 },
      );
    }

    if (!isExecute) {
      // Dry-run: validate and report what would happen
      const existingGuids = new Set<string>();
      const guidList = vouchers
        .map((v) => v.tallyGuid)
        .filter(Boolean) as string[];
      if (guidList.length > 0) {
        const existing = await prisma.tallyVoucher.findMany({
          where: { tallyGuid: { in: guidList } },
          select: { tallyGuid: true },
        });
        for (const e of existing) {
          if (e.tallyGuid) existingGuids.add(e.tallyGuid);
        }
      }

      const allCustomers = await prisma.customer.findMany({
        select: { id: true, fullName: true },
      });
      const nameIndex = new Map<string, string>();
      for (const c of allCustomers) {
        const key = normalizeName(c.fullName);
        if (!nameIndex.has(key)) nameIndex.set(key, c.id);
      }

      let matched = 0;
      let unmatched = 0;
      let duplicates = 0;
      let invalid = 0;

      for (const v of vouchers) {
        if (!v.customerName || !v.voucherDate || !v.voucherType) {
          invalid++;
          continue;
        }
        if (v.tallyGuid && existingGuids.has(v.tallyGuid)) {
          duplicates++;
          continue;
        }

        const normalizedInput = normalizeName(v.customerName);
        let customerId = nameIndex.get(normalizedInput);
        if (!customerId) {
          for (const [, cid] of nameIndex) {
            if (normalizedInput.includes(cid)) {
              customerId = cid;
              break;
            }
          }
        }
        if (customerId) matched++;
        else unmatched++;
      }

      return NextResponse.json({
        dryRun: true,
        message: "This is a dry run. Use ?execute=true to import.",
        summary: {
          total: vouchers.length,
          matched,
          unmatched,
          duplicates,
          invalid,
          valid: vouchers.length - unmatched - duplicates - invalid,
        },
      });
    }

    // Execute: reuse uploaded batch when available, otherwise create a new one
    let batch = null;
    if (batchId) {
      batch = await prisma.tallyImportBatch.findUnique({
        where: { id: batchId },
        select: { id: true },
      });
    }

    if (!batch) {
      batch = await prisma.tallyImportBatch.create({
        data: {
          originalFileName: body.sourceFileName || "tally-import.json",
          storedFileName: null,
          importedById: auth.userId,
          status: "IMPORTING",
        },
      });
    }

    const result = await importVouchers(vouchers, auth.userId, batch.id);

    return NextResponse.json({
      success: true,
      importBatchId: batch.id,
      imported: result.imported,
      duplicates: result.duplicates,
      skipped: result.skipped,
      errors: result.errors,
      debitTotal: result.debitTotal,
      creditTotal: result.creditTotal,
      errorDetails:
        result.errorDetails.length > 0 ? result.errorDetails : undefined,
    });
  } catch (err) {
    console.error("[POST /api/tally/import]", err);
    return NextResponse.json(
      { error: "Server error during import" },
      { status: 500 },
    );
  }
}
