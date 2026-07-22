import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { requireAuth } from '@/lib/auth';

/**
 * GET /api/tally/reconciliation?customerId=xxx
 * GET /api/tally/reconciliation (all customers)
 *
 * For every customer, calculate:
 *   expectedClosing = openingBalance + totalSalesDebit + totalDebitNotes
 *                     - totalReceiptsCredit - totalCreditNotes
 *
 * And compare against Tally source balance when available.
 * Produces a mismatch report.
 */

function toPaise(value: unknown): number {
  if (value == null) return 0;
  const f = parseFloat(String(value));
  if (!isFinite(f)) return 0;
  return Math.round(f * 100);
}

function fromPaise(paise: number): string {
  const rupees = Math.abs(paise) / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rupees);
}

export async function GET(req: NextRequest) {
  const { error } = await requireAuth(req);
  if (error) return error;

  const customerId = req.nextUrl.searchParams.get('customerId');

  try {
    // Build customer query
    const where: Prisma.CustomerWhereInput = {};
    if (customerId) {
      where.id = customerId;
    }

    const customers = await prisma.customer.findMany({
      where,
      select: {
        id: true,
        customerCode: true,
        fullName: true,
        mobile: true,
        openingBalance: true,
        currentBalance: true,
      },
      orderBy: { fullName: 'asc' },
    });

    // For each customer, compute expected closing
    const mismatches: Array<{
      customerCode: string;
      customerName: string;
      mobile: string;
      openingBalance: string;
      debitTotal: string;
      creditTotal: string;
      expectedClosing: string;
      storedCurrentBalance: string;
      difference: string;
      sourceClosing?: string;
    }> = [];

    const reconciled: Array<{
      customerCode: string;
      customerName: string;
      mobile: string;
      openingBalance: string;
      expectedClosing: string;
      storedCurrentBalance: string;
    }> = [];

    for (const c of customers) {
      // Get ledger transactions (non-OB)
      const ledgerEntries = await prisma.creditLedger.findMany({
        where: {
          customerId: c.id,
          transactionType: { not: 'OPENING_BALANCE' },
        },
        select: { transactionType: true, amount: true },
      });

      const openingPaise = toPaise(c.openingBalance);
      let debitPaise = 0;
      let creditPaise = 0;

      for (const l of ledgerEntries) {
        const amt = toPaise(l.amount);
        switch (l.transactionType) {
          case 'CREDIT_SALE':
          case 'PAYMENT_REVERSAL':
            debitPaise += amt;
            break;
          case 'PAYMENT_RECEIVED':
          case 'SALE_CANCELLED':
          case 'RETURN_CREDIT':
            creditPaise += amt;
            break;
          case 'ADJUSTMENT':
            // For ADJUSTMENT, check description or amount sign convention
            // Positive adjustments typically are debits
            debitPaise += amt;
            break;
          default:
            break;
        }
      }

      const expectedClosingPaise = openingPaise + debitPaise - creditPaise;
      const storedCurrentPaise = toPaise(c.currentBalance);

      // Check if Tally voucher data exists for this customer
      const tallyVouchers = await prisma.tallyVoucher.findMany({
        where: { customerId: c.id },
        select: { debit: true, credit: true },
      });
      let tallyClosingPaise: number | null = null;
      if (tallyVouchers.length > 0) {
        let tallyDebit = 0;
        let tallyCredit = 0;
        for (const tv of tallyVouchers) {
          tallyDebit += toPaise(tv.debit);
          tallyCredit += toPaise(tv.credit);
        }
        tallyClosingPaise = openingPaise + tallyDebit - tallyCredit;
      }

      const entry = {
        customerCode: c.customerCode,
        customerName: c.fullName,
        mobile: c.mobile,
        openingBalance: fromPaise(openingPaise),
        debitTotal: fromPaise(debitPaise),
        creditTotal: fromPaise(creditPaise),
        expectedClosing: fromPaise(expectedClosingPaise),
        storedCurrentBalance: fromPaise(storedCurrentPaise),
        difference: fromPaise(expectedClosingPaise - storedCurrentPaise),
        sourceClosing: tallyClosingPaise !== null ? fromPaise(tallyClosingPaise) : undefined,
      };

      if (expectedClosingPaise !== storedCurrentPaise) {
        mismatches.push(entry);
      } else {
        reconciled.push({
          customerCode: c.customerCode,
          customerName: c.fullName,
          mobile: c.mobile,
          openingBalance: fromPaise(openingPaise),
          expectedClosing: fromPaise(expectedClosingPaise),
          storedCurrentBalance: fromPaise(storedCurrentPaise),
        });
      }
    }

    return NextResponse.json({
      summary: {
        totalCustomers: customers.length,
        reconciled: reconciled.length,
        mismatched: mismatches.length,
      },
      reconciled: reconciled.slice(0, 50), // first 50
      mismatches,
    });
  } catch (err) {
    console.error('[GET /api/tally/reconciliation]', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}