#!/usr/bin/env tsx
/**
 * FIX IMPORTED VALUES — 100x Inflation Repair Script
 *
 * PROBLEM: parseSignedAmount() in amount-parser.ts used regex [₹Rs.,\s]
 * which removed the decimal point. "12500.00" became "1250000" (100x larger).
 *
 * FIX: All imported TallyVoucher records have amounts 100x too large.
 * This script divides them by 100 using fast SQL batch updates.
 *
 * Usage:
 *   npx tsx src/scripts/fix-imported-values.ts            # DRY RUN
 *   npx tsx src/scripts/fix-imported-values.ts --execute   # APPLY FIXES
 */

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();
const BACKUP_DIR = path.join(process.cwd(), "backups");

async function backupTable(tableName: string, data: unknown[]): Promise<string> {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const fp = path.join(BACKUP_DIR, `backup-${tableName}-${ts}.json`);
  fs.writeFileSync(fp, JSON.stringify(data, null, 2), "utf-8");
  return fp;
}

async function main() {
  const isExecute = process.argv.includes("--execute");
  console.log("═".repeat(60));
  console.log(`  FIX IMPORTED VALUES — Mode: ${isExecute ? "⚠️ EXECUTE" : "✅ DRY-RUN"}`);
  console.log("═".repeat(60));

  // ─── STEP 1: Find all imported TallyVouchers ──────────────────────
  console.log("\n  STEP 1: TallyVouchers...");
  const voucherCount = await prisma.tallyVoucher.count({ where: { importStatus: "IMPORTED" } });
  console.log(`  Found ${voucherCount} imported vouchers`);

  // ─── STEP 2: Find linked CreditLedger entries ─────────────────────
  console.log("\n  STEP 2: CreditLedger entries...");
  const vouchers = await prisma.tallyVoucher.findMany({
    where: { importStatus: "IMPORTED", ledgerEntryId: { not: null } },
    select: { ledgerEntryId: true },
  });
  const ledgerEntryIds = vouchers.map(v => v.ledgerEntryId).filter((id): id is string => id !== null);
  console.log(`  Found ${ledgerEntryIds.length} linked ledger entries`);

  // ─── STEP 3: Find linked Payments ─────────────────────────────────
  console.log("\n  STEP 3: Payment records...");
  const ledgerEntries = await prisma.creditLedger.findMany({
    where: { id: { in: ledgerEntryIds }, paymentId: { not: null } },
    select: { paymentId: true },
  });
  const paymentIds = ledgerEntries.map(e => e.paymentId!).filter(Boolean);
  console.log(`  Found ${paymentIds.length} linked payments`);

  // ─── STEP 4: Find linked Sales ────────────────────────────────────
  console.log("\n  STEP 4: Sale records...");
  const saleCount = await prisma.sale.count({
    where: {
      OR: [
        { invoiceNumber: { startsWith: "IMP-" } },
        { notes: { contains: "Imported", mode: "insensitive" } },
        { notes: { contains: "import", mode: "insensitive" } },
      ],
    },
  });
  console.log(`  Found ${saleCount} imported sales`);

  // ─── STEP 5: Find affected customers ──────────────────────────────
  console.log("\n  STEP 5: Customer records...");
  const customerIds = await prisma.tallyVoucher.findMany({
    where: { importStatus: "IMPORTED", customerId: { not: null } },
    select: { customerId: true },
    distinct: ["customerId"],
  });
  const cids = customerIds.map(c => c.customerId!).filter(Boolean);
  console.log(`  Found ${cids.length} affected customers`);

  // ─── SUMMARY ──────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(60));
  console.log("  SUMMARY");
  console.log("═".repeat(60));
  console.log(`  Vouchers:     ${voucherCount}`);
  console.log(`  Ledger:       ${ledgerEntryIds.length}`);
  console.log(`  Payments:     ${paymentIds.length}`);
  console.log(`  Sales:        ${saleCount}`);
  console.log(`  Customers:    ${cids.length}`);

  if (!isExecute) {
    console.log("\n  ⚠️  DRY-RUN. Use --execute to apply.");
    console.log("  npx tsx src/scripts/fix-imported-values.ts --execute");
    await prisma.$disconnect();
    return;
  }

  // ─── EXECUTE ──────────────────────────────────────────────────────
  console.log("\n" + "─".repeat(60));
  console.log("  EXECUTING FIXES...");
  console.log("─".repeat(60));

  // Backup
  console.log("\n  Backing up...");
  const bCustomers = await prisma.customer.findMany({ where: { id: { in: cids } } });
  const bSales = await prisma.sale.findMany({ where: { invoiceNumber: { startsWith: "IMP-" } } });
  const bPayments = await prisma.payment.findMany({ where: { id: { in: paymentIds } } });
  const bLedger = await prisma.creditLedger.findMany({ where: { id: { in: ledgerEntryIds } } });
  const bVouchers = await prisma.tallyVoucher.findMany({ where: { importStatus: "IMPORTED" } });
  const files = [
    await backupTable("Customer", bCustomers),
    await backupTable("Sale", bSales),
    await backupTable("Payment", bPayments),
    await backupTable("CreditLedger", bLedger),
    await backupTable("TallyVoucher", bVouchers),
  ];
  console.log(`  Backups: ${files.join(", ")}`);

  // 1. Fix TallyVouchers — batch SQL update
  console.log("\n  1. Fixing TallyVouchers...");
  const r1 = await prisma.$executeRawUnsafe(`
    UPDATE "TallyVoucher"
    SET debit = debit / 100,
        credit = credit / 100
    WHERE "importStatus" = 'IMPORTED'
      AND (debit > 0 OR credit > 0)
  `);
  console.log(`     ✓ Fixed ${r1} vouchers`);

  // 2. Fix Sales — batch SQL update
  console.log("\n  2. Fixing Sales...");
  const r2 = await prisma.$executeRawUnsafe(`
    UPDATE "Sale"
    SET subtotal = subtotal / 100,
        "grandTotal" = "grandTotal" / 100,
        "paidAmount" = "paidAmount" / 100,
        "pendingAmount" = "pendingAmount" / 100
    WHERE "invoiceNumber" LIKE 'IMP-%'
       OR notes ILIKE '%Imported%'
       OR notes ILIKE '%import%'
  `);
  console.log(`     ✓ Fixed ${r2} sales`);

  // 3. Fix CreditLedger — batch SQL update
  console.log("\n  3. Fixing CreditLedger...");
  const r3 = await prisma.$executeRawUnsafe(`
    UPDATE "CreditLedger"
    SET amount = amount / 100,
        "balanceAfter" = "balanceAfter" / 100
    WHERE id = ANY($1::text[])
  `, [ledgerEntryIds]);
  console.log(`     ✓ Fixed ${r3} ledger entries`);

  // 4. Fix Payments — batch SQL update
  console.log("\n  4. Fixing Payments...");
  const r4 = await prisma.$executeRawUnsafe(`
    UPDATE "Payment"
    SET amount = amount / 100
    WHERE id = ANY($1::text[])
  `, [paymentIds]);
  console.log(`     ✓ Fixed ${r4} payments`);

  // 5. Recalculate Customer balances from scratch
  console.log("\n  5. Recalculating Customer balances...");
  for (const cid of cids) {
    const customer = await prisma.customer.findUnique({
      where: { id: cid },
      select: { openingBalance: true },
    });
    if (!customer) continue;

    const ob = Number(customer.openingBalance);
    const fixedOB = ob > 0 ? Math.round(ob * 100) / 10000 : ob;

    const entries = await prisma.creditLedger.findMany({
      where: { customerId: cid },
      select: { transactionType: true, amount: true },
      orderBy: { createdAt: "asc" },
    });

    let bal = fixedOB;
    for (const e of entries) {
      const amt = Number(e.amount);
      if (["CREDIT_SALE", "PAYMENT_REVERSAL", "ADJUSTMENT"].includes(e.transactionType)) bal += amt;
      else if (["PAYMENT_RECEIVED", "SALE_CANCELLED", "RETURN_CREDIT"].includes(e.transactionType)) bal -= amt;
    }

    await prisma.customer.update({
      where: { id: cid },
      data: {
        openingBalance: fixedOB,
        currentBalance: Math.max(0, Math.round(bal * 100) / 100),
      },
    });
  }
  console.log(`     ✓ Recalculated ${cids.length} customer balances`);

  // ─── VERIFICATION ─────────────────────────────────────────────────
  console.log("\n" + "═".repeat(60));
  console.log("  VERIFICATION");
  console.log("═".repeat(60));

  const { getTotalPendingCredit, getTotalOverdue } = await import("../lib/accounting");
  const pc = await getTotalPendingCredit();
  const od = await getTotalOverdue();
  console.log(`  Pending Credit: ₹${Number(pc.total).toFixed(2)} (${pc.count} customers)`);
  console.log(`  Overdue Total:  ₹${Number(od.total).toFixed(2)} (${od.count} customers)`);

  // Count last 30 days payments
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const recentPayments = await prisma.payment.findMany({
    where: { paymentDate: { gte: thirtyDaysAgo }, status: "COMPLETED" },
    select: { amount: true },
  });
  const recentTotal = recentPayments.reduce((s, p) => s + Number(p.amount), 0);
  console.log(`  Last 30d Payments: ₹${recentTotal.toFixed(2)} (${recentPayments.length} receipts)`);

  // Count customers
  const activeCustomers = await prisma.customer.count({ where: { isActive: true, deletedAt: null } });
  console.log(`  Active Customers: ${activeCustomers}`);

  console.log("\n" + "═".repeat(60));
  console.log("  FIX COMPLETE");
  console.log("═".repeat(60));
  console.log("  Run: npm run build");

  await prisma.$disconnect();
}

main().catch((e) => { console.error("❌ Failed:", e); process.exit(1); });