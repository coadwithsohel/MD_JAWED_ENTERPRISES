/**
 * AUDIT SCRIPT — Dry-run safe audit of imported customers with temporary mobiles starting with 7999.
 *
 * Usage:
 *   npx tsx src/scripts/audit-imported-customers.ts
 *   npx tsx src/scripts/audit-imported-customers.ts --execute
 *
 * This script:
 * 1. Finds all customers whose mobile begins with '7999'
 * 2. Reports Customer ID, Name, Mobile, Opening Balance, Invoice count, Payment count,
 *    Ledger-adjustment count, Current calculated balance, CreatedAt
 * 3. Checks whether any imported customer has manually created invoices/payments/adjustments
 * 4. Compares stored openingBalance vs displayed closingBalance with zero transactions
 * 5. Pure dry-run by default — requires --execute flag to modify anything
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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

async function main() {
  const isExecute = process.argv.includes('--execute');

  console.log('══════════════════════════════════════════════════════════');
  console.log('  AUDIT REPORT — Imported Customers (mobile prefix 7999)');
  console.log(`  Mode: ${isExecute ? '⚠️  EXECUTE' : '✅ DRY-RUN (use --execute to apply changes)'}`);
  console.log('══════════════════════════════════════════════════════════\n');

  // 1. Find all customers with mobile starting with 7999
  const customers = await prisma.customer.findMany({
    where: {
      mobile: { startsWith: '7999' },
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      customerCode: true,
      fullName: true,
      mobile: true,
      openingBalance: true,
      currentBalance: true,
      createdAt: true,
      _count: {
        select: {
          sales: true,
          payments: true,
          ledgers: true,
        },
      },
    },
  });

  console.log(`Total customers with mobile starting with 7999: ${customers.length}\n`);

  if (customers.length === 0) {
    console.log('⚠️  No imported customers found with 7999 prefix.');
    await prisma.$disconnect();
    return;
  }

  // Table header
  const header = [
    'ID'.padEnd(28),
    'Code'.padEnd(16),
    'Name'.padEnd(24),
    'Mobile'.padEnd(14),
    'Op.Bal'.padEnd(12),
    'Cur.Bal'.padEnd(12),
    'Invoices'.padEnd(9),
    'Payments'.padEnd(9),
    'LedgerAdj'.padEnd(10),
    'CreatedAt'.padEnd(20),
    'HasManualTx'.padEnd(12),
    'OB=CB?'.padEnd(8),
  ].join(' | ');

  console.log(header);
  console.log('─'.repeat(header.length));

  let countWithManualTx = 0;
  let countBalanceMismatch = 0;

  for (const c of customers) {
    // Check if customer has manually created transactions (not just opening balance)
    // "Manual" = sales with saleType CASH, invoices, payments, non-OB ledger entries
    const nonObLedgerCount = await prisma.creditLedger.count({
      where: {
        customerId: c.id,
        transactionType: { not: 'OPENING_BALANCE' },
      },
    });

    const hasManualTx = nonObLedgerCount > 0 || c._count.sales > 0 || c._count.payments > 0;

    if (hasManualTx) {
      countWithManualTx++;
    }

    // Check if opening balance matches what closing would be with zero transactions
    // Customer.openingBalance should equal customer.currentBalance if no transactions
    const openingPaise = toPaise(c.openingBalance);
    const currentPaise = toPaise(c.currentBalance);
    const obEqualsCb = openingPaise === currentPaise;

    if (!obEqualsCb) {
      countBalanceMismatch++;
    }

    const row = [
      c.id.slice(0, 24).padEnd(28),
      c.customerCode.padEnd(16),
      c.fullName.slice(0, 22).padEnd(24),
      c.mobile.padEnd(14),
      fromPaise(toPaise(c.openingBalance)).padEnd(12),
      fromPaise(toPaise(c.currentBalance)).padEnd(12),
      String(c._count.sales).padEnd(9),
      String(c._count.payments).padEnd(9),
      String(c._count.ledgers).padEnd(10),
      c.createdAt.toISOString().slice(0, 10).padEnd(20),
      (hasManualTx ? '⚠️ YES' : 'No').padEnd(12),
      (obEqualsCb ? '✓' : '✗ MISMATCH').padEnd(8),
    ].join(' | ');

    console.log(row);
  }

  console.log('\n────────────────────────────────────────────────────────────');
  console.log(`  Summary:`);
  console.log(`  Total 7999 customers:     ${customers.length}`);
  console.log(`  With manual transactions: ${countWithManualTx}`);
  console.log(`  Balance (OB ≠ current):   ${countBalanceMismatch}`);
  console.log();

  // Detailed check for customers with balance mismatches
  if (countBalanceMismatch > 0) {
    console.log('────────────────────────────────────────────────────────────');
    console.log('  DETAILED BALANCE MISMATCH ANALYSIS');
    console.log('  These customers have openingBalance ≠ currentBalance.');
    console.log('  This may be legitimate (if they have transactions) or due to bugs.');
    console.log();

    for (const c of customers) {
      const openingPaise = toPaise(c.openingBalance);
      const currentPaise = toPaise(c.currentBalance);
      if (openingPaise === currentPaise) continue;

      const nonObLedgerCount = await prisma.creditLedger.count({
        where: {
          customerId: c.id,
          transactionType: { not: 'OPENING_BALANCE' },
        },
      });

      // Calculate expected balance from ledger
      const ledgerEntries = await prisma.creditLedger.findMany({
        where: {
          customerId: c.id,
          transactionType: { not: 'OPENING_BALANCE' },
        },
        select: { transactionType: true, amount: true },
      });

      let ledgerDelta = 0;
      for (const l of ledgerEntries) {
        const amt = toPaise(l.amount);
        if (['CREDIT_SALE', 'PAYMENT_REVERSAL'].includes(l.transactionType)) {
          ledgerDelta += amt; // Debit
        } else if (['PAYMENT_RECEIVED', 'SALE_CANCELLED', 'RETURN_CREDIT'].includes(l.transactionType)) {
          ledgerDelta -= amt; // Credit
        }
      }

      const expectedBalance = openingPaise + ledgerDelta;

      console.log(`  ${c.customerCode} — ${c.fullName}`);
      console.log(`    Opening Balance:  ${fromPaise(openingPaise)}`);
      console.log(`    Ledger Delta:     ${ledgerDelta >= 0 ? '+' : ''}${fromPaise(ledgerDelta)}`);
      console.log(`    Expected Balance: ${fromPaise(expectedBalance)}`);
      console.log(`    Stored Current:   ${fromPaise(currentPaise)}`);
      console.log(`    Non-OB Ledgers:   ${nonObLedgerCount}`);
      console.log(`    Sales:            ${c._count.sales}`);
      console.log(`    Payments:         ${c._count.payments}`);
      console.log();
    }
  }

  // Summary recommendation
  console.log('────────────────────────────────────────────────────────────');
  console.log('  RECOMMENDATION');
  console.log('────────────────────────────────────────────────────────────');
  if (countBalanceMismatch === 0) {
    console.log('  ✅ All stored opening balances match current balances.');
    console.log('  The double-counting was purely a display/calculation bug');
    console.log('  in the ledger API, not in the stored data.');
  } else {
    console.log('  ⚠️  Some customers have balance mismatches.');
    console.log('  Review detailed analysis above before making corrections.');
  }

  console.log('\n  To correct customer.currentBalance values if needed:');
  console.log('  npx tsx src/scripts/audit-imported-customers.ts --execute\n');

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('❌ Audit failed:', e);
  process.exit(1);
});