#!/usr/bin/env tsx
/**
 * REPAIR BATCH DATA — Fix 100x inflated amounts and complete stuck imports
 *
 * PROBLEM:
 * - parseSignedAmount() in amount-parser.ts used regex [₹Rs.,\s] which removed
 *   the decimal point. "12500.00" became "1250000" (100x larger).
 * - All TallyVoucher records (except the last BATCH_10 re-upload) have 100x inflated amounts
 * - Import batches are stuck in "IMPORTING" status — only partial data was created
 * - Some records were partially divided by previous fix attempts, creating inconsistency
 * - 533 customers exist instead of 541
 *
 * FIX STRATEGY:
 * 1. Backup all affected data
 * 2. Delete all corrupted imported records (Sales, Payments, CreditLedger from import)
 * 3. Reset all IMPORTED vouchers back to VALID
 * 4. Fix TallyVoucher amounts (divide by 100 for inflated batches)
 * 5. Reset all batches to UPLOADED
 * 6. Re-import everything from the fixed vouchers
 *
 * Usage:
 *   npx tsx src/scripts/repair-batch-data.ts            # DRY RUN
 *   npx tsx src/scripts/repair-batch-data.ts --execute   # APPLY FIXES
 */

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();
const BACKUP_DIR = path.join(process.cwd(), "backups");

// Batches with correct amounts (re-uploaded after fix)
const CORRECT_BATCH_IDS = ["cmrzer2ic00018qz3ci9"];

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
  console.log(`  REPAIR BATCH DATA — Mode: ${isExecute ? "⚠️ EXECUTE" : "✅ DRY-RUN"}`);
  console.log("═".repeat(60));

  // ─── STEP 0: Gather current state ──────────────────────────────────
  console.log("\n  STEP 0: Current database state");
  const totalCustomers = await prisma.customer.count({ where: { isActive: true, deletedAt: null } });
  const totalSales = await prisma.sale.count();
  const totalPayments = await prisma.payment.count();
  const totalLedger = await prisma.creditLedger.count();
  const totalVouchers = await prisma.tallyVoucher.count();
  const importedVouchers = await prisma.tallyVoucher.count({ where: { importStatus: "IMPORTED" } });
  const validVouchers = await prisma.tallyVoucher.count({ where: { importStatus: "VALID" } });
  const parsedVouchers = await prisma.tallyVoucher.count({ where: { importStatus: "PARSED" } });
  console.log(`  Customers: ${totalCustomers} (expected 541)`);
  console.log(`  Sales: ${totalSales} (expected 516)`);
  console.log(`  Payments: ${totalPayments} (expected 3704)`);
  console.log(`  CreditLedger: ${totalLedger}`);
  console.log(`  TallyVouchers: ${totalVouchers} (IMPORTED: ${importedVouchers}, VALID: ${validVouchers}, PARSED: ${parsedVouchers})`);

  // ─── STEP 1: Find all imported records to delete ───────────────────
  console.log("\n  STEP 1: Find imported records to delete");
  
  // Find all imported vouchers with ledger entries
  const importedVoucherList = await prisma.tallyVoucher.findMany({
    where: {
      importBatchId: { notIn: CORRECT_BATCH_IDS },
      importStatus: "IMPORTED",
      ledgerEntryId: { not: null },
    },
    select: { id: true, ledgerEntryId: true, voucherType: true },
  });
  console.log(`  Found ${importedVoucherList.length} imported vouchers with ledger entries`);

  const ledgerEntryIds = importedVoucherList
    .map(v => v.ledgerEntryId)
    .filter((id): id is string => id !== null);

  // Find linked Sales and Payments via CreditLedger
  const linkedLedgerEntries = await prisma.creditLedger.findMany({
    where: { id: { in: ledgerEntryIds } },
    select: { id: true, saleId: true, paymentId: true },
  });

  const saleIds = [...new Set(linkedLedgerEntries
    .map(e => e.saleId)
    .filter((id): id is string => id !== null))];
  const paymentIds = [...new Set(linkedLedgerEntries
    .map(e => e.paymentId)
    .filter((id): id is string => id !== null))];

  console.log(`  Sales to delete: ${saleIds.length}`);
  console.log(`  Payments to delete: ${paymentIds.length}`);
  console.log(`  CreditLedger entries to delete: ${ledgerEntryIds.length}`);

  // ─── STEP 2: Find affected customers ──────────────────────────────
  console.log("\n  STEP 2: Find affected customers");
  const affectedCustomerIds = await prisma.tallyVoucher.findMany({
    where: {
      importBatchId: { notIn: CORRECT_BATCH_IDS },
      importStatus: "IMPORTED",
      customerId: { not: null },
    },
    select: { customerId: true },
    distinct: ["customerId"],
  });
  const cids = affectedCustomerIds.map(c => c.customerId!).filter(Boolean);
  console.log(`  Found ${cids.length} affected customers`);

  // ─── STEP 3: Check for manually created records ───────────────────
  console.log("\n  STEP 3: Check for manually created records");
  const manualSales = await prisma.sale.count({
    where: {
      id: { notIn: saleIds },
      customerId: { not: null },
    },
  });
  const manualPayments = await prisma.payment.count({
    where: {
      id: { notIn: paymentIds },
    },
  });
  console.log(`  Manual sales (not from import): ${manualSales}`);
  console.log(`  Manual payments (not from import): ${manualPayments}`);

  // ─── SUMMARY ──────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(60));
  console.log("  REPAIR SUMMARY");
  console.log("═".repeat(60));
  console.log(`  Sales to delete: ${saleIds.length}`);
  console.log(`  Payments to delete: ${paymentIds.length}`);
  console.log(`  CreditLedger to delete: ${ledgerEntryIds.length}`);
  console.log(`  Vouchers to reset to VALID: ${importedVoucherList.length}`);
  console.log(`  Vouchers to fix amounts: ${validVouchers + importedVoucherList.length}`);
  console.log(`  Customers to rebuild: ${cids.length}`);
  console.log(`  Manual sales preserved: ${manualSales}`);
  console.log(`  Manual payments preserved: ${manualPayments}`);

  if (!isExecute) {
    console.log("\n  ⚠️  DRY-RUN. Use --execute to apply.");
    console.log("  npx tsx src/scripts/repair-batch-data.ts --execute");
    await prisma.$disconnect();
    return;
  }

  // ═══════════════════════════════════════════════════════════════════
  // EXECUTE
  // ═══════════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(60));
  console.log("  EXECUTING REPAIRS...");
  console.log("─".repeat(60));

  // ─── BACKUP ────────────────────────────────────────────────────────
  console.log("\n  Backing up affected records...");
  const bCustomers = await prisma.customer.findMany({ where: { id: { in: cids } } });
  const bSales = saleIds.length > 0 ? await prisma.sale.findMany({ where: { id: { in: saleIds } } }) : [];
  const bPayments = paymentIds.length > 0 ? await prisma.payment.findMany({ where: { id: { in: paymentIds } } }) : [];
  const bLedger = ledgerEntryIds.length > 0 ? await prisma.creditLedger.findMany({ where: { id: { in: ledgerEntryIds } } }) : [];
  const bVouchers = await prisma.tallyVoucher.findMany({
    where: { importBatchId: { notIn: CORRECT_BATCH_IDS }, importStatus: { in: ["IMPORTED", "VALID", "PARSED", "MATCHED"] } },
  });
  const files = [
    await backupTable("Customer", bCustomers),
    await backupTable("Sale", bSales),
    await backupTable("Payment", bPayments),
    await backupTable("CreditLedger", bLedger),
    await backupTable("TallyVoucher", bVouchers),
  ];
  console.log(`  Backups created: ${files.length}`);

  // ─── DELETE 1: Delete CreditLedger entries ─────────────────────────
  if (ledgerEntryIds.length > 0) {
    console.log("\n  1. Deleting corrupted CreditLedger entries...");
    const d1 = await prisma.creditLedger.deleteMany({
      where: { id: { in: ledgerEntryIds } },
    });
    console.log(`     ✓ Deleted ${d1.count} ledger entries`);
  } else {
    console.log("\n  1. No CreditLedger entries to delete");
  }

  // ─── DELETE 2: Delete Payments ─────────────────────────────────────
  if (paymentIds.length > 0) {
    console.log("\n  2. Deleting corrupted Payment records...");
    const d2 = await prisma.payment.deleteMany({
      where: { id: { in: paymentIds } },
    });
    console.log(`     ✓ Deleted ${d2.count} payments`);
  } else {
    console.log("\n  2. No Payments to delete");
  }

  // ─── DELETE 3: Delete Sales ────────────────────────────────────────
  if (saleIds.length > 0) {
    console.log("\n  3. Deleting corrupted Sale records...");
    const d3 = await prisma.sale.deleteMany({
      where: { id: { in: saleIds } },
    });
    console.log(`     ✓ Deleted ${d3.count} sales`);
  } else {
    console.log("\n  3. No Sales to delete");
  }

  // ─── FIX 4: Reset IMPORTED vouchers to VALID ──────────────────────
  console.log("\n  4. Resetting IMPORTED vouchers to VALID...");
  const r4 = await prisma.$executeRawUnsafe(`
    UPDATE "TallyVoucher"
    SET "importStatus" = 'VALID',
        "ledgerEntryId" = NULL
    WHERE "importStatus" = 'IMPORTED'
      AND "importBatchId" NOT IN (${CORRECT_BATCH_IDS.map(id => `'${id}'`).join(",")})
  `);
  console.log(`     ✓ Reset ${r4} vouchers`);

  // ─── FIX 5: Fix TallyVoucher amounts (divide by 100) ──────────────
  console.log("\n  5. Fixing TallyVoucher amounts (divide by 100)...");
  const r5 = await prisma.$executeRawUnsafe(`
    UPDATE "TallyVoucher"
    SET debit = CASE WHEN debit > 0 THEN ROUND(debit / 100, 2) ELSE 0 END,
        credit = CASE WHEN credit > 0 THEN ROUND(credit / 100, 2) ELSE 0 END
    WHERE "importBatchId" NOT IN (${CORRECT_BATCH_IDS.map(id => `'${id}'`).join(",")})
      AND "importStatus" IN ('VALID', 'PARSED', 'MATCHED')
      AND (debit > 0 OR credit > 0)
  `);
  console.log(`     ✓ Fixed ${r5} vouchers`);

  // ─── FIX 6: Reset all batches to UPLOADED ─────────────────────────
  console.log("\n  6. Resetting all import batches to UPLOADED...");
  const r6 = await prisma.$executeRawUnsafe(`
    UPDATE "TallyImportBatch"
    SET status = 'UPLOADED',
        "completedAt" = NULL
    WHERE status = 'IMPORTING'
  `);
  console.log(`     ✓ Reset ${r6} batches`);

  // ─── FIX 7: Rebuild customer balances from scratch ────────────────
  console.log("\n  7. Rebuilding customer balances from CreditLedger...");
  const allCustomers = await prisma.customer.findMany({
    where: { isActive: true, deletedAt: null },
    select: { id: true, customerCode: true, openingBalance: true, currentBalance: true },
  });

  let balCount = 0;
  for (const c of allCustomers) {
    const ob = Number(c.openingBalance);
    // Fix opening balance if inflated (check if > 99999 which is unrealistically high for OB)
    const fixedOB = ob > 99999 ? Math.round(ob / 100 * 100) / 100 : ob;

    const entries = await prisma.creditLedger.findMany({
      where: { customerId: c.id },
      select: { transactionType: true, amount: true },
      orderBy: { createdAt: "asc" },
    });

    let bal = fixedOB;
    for (const e of entries) {
      const amt = Number(e.amount);
      if (["CREDIT_SALE", "PAYMENT_REVERSAL", "ADJUSTMENT"].includes(e.transactionType)) {
        bal += amt;
      } else if (["PAYMENT_RECEIVED", "SALE_CANCELLED", "RETURN_CREDIT"].includes(e.transactionType)) {
        bal -= amt;
      }
    }

    const newBal = Math.max(0, Math.round(bal * 100) / 100);

    if (Math.abs(newBal - Number(c.currentBalance ?? 0)) > 0.01 || Math.abs(fixedOB - ob) > 0.01) {
      await prisma.customer.update({
        where: { id: c.id },
        data: { openingBalance: fixedOB, currentBalance: newBal },
      });
      balCount++;
    }
  }
  console.log(`     ✓ Recalculated ${balCount} customer balances`);

  // ─── VERIFICATION ─────────────────────────────────────────────────
  console.log("\n" + "═".repeat(60));
  console.log("  VERIFICATION");
  console.log("═".repeat(60));

  const vCustomers = await prisma.customer.count({ where: { isActive: true, deletedAt: null } });
  const vSales = await prisma.sale.count();
  const vPayments = await prisma.payment.count();
  const vLedger = await prisma.creditLedger.count();
  const vImported = await prisma.tallyVoucher.count({ where: { importStatus: "IMPORTED" } });
  const vValid = await prisma.tallyVoucher.count({ where: { importStatus: "VALID" } });
  const vParsed = await prisma.tallyVoucher.count({ where: { importStatus: "PARSED" } });
  console.log(`  Customers: ${vCustomers}`);
  console.log(`  Sales: ${vSales}`);
  console.log(`  Payments: ${vPayments}`);
  console.log(`  CreditLedger: ${vLedger}`);
  console.log(`  Vouchers IMPORTED: ${vImported}, VALID: ${vValid}, PARSED: ${vParsed}`);

  // Check for remaining inflated amounts
  const remainingBig = await prisma.tallyVoucher.count({
    where: { debit: { gt: 100000 }, importStatus: { in: ["IMPORTED", "VALID", "PARSED", "MATCHED"] } },
  });
  console.log(`  Vouchers still with debit > 100000: ${remainingBig}`);

  // Check accounting totals
  const { getTotalPendingCredit, getTotalOverdue } = await import("../lib/accounting");
  const pc = await getTotalPendingCredit();
  const od = await getTotalOverdue();
  console.log(`\n  Pending Credit: ₹${Number(pc.total).toFixed(2)} (${pc.count} customers)`);
  console.log(`  Overdue Total:  ₹${Number(od.total).toFixed(2)} (${od.count} customers)`);

  // Last 30 days payments
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const recentPayments = await prisma.payment.findMany({
    where: { paymentDate: { gte: thirtyDaysAgo }, status: "COMPLETED" },
    select: { amount: true },
  });
  const recentTotal = recentPayments.reduce((s, p) => s + Number(p.amount), 0);
  console.log(`  Last 30d Payments: ₹${recentTotal.toFixed(2)} (${recentPayments.length} receipts)`);

  console.log("\n" + "═".repeat(60));
  console.log("  REPAIR COMPLETE");
  console.log("═".repeat(60));
  console.log("  Next steps:");
  console.log("  1. Run: npx tsx src/scripts/repair-batch-data.ts --execute (if dry-run)");
  console.log("  2. Re-import batches via the UI or API");
  console.log("  3. Run: npm run build");

  await prisma.$disconnect();
}

main().catch((e) => { console.error("❌ Failed:", e); process.exit(1); });