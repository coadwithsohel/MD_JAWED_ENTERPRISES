import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';

/**
 * POST /api/tally/preview
 *
 * Accepts a JSON array of Tally vouchers for preview/validation.
 * Does NOT import anything — purely informational.
 *
 * Body: { vouchers: Array<{
 *   tallyGuid?: string
 *   tallyRemoteId?: string
 *   tallyMasterId?: string
 *   voucherKey?: string
 *   customerName: string
 *   voucherDate: string  (ISO date)
 *   voucherType: 'SALES' | 'RECEIPT' | 'DEBIT_NOTE' | 'CREDIT_NOTE' | 'OPENING_BALANCE'
 *   voucherNumber?: string
 *   debit?: number
 *   credit?: number
 *   narration?: string
 *   reference?: string
 *   sourceFileName?: string
 * }> }
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

export async function POST(req: NextRequest) {
  const { error } = await requireAuth(req);
  if (error) return error;

  try {
    const body = await req.json();
    const vouchers: TallyVoucherInput[] = body.vouchers;

    if (!Array.isArray(vouchers) || vouchers.length === 0) {
      return NextResponse.json({ error: 'vouchers array is required and must not be empty' }, { status: 400 });
    }

    // Find all customers (for matching)
    const allCustomers = await prisma.customer.findMany({
      select: { id: true, fullName: true, customerCode: true, mobile: true },
    });

    // Normalize customer names for fuzzy matching
    function normalizeName(name: string): string {
      return name.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
    }

    const nameIndex = new Map<string, typeof allCustomers[number]>();
    for (const c of allCustomers) {
      const key = normalizeName(c.fullName);
      if (!nameIndex.has(key)) {
        nameIndex.set(key, c);
      }
    }

    // Check for existing tally GUIDs
    const existingGuids = new Set<string>();
    if (vouchers.some(v => v.tallyGuid)) {
      const guids = vouchers.map(v => v.tallyGuid).filter(Boolean) as string[];
      const existing = await prisma.tallyVoucher.findMany({
        where: { tallyGuid: { in: guids } },
        select: { tallyGuid: true },
      });
      for (const e of existing) {
        if (e.tallyGuid) existingGuids.add(e.tallyGuid);
      }
    }

    // Process each voucher
    const matchedCustomers: Set<string> = new Set();
    const unmatchedCustomers: Set<string> = new Set();
    const salesVouchers: Array<{ customerName: string; amount: number; voucherNumber?: string }> = [];
    const receiptVouchers: Array<{ customerName: string; amount: number; voucherNumber?: string }> = [];
    let totalDebit = 0;
    let totalCredit = 0;
    let duplicateCount = 0;
    let invalidRows = 0;
    const customerClosings = new Map<string, { opening: number; debit: number; credit: number }>();

    for (const v of vouchers) {
      // Validate
      if (!v.customerName || !v.voucherDate || !v.voucherType) {
        invalidRows++;
        continue;
      }

      const d = new Date(v.voucherDate);
      if (isNaN(d.getTime())) {
        invalidRows++;
        continue;
      }

      const amt = (v.debit || 0) - (v.credit || 0);

      // Check duplicate
      if (v.tallyGuid && existingGuids.has(v.tallyGuid)) {
        duplicateCount++;
        continue;
      }

      // Match customer
      const normalizedInput = normalizeName(v.customerName);
      let matchedCustomer = nameIndex.get(normalizedInput);

      // Try partial match if exact fails
      if (!matchedCustomer) {
        for (const [key, cust] of nameIndex) {
          if (key.includes(normalizedInput) || normalizedInput.includes(key)) {
            matchedCustomer = cust;
            break;
          }
        }
      }

      if (matchedCustomer) {
        matchedCustomers.add(matchedCustomer.fullName);

        if (!customerClosings.has(matchedCustomer.id)) {
          const dbCustomer = await prisma.customer.findUnique({
            where: { id: matchedCustomer.id },
            select: { openingBalance: true },
          });
          const opening = dbCustomer ? Number(dbCustomer.openingBalance) : 0;
          customerClosings.set(matchedCustomer.id, { opening, debit: 0, credit: 0 });
        }

        const cl = customerClosings.get(matchedCustomer.id)!;

        if (v.voucherType === 'SALES' || v.voucherType === 'DEBIT_NOTE') {
          cl.debit += v.debit || 0;
          totalDebit += v.debit || 0;
          if (v.voucherType === 'SALES') {
            salesVouchers.push({ customerName: v.customerName, amount: v.debit || 0, voucherNumber: v.voucherNumber });
          }
        } else if (v.voucherType === 'RECEIPT' || v.voucherType === 'CREDIT_NOTE') {
          cl.credit += v.credit || 0;
          totalCredit += v.credit || 0;
          if (v.voucherType === 'RECEIPT') {
            receiptVouchers.push({ customerName: v.customerName, amount: v.credit || 0, voucherNumber: v.voucherNumber });
          }
        }
      } else {
        unmatchedCustomers.add(v.customerName);
      }
    }

    // Build expected closing report
    const expectedClosings = Array.from(customerClosings.entries()).map(([customerId, data]) => {
      const customer = allCustomers.find(c => c.id === customerId);
      return {
        customer: customer?.fullName || customerId,
        openingBalance: data.opening,
        debitTotal: data.debit,
        creditTotal: data.credit,
        expectedClosing: data.opening + data.debit - data.credit,
      };
    });

    return NextResponse.json({
      summary: {
        totalVouchers: vouchers.length,
        matchedCustomers: matchedCustomers.size,
        unmatchedCustomers: unmatchedCustomers.size,
        salesVouchers: salesVouchers.length,
        receiptVouchers: receiptVouchers.length,
        debitTotal: totalDebit,
        creditTotal: totalCredit,
        duplicateVouchers: duplicateCount,
        invalidRows,
      },
      matchedCustomerList: Array.from(matchedCustomers),
      unmatchedCustomerList: Array.from(unmatchedCustomers),
      salesVoucherList: salesVouchers.slice(0, 100), // preview max 100
      receiptVoucherList: receiptVouchers.slice(0, 100),
      expectedClosings,
      warnings: invalidRows > 0 ? [`${invalidRows} invalid rows found`] : [],
      ok: duplicateCount === 0 && invalidRows === 0,
    });
  } catch (err) {
    console.error('[POST /api/tally/preview]', err);
    return NextResponse.json({ error: 'Server error processing preview' }, { status: 500 });
  }
}