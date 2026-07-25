import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Sample some imported SALES vouchers and their linked records
  const sampleSales = await prisma.tallyVoucher.findMany({
    where: { importStatus: "IMPORTED", voucherType: "SALES" },
    take: 10,
    select: { id: true, debit: true, credit: true, voucherNumber: true, importBatchId: true, ledgerEntryId: true },
    orderBy: { debit: "desc" },
  });
  console.log("=== SAMPLE IMPORTED SALES VOUCHERS (highest debit) ===");
  for (const v of sampleSales) {
    const ledger = v.ledgerEntryId ? await prisma.creditLedger.findUnique({ where: { id: v.ledgerEntryId }, select: { amount: true, saleId: true } }) : null;
    const sale = ledger?.saleId ? await prisma.sale.findUnique({ where: { id: ledger.saleId }, select: { invoiceNumber: true, grandTotal: true, paidAmount: true, pendingAmount: true } }) : null;
    console.log(`  Voucher: ${v.id.slice(0,16)} debit=${v.debit} credit=${v.credit} #=${v.voucherNumber}`);
    console.log(`    Ledger: amount=${ledger?.amount} saleId=${ledger?.saleId?.slice(0,16)}`);
    console.log(`    Sale: inv=${sale?.invoiceNumber} total=${sale?.grandTotal} paid=${sale?.paidAmount} pending=${sale?.pendingAmount}`);
  }

  // Sample some imported RECEIPT vouchers
  const sampleReceipts = await prisma.tallyVoucher.findMany({
    where: { importStatus: "IMPORTED", voucherType: "RECEIPT" },
    take: 10,
    select: { id: true, debit: true, credit: true, voucherNumber: true, importBatchId: true, ledgerEntryId: true },
    orderBy: { credit: "desc" },
  });
  console.log("\n=== SAMPLE IMPORTED RECEIPT VOUCHERS (highest credit) ===");
  for (const v of sampleReceipts) {
    const ledger = v.ledgerEntryId ? await prisma.creditLedger.findUnique({ where: { id: v.ledgerEntryId }, select: { amount: true, paymentId: true } }) : null;
    const payment = ledger?.paymentId ? await prisma.payment.findUnique({ where: { id: ledger.paymentId }, select: { receiptNumber: true, amount: true } }) : null;
    console.log(`  Voucher: ${v.id.slice(0,16)} debit=${v.debit} credit=${v.credit} #=${v.voucherNumber}`);
    console.log(`    Ledger: amount=${ledger?.amount} paymentId=${ledger?.paymentId?.slice(0,16)}`);
    console.log(`    Payment: rec=${payment?.receiptNumber} amount=${payment?.amount}`);
  }

  // Check the correct batch amounts
  const correctBatchVouchers = await prisma.tallyVoucher.findMany({
    where: { importBatchId: "cmrzer2ic00018qz3ci9" },
    take: 5,
    select: { id: true, debit: true, credit: true, voucherType: true, voucherNumber: true, importStatus: true },
  });
  console.log("\n=== CORRECT BATCH SAMPLES ===");
  correctBatchVouchers.forEach(v => console.log(`  ${v.id.slice(0,16)} type=${v.voucherType} debit=${v.debit} credit=${v.credit} #=${v.voucherNumber} status=${v.importStatus}`));

  // Check a VALID SALES voucher with high debit
  const highDebitValid = await prisma.tallyVoucher.findMany({
    where: { importStatus: "VALID", debit: { gt: 100000 } },
    take: 5,
    select: { id: true, debit: true, credit: true, voucherType: true, voucherNumber: true, importBatchId: true },
  });
  console.log("\n=== HIGH DEBIT VALID VOUCHERS ===");
  highDebitValid.forEach(v => console.log(`  ${v.id.slice(0,16)} type=${v.voucherType} debit=${v.debit} credit=${v.credit} #=${v.voucherNumber} batch=${v.importBatchId?.slice(0,16)}`));

  // Check batch totals vs actual voucher sums
  const batches = await prisma.tallyImportBatch.findMany({ orderBy: { createdAt: "asc" } });
  console.log("\n=== BATCH TOTALS ===");
  for (const b of batches) {
    const sumDebit = await prisma.tallyVoucher.aggregate({ where: { importBatchId: b.id }, _sum: { debit: true, credit: true } });
    console.log(`  ${b.id.slice(0,20)} ${b.originalFileName} stored_debit=${b.debitTotal} actual_debit=${sumDebit._sum.debit} stored_credit=${b.creditTotal} actual_credit=${sumDebit._sum.credit}`);
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });