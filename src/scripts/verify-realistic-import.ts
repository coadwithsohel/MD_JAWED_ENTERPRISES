// ─── Verification Script for Realistic Import Test ────────────────────────
// Run: npx tsx src/scripts/verify-realistic-import.ts

import { prisma } from "@/lib/prisma";

const TEST_MOBILES = [
  "7890011201", // Mohammad Arif Shaikh
  "7890011202", // Sajid Abdul Qureshi
  "7890011203", // Rafiq Ahmed Pathan
  "7890011204", // Imran Yusuf Ansari
  "7890011205", // Shabana Parveen Khan
];

async function main() {
  console.log("=== REALISTIC IMPORT VERIFICATION ===\n");

  for (const mobile of TEST_MOBILES) {
    const customer = await prisma.customer.findFirst({
      where: {
        OR: [{ mobile }, { normalizedMobile: mobile }],
      },
    });

    if (!customer) {
      console.log(`${mobile}: CUSTOMER NOT FOUND`);
      console.log("---");
      continue;
    }

    // Get ledger entries (excluding opening balance)
    const ledgerEntries = await prisma.creditLedger.findMany({
      where: {
        customerId: customer.id,
        transactionType: { not: "OPENING_BALANCE" },
      },
    });

    let totalDebit = 0;
    let totalCredit = 0;

    for (const entry of ledgerEntries) {
      const amt = Number(entry.amount);
      switch (entry.transactionType) {
        case "CREDIT_SALE":
          totalDebit += amt;
          break;
        case "PAYMENT_RECEIVED":
          totalCredit += amt;
          break;
        default:
          break;
      }
    }

    const openingBalance = Number(customer.openingBalance);
    const calculatedClosing = openingBalance + totalDebit - totalCredit;
    const storedBalance = Number(customer.currentBalance);
    const balanceType = calculatedClosing > 0 ? "Dr" : calculatedClosing < 0 ? "Cr" : "Settled";

    // Count transactions
    const stagedCount = await prisma.tallyVoucher.count({
      where: { customerId: customer.id, importStatus: "IMPORTED" },
    });
    const creditLedgerCount = await prisma.creditLedger.count({
      where: { customerId: customer.id, transactionType: { not: "OPENING_BALANCE" } },
    });
    const cltCount = await prisma.customerLedgerTransaction.count({
      where: { customerId: customer.id },
    });

    console.log(`${customer.fullName} (${mobile}):`);
    console.log(`  customerCode: ${customer.customerCode}`);
    console.log(`  creditLimit: ${Number(customer.creditLimit)}`);
    console.log(`  openingBalance: ${openingBalance}`);
    console.log(`  totalDebit (ledger): ${totalDebit}`);
    console.log(`  totalCredit (ledger): ${totalCredit}`);
    console.log(`  calculatedClosing: ${calculatedClosing} ${balanceType}`);
    console.log(`  stored currentBalance: ${storedBalance}`);
    console.log(`  staged tallyVouchers (IMPORTED): ${stagedCount}`);
    console.log(`  creditLedger entries: ${creditLedgerCount}`);
    console.log(`  customerLedgerTransaction entries: ${cltCount}`);
    console.log(`  isActive: ${customer.isActive}`);
    console.log("---");
  }

  // Check duplicate detection
  console.log("\n=== DUPLICATE DETECTION CHECK ===");
  const batchIds = await prisma.tallyImportBatch.findMany({
    where: { status: "COMPLETED" },
    select: { id: true, originalFileName: true, totalVouchers: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 3,
  });

  for (const b of batchIds) {
    const importedCount = await prisma.tallyVoucher.count({
      where: { importBatchId: b.id, importStatus: "IMPORTED" },
    });
    const duplicateCount = await prisma.tallyVoucher.count({
      where: { importBatchId: b.id, isDuplicate: true },
    });
    console.log(`  Batch ${b.id}: ${b.originalFileName}`);
    console.log(`    totalVouchers: ${b.totalVouchers}, imported: ${importedCount}, duplicates: ${duplicateCount}`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});