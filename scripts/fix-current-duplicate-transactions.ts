/**
 * FIX CURRENT DUPLICATE TRANSACTIONS
 *
 * ROOT CAUSE ANALYSIS:
 *
 * For customer Ganesh Shrirang Samale (cmrxg4o4t05mtgcxvsjqnbjeq):
 *
 * The import route creates CreditLedger entries for EVERY Tally voucher,
 * but does NOT set paymentId on CreditLedger records for receipts.
 *
 * The ledger API (route.ts) fetches:
 *   1. CreditLedger records (all transactions)
 *   2. Orphaned Payments (Payments where id NOT IN CreditLedger.paymentId)
 *
 * Since CreditLedger.paymentId is always NULL, ALL Payment records appear
 * as orphaned and are returned as EXTRA rows in the ledger.
 *
 * This causes every receipt that has BOTH a CreditLedger entry AND a
 * Payment record to appear TWICE in the ledger.
 *
 * For Ganesh:
 *   - Receipt 14: CreditLedger entry + Payment record = 2 rows (DUPLICATE)
 *   - Receipt 22: CreditLedger entry + Payment record = 2 rows (DUPLICATE)
 *   - Receipt 69: CreditLedger entry + Payment record = 2 rows (DUPLICATE)
 *   - Receipt 78: CreditLedger entry + Payment record = 2 rows (DUPLICATE)
 *
 * Additionally, CustomerLedgerTransaction records are exact duplicates
 * of CreditLedger records (same sourceGuid as TallyVoucher).
 *
 * FIX STRATEGY:
 *   1. Link CreditLedger.paymentId to corresponding Payment records
 *   2. Delete redundant CustomerLedgerTransaction records
 *   3. Recalculate customer balances from canonical sources
 *   4. Verify the fix
 *
 * Usage:
 *   npx tsx scripts/fix-current-duplicate-transactions.ts --dry-run
 *   npx tsx scripts/fix-current-duplicate-transactions.ts --execute
 */
import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();
const CHUNK_SIZE = 50;

