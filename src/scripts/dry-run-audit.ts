#!/usr/bin/env tsx
/**
 * DRY-RUN AUDIT — Inspect imported Tally amounts WITHOUT modifying the database.
 *
 * Purpose: Show exact current values for all imported data and compare with
 * expected source totals. This is a READ-ONLY inspection script.
 *
 * Usage:
 *   npx tsx src/scripts/dry-run-audit.ts
 *
 * The bug: parseSignedAmount() in amount-parser.ts used
 *   .replace(/[₹Rs,\s]/g, "")
 * which removed the decimal point '.' on line 67.
 * "12500.00" became "1250000" (100x larger).
 *
 * This script does NOT divide, multiply, or modify anything.
 * It just reads and reports exact database values.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("=".repeat(72));
  console.log("  DRY-RUN AUDIT — Imported Amount Inspection");
  console.log("  Mode: READ-ONLY — No changes will be made");
  console.log("=".repeat(72));

  // ─── 1. TALLY VOUCHERS ────────────────────────────────────────────
  console.log("\n" + "─".repeat(72));
  console.log("  SECTION 1: TallyVoucher (debit/credit)");
  console.log("─".repeat(72));

  const totalVouchers = await prisma.tallyVoucher.count();
  const importedVouchers = await prisma.tallyVoucher.count({ where: { importStatus: "IMPORTED" } });
  const validVouchers = await prisma.tallyVoucher.count({ where: { importStatus: { in: ["VALID", "PARSED", "MATCHED"] } } });
  const skippedVouchers = await prisma.tallyVoucher.count({ where: { importStatus: "SKIPPED" } });
  const failedVouchers = await prisma.tallyVoucher.count({ where: { importStatus: "FAILED" } });

  console.log(`  Total vouchers:       ${totalVouchers}`);
  console.log(`  Imported:             ${importedVouchers}`);
  console.log(`  Valid/staged:         ${validVouchers}`);
  console.log(`  Skipped:               ${skippedVouchers}`);
  console.log(`  Failed:                ${failedVouchers}`);

  // Debit/credit totals by status
  for (const status of ["IMPORTED", "VALID", "PARSED", "MATCHED", "FAILED", "SKIPPED"]) {
    const count = await prisma.tallyVoucher.count({ where: { importStatus: status as any } });
    if (count > 0) {
      const agg = await prisma.tallyVoucher.aggregate({
        where: { importStatus: status as any },
        _sum: { debit: true, credit: true },
      });
      console.log(`\n  [${status}] ${count} vouchers:`);
      console.log(`    Sum debit:  ${Number(agg._sum?.debit ?? 0).toFixed(2)}`);
      console.log(`    Sum credit: ${Number(agg._sum?.credit ?? 0).toFixed(2)}`);
    }
  }

  // Sample vouchers with high values
  console.log("\n  Top 10 highest debit vouchers (all statuses):");
  const topDebitVouchers = await prisma.tallyVoucher.findMany({
    where: { debit: { gt: 0 } },
    orderBy: { debit: "desc" },
    take: 10,
    select: {
      id: true,
      voucherType: true,
      voucherNumber: true,
      debit: true,
      credit: true,
      customerName: true,
      importStatus: true,
    },
  });
  for (const v of topDebitVouchers) {
    console.log(`    ${v.id.slice(0, 12)} | ${(v.voucherType ?? "").padEnd(16)} | debit=${Number(v.debit).toFixed(2)} | credit=${Number(v.credit).toFixed(2)} | ${(v.customerName ?? "?").padEnd(20)} | ${v.importStatus ?? "?"}`);
  }

  console.log("\n  Top 10 highest credit vouchers (all statuses):");
  const topCreditVouchers = await prisma.tallyVoucher.findMany({
    where: { credit: { gt: 0 } },
    orderBy: { credit: "desc" },
    take: 10,
    select: {
      id: true,
      voucherType: true,
      voucherNumber: true,
      debit: true,
      credit: true,
      customerName: true,
      importStatus: true,
    },
  });
  for (const v of topCreditVouchers) {
    console.log(`    ${v.id.slice(0, 12)} | ${(v.voucherType ?? "").padEnd(16)} | debit=${Number(v.debit).toFixed(2)} | credit=${Number(v.credit).toFixed(2)} | ${(v.customerName ?? "?").padEnd(20)} | ${v.importStatus ?? "?"}`);
  }

  // ─── 2. VOUCHER TYPE BREAKDOWN ─────────────────────────────────────
  console.log("\n" + "─".repeat(72));
  console.log("  SECTION 2: Voucher Type Breakdown (IMPORTED only)");
  console.log("─".repeat(72));

  const voucherTypes = await prisma.tallyVoucher.groupBy({
    by: ["voucherType"],
    where: { importStatus: "IMPORTED" },
    _count: true,
    _sum: { debit: true, credit: true },
  });
  for (const vt of voucherTypes) {
    console.log(`  ${(vt.voucherType ?? "NULL").padEnd(20)} | count=${vt._count} | sum_debit=${Number(vt._sum.debit ?? 0).toFixed(2)} | sum_credit=${Number(vt._sum.credit ?? 0).toFixed(2)}`);
  }

  // ─── 3. INVOICES (Sale) ────────────────────────────────────────────
  console.log("\n" + "─".repeat(72));
  console.log("  SECTION 3: Invoices (Sale)");
  console.log("─".repeat(72));

  const totalSales = await prisma.sale.count();
  const importedSales = await prisma.sale.count({
    where: {
      OR: [
        { invoiceNumber: { startsWith: "IMP-" } },
        { notes: { contains: "Imported", mode: "insensitive" } },
      ],
    },
  });
  const otherSales = totalSales - importedSales;

  console.log(`  Total sales:         ${totalSales}`);
  console.log(`  Imported sales:      ${importedSales}`);
  console.log(`  Other sales:         ${otherSales}`);

  // Sale aggregates
  const saleAgg = await prisma.sale.aggregate({
    _sum: { grandTotal: true, paidAmount: true, pendingAmount: true },
    _count: true,
  });
  console.log(`\n  All Sales aggregated:`);
  console.log(`    Sum grandTotal:    ${Number(saleAgg._sum.grandTotal ?? 0).toFixed(2)}`);
  console.log(`    Sum paidAmount:    ${Number(saleAgg._sum.paidAmount ?? 0).toFixed(2)}`);
  console.log(`    Sum pendingAmount: ${Number(saleAgg._sum.pendingAmount ?? 0).toFixed(2)}`);

  const importedSaleAgg = await prisma.sale.aggregate({
    where: {
      OR: [
        { invoiceNumber: { startsWith: "IMP-" } },
        { notes: { contains: "Imported", mode: "insensitive" } },
      ],
    },
    _sum: { grandTotal: true, paidAmount: true, pendingAmount: true },
    _count: true,
  });
  console.log(`\n  Imported Sales aggregated:`);
  console.log(`    Count:             ${importedSaleAgg._count}`);
  console.log(`    Sum grandTotal:    ${Number(importedSaleAgg._sum.grandTotal ?? 0).toFixed(2)}`);
  console.log(`    Sum paidAmount:    ${Number(importedSaleAgg._sum.paidAmount ?? 0).toFixed(2)}`);
  console.log(`    Sum pendingAmount: ${Number(importedSaleAgg._sum.pendingAmount ?? 0).toFixed(2)}`);

  // Top 10 highest imported sales
  console.log("\n  Top 10 highest imported sales:");
  const topSales = await prisma.sale.findMany({
    where: {
      OR: [
        { invoiceNumber: { startsWith: "IMP-" } },
        { notes: { contains: "Imported", mode: "insensitive" } },
      ],
    },
    orderBy: { grandTotal: "desc" },
    take: 10,
    select: {
      invoiceNumber: true,
      grandTotal: true,
      paidAmount: true,
      pendingAmount: true,
      paymentStatus: true,
    },
  });
  for (const s of topSales) {
    console.log(`    ${s.invoiceNumber.padEnd(20)} | grandTotal=${Number(s.grandTotal).toFixed(2).padStart(12)} | paid=${Number(s.paidAmount).toFixed(2).padStart(10)} | pending=${Number(s.pendingAmount).toFixed(2).padStart(10)} | ${s.paymentStatus}`);
  }

  // ─── 4. PAYMENTS ───────────────────────────────────────────────────
  console.log("\n" + "─".repeat(72));
  console.log("  SECTION 4: Payments");
  console.log("─".repeat(72));

  const paymentAgg = await prisma.payment.aggregate({
    _sum: { amount: true },
    _count: true,
  });
  console.log(`  Total payments:   ${paymentAgg._count}`);
  console.log(`  Sum amount:       ${Number(paymentAgg._sum.amount ?? 0).toFixed(2)}`);

  // Find payments linked to imported sales
  const importedPayments = await prisma.payment.findMany({
    where: {
      receiptNumber: { startsWith: "REC-IMP-" },
    },
    select: { id: true, receiptNumber: true, amount: true },
    orderBy: { amount: "desc" },
  });
  console.log(`\n  Imported payments (REC-IMP-*): ${importedPayments.length}`);
  const sumImportedPayments = importedPayments.reduce((s, p) => s + Number(p.amount), 0);
  console.log(`  Sum amount:       ${sumImportedPayments.toFixed(2)}`);

  // Top 10 highest payments
  console.log("\n  Top 10 highest payments (all):");
  const topPayments = await prisma.payment.findMany({
    orderBy: { amount: "desc" },
    take: 10,
    select: { receiptNumber: true, amount: true, paymentMode: true, status: true },
  });
  for (const p of topPayments) {
    console.log(`    ${p.receiptNumber.padEnd(20)} | amount=${Number(p.amount).toFixed(2).padStart(12)} | ${(p.paymentMode ?? "?").padEnd(14)} | ${p.status}`);
  }

  // ─── 5. CUSTOMER OPENING BALANCES ──────────────────────────────────
  console.log("\n" + "─".repeat(72));
  console.log("  SECTION 5: Customer Opening Balances");
  console.log("─".repeat(72));

  const customersWithOB = await prisma.customer.count({
    where: { openingBalance: { not: 0 } },
  });
  console.log(`  Customers with non-zero openingBalance: ${customersWithOB}`);

  const obAgg = await prisma.customer.aggregate({
    where: { openingBalance: { not: 0 } },
    _sum: { openingBalance: true, currentBalance: true },
    _count: true,
  });
  console.log(`  Sum openingBalance:  ${Number(obAgg._sum.openingBalance ?? 0).toFixed(2)}`);
  console.log(`  Sum currentBalance:  ${Number(obAgg._sum.currentBalance ?? 0).toFixed(2)}`);

  // Top 20 opening balances
  console.log("\n  Top 20 opening balances:");
  const topOBs = await prisma.customer.findMany({
    where: { openingBalance: { not: 0 } },
    orderBy: { openingBalance: "desc" },
    take: 20,
    select: {
      customerCode: true,
      fullName: true,
      openingBalance: true,
      currentBalance: true,
    },
  });
  for (const c of topOBs) {
    console.log(`    ${c.customerCode.padEnd(16)} | ${c.fullName.padEnd(25)} | openingBal=${Number(c.openingBalance).toFixed(2).padStart(12)} | currentBal=${Number(c.currentBalance).toFixed(2).padStart(12)}`);
  }

  // ─── 6. CUSTOMER CURRENT BALANCES ─────────────────────────────────
  console.log("\n" + "─".repeat(72));
  console.log("  SECTION 6: Customer Current Balances (non-zero)");
  console.log("─".repeat(72));

  const cbAgg = await prisma.customer.aggregate({
    where: { currentBalance: { not: 0 }, isActive: true, deletedAt: null },
    _sum: { currentBalance: true },
    _count: true,
  });
  console.log(`  Active customers with non-zero balance: ${cbAgg._count}`);
  console.log(`  Sum currentBalance:  ${Number(cbAgg._sum.currentBalance ?? 0).toFixed(2)}`);

  // ─── 7. CREDIT LEDGER (CreditLedger) ───────────────────────────────
  console.log("\n" + "─".repeat(72));
  console.log("  SECTION 7: CreditLedger");
  console.log("─".repeat(72));

  const ledgerAgg = await prisma.creditLedger.aggregate({
    _sum: { amount: true, balanceAfter: true },
    _count: true,
  });
  console.log(`  Total entries:      ${ledgerAgg._count}`);
  console.log(`  Sum amount:         ${Number(ledgerAgg._sum.amount ?? 0).toFixed(2)}`);
  console.log(`  Sum balanceAfter:   ${Number(ledgerAgg._sum.balanceAfter ?? 0).toFixed(2)}`);

  // Top 10 ledger entries
  const topLedger = await prisma.creditLedger.findMany({
    orderBy: { amount: "desc" },
    take: 10,
    select: {
      id: true,
      transactionType: true,
      amount: true,
      balanceAfter: true,
      description: true,
    },
  });
  console.log("\n  Top 10 highest ledger entries:");
  for (const l of topLedger) {
    console.log(`    ${l.id.slice(0, 12)} | ${l.transactionType.padEnd(18)} | amount=${Number(l.amount).toFixed(2).padStart(12)} | balAfter=${Number(l.balanceAfter).toFixed(2).padStart(12)} | ${(l.description ?? "").slice(0, 30)}`);
  }

  // ─── 8. CROSS-REFERENCE CHECK ──────────────────────────────────────
  console.log("\n" + "─".repeat(72));
  console.log("  SECTION 8: Cross-Reference — Voucher vs Ledger vs Sale vs Payment");
  console.log("─".repeat(72));

  // For IMPORTED vouchers with a ledgerEntryId, compare voucher amount vs ledger amount
  const crossRef = await prisma.tallyVoucher.findMany({
    where: { importStatus: "IMPORTED", ledgerEntryId: { not: null } },
    select: {
      id: true,
      debit: true,
      credit: true,
      voucherType: true,
      voucherNumber: true,
      ledgerEntryId: true,
    },
    take: 100,
  });

  let mismatches = 0;
  let checked = 0;
  for (const v of crossRef) {
    const ledger = await prisma.creditLedger.findUnique({
      where: { id: v.ledgerEntryId! },
      select: { amount: true, transactionType: true },
    });
    if (!ledger) continue;
    checked++;
    const voucherAmount = Number(v.debit) > 0 ? Number(v.debit) : Number(v.credit);
    const ledgerAmount = Number(ledger.amount);
    const diff = Math.abs(voucherAmount - ledgerAmount);
    const ratio = voucherAmount > 0 ? (ledgerAmount / voucherAmount).toFixed(4) : "N/A";

    if (diff > 0.01) {
      mismatches++;
      if (mismatches <= 10) {
        console.log(`  MISMATCH: ${v.id.slice(0, 12)} | ${(v.voucherType ?? "").padEnd(12)} | vchAmt=${voucherAmount.toFixed(2).padStart(12)} | lgrAmt=${ledgerAmount.toFixed(2).padStart(12)} | ratio=${ratio} | ${v.voucherNumber ?? ""}`);
      }
    }
  }
  console.log(`\n  Cross-reference checked: ${checked} vouchers`);
  console.log(`  Mismatches (>0.01 diff):  ${mismatches}`);

  // ─── 9. IMPORT BATCH SUMMARIES ─────────────────────────────────────
  console.log("\n" + "─".repeat(72));
  console.log("  SECTION 9: Import Batch Summaries");
  console.log("─".repeat(72));

  const batches = await prisma.tallyImportBatch.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      originalFileName: true,
      createdAt: true,
      status: true,
      totalVouchers: true,
      salesCount: true,
      receiptCount: true,
      debitTotal: true,
      creditTotal: true,
      errorCount: true,
      skippedCount: true,
    },
  });

  for (const b of batches) {
    console.log(`\n  Batch: ${b.id.slice(0, 16)}`);
    console.log(`    File:         ${b.originalFileName}`);
    console.log(`    Date:         ${b.createdAt.toISOString()}`);
    console.log(`    Status:       ${b.status}`);
    console.log(`    Vouchers:     ${b.totalVouchers}`);
    console.log(`    Sales:        ${b.salesCount}`);
    console.log(`    Receipts:     ${b.receiptCount}`);
    console.log(`    debitTotal:   ${Number(b.debitTotal).toFixed(2)}`);
    console.log(`    creditTotal:  ${Number(b.creditTotal).toFixed(2)}`);
    console.log(`    Errors:       ${b.errorCount}`);
    console.log(`    Skipped:      ${b.skippedCount}`);
  }

  // ─── 10. CUSTOMER LEDGER TRANSACTIONS ──────────────────────────────
  console.log("\n" + "─".repeat(72));
  console.log("  SECTION 10: CustomerLedgerTransaction (if any)");
  console.log("─".repeat(72));

  const cltCount = await prisma.customerLedgerTransaction.count();
  const cltAgg = await prisma.customerLedgerTransaction.aggregate({
    _sum: { debit: true, credit: true },
  });
  console.log(`  Count:          ${cltCount}`);
  console.log(`  Sum debit:      ${Number(cltAgg._sum.debit ?? 0).toFixed(2)}`);
  console.log(`  Sum credit:     ${Number(cltAgg._sum.credit ?? 0).toFixed(2)}`);

  // ─── 11. VALUE DISTRIBUTION ANALYSIS ───────────────────────────────
  console.log("\n" + "─".repeat(72));
  console.log("  SECTION 11: Value Distribution — Are amounts inflated?");
  console.log("─".repeat(72));

  // Check what percentage of imported vouchers have amounts divisible by 100
  // (indicating a decimal was removed, e.g. 12500.00 -> 1250000)
  const allImportedVouchers = await prisma.tallyVoucher.findMany({
    where: { importStatus: "IMPORTED" },
    select: { debit: true, credit: true },
  });

  let divisibleBy100 = 0;
  let totalAmounts = 0;
  const amountBuckets: Record<string, number> = {
    "< 1,000": 0,
    "1,000–10,000": 0,
    "10,000–100,000": 0,
    "100,000–1,000,000": 0,
    "1,000,000–10,000,000": 0,
    ">= 10,000,000": 0,
  };

  for (const v of allImportedVouchers) {
    const amt = Math.max(Number(v.debit), Number(v.credit));
    if (amt > 0) {
      totalAmounts++;
      if (amt % 100 === 0) divisibleBy100++;
      if (amt < 1000) amountBuckets["< 1,000"]++;
      else if (amt < 10000) amountBuckets["1,000–10,000"]++;
      else if (amt < 100000) amountBuckets["10,000–100,000"]++;
      else if (amt < 1000000) amountBuckets["100,000–1,000,000"]++;
      else if (amt < 10000000) amountBuckets["1,000,000–10,000,000"]++;
      else amountBuckets[">= 10,000,000"]++;
    }
  }

  console.log(`  Total amounts analyzed: ${totalAmounts}`);
  console.log(`  Amounts divisible by 100: ${divisibleBy100} (${totalAmounts > 0 ? ((divisibleBy100 / totalAmounts) * 100).toFixed(1) : 0}%)`);
  console.log(`  Amounts NOT divisible by 100: ${totalAmounts - divisibleBy100} (${totalAmounts > 0 ? (((totalAmounts - divisibleBy100) / totalAmounts) * 100).toFixed(1) : 0}%)`);
  console.log(`\n  Distribution:`);
  for (const [bucket, count] of Object.entries(amountBuckets)) {
    console.log(`    ${bucket.padEnd(22)}: ${count}`);
  }

  // ─── SUMMARY ───────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(72));
  console.log("  SUMMARY — All values in rupees (exact from database)");
  console.log("=".repeat(72));
  console.log(`  TallyVoucher imported debit total:  ${Number((await prisma.tallyVoucher.aggregate({ where: { importStatus: "IMPORTED" }, _sum: { debit: true } }))._sum.debit ?? 0).toFixed(2)}`);
  console.log(`  TallyVoucher imported credit total: ${Number((await prisma.tallyVoucher.aggregate({ where: { importStatus: "IMPORTED" }, _sum: { credit: true } }))._sum.credit ?? 0).toFixed(2)}`);
  console.log(`  Sale grandTotal total:              ${Number((await prisma.sale.aggregate({ _sum: { grandTotal: true } }))._sum.grandTotal ?? 0).toFixed(2)}`);
  console.log(`  Payment amount total:               ${Number((await prisma.payment.aggregate({ _sum: { amount: true } }))._sum.amount ?? 0).toFixed(2)}`);
  console.log(`  Customer openingBalance total:      ${Number((await prisma.customer.aggregate({ _sum: { openingBalance: true } }))._sum.openingBalance ?? 0).toFixed(2)}`);
  console.log(`  Customer currentBalance total:      ${Number((await prisma.customer.aggregate({ _sum: { currentBalance: true } }))._sum.currentBalance ?? 0).toFixed(2)}`);
  console.log(`  CreditLedger amount total:          ${Number((await prisma.creditLedger.aggregate({ _sum: { amount: true } }))._sum.amount ?? 0).toFixed(2)}`);

  console.log("\n" + "=".repeat(72));
  console.log("  AUDIT COMPLETE — No changes were made to the database");
  console.log("=".repeat(72));

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("❌ Audit failed:", e.message);
  process.exit(1);
});