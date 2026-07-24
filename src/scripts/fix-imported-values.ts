#!/usr/bin/env tsx
/**
 * FIX IMPORTED VALUE SCRIPT
 *
 * PROBLEM: parseSignedAmount() in amount-parser.ts uses regex [₹Rs.,\s]
 * which removes the decimal point. So "12500.00" becomes "1250000" (100x larger).
 *
 * This script:
 * 1. Backs up affected data
 * 2. Identifies records scaled by exactly 100x
 * 3. Divides inflated amounts by 100 in:
 *    - Customer.openingBalance, Customer.currentBalance
 *    - Sale.grandTotal, Sale.subtotal, Sale.pendingAmount, Sale.paidAmount
 *    - Payment.amount
 *    - CreditLedger.amount, CreditLedger.balanceAfter
 *    - TallyVoucher.debit, TallyVoucher.credit
 * 4. Recalculates all financial totals
 *
 * Usage:
 *   npx tsx src/scripts/fix-imported-values.ts            # DRY RUN
 *   npx tsx src/scripts/fix-imported-values.ts --execute   # APPLY FIXES
 */

import { PrismaClient } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();
const BACKUP_DIR = path.join(process.cwd(), "backups");

interface FixReport {
  customersChecked: number;
  customersFixed: number;
  salesChecked: number;
  salesFixed: number;
  paymentsChecked: number;
  paymentsFixed: number;
  creditLedgerChecked: number;
  creditLedgerFixed: number;
  tallyVouchersChecked: number;
  tallyVouchersFixed: number;
}

/**
 * Check if a value is likely inflated by 100x.
 * CSV amounts come as "12500.00" — after the bug they become 1250000.
 * Original amount would be 12500.00. Inflated = amount / 100 should be a round number
 * with at most 2 decimal places.
 */
function isDefinitelyInflated(value: Decimal | number | string): boolean {
  const num = Number(value);
  if (!isFinite(num) || num <= 0) return false;
  const divided = num / 100;
  const roundedToNearestPaise = Math.round(divided * 100) / 100;
  if (Math.abs(divided - roundedToNearestPaise) > 0.001) return false;
  return true;
}

function fixValue(value: Decimal | number | string): number {
  return Math.round(Number(value) * 100) / 10000; // Divide by 100
}

