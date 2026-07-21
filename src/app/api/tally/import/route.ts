import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { LedgerTransactionType, Prisma } from '@prisma/client';

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
  voucherDate: string;
  voucherType: 'SALES' | 'RECEIPT' | 'DEBIT_NOTE' | 'CREDIT_NOTE' | 'OPENING_BALANCE';
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
  return name.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
}

async function importVouchers(vouchers: TallyVoucherInput[], userId: string, batchId: string) {
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
    select: { id: true, fullName: true },
  });
  const nameIndex = new Map<string, string>();
  for (const c of allCustomers) {
    const key = normalizeName(c.fullName);
    if (!nameIndex.has(key)) nameIndex.set(key, c.id);
  }

  // Get existing GUIDs to avoid duplicates
  const existingGuids = new Set<string>();
  const guidVouchers = vouchers.filter(v => v.tallyGuid);
  if (guidVouchers.length > 0) {
    const existing = await prisma.tallyVoucher.findMany({
      where: { tallyGuid: { in: guidVouchers.map(v => v.tallyGuid as string) } },
      select: { tallyGuid: true },
    });
    for (const e of existing) {
      if (e.tallyGuid) existingGuids.add(e.tallyGuid);
    }
  }

  // Process in a transaction
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

        // Duplicate check
        if (v.tallyGuid && existingGuids.has(v.tallyGuid)) {
          results.duplicates++;
          continue;
        }

        // Match customer
        const normalizedInput = normalizeName(v.customerName);
        let customerId = nameIndex.get(normalizedInput);
        if (!customerId) {
          for (const [key, cid] of nameIndex) {
            if (key.includes(normalizedInput) || normalizedInput.includes(key)) {
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
          case 'SALES':
            ledgerType = 'CREDIT_SALE';
            amount = v.debit || 0;
            isDebit = true;
            break;
          case 'RECEIPT':
            ledgerType = 'PAYMENT_RECEIVED';
            amount = v.credit || 0;
            isDebit = false;
            break;
          case 'DEBIT_NOTE':
            ledgerType = 'ADJUSTMENT';
            amount = v.debit || 0;
            isDebit = true;
            break;
          case 'CREDIT_NOTE':
            ledgerType = 'RETURN_CREDIT';
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
            description: `Tally ${v.voucherType} — ${v.voucherNumber || v.narration || ''}`.trim(),
            createdAt: d,
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
            importStatus: 'CREATED',
            ledgerEntryId: ledgerEntry.id,
          },
        });

        results.imported++;
        results.importedIds.push(tallyVoucher.id);
        if (isDebit) results.debitTotal += amount;
        else results.creditTotal += amount;

        // Mark GUID as used (prevents duplicate in this same batch)
        if (v.tallyGuid) existingGuids.add(v.tallyGuid);

      } catch (err) {
        results.errors++;
        results.errorDetails.push(`Error processing ${v.customerName}/${v.voucherNumber}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Update batch record
    await tx.tallyImportBatch.update({
      where: { id: batchId },
      data: {
        totalVouchers: vouchers.length,
        salesCount: vouchers.filter(v => v.voucherType === 'SALES').length,
        receiptCount: vouchers.filter(v => v.voucherType === 'RECEIPT').length,
        debitNoteCount: vouchers.filter(v => v.voucherType === 'DEBIT_NOTE').length,
        creditNoteCount: vouchers.filter(v => v.voucherType === 'CREDIT_NOTE').length,
        duplicateCount: results.duplicates,
        skippedCount: results.skipped,
        errorCount: results.errors,
        debitTotal: results.debitTotal,
        creditTotal: results.creditTotal,
        status: results.errors > 0 ? 'PARTIALLY_COMPLETED' : 'COMPLETED',
        errorSummary: results.errorDetails.length > 0 ? { errors: results.errorDetails } : Prisma.JsonNull,
        completedAt: new Date(),
      },
    });
  });

  return results;
}

export async function POST(req: NextRequest) {
  const { auth, error } = await requireAuth(req);
  if (error) return error;

  const isExecute = req.nextUrl.searchParams.get('execute') === 'true';

  try {
    const body = await req.json();
    const vouchers: TallyVoucherInput[] = body.vouchers;
    if (!Array.isArray(vouchers) || vouchers.length === 0) {
      return NextResponse.json({ error: 'vouchers array is required and must not be empty' }, { status: 400 });
    }

    if (!isExecute) {
      // Dry-run: validate and report what would happen
      const existingGuids = new Set<string>();
      const guidList = vouchers.map(v => v.tallyGuid).filter(Boolean) as string[];
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
        if (!v.customerName || !v.voucherDate || !v.voucherType) { invalid++; continue; }
        if (v.tallyGuid && existingGuids.has(v.tallyGuid)) { duplicates++; continue; }

        const normalizedInput = normalizeName(v.customerName);
        let customerId = nameIndex.get(normalizedInput);
        if (!customerId) {
          for (const [, cid] of nameIndex) {
            if (normalizedInput.includes(cid)) { customerId = cid; break; }
          }
        }
        if (customerId) matched++;
        else unmatched++;
      }

      return NextResponse.json({
        dryRun: true,
        message: 'This is a dry run. Use ?execute=true to import.',
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

    // Execute: create batch and import
    const batch = await prisma.tallyImportBatch.create({
      data: {
        originalFileName: body.sourceFileName || 'tally-import.json',
        storedFileName: null,
        importedById: auth.userId,
        status: 'IMPORTING',
      },
    });

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
      errorDetails: result.errorDetails.length > 0 ? result.errorDetails : undefined,
    });
  } catch (err) {
    console.error('[POST /api/tally/import]', err);
    return NextResponse.json({ error: 'Server error during import' }, { status: 500 });
  }
}