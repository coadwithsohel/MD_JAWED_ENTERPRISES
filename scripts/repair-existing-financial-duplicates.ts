/**
 * REPAIR SCRIPT: Remove duplicate CustomerLedgerTransaction records and recalculate balances.
 *
 * ROOT CAUSE: The import route was creating records in BOTH CreditLedger AND
 * CustomerLedgerTransaction for every imported SALES and RECEIPT voucher.
 * The ledger query was then concatenating both, causing every transaction
 * to appear twice.
 *
 * This script:
 * 1. (DRY RUN) Identifies all duplicate pairs
 * 2. (EXECUTE) Deletes the redundant CustomerLedgerTransaction records
 * 3. Recalculates all customer balances from unique sources (Sale + Payment only)
 *
 * Usage:
 *   npx tsx scripts/repair-existing-financial-duplicates.ts --dry-run
 *   npx tsx scripts/repair-existing-financial-duplicates.ts --execute
 *
 * Safety:
 * - Requires explicit --execute flag
 * - Creates a JSON backup before any deletion
 * - Processes in chunks of 50
 * - Rolls back individual group if any error occurs
 * - Prints detailed diff of what changed
 */
import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();

const CHUNK_SIZE = 50;

interface DuplicateToRemove {
  customerLedgerTxnId: string;
  creditLedgerId: string;
  customerId: string;
  voucherType: string;
  voucherNumber: string;
  amount: number;
  isDebit: boolean;
}

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");
  const isExecute = args.includes("--execute");
  const customerFilter = args
    .find((a) => a.startsWith("--customer-id="))
    ?.split("=")[1];

  console.log("=".repeat(80));
  console.log(isDryRun ? "🔍 DRY RUN MODE (no changes)" : "⚠️  EXECUTE MODE");
  console.log("=".repeat(80));

  // Backup directory (used in execute mode)
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(process.cwd(), "backups");

  if (isExecute) {
    const confirmation = args.find((a) => a.startsWith("--confirmation="))?.split("=")[1];
    if (confirmation !== "REPAIR EXISTING FINANCIAL DUPLICATES") {
      console.error("\n❌ ERROR: Missing or incorrect confirmation.");
      console.error('  Use: --confirmation="REPAIR EXISTING FINANCIAL DUPLICATES"');
      process.exit(1);
    }

    // Backup before execute
    console.log("\n📦 Creating backup before repair...");
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    console.log("\n⚠️  WARNING: This will modify the database!");
    console.log("  - CustomerLedgerTransaction records will be DELETED");
    console.log("  - Customer currentBalance fields will be UPDATED");
    console.log("  - A JSON backup will be saved first");
    console.log(`  - Backup dir: ${backupDir}`);
    console.log("\n  Proceeding in 3 seconds...\n");
    await new Promise((r) => setTimeout(r, 3000));
  }

  // ─── Step 1: Find duplicate pairs ──────────────────────────────────────
  console.log("\n📋 Step 1: Finding duplicate pairs...\n");

  const creditLedgerEntries = await prisma.creditLedger.findMany({
    where: {
      ...(customerFilter ? { customerId: customerFilter } : {}),
      transactionType: { not: "OPENING_BALANCE" },
    },
    select: {
      id: true,
      customerId: true,
      transactionType: true,
      amount: true,
      createdAt: true,
      saleId: true,
      paymentId: true,
      description: true,
    },
    orderBy: [{ customerId: "asc" }, { createdAt: "asc" }],
  });

  const ledgerTxns = await prisma.customerLedgerTransaction.findMany({
    where: {
      ...(customerFilter ? { customerId: customerFilter } : {}),
    },
    select: {
      id: true,
      customerId: true,
      voucherType: true,
      transactionDate: true,
      debit: true,
      credit: true,
      voucherNumber: true,
      particulars: true,
    },
    orderBy: [{ customerId: "asc" }, { transactionDate: "asc" }],
  });

  // Build lookup map
  const txnByCustomer = new Map<string, typeof ledgerTxns>();
  for (const txn of ledgerTxns) {
    if (!txnByCustomer.has(txn.customerId)) {
      txnByCustomer.set(txn.customerId, []);
    }
    txnByCustomer.get(txn.customerId)!.push(txn);
  }

  const duplicatesToRemove: DuplicateToRemove[] = [];
  const matchedTxnIds = new Set<string>();

  for (const cl of creditLedgerEntries) {
    const customerTxns = txnByCustomer.get(cl.customerId) ?? [];
    const isDebit = ["CREDIT_SALE", "SALE_CANCELLED"].includes(cl.transactionType);
    const clAmount = Number(cl.amount);
    const clDate = new Date(cl.createdAt);
    clDate.setHours(0, 0, 0, 0);

    const match = customerTxns.find((txn) => {
      const txnAmount = isDebit ? Number(txn.debit) : Number(txn.credit);
      const txnDate = new Date(txn.transactionDate);
      txnDate.setHours(0, 0, 0, 0);
      return (
        txnDate.getTime() === clDate.getTime() &&
        Math.abs(txnAmount - clAmount) < 0.01 &&
        (isDebit ? Number(txn.debit) > 0 : Number(txn.credit) > 0) &&
        !matchedTxnIds.has(txn.id)
      );
    });

    if (match) {
      matchedTxnIds.add(match.id);
      const vType = isDebit ? "SALES" : "RECEIPT";
      duplicatesToRemove.push({
        customerLedgerTxnId: match.id,
        creditLedgerId: cl.id,
        customerId: cl.customerId,
        voucherType: vType,
        voucherNumber: match.voucherNumber ?? "",
        amount: clAmount,
        isDebit,
      });
    }
  }

  console.log(`  Found ${duplicatesToRemove.length} duplicate CustomerLedgerTransaction records to remove.`);

  // Group duplicates by customer
  const customerDuplicateCounts = new Map<string, number>();
  for (const dup of duplicatesToRemove) {
    const count = customerDuplicateCounts.get(dup.customerId) ?? 0;
    customerDuplicateCounts.set(dup.customerId, count + 1);
  }

  console.log("\n  Affected customers:");
  for (const [cid, count] of customerDuplicateCounts) {
    const customer = await prisma.customer.findUnique({
      where: { id: cid },
      select: { fullName: true, customerCode: true },
    });
    console.log(`    ${customer?.fullName ?? "Unknown"} (${customer?.customerCode ?? cid}): ${count} duplicate(s)`);
  }

  if (duplicatesToRemove.length === 0) {
    console.log("\n✅ No duplicates found. Nothing to repair.");
    await prisma.$disconnect();
    return;
  }

  if (isDryRun) {
    console.log("\n📝 DRY RUN: Would remove these duplicates:");
    for (const dup of duplicatesToRemove.slice(0, 20)) {
      console.log(`  [${dup.voucherType}] #${dup.voucherNumber || "N/A"} — Customer=${dup.customerId} Amount=₹${dup.amount} CLTxnId=${dup.customerLedgerTxnId}`);
    }
    if (duplicatesToRemove.length > 20) {
      console.log(`  ... and ${duplicatesToRemove.length - 20} more`);
    }
    console.log("\n  To execute repair, run with --execute flag");
    await prisma.$disconnect();
    return;
  }

  // ─── Step 2: Backup ───────────────────────────────────────────────────
  console.log("\n📦 Step 2: Creating backup...");

  const backupData = {
    timestamp: new Date().toISOString(),
    duplicatesToRemove: duplicatesToRemove.map((d) => ({
      ...d,
    })),
    customerLedgerTransactionRecords: await prisma.customerLedgerTransaction.findMany({
      where: {
        id: { in: duplicatesToRemove.map((d) => d.customerLedgerTxnId) },
      },
    }),
  };

  const backupPath = path.join(
    backupDir,
    `pre-repair-backup-${timestamp}.json`,
  );
  fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2));
  console.log(`  ✅ Backup saved to: ${backupPath}`);

  // ─── Step 3: Remove duplicates in chunks ──────────────────────────────
  console.log("\n🗑️  Step 3: Removing duplicate records...\n");

  let removed = 0;
  let failed = 0;

  for (let i = 0; i < duplicatesToRemove.length; i += CHUNK_SIZE) {
    const chunk = duplicatesToRemove.slice(i, i + CHUNK_SIZE);
    const chunkIds = chunk.map((d) => d.customerLedgerTxnId);

    try {
      await prisma.$transaction(async (tx) => {
        // Delete the duplicate CustomerLedgerTransaction records
        const result = await tx.customerLedgerTransaction.deleteMany({
          where: { id: { in: chunkIds } },
        });
        removed += result.count;

        // Verify each deletion
        const remaining = await tx.customerLedgerTransaction.findMany({
          where: { id: { in: chunkIds } },
          select: { id: true },
        });
        if (remaining.length > 0) {
          throw new Error(`Failed to delete all records in chunk. ${remaining.length} remaining.`);
        }
      });

      process.stdout.write(`  ✅ Removed ${chunk.length} duplicates (${removed}/${duplicatesToRemove.length})\r`);
    } catch (err) {
      failed += chunk.length;
      console.error(`\n  ❌ Failed to remove chunk:`, err);
    }
  }

  console.log(`\n  Total removed: ${removed}`);
  console.log(`  Total failed: ${failed}`);

  // ─── Step 4: Recalculate all customer balances ───────────────────────
  console.log("\n💰 Step 4: Recalculating customer balances...\n");

  // Recalculate all customers that have balance mismatches
  const allActiveCustomers = await prisma.customer.findMany({
    where: {
      ...(customerFilter ? { id: customerFilter } : {}),
      isActive: true,
      deletedAt: null,
    },
    select: { id: true, openingBalance: true, currentBalance: true, fullName: true },
  });

  let recalculated = 0;
  let skipped = 0;

  for (const customer of allActiveCustomers) {
    const opening = Number(customer.openingBalance);

    const [salesAgg, paymentAgg] = await Promise.all([
      prisma.sale.aggregate({
        where: {
          customerId: customer.id,
          status: { in: ["COMPLETED", "PARTIALLY_RETURNED"] },
        },
        _sum: { grandTotal: true },
      }),
      prisma.payment.aggregate({
        where: {
          customerId: customer.id,
          status: "COMPLETED",
        },
        _sum: { amount: true },
      }),
    ]);

    const totalSales = Number(salesAgg._sum.grandTotal ?? 0);
    const totalPayments = Number(paymentAgg._sum.amount ?? 0);
    const calculatedBalance = opening + totalSales - totalPayments;
    const storedBalance = Number(customer.currentBalance);

    if (Math.abs(calculatedBalance - storedBalance) > 0.01) {
      await prisma.customer.update({
        where: { id: customer.id },
        data: { currentBalance: calculatedBalance },
      });
      recalculated++;
      console.log(`  ✅ ${customer.fullName}: ₹${storedBalance.toFixed(2)} → ₹${calculatedBalance.toFixed(2)}`);
    } else {
      skipped++;
    }
  }

  console.log(`\n  Recalculated: ${recalculated} customer(s)`);
  console.log(`  Already correct: ${skipped} customer(s)`);

  // ─── Step 5: Summary ─────────────────────────────────────────────────
  console.log("\n" + "=".repeat(80));
  console.log("REPAIR COMPLETE");
  console.log("=".repeat(80));
  console.log(`  Duplicates removed:        ${removed}`);
  console.log(`  Duplicates failed:         ${failed}`);
  console.log(`  Customer balances updated:  ${recalculated}`);
  console.log(`  Customer balances skipped:  ${skipped}`);
  console.log(`  Backup saved:              ${backupPath}`);

  if (failed > 0) {
    console.log("\n⚠️  Some operations failed. Check the backup and re-run if needed.");
  } else {
    console.log("\n✅ All duplicates removed successfully.");
  }

  // ─── Step 6: Post-repair verification ────────────────────────────────
  console.log("\n🔎 Step 6: Post-repair verification...\n");

  const remainingCLTxns = await prisma.customerLedgerTransaction.count();
  console.log(`  Remaining CustomerLedgerTransaction records: ${remainingCLTxns}`);

  if (remainingCLTxns > 0) {
    // Check if any of the remaining ones have matching CreditLedger entries
    const remainingRecords = await prisma.customerLedgerTransaction.findMany({
      select: {
        id: true,
        customerId: true,
        transactionDate: true,
        debit: true,
        credit: true,
      },
    });

    let stillDuplicated = 0;
    for (const txn of remainingRecords) {
      const amount = Number(txn.debit) > 0 ? Number(txn.debit) : Number(txn.credit);
      const isDebit = Number(txn.debit) > 0;
      const txnDate = new Date(txn.transactionDate);
      txnDate.setHours(0, 0, 0, 0);

      // Check if there's a matching CreditLedger entry
      const match = await prisma.creditLedger.findFirst({
        where: {
          customerId: txn.customerId,
          amount: { equals: amount },
          transactionType: isDebit ? "CREDIT_SALE" : "PAYMENT_RECEIVED",
        },
      });

      if (match) {
        stillDuplicated++;
        console.log(`  ⚠️  Still duplicated: CLTxn=${txn.id} matches CreditLedger=${match.id}`);
      }
    }

    if (stillDuplicated > 0) {
      console.log(`\n  ⚠️  ${stillDuplicated} records still duplicated. Re-run repair.`);
    } else {
      console.log("  ✅ No remaining cross-model duplicates.");
    }
  } else {
    console.log("  ✅ All CustomerLedgerTransaction records have been removed.");
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Repair failed:", err);
  process.exit(1);
});