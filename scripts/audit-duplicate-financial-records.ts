/**
 * Audit script: Identifies duplicate financial records across models.
 *
 * This script scans the database for transactions that exist in multiple models
 * (CreditLedger, CustomerLedgerTransaction) and groups them for review.
 *
 * Usage:
 *   npx tsx scripts/audit-duplicate-financial-records.ts
 *   npx tsx scripts/audit-duplicate-financial-records.ts --customer-id=<id>
 *
 * ROOT CAUSE OF DUPLICATES:
 * The import route was creating records in BOTH:
 *   1. CreditLedger (for ledger display)
 *   2. CustomerLedgerTransaction (for imported transaction display)
 *
 * The ledger query was then concatenating records from both sources,
 * causing every transaction to appear twice.
 *
 * This audit identifies all such duplicate pairs.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface DuplicateGroup {
  customerId: string;
  voucherType: string;
  voucherNumber: string;
  transactionDate: Date;
  debit: number;
  credit: number;
  canonicalRecord: {
    model: string;
    id: string;
    source: string;
  };
  duplicateRecord: {
    model: string;
    id: string;
    source: string;
  };
  bothCounted: boolean;
}

async function audit() {
  console.log("=".repeat(80));
  console.log("DUPLICATE FINANCIAL RECORDS AUDIT");
  console.log("=".repeat(80));

  // Parse command-line args
  const args = process.argv.slice(2);
  const customerFilter = args
    .find((a) => a.startsWith("--customer-id="))
    ?.split("=")[1];

  // 1. Count records in each model
  const [
    creditLedgerCount,
    customerLedgerTxnCount,
    saleCount,
    paymentCount,
    tallyVoucherCount,
  ] = await Promise.all([
    prisma.creditLedger.count(),
    prisma.customerLedgerTransaction.count(),
    prisma.sale.count(),
    prisma.payment.count(),
    prisma.tallyVoucher.count({ where: { importStatus: "IMPORTED" } }),
  ]);

  console.log("\n📊 DATABASE RECORD COUNTS:");
  console.log(`  CreditLedger entries:          ${creditLedgerCount}`);
  console.log(`  CustomerLedgerTransaction:      ${customerLedgerTxnCount}`);
  console.log(`  Sale records:                   ${saleCount}`);
  console.log(`  Payment records:                ${paymentCount}`);
  console.log(`  TallyVoucher (IMPORTED):         ${tallyVoucherCount}`);

  // 2. Find duplicates by matching CreditLedger with CustomerLedgerTransaction
  //    Match on: customerId + amount + date (within same day)
  console.log("\n🔍 CROSS-MODEL DUPLICATE ANALYSIS:");
  console.log("   (CreditLedger vs CustomerLedgerTransaction)\n");

  const duplicateGroups: DuplicateGroup[] = [];

  // Get all non-OPENING_BALANCE credit ledger entries
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

  // Get all customer ledger transactions
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

  // Build lookup map: customerId -> CustomerLedgerTransaction[]
  const txnByCustomer = new Map<string, typeof ledgerTxns>();
  for (const txn of ledgerTxns) {
    if (!txnByCustomer.has(txn.customerId)) {
      txnByCustomer.set(txn.customerId, []);
    }
    txnByCustomer.get(txn.customerId)!.push(txn);
  }

  let matchedDuplicates = 0;
  let unmatchedCreditLedger = 0;
  let unmatchedLedgerTxns = 0;

  // For each CreditLedger entry, find matching CustomerLedgerTransaction
  const matchedTxnIds = new Set<string>();

  for (const cl of creditLedgerEntries) {
    const customerTxns = txnByCustomer.get(cl.customerId) ?? [];
    const isDebit = ["CREDIT_SALE", "SALE_CANCELLED"].includes(cl.transactionType);
    const clAmount = Number(cl.amount);

    // Find matching transaction: same amount + same date
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
      matchedDuplicates++;

      const vType = isDebit ? "SALES" : "RECEIPT";
      const vNumber = match.voucherNumber ?? "";

      duplicateGroups.push({
        customerId: cl.customerId,
        voucherType: vType,
        voucherNumber: vNumber,
        transactionDate: cl.createdAt,
        debit: isDebit ? clAmount : 0,
        credit: isDebit ? 0 : clAmount,
        canonicalRecord: {
          model: "CreditLedger",
          id: cl.id,
          source: cl.saleId ? `Sale:${cl.saleId}` : cl.paymentId ? `Payment:${cl.paymentId}` : "direct",
        },
        duplicateRecord: {
          model: "CustomerLedgerTransaction",
          id: match.id,
          source: `vType=${match.voucherType} vNum=${match.voucherNumber ?? ""}`,
        },
        bothCounted: true, // Both were being counted in the ledger
      });
    } else {
      unmatchedCreditLedger++;
    }
  }

  unmatchedLedgerTxns = ledgerTxns.length - matchedTxnIds.size;

  // Report
  console.log(`\n📋 DUPLICATE GROUPS FOUND: ${duplicateGroups.length}`);
  console.log(`  CreditLedger entries matched:    ${matchedDuplicates}`);
  console.log(`  CreditLedger unmatched:          ${unmatchedCreditLedger}`);
  console.log(`  CustomerLedgerTxn unmatched:     ${unmatchedLedgerTxns}`);

  if (duplicateGroups.length > 0) {
    console.log("\n📝 DUPLICATE GROUP DETAILS:\n");
    for (const group of duplicateGroups) {
      console.log(`  [${group.voucherType}] Voucher #${group.voucherNumber || "N/A"}`);
      console.log(`    Customer:     ${group.customerId}`);
      console.log(`    Date:         ${group.transactionDate.toISOString().split("T")[0]}`);
      console.log(`    Debit:        ₹${group.debit}`);
      console.log(`    Credit:       ₹${group.credit}`);
      console.log(`    Canonical:    ${group.canonicalRecord.model} (${group.canonicalRecord.id}) — ${group.canonicalRecord.source}`);
      console.log(`    Duplicate:    ${group.duplicateRecord.model} (${group.duplicateRecord.id}) — ${group.duplicateRecord.source}`);
      console.log(`    Both counted: ${group.bothCounted ? "YES ⚠️" : "No"}`);
      console.log(`    Safe cleanup: Delete CustomerLedgerTransaction record (${group.duplicateRecord.id})`);
      console.log();
    }
  }

  // 3. Check for duplicate customer balance issues
  console.log("\n💰 CUSTOMER BALANCE ANALYSIS:");
  console.log("   (Comparing currentBalance with ledger-calculated balance)\n");

  const customersWithIssues: Array<{
    id: string;
    fullName: string;
    currentBalance: number;
    calculatedBalance: number;
    diff: string;
  }> = [];

  const customers = await prisma.customer.findMany({
    where: {
      ...(customerFilter ? { id: customerFilter } : {}),
      isActive: true,
      deletedAt: null,
    },
    select: {
      id: true,
      fullName: true,
      openingBalance: true,
      currentBalance: true,
    },
  });

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
    const diff = calculatedBalance - storedBalance;

    if (Math.abs(diff) > 0.01) {
      customersWithIssues.push({
        id: customer.id,
        fullName: customer.fullName,
        currentBalance: storedBalance,
        calculatedBalance,
        diff: diff > 0 ? `+₹${diff.toFixed(2)}` : `-₹${Math.abs(diff).toFixed(2)}`,
      });
    }
  }

  if (customersWithIssues.length > 0) {
    console.log(`  ⚠️ ${customersWithIssues.length} customer(s) with balance mismatch:`);
    for (const c of customersWithIssues) {
      console.log(`    ${c.fullName} (${c.id})`);
      console.log(`      Stored: ₹${c.currentBalance.toFixed(2)}`);
      console.log(`      Calculated: ₹${c.calculatedBalance.toFixed(2)}`);
      console.log(`      Diff: ${c.diff}`);
    }
  } else {
    console.log("  ✅ All customer balances match calculated values.");
  }

  // 4. Check for duplicate CustomerLedgerTransaction records by source fields
  console.log("\n🔎 CUSTOMERLEDGERTRANSACTION INTERNAL DUPLICATES:");
  console.log("   (Same customer + amount + date)\n");

  const txnDuplicateMap = new Map<string, number>();
  const txnDuplicateIds: string[] = [];

  for (const txn of ledgerTxns) {
    const amount = Number(txn.debit) > 0 ? Number(txn.debit) : Number(txn.credit);
    const date = new Date(txn.transactionDate);
    date.setHours(0, 0, 0, 0);
    const key = `${txn.customerId}:${amount}:${date.getTime()}:${txn.voucherType}`;
    const count = txnDuplicateMap.get(key) ?? 0;
    txnDuplicateMap.set(key, count + 1);
    if (count >= 1) {
      txnDuplicateIds.push(txn.id);
    }
  }

  const internalDuplicateCount = [...txnDuplicateMap.values()].filter((c) => c > 1).length;

  if (internalDuplicateCount > 0) {
    console.log(`  ⚠️ Found ${txnDuplicateIds.length} records involved in ${internalDuplicateCount} internal duplicate group(s).`);
  } else {
    console.log("  ✅ No internal duplicates in CustomerLedgerTransaction.");
  }

  // 5. Check for duplicate Sale records by invoiceNumber
  console.log("\n🔎 SALE RECORD INTERNAL DUPLICATES:");
  console.log("   (Same invoiceNumber appearing multiple times)\n");

  const salesWithInvoice = await prisma.sale.findMany({
    where: {
      ...(customerFilter ? { customerId: customerFilter } : {}),
    },
    select: {
      id: true,
      invoiceNumber: true,
      customerId: true,
    },
  });

  const invoiceMap = new Map<string, typeof salesWithInvoice>();
  for (const sale of salesWithInvoice) {
    if (!invoiceMap.has(sale.invoiceNumber)) {
      invoiceMap.set(sale.invoiceNumber, []);
    }
    invoiceMap.get(sale.invoiceNumber)!.push(sale);
  }

  let duplicateInvoices = 0;
  for (const [invNum, sales] of invoiceMap) {
    if (sales.length > 1) {
      duplicateInvoices++;
      console.log(`  ⚠️ Invoice ${invNum} appears ${sales.length} times:`);
      for (const s of sales) {
        console.log(`    - ${s.id} (customer: ${s.customerId})`);
      }
    }
  }

  if (duplicateInvoices === 0) {
    console.log("  ✅ No duplicate Sale records found.");
  }

  // Summary
  console.log("\n" + "=".repeat(80));
  console.log("AUDIT SUMMARY");
  console.log("=".repeat(80));
  console.log(`  Cross-model duplicate groups:  ${duplicateGroups.length}`);
  console.log(`  Unique CreditLedger records:    ${creditLedgerCount}`);
  console.log(`  CustomerLedgerTxn records:      ${customerLedgerTxnCount}`);
  console.log(`  Duplicate Sale invNumbers:       ${duplicateInvoices}`);
  console.log(`  Customers with balance mismatch: ${customersWithIssues.length}`);

  if (duplicateGroups.length > 0) {
    console.log("\n⚠️  RECOMMENDED ACTION:");
    console.log("  Run: npx tsx scripts/repair-existing-financial-duplicates.ts");
    console.log("  to safely remove duplicate CustomerLedgerTransaction records.");
  }

  await prisma.$disconnect();
}

audit().catch((err) => {
  console.error("Audit failed:", err);
  process.exit(1);
});