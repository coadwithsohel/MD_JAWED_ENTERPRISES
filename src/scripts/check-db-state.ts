import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("=== DATABASE STATE ===");
  console.log("Customers:", await prisma.customer.count({ where: { isActive: true, deletedAt: null } }));
  console.log("Sales:", await prisma.sale.count());
  console.log("Payments:", await prisma.payment.count());
  console.log("CreditLedger:", await prisma.creditLedger.count());
  console.log("TallyVouchers:", await prisma.tallyVoucher.count());
  console.log("TallyVouchers IMPORTED:", await prisma.tallyVoucher.count({ where: { importStatus: "IMPORTED" } }));
  console.log("TallyImportBatches:", await prisma.tallyImportBatch.count());

  const bigVouchers = await prisma.tallyVoucher.findMany({ where: { debit: { gt: 100000 } }, take: 5, select: { id: true, debit: true, credit: true, voucherType: true, voucherNumber: true } });
  console.log("\nVouchers with debit > 100000:", bigVouchers.length);
  bigVouchers.forEach(v => console.log("  ", v.id.slice(0,20), v.debit, v.credit, v.voucherType, v.voucherNumber));

  const bigSales = await prisma.sale.findMany({ where: { grandTotal: { gt: 100000 } }, take: 5, select: { id: true, invoiceNumber: true, grandTotal: true, paidAmount: true, pendingAmount: true } });
  console.log("\nSales with grandTotal > 100000:", bigSales.length);
  bigSales.forEach(s => console.log("  ", s.id.slice(0,20), s.invoiceNumber, s.grandTotal, s.paidAmount, s.pendingAmount));

  const bigPayments = await prisma.payment.findMany({ where: { amount: { gt: 100000 } }, take: 5, select: { id: true, receiptNumber: true, amount: true } });
  console.log("\nPayments with amount > 100000:", bigPayments.length);
  bigPayments.forEach(p => console.log("  ", p.id.slice(0,20), p.receiptNumber, p.amount));

  const bigLedger = await prisma.creditLedger.findMany({ where: { amount: { gt: 100000 } }, take: 5, select: { id: true, transactionType: true, amount: true, balanceAfter: true } });
  console.log("\nLedger entries with amount > 100000:", bigLedger.length);
  bigLedger.forEach(l => console.log("  ", l.id.slice(0,20), l.transactionType, l.amount, l.balanceAfter));

  const bigBalances = await prisma.customer.findMany({ where: { currentBalance: { gt: 100000 } }, take: 5, select: { id: true, customerCode: true, fullName: true, openingBalance: true, currentBalance: true } });
  console.log("\nCustomers with currentBalance > 100000:", bigBalances.length);
  bigBalances.forEach(c => console.log("  ", c.customerCode, c.fullName, c.openingBalance, c.currentBalance));

  const batches = await prisma.tallyImportBatch.findMany({ select: { id: true, originalFileName: true, status: true, totalVouchers: true, salesCount: true, receiptCount: true, debitTotal: true, creditTotal: true, createdAt: true } });
  console.log("\nImport Batches:");
  batches.forEach(b => console.log("  ", b.id.slice(0,20), b.originalFileName, b.status, b.totalVouchers, "vouchers", "sales:", b.salesCount, "receipts:", b.receiptCount, "debit:", b.debitTotal, "credit:", b.creditTotal, b.createdAt));

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });