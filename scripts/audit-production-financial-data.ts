/**
 * Read-Only Audit Script for MD JAWED ENTERPRISES Production Financial Data
 * Path: scripts/audit-production-financial-data.ts
 *
 * Requirements:
 * - Read-only (does not modify data)
 * - Reports customer, sales, receipt counts
 * - Identifies duplicates, orphans, invalid amounts, scaling issues (x100 / ÷100)
 * - Reports financial totals: opening balance, debit, credit, positive balances, overdue, recent payments
 */
import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";

// Simple env loader
function loadEnvFile(filePath: string) {
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
}

loadEnvFile(path.join(__dirname, "../.env.local"));
loadEnvFile(path.join(__dirname, "../.env"));

const prisma = new PrismaClient();

async function runAudit() {
  console.log("==================================================");
  console.log("PRODUCTION FINANCIAL DATA AUDIT (READ-ONLY)");
  console.log("==================================================");

  // 1. Customer Counts
  const totalCustomers = await prisma.customer.count();
  const activeCustomers = await prisma.customer.count({ where: { isActive: true, deletedAt: null } });
  const inactiveCustomers = await prisma.customer.count({ where: { isActive: false, deletedAt: null } });
  const deletedCustomers = await prisma.customer.count({ where: { deletedAt: { not: null } } });
  
  // Imported customers check (customers created via batch or tally import)
  const importedCustomers = await prisma.customer.count({
    where: {
      OR: [
        { importRows: { some: {} } },
        { tallyVouchers: { some: {} } },
      ]
    }
  });

  console.log("\n--- 1. CUSTOMER COUNTS ---");
  console.log(`Total Customers: ${totalCustomers}`);
  console.log(`Imported Customers: ${importedCustomers}`);
  console.log(`Active Customers: ${activeCustomers}`);
  console.log(`Inactive Customers: ${inactiveCustomers}`);
  console.log(`Deleted Customers: ${deletedCustomers}`);

  // 2. Transaction Counts (Sales & Receipts)
  const saleCount = await prisma.sale.count();
  const paymentCount = await prisma.payment.count();
  const tallySalesCount = await prisma.tallyVoucher.count({ where: { voucherType: "SALES" } });
  const tallyReceiptCount = await prisma.tallyVoucher.count({ where: { voucherType: "RECEIPT" } });
  const ledgerTxSalesCount = await prisma.customerLedgerTransaction.count({ where: { voucherType: "SALES" } });
  const ledgerTxReceiptCount = await prisma.customerLedgerTransaction.count({ where: { voucherType: "RECEIPT" } });

  console.log("\n--- 2. TRANSACTION COUNTS ---");
  console.log(`Sales Model Count: ${saleCount}`);
  console.log(`Payment Model Count: ${paymentCount}`);
  console.log(`TallyVoucher Sales: ${tallySalesCount}`);
  console.log(`TallyVoucher Receipts: ${tallyReceiptCount}`);
  console.log(`CustomerLedgerTransaction Sales: ${ledgerTxSalesCount}`);
  console.log(`CustomerLedgerTransaction Receipts: ${ledgerTxReceiptCount}`);

  // 3. Duplicate Source Entry Keys & Cross-Model Duplicates
  const voucherKeys = await prisma.tallyVoucher.groupBy({
    by: ["voucherKey"],
    where: { voucherKey: { not: null } },
    _count: { voucherKey: true },
    having: { voucherKey: { _count: { gt: 1 } } },
  });

  const tallyGuids = await prisma.tallyVoucher.groupBy({
    by: ["tallyGuid"],
    where: { tallyGuid: { not: null } },
    _count: { tallyGuid: true },
    having: { tallyGuid: { _count: { gt: 1 } } },
  });

  console.log("\n--- 3. DUPLICATE ANALYSIS ---");
  console.log(`Duplicate Tally voucherKeys: ${voucherKeys.length}`);
  console.log(`Duplicate Tally GUIDs: ${tallyGuids.length}`);

  // 4. Orphan Records
  const unassignedSales = await prisma.sale.count({ where: { customerId: null } });
  const unassignedTallyVouchers = await prisma.tallyVoucher.count({ where: { customerId: null } });

  // DB level orphan check using Prisma counts where customer relation is missing
  const orphanSalesRes: Array<{ count: bigint }> = await prisma.$queryRaw`
    SELECT COUNT(*) as count FROM "Sale" WHERE "customerId" IS NOT NULL AND "customerId" NOT IN (SELECT "id" FROM "Customer")
  `;
  const orphanPaymentsRes: Array<{ count: bigint }> = await prisma.$queryRaw`
    SELECT COUNT(*) as count FROM "Payment" WHERE "customerId" NOT IN (SELECT "id" FROM "Customer")
  `;
  const orphanCreditLedgersRes: Array<{ count: bigint }> = await prisma.$queryRaw`
    SELECT COUNT(*) as count FROM "CreditLedger" WHERE "customerId" NOT IN (SELECT "id" FROM "Customer")
  `;
  const orphanLedgerTxsRes: Array<{ count: bigint }> = await prisma.$queryRaw`
    SELECT COUNT(*) as count FROM "CustomerLedgerTransaction" WHERE "customerId" NOT IN (SELECT "id" FROM "Customer")
  `;

  const orphanSales = Number(orphanSalesRes[0]?.count ?? 0);
  const orphanPayments = Number(orphanPaymentsRes[0]?.count ?? 0);
  const orphanCreditLedgers = Number(orphanCreditLedgersRes[0]?.count ?? 0);
  const orphanLedgerTxs = Number(orphanLedgerTxsRes[0]?.count ?? 0);

  console.log("\n--- 4. ORPHAN / UNASSIGNED RECORDS ---");
  console.log(`Unassigned Sales (customerId = null): ${unassignedSales}`);
  console.log(`Unassigned TallyVouchers (customerId = null): ${unassignedTallyVouchers}`);
  console.log(`Orphan Sales (invalid customerId): ${orphanSales}`);
  console.log(`Orphan Payments (invalid customerId): ${orphanPayments}`);
  console.log(`Orphan CreditLedger Rows: ${orphanCreditLedgers}`);
  console.log(`Orphan CustomerLedgerTransactions: ${orphanLedgerTxs}`);

  // 5. Invalid Monetary Values & Scaling Candidates
  const invalidSales: Array<{ count: bigint }> = await prisma.$queryRaw`
    SELECT COUNT(*) as count FROM "Sale" WHERE "grandTotal" < 0 OR "pendingAmount" < 0
  `;
  const scaledSales: Array<{ count: bigint }> = await prisma.$queryRaw`
    SELECT COUNT(*) as count FROM "Sale" WHERE "grandTotal" > 1000000
  `;
  const divSales: Array<{ count: bigint }> = await prisma.$queryRaw`
    SELECT COUNT(*) as count FROM "Sale" WHERE "grandTotal" > 0 AND "grandTotal" < 1
  `;

  const invalidPayments: Array<{ count: bigint }> = await prisma.$queryRaw`
    SELECT COUNT(*) as count FROM "Payment" WHERE "amount" < 0
  `;
  const scaledPayments: Array<{ count: bigint }> = await prisma.$queryRaw`
    SELECT COUNT(*) as count FROM "Payment" WHERE "amount" > 1000000
  `;
  const divPayments: Array<{ count: bigint }> = await prisma.$queryRaw`
    SELECT COUNT(*) as count FROM "Payment" WHERE "amount" > 0 AND "amount" < 1
  `;

  const invalidVouchers: Array<{ count: bigint }> = await prisma.$queryRaw`
    SELECT COUNT(*) as count FROM "TallyVoucher" WHERE "debit" < 0 OR "credit" < 0
  `;
  const scaledVouchers: Array<{ count: bigint }> = await prisma.$queryRaw`
    SELECT COUNT(*) as count FROM "TallyVoucher" WHERE "debit" > 1000000 OR "credit" > 1000000
  `;
  const divVouchers: Array<{ count: bigint }> = await prisma.$queryRaw`
    SELECT COUNT(*) as count FROM "TallyVoucher" WHERE ("debit" > 0 AND "debit" < 1) OR ("credit" > 0 AND "credit" < 1)
  `;

  const invalidMonetaryCount = Number(invalidSales[0]?.count ?? 0) + Number(invalidPayments[0]?.count ?? 0) + Number(invalidVouchers[0]?.count ?? 0);
  const scaledBy100Candidates = Number(scaledSales[0]?.count ?? 0) + Number(scaledPayments[0]?.count ?? 0) + Number(scaledVouchers[0]?.count ?? 0);
  const dividedBy100Candidates = Number(divSales[0]?.count ?? 0) + Number(divPayments[0]?.count ?? 0) + Number(divVouchers[0]?.count ?? 0);

  console.log("\n--- 5. MONETARY VALIDATION ---");
  console.log(`Invalid Monetary Values: ${invalidMonetaryCount}`);
  console.log(`Scaled-by-100 Candidates (> ₹1,000,000): ${scaledBy100Candidates}`);
  console.log(`Divided-by-100 Candidates (< ₹1): ${dividedBy100Candidates}`);

  // 6. Financial Totals
  const obAgg = await prisma.customer.aggregate({ _sum: { openingBalance: true } });
  const totalOpeningBalance = Number(obAgg._sum.openingBalance ?? 0);

  const tallyDebitAgg = await prisma.tallyVoucher.aggregate({
    where: { voucherType: { in: ["SALES", "DEBIT_NOTE"] } },
    _sum: { debit: true },
  });
  const totalTallyDebit = Number(tallyDebitAgg._sum.debit ?? 0);

  const tallyCreditAgg = await prisma.tallyVoucher.aggregate({
    where: { voucherType: { in: ["RECEIPT", "CREDIT_NOTE"] } },
    _sum: { credit: true },
  });
  const totalTallyCredit = Number(tallyCreditAgg._sum.credit ?? 0);

  const saleTotalAgg = await prisma.sale.aggregate({
    where: { status: "COMPLETED" },
    _sum: { grandTotal: true },
  });
  const totalSaleGrandTotal = Number(saleTotalAgg._sum.grandTotal ?? 0);

  const paymentTotalAgg = await prisma.payment.aggregate({
    where: { status: "COMPLETED" },
    _sum: { amount: true },
  });
  const totalPaymentAmount = Number(paymentTotalAgg._sum.amount ?? 0);

  // Positive Customer Balances
  const posBalanceRes: Array<{ sum: Decimal | number | null }> = await prisma.$queryRaw`
    SELECT SUM("currentBalance") as sum FROM "Customer" WHERE "isActive" = true AND "deletedAt" IS NULL AND "currentBalance" > 0
  `;
  const positiveBalanceTotal = Number(posBalanceRes[0]?.sum ?? 0);

  // Overdue Totals
  const now = new Date();
  const overdueSalesAgg = await prisma.sale.aggregate({
    where: {
      status: { in: ["COMPLETED", "PARTIALLY_RETURNED"] },
      pendingAmount: { gt: 0 },
      dueDate: { lt: now },
      customer: { isActive: true, deletedAt: null }
    },
    _sum: { pendingAmount: true }
  });
  const totalOverdue = Number(overdueSalesAgg._sum.pendingAmount ?? 0);

  // Recent Payments (Last 30 days up to 25 July 2026)
  const endDate = new Date("2026-07-25T23:59:59.999Z");
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 30);

  const recentPaymentsAgg = await prisma.payment.aggregate({
    where: {
      paymentDate: { gte: startDate, lte: endDate },
      status: "COMPLETED"
    },
    _sum: { amount: true },
    _count: { _all: true }
  });

  const recentPaymentsAmount = Number(recentPaymentsAgg._sum.amount ?? 0);
  const recentPaymentsCount = recentPaymentsAgg._count._all;

  console.log("\n--- 6. FINANCIAL TOTALS ---");
  console.log(`Opening Balance Total: ₹${totalOpeningBalance.toLocaleString("en-IN")}`);
  console.log(`Tally Voucher Debit Total: ₹${totalTallyDebit.toLocaleString("en-IN")}`);
  console.log(`Tally Voucher Credit Total: ₹${totalTallyCredit.toLocaleString("en-IN")}`);
  console.log(`Sale Model GrandTotal: ₹${totalSaleGrandTotal.toLocaleString("en-IN")}`);
  console.log(`Payment Model Amount: ₹${totalPaymentAmount.toLocaleString("en-IN")}`);
  console.log(`Positive Balance Total (Outstanding): ₹${positiveBalanceTotal.toLocaleString("en-IN")}`);
  console.log(`Overdue Total: ₹${totalOverdue.toLocaleString("en-IN")}`);
  console.log(`Recent Payments (Last 30 Days): ₹${recentPaymentsAmount.toLocaleString("en-IN")} (${recentPaymentsCount} payments)`);

  console.log("\n==================================================");
  console.log("READ-ONLY AUDIT COMPLETE");
  console.log("==================================================");
}

runAudit()
  .catch((err) => {
    console.error("Audit script failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
