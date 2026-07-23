/**
 * Audit Overdue Data — Read-Only Diagnostic Script
 *
 * Reports the state of overdue data in the database.
 * Does not modify any data.
 *
 * Usage:
 *   npx tsx scripts/audit-overdue-data.ts
 */

import { prisma } from "../src/lib/prisma";
import { Decimal } from "@prisma/client/runtime/library";
import { allocateCreditsToSales, getISTStartOfToday, getDefaultCreditDays } from "../src/lib/accounting";

async function main() {
  console.log("=".repeat(80));
  console.log("  OVERDUE DATA AUDIT — Read Only");
  console.log("=".repeat(80));

  // ── 1. Count permanent records ────────────────────────────────────────────
  const [saleCount, paymentCount, customerCount, activeCustomerCount] = await Promise.all([
    prisma.sale.count(),
    prisma.payment.count(),
    prisma.customer.count(),
    prisma.customer.count({ where: { isActive: true, deletedAt: null } }),
  ]);

  console.log("\n📊 Database Record Counts:");
  console.log(`   Total Sales (permanent):     ${saleCount}`);
  console.log(`   Total Payments (permanent):  ${paymentCount}`);
  console.log(`   Total Customers:             ${customerCount}`);
  console.log(`   Active Customers:            ${activeCustomerCount}`);

  // ── 2. Sales with null dueDate ────────────────────────────────────────────
  const nullDueDateSales = await prisma.sale.count({
    where: {
      dueDate: null,
      status: { in: ["COMPLETED", "PARTIALLY_RETURNED"] },
      saleType: { in: ["CREDIT", "PARTIAL"] },
    },
  });

  const totalCreditSales = await prisma.sale.count({
    where: {
      status: { in: ["COMPLETED", "PARTIALLY_RETURNED"] },
      saleType: { in: ["CREDIT", "PARTIAL"] },
    },
  });

  console.log(`\n📅 Due Date Analysis:`);
  console.log(`   Total credit/partial Sales:  ${totalCreditSales}`);
  console.log(`   Sales with null dueDate:     ${nullDueDateSales}`);
  console.log(`   Sales with dueDate set:      ${totalCreditSales - nullDueDateSales}`);

  // ── 3. Sales with pending amount ──────────────────────────────────────────
  const salesWithPending = await prisma.sale.count({
    where: {
      status: { in: ["COMPLETED", "PARTIALLY_RETURNED"] },
      saleType: { in: ["CREDIT", "PARTIAL"] },
      pendingAmount: { gt: 0 },
    },
  });

  const fullyPaidSales = await prisma.sale.count({
    where: {
      status: { in: ["COMPLETED", "PARTIALLY_RETURNED"] },
      saleType: { in: ["CREDIT", "PARTIAL"] },
      pendingAmount: { lte: 0 },
    },
  });

  console.log(`\n💰 Payment Status:`);
  console.log(`   Sales with pending amount:   ${salesWithPending}`);
  console.log(`   Fully paid Sales:            ${fullyPaidSales}`);

  // ── 4. Staging/excluded records ───────────────────────────────────────────
  const [stagingVouchers, failedVouchers, duplicateVouchers, orphanVouchers] = await Promise.all([
    prisma.tallyVoucher.count({ where: { importStatus: { in: ["PARSED", "VALID", "MATCHED"] } } }),
    prisma.tallyVoucher.count({ where: { importStatus: "FAILED" } }),
    prisma.tallyVoucher.count({ where: { isDuplicate: true } }),
    prisma.tallyVoucher.count({ where: { customerId: null, importStatus: "IMPORTED" } }),
  ]);

  console.log(`\n🚫 Excluded Records:`);
  console.log(`   Staging vouchers (not imported): ${stagingVouchers}`);
  console.log(`   Failed vouchers:                 ${failedVouchers}`);
  console.log(`   Duplicate vouchers:              ${duplicateVouchers}`);
  console.log(`   Orphan vouchers (no customer):   ${orphanVouchers}`);

  // ── 5. Inactive/deleted customers ─────────────────────────────────────────
  const [inactiveCustomers, deletedCustomers] = await Promise.all([
    prisma.customer.count({ where: { isActive: false } }),
    prisma.customer.count({ where: { deletedAt: { not: null } } }),
  ]);

  console.log(`\n👤 Customer Status:`);
  console.log(`   Inactive customers:          ${inactiveCustomers}`);
  console.log(`   Soft-deleted customers:      ${deletedCustomers}`);

  // ── 6. Overdue analysis using the shared service ──────────────────────────
  console.log(`\n🔍 Overdue Analysis (via allocateCreditsToSales):`);

  const activeCustomersList = await prisma.customer.findMany({
    where: { isActive: true, deletedAt: null },
    select: { id: true, fullName: true, customerCode: true, openingBalance: true, currentBalance: true },
  });

  let totalOverdueAmount = new Decimal(0);
  let totalOverdueInvoices = 0;
  let totalOverdueCustomers = 0;
  let customersWithBalanceNoOverdue = 0;

  const istToday = getISTStartOfToday();

  for (const customer of activeCustomersList) {
    const salesWithOutstanding = await allocateCreditsToSales(customer.id);
    const overdueSales = salesWithOutstanding.filter((s) => s.isOverdue);
    const hasPositiveBalance = customer.currentBalance.gt(0);

    if (overdueSales.length > 0) {
      totalOverdueCustomers++;
      totalOverdueInvoices += overdueSales.length;
      for (const s of overdueSales) {
        totalOverdueAmount = totalOverdueAmount.add(s.remainingAfterAllocation);
      }
    } else if (hasPositiveBalance) {
      customersWithBalanceNoOverdue++;
    }
  }

  console.log(`   Overdue customers:           ${totalOverdueCustomers}`);
  console.log(`   Overdue invoices:            ${totalOverdueInvoices}`);
  console.log(`   Total overdue amount:        ₹${totalOverdueAmount.toFixed(2)}`);
  console.log(`   Customers with balance but no overdue: ${customersWithBalanceNoOverdue}`);

  // ── 7. Sample customer details (first 5 with overdue) ─────────────────────
  console.log(`\n📋 Sample Customer Details (first 5 with overdue):`);
  let sampleCount = 0;

  for (const customer of activeCustomersList) {
    if (sampleCount >= 5) break;

    const salesWithOutstanding = await allocateCreditsToSales(customer.id);
    const overdueSales = salesWithOutstanding.filter((s) => s.isOverdue);

    if (overdueSales.length === 0) continue;

    sampleCount++;
    console.log(`\n   ── Customer: ${customer.fullName} (${customer.customerCode}) ──`);
    console.log(`      Opening Balance: ₹${customer.openingBalance.toFixed(2)}`);
    console.log(`      Current Balance: ₹${customer.currentBalance.toFixed(2)}`);

    const [salesAgg, paymentAgg] = await Promise.all([
      prisma.sale.aggregate({
        where: { customerId: customer.id, status: { in: ["COMPLETED", "PARTIALLY_RETURNED"] } },
        _sum: { grandTotal: true },
      }),
      prisma.payment.aggregate({
        where: { customerId: customer.id, status: "COMPLETED" },
        _sum: { amount: true },
      }),
    ]);

    console.log(`      Total Sales: ₹${(salesAgg._sum.grandTotal ?? new Decimal(0)).toFixed(2)}`);
    console.log(`      Total Payments: ₹${(paymentAgg._sum.amount ?? new Decimal(0)).toFixed(2)}`);

    for (const sale of overdueSales) {
      console.log(`\n      Invoice: ${sale.invoiceNumber}`);
      console.log(`         Date: ${sale.createdAt.toISOString().slice(0, 10)}`);
      console.log(`         Original Due Date: ${sale.dueDate ? sale.dueDate.toISOString().slice(0, 10) : "null"}`);
      console.log(`         Effective Due Date: ${sale.effectiveDueDate.toISOString().slice(0, 10)}`);
      console.log(`         Grand Total: ₹${sale.grandTotal.toFixed(2)}`);
      console.log(`         Paid Amount: ₹${sale.paidAmount.toFixed(2)}`);
      console.log(`         Pending Amount: ₹${sale.pendingAmount.toFixed(2)}`);
      console.log(`         Remaining After Allocation: ₹${sale.remainingAfterAllocation.toFixed(2)}`);
      console.log(`         Days Overdue: ${Math.max(0, Math.floor((istToday.getTime() - sale.effectiveDueDate.getTime()) / (1000 * 60 * 60 * 24)))}`);
    }
  }

  if (sampleCount === 0) {
    console.log("   (No overdue customers found)");
  }

  // ── 8. Summary ────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(80));
  console.log("  AUDIT SUMMARY");
  console.log("=".repeat(80));
  console.log(`  Permanent Sales:              ${saleCount}`);
  console.log(`  Permanent Receipts:           ${paymentCount}`);
  console.log(`  Sales with null dueDate:      ${nullDueDateSales}`);
  console.log(`  Sales using fallback dueDate: ${nullDueDateSales} (via resolveEffectiveDueDate)`);
  console.log(`  Fully paid Sales excluded:    ${fullyPaidSales}`);
  console.log(`  Unpaid overdue Sales:         ${totalOverdueInvoices}`);
  console.log(`  Overdue customers:            ${totalOverdueCustomers}`);
  console.log(`  Total overdue amount:         ₹${totalOverdueAmount.toFixed(2)}`);
  console.log(`  Customers with balance/no overdue: ${customersWithBalanceNoOverdue}`);
  console.log(`  Staging records excluded:     ${stagingVouchers}`);
  console.log(`  Orphan records:               ${orphanVouchers}`);
  console.log("=".repeat(80));

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Audit failed:", err);
  process.exit(1);
});