async function backupTable(tableName: string, data: unknown[]): Promise<string> {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(BACKUP_DIR, `backup-${tableName}-${timestamp}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  return filePath;
}

async function main() {
  const isExecute = process.argv.includes("--execute");

  console.log("══════════════════════════════════════════════════════════");
  console.log("  FIX IMPORTED VALUES — 100x Inflation Repair Script");
  console.log(`  Mode: ${isExecute ? "⚠️  EXECUTE" : "✅ DRY-RUN (use --execute to apply)"}`);
  console.log("══════════════════════════════════════════════════════════\n");

  const report: FixReport = {
    customersChecked: 0, customersFixed: 0,
    salesChecked: 0, salesFixed: 0,
    paymentsChecked: 0, paymentsFixed: 0,
    creditLedgerChecked: 0, creditLedgerFixed: 0,
    tallyVouchersChecked: 0, tallyVouchersFixed: 0,
  };

  // ═══════════════════════════════════════════════════
  // STEP 1: Find all imported TallyVouchers
  // ═══════════════════════════════════════════════════
  console.log("─".repeat(60));
  console.log("  STEP 1: Checking TallyVoucher amounts...");
  console.log("─".repeat(60));

  const importedVouchers = await prisma.tallyVoucher.findMany({
    where: { importStatus: "IMPORTED" },
    select: { id: true, debit: true, credit: true, voucherType: true, voucherNumber: true, customerName: true, customerId: true, importBatchId: true, ledgerEntryId: true },
  });
  report.tallyVouchersChecked = importedVouchers.length;

  const inflatedVouchers: Array<{ id: string; field: string; oldValue: number; newValue: number }> = [];
  for (const v of importedVouchers) {
    const debitNum = Number(v.debit);
    const creditNum = Number(v.credit);
    if (debitNum > 0 && isDefinitelyInflated(debitNum)) {
      inflatedVouchers.push({ id: v.id, field: "debit", oldValue: debitNum, newValue: fixValue(debitNum) });
    }
    if (creditNum > 0 && isDefinitelyInflated(creditNum)) {
      inflatedVouchers.push({ id: v.id, field: "credit", oldValue: creditNum, newValue: fixValue(creditNum) });
    }
  }

  console.log(`  Checked ${importedVouchers.length} vouchers, found ${inflatedVouchers.length} inflated`);
  if (inflatedVouchers.length > 0) {
    for (const iv of inflatedVouchers.slice(0, 5)) {
      const v = importedVouchers.find((x) => x.id === iv.id)!;
      console.log(`    ${v.customerName} (${v.voucherType} ${v.voucherNumber || ""}): ${iv.field} ${Number(iv.oldValue / 100).toFixed(2)} → ${iv.newValue.toFixed(2)}`);
    }
  }
  console.log();

  // ═══════════════════════════════════════════════════
  // STEP 2: Check Sales created from imports
  // ═══════════════════════════════════════════════════
  console.log("─".repeat(60));
  console.log("  STEP 2: Checking Sale records...");
  console.log("─".repeat(60));

  const importedSales = await prisma.sale.findMany({
    where: {
      OR: [
        { invoiceNumber: { startsWith: "IMP-" } },
        { notes: { contains: "Imported", mode: "insensitive" } },
        { notes: { contains: "import", mode: "insensitive" } },
      ],
    },
    select: { id: true, invoiceNumber: true, customerId: true, subtotal: true, grandTotal: true, paidAmount: true, pendingAmount: true, notes: true },
  });
  report.salesChecked = importedSales.length;

  const fixedSales: Array<{ id: string; invoiceNumber: string; changes: Record<string, { old: number; new: number }> }> = [];
  for (const sale of importedSales) {
    const changes: Record<string, { old: number; new: number }> = {};
    if (isDefinitelyInflated(sale.subtotal)) changes.subtotal = { old: Number(sale.subtotal), new: fixValue(sale.subtotal) };
    if (isDefinitelyInflated(sale.grandTotal)) changes.grandTotal = { old: Number(sale.grandTotal), new: fixValue(sale.grandTotal) };
    if (isDefinitelyInflated(sale.paidAmount)) changes.paidAmount = { old: Number(sale.paidAmount), new: fixValue(sale.paidAmount) };
    if (isDefinitelyInflated(sale.pendingAmount)) changes.pendingAmount = { old: Number(sale.pendingAmount), new: fixValue(sale.pendingAmount) };
    if (Object.keys(changes).length > 0) fixedSales.push({ id: sale.id, invoiceNumber: sale.invoiceNumber, changes });
  }

  console.log(`  Checked ${importedSales.length} sales, found ${fixedSales.length} inflated`);
  if (fixedSales.length > 0) {
    for (const fs of fixedSales.slice(0, 3)) {
      console.log(`    ${fs.invoiceNumber}:`);
      for (const [field, { old: o, new: n }] of Object.entries(fs.changes)) {
        console.log(`      ${field}: ${(o / 100).toFixed(2)} → ${n.toFixed(2)}`);
      }
    }
  }
  console.log();

  // ═══════════════════════════════════════════════════
  // STEP 3: Check CreditLedger records (must be before Payments)
  // ═══════════════════════════════════════════════════
  console.log("─".repeat(60));
  console.log("  STEP 3: Checking CreditLedger records...");
  console.log("─".repeat(60));

  // Find CreditLedger entries linked to imported TallyVouchers via ledgerEntryId
  const importedLedgerEntryIds = importedVouchers
    .map(v => v.ledgerEntryId)
    .filter((id): id is string => id !== null);

  // Also find by description pattern
  const creditLedgerEntries = await prisma.creditLedger.findMany({
    where: {
      OR: [
        { id: { in: importedLedgerEntryIds } },
        { description: { contains: "Import", mode: "insensitive" } },
        { description: { contains: "Imported", mode: "insensitive" } },
      ],
    },
    select: { id: true, customerId: true, transactionType: true, amount: true, balanceAfter: true, description: true, paymentId: true },
    orderBy: { createdAt: "asc" },
  });
  report.creditLedgerChecked = creditLedgerEntries.length;

  const fixedLedgerEntries: Array<{ id: string; changes: Record<string, { old: number; new: number }> }> = [];
  for (const entry of creditLedgerEntries) {
    const changes: Record<string, { old: number; new: number }> = {};
    if (isDefinitelyInflated(entry.amount)) changes.amount = { old: Number(entry.amount), new: fixValue(entry.amount) };
    if (isDefinitelyInflated(entry.balanceAfter)) changes.balanceAfter = { old: Number(entry.balanceAfter), new: fixValue(entry.balanceAfter) };
    if (Object.keys(changes).length > 0) fixedLedgerEntries.push({ id: entry.id, changes });
  }

  console.log(`  Checked ${creditLedgerEntries.length} entries, found ${fixedLedgerEntries.length} inflated`);
  if (fixedLedgerEntries.length > 0) {
    for (const fe of fixedLedgerEntries.slice(0, 3)) {
      console.log(`    Entry ${fe.id.slice(0, 8)}...:`);
      for (const [field, { old: o, new: n }] of Object.entries(fe.changes)) {
        console.log(`      ${field}: ${(o / 100).toFixed(2)} → ${n.toFixed(2)}`);
      }
    }
  }
  console.log();

  // ═══════════════════════════════════════════════════
  // STEP 4: Check Payment records from imports
  // ═══════════════════════════════════════════════════
  console.log("─".repeat(60));
  console.log("  STEP 4: Checking Payment records...");
  console.log("─".repeat(60));

  // Find payments linked to import CreditLedger entries
  const importPaymentIds = creditLedgerEntries
    .filter(e => e.paymentId)
    .map(e => e.paymentId!);

  const importedPayments = await prisma.payment.findMany({
    where: { id: { in: importPaymentIds } },
    select: { id: true, receiptNumber: true, customerId: true, amount: true, notes: true },
  });
  report.paymentsChecked = importedPayments.length;

  const fixedPayments: Array<{ id: string; receiptNumber: string; oldAmount: number; newAmount: number }> = [];
  for (const p of importedPayments) {
    if (isDefinitelyInflated(p.amount)) {
      fixedPayments.push({ id: p.id, receiptNumber: p.receiptNumber, oldAmount: Number(p.amount), newAmount: fixValue(p.amount) });
    }
  }

  console.log(`  Checked ${importedPayments.length} payments, found ${fixedPayments.length} inflated`);
  if (fixedPayments.length > 0) {
    for (const fp of fixedPayments.slice(0, 5)) {
      console.log(`    ${fp.receiptNumber}: ${(fp.oldAmount / 100).toFixed(2)} → ${fp.newAmount.toFixed(2)}`);
    }
  }
  console.log();

  // ═══════════════════════════════════════════════════
  // STEP 5: Check Customer balances
  // ═══════════════════════════════════════════════════
  console.log("─".repeat(60));
  console.log("  STEP 5: Checking Customer balances...");
  console.log("─".repeat(60));

  const tallyCustomerIds = [...new Set(importedVouchers.map((v) => v.customerId).filter(Boolean))] as string[];
  const ledgerCustomerIds = [...new Set(creditLedgerEntries.map((e) => e.customerId).filter(Boolean))] as string[];
  const importCustomerIds = new Set<string>([...tallyCustomerIds, ...ledgerCustomerIds]);

  const importedCustomers = await prisma.customer.findMany({
    where: { id: { in: [...importCustomerIds] } },
    select: { id: true, customerCode: true, fullName: true, openingBalance: true, currentBalance: true, mobile: true },
    orderBy: { createdAt: "asc" },
  });
  report.customersChecked = importedCustomers.length;

  const fixedCustomers: Array<{ id: string; customerCode: string; fullName: string; changes: Record<string, { old: number; new: number }> }> = [];
  for (const c of importedCustomers) {
    const changes: Record<string, { old: number; new: number }> = {};
    if (isDefinitelyInflated(c.openingBalance)) changes.openingBalance = { old: Number(c.openingBalance), new: fixValue(c.openingBalance) };
    if (isDefinitelyInflated(c.currentBalance)) changes.currentBalance = { old: Number(c.currentBalance), new: fixValue(c.currentBalance) };
    if (Object.keys(changes).length > 0) fixedCustomers.push({ id: c.id, customerCode: c.customerCode, fullName: c.fullName, changes });
  }

  console.log(`  Checked ${importedCustomers.length} customers, found ${fixedCustomers.length} with inflated balances`);
  if (fixedCustomers.length > 0) {
    for (const fc of fixedCustomers.slice(0, 5)) {
      console.log(`    ${fc.customerCode} — ${fc.fullName}:`);
      for (const [field, { old: o, new: n }] of Object.entries(fc.changes)) {
        console.log(`      ${field}: ${(o / 100).toFixed(2)} → ${n.toFixed(2)}`);
      }
    }
  }
  console.log();

  // ═══════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════
  console.log("═".repeat(60));
  console.log("  FIX SUMMARY");
  console.log("═".repeat(60));
  console.log(`  TallyVouchers: ${inflatedVouchers.length}/${report.tallyVouchersChecked}`);
  console.log(`  Sales:         ${fixedSales.length}/${report.salesChecked}`);
  console.log(`  CreditLedger:  ${fixedLedgerEntries.length}/${report.creditLedgerChecked}`);
  console.log(`  Payments:      ${fixedPayments.length}/${report.paymentsChecked}`);
  console.log(`  Customers:     ${fixedCustomers.length}/${report.customersChecked}`);
  console.log();

  if (!isExecute) {
    console.log("  ⚠️  DRY-RUN. Use --execute to apply fixes.");
    console.log("  npx tsx src/scripts/fix-imported-values.ts --execute");
    await prisma.$disconnect();
    return;
  }

  // ═══════════════════════════════════════════════════
  // EXECUTE FIXES
  // ═══════════════════════════════════════════════════
  console.log("─".repeat(60));
  console.log("  EXECUTING FIXES...");
  console.log("─".repeat(60));

  // Back up
  console.log("\n  Backing up data...");
  const backupCustomers = await prisma.customer.findMany({ where: { id: { in: [...importCustomerIds] } } });
  const backupSales = await prisma.sale.findMany({ where: { id: { in: fixedSales.map((s) => s.id) } } });
  const backupPayments = await prisma.payment.findMany({ where: { id: { in: fixedPayments.map((p) => p.id) } } });
  const backupLedger = await prisma.creditLedger.findMany({ where: { id: { in: fixedLedgerEntries.map((e) => e.id) } } });
  const backupVouchers = await prisma.tallyVoucher.findMany({ where: { id: { in: inflatedVouchers.map((v) => v.id) } } });

  const backupFiles: string[] = [];
  backupFiles.push(await backupTable("Customer", backupCustomers));
  backupFiles.push(await backupTable("Sale", backupSales));
  backupFiles.push(await backupTable("Payment", backupPayments));
  backupFiles.push(await backupTable("CreditLedger", backupLedger));
  backupFiles.push(await backupTable("TallyVoucher", backupVouchers));
  console.log(`  Backups: ${backupFiles.join(", ")}\n`);

  // 1. Fix TallyVouchers
  console.log("  Fixing TallyVouchers...");
  for (const iv of inflatedVouchers) {
    await prisma.tallyVoucher.update({ where: { id: iv.id }, data: { [iv.field]: iv.newValue } });
  }
  report.tallyVouchersFixed = inflatedVouchers.length;
  console.log(`    ✓ Fixed ${report.tallyVouchersFixed}`);

  // 2. Fix Sales
  console.log("  Fixing Sales...");
  for (const fs of fixedSales) {
    const updateData: Record<string, number> = {};
    for (const [field, { new: newVal }] of Object.entries(fs.changes)) updateData[field] = newVal;
    await prisma.sale.update({ where: { id: fs.id }, data: updateData });
  }
  report.salesFixed = fixedSales.length;
  console.log(`    ✓ Fixed ${report.salesFixed}`);

  // 3. Fix CreditLedger
  console.log("  Fixing CreditLedger...");
  for (const fe of fixedLedgerEntries) {
    const updateData: Record<string, number> = {};
    for (const [field, { new: newVal }] of Object.entries(fe.changes)) updateData[field] = newVal;
    await prisma.creditLedger.update({ where: { id: fe.id }, data: updateData });
  }
  report.creditLedgerFixed = fixedLedgerEntries.length;
  console.log(`    ✓ Fixed ${report.creditLedgerFixed}`);

  // 4. Fix Payments
  console.log("  Fixing Payments...");
  for (const fp of fixedPayments) {
    await prisma.payment.update({ where: { id: fp.id }, data: { amount: fp.newAmount } });
  }
  report.paymentsFixed = fixedPayments.length;
  console.log(`    ✓ Fixed ${report.paymentsFixed}`);

  // 5. Fix Customer balances — recalculate from scratch
  console.log("  Fixing Customer balances...");
  for (const fc of fixedCustomers) {
    const customer = await prisma.customer.findUnique({ where: { id: fc.id }, select: { openingBalance: true } });
    const fixedOpeningBalance = isDefinitelyInflated(customer?.openingBalance ?? 0)
      ? fixValue(customer!.openingBalance) : Number(customer?.openingBalance ?? 0);

    const ledgerEntries = await prisma.creditLedger.findMany({
      where: { customerId: fc.id },
      select: { transactionType: true, amount: true },
      orderBy: { createdAt: "asc" },
    });

    let calculatedBalance = fixedOpeningBalance;
    for (const entry of ledgerEntries) {
      const amt = Number(entry.amount);
      if (["CREDIT_SALE", "PAYMENT_REVERSAL", "ADJUSTMENT"].includes(entry.transactionType)) calculatedBalance += amt;
      else if (["PAYMENT_RECEIVED", "SALE_CANCELLED", "RETURN_CREDIT"].includes(entry.transactionType)) calculatedBalance -= amt;
    }

    const updateData: Record<string, number> = {};
    if (fc.changes.openingBalance) updateData.openingBalance = fc.changes.openingBalance.new;
    updateData.currentBalance = Math.max(0, calculatedBalance);
    await prisma.customer.update({ where: { id: fc.id }, data: updateData });
  }
  report.customersFixed = fixedCustomers.length;
  console.log(`    ✓ Fixed ${report.customersFixed}`);

  // ═══════════════════════════════════════════════════
  // VERIFICATION
  // ═══════════════════════════════════════════════════
  console.log("\n" + "═".repeat(60));
  console.log("  VERIFICATION");
  console.log("═".repeat(60));

  const verifyCustomers = await prisma.customer.findMany({
    where: { id: { in: [...importCustomerIds] } },
    select: { id: true, customerCode: true, fullName: true, openingBalance: true, currentBalance: true },
  });

  let anyRemaining = false;
  for (const c of verifyCustomers) {
    if (isDefinitelyInflated(c.openingBalance) || isDefinitelyInflated(c.currentBalance)) {
      console.log(`  ⚠️  ${c.customerCode} — ${c.fullName} still inflated! ob=${Number(c.openingBalance)} cb=${Number(c.currentBalance)}`);
      anyRemaining = true;
    }
  }
  if (!anyRemaining) console.log("  ✅ No remaining 100x inflation in customer balances");

  // Verify financial totals
  const { getTotalPendingCredit, getTotalOverdue } = await import("../lib/accounting");
  const pendingCredit = await getTotalPendingCredit();
  const overdue = await getTotalOverdue();
  console.log(`\n  Pending Credit: ₹${Number(pendingCredit.total).toFixed(2)} (${pendingCredit.count} customers)`);
  console.log(`  Overdue Total:  ₹${Number(overdue.total).toFixed(2)} (${overdue.count} customers)`);

  console.log("\n" + "═".repeat(60));
  console.log("  FIX COMPLETE");
  console.log("═".repeat(60));
  console.log(`  TallyVouchers: ${report.tallyVouchersFixed}`);
  console.log(`  Sales:         ${report.salesFixed}`);
  console.log(`  CreditLedger:  ${report.creditLedgerFixed}`);
  console.log(`  Payments:      ${report.paymentsFixed}`);
  console.log(`  Customers:     ${report.customersFixed}`);
  console.log(`  Backups: ${backupFiles.join(", ")}`);
  console.log("\n  ✅ Run `npm run build` to redeploy.");

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("❌ Fix script failed:", e);
  process.exit(1);
});