interface DuplicateGroup {
  customerId: string;
  customerName: string;
  voucherType: string;
  voucherNumber: string;
  amount: number;
  transactionDate: Date;
  creditLedgerId: string;
  paymentId: string | null;
  customerLedgerTxnId: string | null;
  tallyVoucherId: string;
  sourceGuid: string | null;
  isHighConfidence: boolean;
  reason: string;
}

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");
  const isExecute = args.includes("--execute");

  console.log("=".repeat(80));
  console.log(isDryRun ? "🔍 DRY RUN MODE (no changes)" : "⚠️  EXECUTE MODE");
  console.log("=".repeat(80));

  if (isExecute) {
    const confirmation = args.find((a) => a.startsWith("--confirmation="))?.split("=")[1];
    if (confirmation !== "FIX CURRENT DUPLICATE TRANSACTIONS") {
      console.error('\n❌ ERROR: Missing or incorrect confirmation.');
      console.error('  Use: --confirmation="FIX CURRENT DUPLICATE TRANSACTIONS"');
      process.exit(1);
    }

    // Backup
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupDir = path.join(process.cwd(), "backups");
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

    console.log("\n📦 Creating backup...");
    const backupData = {
      timestamp: new Date().toISOString(),
      creditLedgerRecords: await prisma.creditLedger.findMany({
        where: { paymentId: null, transactionType: "PAYMENT_RECEIVED" },
      }),
      customerLedgerTransactions: await prisma.customerLedgerTransaction.findMany(),
    };
    const backupPath = path.join(backupDir, `pre-fix-backup-${timestamp}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2));
    console.log(`  ✅ Backup saved: ${backupPath}`);

    console.log("\n⚠️  Proceeding in 3 seconds...\n");
    await new Promise((r) => setTimeout(r, 3000));
  }

  // ─── STEP 1: Find all CreditLedger records without paymentId ──────────
  console.log("\n📋 STEP 1: Finding CreditLedger records missing paymentId...\n");

  const unlinkedCreditLedgers = await prisma.creditLedger.findMany({
    where: {
      paymentId: null,
      transactionType: "PAYMENT_RECEIVED",
    },
    orderBy: [{ customerId: "asc" }, { createdAt: "asc" }],
  });

  console.log(`  Found ${unlinkedCreditLedgers.length} unlinked CreditLedger records.`);

  // ─── STEP 2: Find matching Payment records ───────────────────────────
  console.log("\n📋 STEP 2: Matching CreditLedger records to Payment records...\n");

  const allPayments = await prisma.payment.findMany({
    where: { status: "COMPLETED" },
    orderBy: [{ customerId: "asc" }, { paymentDate: "asc" }],
  });

  const paymentByCustomer = new Map<string, typeof allPayments>();
  for (const p of allPayments) {
    if (!paymentByCustomer.has(p.customerId)) {
      paymentByCustomer.set(p.customerId, []);
    }
    paymentByCustomer.get(p.customerId)!.push(p);
  }

  const linkUpdates: Array<{ creditLedgerId: string; paymentId: string; paymentReceipt: string }> = [];
  const unmatchedCreditLedgers: typeof unlinkedCreditLedgers = [];

  for (const cl of unlinkedCreditLedgers) {
    const customerPayments = paymentByCustomer.get(cl.customerId) ?? [];
    const clAmount = Number(cl.amount);
    const clDate = new Date(cl.createdAt);
    clDate.setHours(0, 0, 0, 0);

    // Find matching payment: same customer, same amount, same date (±1 day)
    const match = customerPayments.find((p) => {
      const pAmount = Number(p.amount);
      const pDate = new Date(p.paymentDate);
      pDate.setHours(0, 0, 0, 0);
      const diffMs = Math.abs(pDate.getTime() - clDate.getTime());
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      return Math.abs(pAmount - clAmount) < 0.01 && diffDays <= 1;
    });

    if (match) {
      linkUpdates.push({
        creditLedgerId: cl.id,
        paymentId: match.id,
        paymentReceipt: match.receiptNumber,
      });
    } else {
      unmatchedCreditLedgers.push(cl);
    }
  }

  console.log(`  Matched: ${linkUpdates.length} CreditLedger records can be linked to Payment records.`);
  console.log(`  Unmatched: ${unmatchedCreditLedgers.length} CreditLedger records have no corresponding Payment record.`);

  if (linkUpdates.length > 0) {
    console.log("\n  Link updates:");
    for (const lu of linkUpdates.slice(0, 20)) {
      console.log(`    CL=${lu.creditLedgerId} → Payment=${lu.paymentId} (receipt ${lu.paymentReceipt})`);
    }
    if (linkUpdates.length > 20) {
      console.log(`    ... and ${linkUpdates.length - 20} more`);
    }
  }

  // ─── STEP 3: Find CustomerLedgerTransaction duplicates ───────────────
  console.log("\n📋 STEP 3: Finding CustomerLedgerTransaction duplicates...\n");

  const allCLT = await prisma.customerLedgerTransaction.findMany({
    orderBy: [{ customerId: "asc" }, { transactionDate: "asc" }],
  });

  // Group by sourceGuid to find duplicates
  const cltByGuid = new Map<string, typeof allCLT>();
  for (const clt of allCLT) {
    const key = clt.sourceGuid ?? `no-guid-${clt.id}`;
    if (!cltByGuid.has(key)) cltByGuid.set(key, []);
    cltByGuid.get(key)!.push(clt);
  }

  // Find CLT records that have a matching CreditLedger entry
  const cltToDelete: Array<{
    id: string;
    customerId: string;
    voucherType: string;
    voucherNumber: string | null;
    amount: number;
    isDebit: boolean;
    sourceGuid: string | null;
  }> = [];

  for (const clt of allCLT) {
    const amount = Number(clt.debit) > 0 ? Number(clt.debit) : Number(clt.credit);
    const isDebit = Number(clt.debit) > 0;
    const cltDate = new Date(clt.transactionDate);
    cltDate.setHours(0, 0, 0, 0);

    // Check if there's a matching CreditLedger entry
    const matchingCL = await prisma.creditLedger.findFirst({
      where: {
        customerId: clt.customerId,
        amount: { equals: amount },
        transactionType: isDebit ? "CREDIT_SALE" : "PAYMENT_RECEIVED",
        createdAt: {
          gte: new Date(cltDate.getTime()),
          lt: new Date(cltDate.getTime() + 24 * 60 * 60 * 1000),
        },
      },
    });

    if (matchingCL) {
      cltToDelete.push({
        id: clt.id,
        customerId: clt.customerId,
        voucherType: clt.voucherType,
        voucherNumber: clt.voucherNumber,
        amount,
        isDebit,
        sourceGuid: clt.sourceGuid,
      });
    }
  }

  console.log(`  Found ${cltToDelete.length} CustomerLedgerTransaction records that are duplicates of CreditLedger records.`);

  // ─── STEP 4: Show duplicate groups ───────────────────────────────────
  console.log("\n📋 STEP 4: Duplicate groups summary...\n");

  // Group by customer
  const customerDupCounts = new Map<string, { clt: number; clLink: number; name: string }>();
  for (const clt of cltToDelete) {
    if (!customerDupCounts.has(clt.customerId)) {
      const cust = await prisma.customer.findUnique({
        where: { id: clt.customerId },
        select: { fullName: true },
      });
      customerDupCounts.set(clt.customerId, { clt: 0, clLink: 0, name: cust?.fullName ?? "Unknown" });
    }
    customerDupCounts.get(clt.customerId)!.clt++;
  }

  // Count link updates by customer
  for (const lu of linkUpdates) {
    const cl = unlinkedCreditLedgers.find((c) => c.id === lu.creditLedgerId);
    if (cl) {
      if (!customerDupCounts.has(cl.customerId)) {
        const cust = await prisma.customer.findUnique({
          where: { id: cl.customerId },
          select: { fullName: true },
        });
        customerDupCounts.set(cl.customerId, { clt: 0, clLink: 0, name: cust?.fullName ?? "Unknown" });
      }
      customerDupCounts.get(cl.customerId)!.clLink++;
    }
  }

  for (const [cid, counts] of customerDupCounts) {
    console.log(`  ${counts.name} (${cid}):`);
    if (counts.clLink > 0) console.log(`    - ${counts.clLink} CreditLedger records to link to Payment`);
    if (counts.clt > 0) console.log(`    - ${counts.clt} CustomerLedgerTransaction records to delete`);
  }

  if (isDryRun) {
    console.log("\n📝 DRY RUN SUMMARY:");
    console.log(`  CreditLedger→Payment links to add: ${linkUpdates.length}`);
    console.log(`  CustomerLedgerTransaction records to delete: ${cltToDelete.length}`);
    console.log(`  Unmatched CreditLedger records (no Payment): ${unmatchedCreditLedgers.length}`);
    console.log("\n  To execute, run with --execute flag");
    await prisma.$disconnect();
    return;
  }

  // ─── STEP 5: Link CreditLedger to Payment records ────────────────────
  console.log("\n🔗 STEP 5: Linking CreditLedger records to Payment records...\n");

  let linked = 0;
  let linkFailed = 0;

  for (let i = 0; i < linkUpdates.length; i += CHUNK_SIZE) {
    const chunk = linkUpdates.slice(i, i + CHUNK_SIZE);
    for (const lu of chunk) {
      try {
        await prisma.creditLedger.update({
          where: { id: lu.creditLedgerId },
          data: { paymentId: lu.paymentId },
        });
        linked++;
      } catch (err) {
        linkFailed++;
        console.error(`  ❌ Failed to link CL=${lu.creditLedgerId}:`, err);
      }
    }
    process.stdout.write(`  ✅ Linked ${linked}/${linkUpdates.length}\r`);
  }
  console.log(`\n  Total linked: ${linked}`);
  console.log(`  Total failed: ${linkFailed}`);

  // ─── STEP 6: Delete CustomerLedgerTransaction duplicates ─────────────
  console.log("\n🗑️  STEP 6: Deleting duplicate CustomerLedgerTransaction records...\n");

  let deleted = 0;
  let deleteFailed = 0;

  for (let i = 0; i < cltToDelete.length; i += CHUNK_SIZE) {
    const chunk = cltToDelete.slice(i, i + CHUNK_SIZE);
    const chunkIds = chunk.map((c) => c.id);

    try {
      await prisma.$transaction(async (tx) => {
        const result = await tx.customerLedgerTransaction.deleteMany({
          where: { id: { in: chunkIds } },
        });
        deleted += result.count;

        const remaining = await tx.customerLedgerTransaction.findMany({
          where: { id: { in: chunkIds } },
          select: { id: true },
        });
        if (remaining.length > 0) {
          throw new Error(`Failed to delete all records in chunk. ${remaining.length} remaining.`);
        }
      });
    } catch (err) {
      deleteFailed += chunk.length;
      console.error(`\n  ❌ Failed to delete chunk:`, err);
    }
    process.stdout.write(`  ✅ Deleted ${deleted}/${cltToDelete.length}\r`);
  }
  console.log(`\n  Total deleted: ${deleted}`);
  console.log(`  Total failed: ${deleteFailed}`);

  // ─── STEP 7: Recalculate customer balances ───────────────────────────
  console.log("\n💰 STEP 7: Recalculating customer balances...\n");

  const affectedCustomerIds = new Set<string>();
  for (const clt of cltToDelete) affectedCustomerIds.add(clt.customerId);
  for (const lu of linkUpdates) {
    const cl = unlinkedCreditLedgers.find((c) => c.id === lu.creditLedgerId);
    if (cl) affectedCustomerIds.add(cl.customerId);
  }

  const customers = await prisma.customer.findMany({
    where: {
      id: { in: Array.from(affectedCustomerIds) },
      isActive: true,
      deletedAt: null,
    },
    select: { id: true, openingBalance: true, currentBalance: true, fullName: true },
  });

  let recalculated = 0;
  let alreadyCorrect = 0;

  for (const customer of customers) {
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
      alreadyCorrect++;
    }
  }

  console.log(`\n  Recalculated: ${recalculated} customer(s)`);
  console.log(`  Already correct: ${alreadyCorrect} customer(s)`);

  // ─── STEP 8: Verify ──────────────────────────────────────────────────
  console.log("\n🔎 STEP 8: Verification...\n");

  const remainingCLT = await prisma.customerLedgerTransaction.count();
  console.log(`  Remaining CustomerLedgerTransaction records: ${remainingCLT}`);

  // Verify Ganesh specifically
  const ganeshId = "cmrxg4o4t05mtgcxvsjqnbjeq";
  const ganesh = await prisma.customer.findUnique({
    where: { id: ganeshId },
    select: { fullName: true, currentBalance: true, openingBalance: true },
  });
  console.log(`\n  Ganesh Shrirang Samale:`);
  console.log(`    Opening Balance: ₹${Number(ganesh?.openingBalance ?? 0).toFixed(2)}`);
  console.log(`    Current Balance: ₹${Number(ganesh?.currentBalance ?? 0).toFixed(2)}`);

  // Count CreditLedger records for Ganesh
  const ganeshCL = await prisma.creditLedger.findMany({
    where: { customerId: ganeshId, transactionType: { not: "OPENING_BALANCE" } },
  });
  console.log(`    CreditLedger records: ${ganeshCL.length}`);

  // Count orphaned Payments for Ganesh (should be 0 after fix)
  const ganeshCLPaymentIds = new Set(ganeshCL.filter((c) => c.paymentId).map((c) => c.paymentId as string));
  const ganeshOrphanedPayments = await prisma.payment.findMany({
    where: {
      customerId: ganeshId,
      id: { notIn: Array.from(ganeshCLPaymentIds) },
      status: "COMPLETED",
    },
  });
  console.log(`    Orphaned Payments (should be 0): ${ganeshOrphanedPayments.length}`);

  // Verify invoice 647
  const sale647 = await prisma.sale.findUnique({ where: { invoiceNumber: "647" } });
  console.log(`\n  Invoice 647: sale exists=${!!sale647}, amount=₹${Number(sale647?.grandTotal ?? 0).toFixed(2)}`);

  // Verify receipt 14
  const pay14 = await prisma.payment.findUnique({ where: { receiptNumber: "14" } });
  console.log(`  Receipt 14: payment exists=${!!pay14}, amount=₹${Number(pay14?.amount ?? 0).toFixed(2)}`);

  // ─── SUMMARY ─────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(80));
  console.log("FIX COMPLETE");
  console.log("=".repeat(80));
  console.log(`  CreditLedger→Payment links: ${linked}`);
  console.log(`  CLT records deleted:       ${deleted}`);
  console.log(`  Customer balances updated:  ${recalculated}`);
  console.log(`  Link failures:             ${linkFailed}`);
  console.log(`  Delete failures:           ${deleteFailed}`);

  if (linkFailed > 0 || deleteFailed > 0) {
    console.log("\n⚠️  Some operations failed. Check the backup and re-run if needed.");
  } else {
    console.log("\n✅ All fixes applied successfully.");
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fix failed:", err);
  process.exit(1);
});