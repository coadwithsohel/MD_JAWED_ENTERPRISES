// ─── Database State Audit Script ──────────────────────────────────────────
// Run: npx tsx scripts/audit-database-state.ts
// This is a read-only audit. It does NOT modify any data.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("=== DATABASE STATE AUDIT ===\n");
  console.log(`Database URL: ${(process.env.DATABASE_URL || "").replace(/\/\/[^:]+:[^@]+@/, "//***:***@")}`);
  console.log(`Direct URL: ${(process.env.DIRECT_URL || "").replace(/\/\/[^:]+:[^@]+@/, "//***:***@")}`);
  console.log("");

  // ─── Customer Counts ───────────────────────────────────────────────────
  const totalCustomers = await prisma.customer.count();
  const activeCustomers = await prisma.customer.count({ where: { isActive: true, deletedAt: null } });
  const inactiveCustomers = await prisma.customer.count({ where: { isActive: false, deletedAt: null } });
  const softDeletedCustomers = await prisma.customer.count({ where: { deletedAt: { not: null } } });
  console.log("=== CUSTOMER COUNTS ===");
  console.log(`Total: ${totalCustomers}`);
  console.log(`Active: ${activeCustomers}`);
  console.log(`Inactive: ${inactiveCustomers}`);
  console.log(`Soft-deleted: ${softDeletedCustomers}`);
  console.log("");

  // ─── Opening Balance Total ──────────────────────────────────────────────
  const obAgg = await prisma.customer.aggregate({ _sum: { openingBalance: true } });
  console.log(`Total Opening Balance: ${Number(obAgg._sum.openingBalance ?? 0)}`);

  // ─── Permanent Transaction Counts ──────────────────────────────────────
  const saleCount = await prisma.sale.count();
  const paymentCount = await prisma.payment.count();
  const creditLedgerCount = await prisma.creditLedger.count();
  const customerLedgerTxCount = await prisma.customerLedgerTransaction.count();
  console.log("\n=== PERMANENT TRANSACTIONS ===");
  console.log(`Sales (Sale model): ${saleCount}`);
  console.log(`Payments: ${paymentCount}`);
  console.log(`CreditLedger entries: ${creditLedgerCount}`);
  console.log(`CustomerLedgerTransaction entries: ${customerLedgerTxCount}`);

  // Sales aggregates
  const saleAgg = await prisma.sale.aggregate({
    _sum: { grandTotal: true, paidAmount: true, pendingAmount: true },
    _count: { _all: true },
    where: { status: { in: ["COMPLETED", "PARTIALLY_RETURNED"] }, saleType: { in: ["CREDIT", "PARTIAL"] } },
  });

  // Sales aggregates for active customers only
  const activeSaleAgg = await prisma.sale.aggregate({
    _sum: { grandTotal: true, paidAmount: true, pendingAmount: true },
    _count: { _all: true },
    where: {
      status: { in: ["COMPLETED", "PARTIALLY_RETURNED"] },
      saleType: { in: ["CREDIT", "PARTIAL"] },
      customer: { isActive: true, deletedAt: null },
    },
  });

  console.log(`\nCredit Sales (all): ${saleAgg._count._all}`);
  console.log(`  Total: ${Number(saleAgg._sum.grandTotal ?? 0)}`);
  console.log(`  Paid: ${Number(saleAgg._sum.paidAmount ?? 0)}`);
  console.log(`  Pending: ${Number(saleAgg._sum.pendingAmount ?? 0)}`);
  console.log(`Credit Sales (active customers only): ${activeSaleAgg._count._all}`);
  console.log(`  Pending (active only): ${Number(activeSaleAgg._sum.pendingAmount ?? 0)}`);

  // ─── Orphan Records ────────────────────────────────────────────────────
  console.log("\n=== ORPHAN RECORDS ===");
  const orphanSales = await prisma.sale.count({
    where: {
      customerId: { not: undefined },
      customer: { is: undefined },
    },
  });
  const orphanPayments = await prisma.payment.count({
    where: {
      customerId: { not: undefined },
      customer: { is: undefined },
    },
  });
  const orphanLedgers = await prisma.creditLedger.count({
    where: {
      customerId: { not: undefined },
      customer: { is: undefined },
    },
  });
  const orphanLedgerTx = await prisma.customerLedgerTransaction.count({
    where: {
      customerId: { not: undefined },
      customer: { is: undefined },
    },
  });

  console.log(`Orphan Sales (missing customer): ${orphanSales}`);
  console.log(`Orphan Payments: ${orphanPayments}`);
  console.log(`Orphan CreditLedger: ${orphanLedgers}`);
  console.log(`Orphan CustomerLedgerTx: ${orphanLedgerTx}`);

  // ─── Import Batch State ────────────────────────────────────────────────
  console.log("\n=== IMPORT BATCH STATE ===");
  const customerBatches = await prisma.customerImportBatch.findMany({
    select: { id: true, originalFileName: true, status: true, totalRows: true, importedRows: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  console.log("Customer Import Batches (last 10):");
  for (const b of customerBatches) {
    const rowCount = await prisma.customerImportRow.count({ where: { importBatchId: b.id } });
    console.log(`  ${b.id}: ${b.originalFileName} - status=${b.status} total=${b.totalRows} imported=${b.importedRows} stagedRows=${rowCount} createdAt=${b.createdAt.toISOString()}`);
  }

  const tallyBatches = await prisma.tallyImportBatch.findMany({
    select: { id: true, originalFileName: true, status: true, totalVouchers: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  console.log("\nTally Import Batches (last 10):");
  for (const b of tallyBatches) {
    const importedCount = await prisma.tallyVoucher.count({ where: { importBatchId: b.id, importStatus: "IMPORTED" } });
    const totalCount = await prisma.tallyVoucher.count({ where: { importBatchId: b.id } });
    console.log(`  ${b.id}: ${b.originalFileName} - status=${b.status} totalVouchers=${b.totalVouchers} staged=${totalCount} imported=${importedCount} createdAt=${b.createdAt.toISOString()}`);
  }

  // ─── Stale/Failed Batches ──────────────────────────────────────────────
  const staleCustomerBatches = await prisma.customerImportBatch.count({
    where: {
      status: { in: ["FAILED", "UPLOADED", "VALIDATING"] },
      importedRows: 0,
    },
  });
  const staleTallyBatches = await prisma.tallyImportBatch.count({
    where: {
      status: { in: ["FAILED", "UPLOADED"] },
      totalVouchers: 0,
    },
  });
  console.log(`\nStale/failed customer batches (no imports): ${staleCustomerBatches}`);
  console.log(`Stale/failed tally batches (no vouchers): ${staleTallyBatches}`);

  // ─── Dashboard Summary Calculations ────────────────────────────────────
  console.log("\n=== DASHBOARD / CREDIT / OVERDUE CALCULATION ===");
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  // Pending Credit (all)
  const pendingAll = await prisma.sale.aggregate({
    where: {
      status: { in: ["COMPLETED", "PARTIALLY_RETURNED"] },
      saleType: { in: ["CREDIT", "PARTIAL"] },
      pendingAmount: { gt: 0 },
    },
    _sum: { pendingAmount: true },
    _count: { _all: true },
  });
  console.log(`Pending Credit (all customers): ${Number(pendingAll._sum.pendingAmount ?? 0)} - ${pendingAll._count._all} sales`);

  // Pending Credit (active customers only)
  const pendingActive = await prisma.sale.aggregate({
    where: {
      status: { in: ["COMPLETED", "PARTIALLY_RETURNED"] },
      saleType: { in: ["CREDIT", "PARTIAL"] },
      pendingAmount: { gt: 0 },
      customer: { isActive: true, deletedAt: null },
    },
    _sum: { pendingAmount: true },
    _count: { _all: true },
  });
  console.log(`Pending Credit (active customers only): ${Number(pendingActive._sum.pendingAmount ?? 0)} - ${pendingActive._count._all} sales`);

  // Overdue (all)
  const overdueAll = await prisma.sale.aggregate({
    where: {
      status: { in: ["COMPLETED", "PARTIALLY_RETURNED"] },
      saleType: { in: ["CREDIT", "PARTIAL"] },
      pendingAmount: { gt: 0 },
      dueDate: { lt: now },
    },
    _sum: { pendingAmount: true },
    _count: { _all: true },
  });
  console.log(`Overdue (all customers): ${Number(overdueAll._sum.pendingAmount ?? 0)} - ${overdueAll._count._all} invoices`);

  // Overdue (active customers only)
  const overdueActive = await prisma.sale.aggregate({
    where: {
      status: { in: ["COMPLETED", "PARTIALLY_RETURNED"] },
      saleType: { in: ["CREDIT", "PARTIAL"] },
      pendingAmount: { gt: 0 },
      dueDate: { lt: now },
      customer: { isActive: true, deletedAt: null },
    },
    _sum: { pendingAmount: true },
    _count: { _all: true },
  });
  console.log(`Overdue (active customers only): ${Number(overdueActive._sum.pendingAmount ?? 0)} - ${overdueActive._count._all} invoices`);

  // Active customer count
  const activeCount = await prisma.customer.count({ where: { isActive: true, deletedAt: null } });
  console.log(`\nActive customer count (Dashboard): ${activeCount}`);

  // Today's sales
  const todaySales = await prisma.sale.aggregate({
    where: { createdAt: { gte: todayStart, lte: todayEnd }, status: "COMPLETED" },
    _sum: { grandTotal: true },
    _count: { _all: true },
  });
  console.log(`Today's Revenue: ${Number(todaySales._sum.grandTotal ?? 0)} - ${todaySales._count._all} invoices`);

  console.log("\n=== AUDIT COMPLETE ===");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Audit failed:", err);
  process.exit(1);
});