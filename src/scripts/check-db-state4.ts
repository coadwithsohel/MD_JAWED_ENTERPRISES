import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const smallImportedDebit = await prisma.tallyVoucher.count({ where: { importStatus: "IMPORTED", debit: { gt: 0, lt: 1000 } } });
  const bigImportedDebit = await prisma.tallyVoucher.count({ where: { importStatus: "IMPORTED", debit: { gte: 1000 } } });
  console.log("IMPORTED vouchers with debit < 1000:", smallImportedDebit);
  console.log("IMPORTED vouchers with debit >= 1000:", bigImportedDebit);

  const smallValidDebit = await prisma.tallyVoucher.count({ where: { importStatus: "VALID", debit: { gt: 0, lt: 1000 } } });
  const bigValidDebit = await prisma.tallyVoucher.count({ where: { importStatus: "VALID", debit: { gte: 1000 } } });
  console.log("VALID vouchers with debit < 1000:", smallValidDebit);
  console.log("VALID vouchers with debit >= 1000:", bigValidDebit);

  const smallSales = await prisma.sale.count({ where: { grandTotal: { lt: 100000 } } });
  const bigSales = await prisma.sale.count({ where: { grandTotal: { gte: 100000 } } });
  console.log("Sales with grandTotal < 100000:", smallSales);
  console.log("Sales with grandTotal >= 100000:", bigSales);

  const smallPayments = await prisma.payment.count({ where: { amount: { lt: 100000 } } });
  const bigPayments = await prisma.payment.count({ where: { amount: { gte: 100000 } } });
  console.log("Payments with amount < 100000:", smallPayments);
  console.log("Payments with amount >= 100000:", bigPayments);

  const smallLedger = await prisma.creditLedger.count({ where: { amount: { lt: 100000 } } });
  const bigLedger = await prisma.creditLedger.count({ where: { amount: { gte: 100000 } } });
  console.log("CreditLedger with amount < 100000:", smallLedger);
  console.log("CreditLedger with amount >= 100000:", bigLedger);

  // Check if correct batch has any imported records or is fully pending
  const correctBatchVouchers = await prisma.tallyVoucher.findMany({ where: { importBatchId: "cmrzer2ic00018qz3ci9" }, take: 5, select: { id: true, debit: true, credit: true, voucherType: true, importStatus: true } });
  console.log("\nCorrect batch samples:");
  correctBatchVouchers.forEach(v => console.log("  ", v.id.slice(0,16), v.voucherType, "debit:", v.debit, "credit:", v.credit, "status:", v.importStatus));

  const correctImported = await prisma.tallyVoucher.count({ where: { importBatchId: "cmrzer2ic00018qz3ci9", importStatus: "IMPORTED" } });
  console.log("Correct batch imported:", correctImported);
  const correctValid = await prisma.tallyVoucher.count({ where: { importBatchId: "cmrzer2ic00018qz3ci9", importStatus: "VALID" } });
  console.log("Correct batch valid:", correctValid);

  // Check actual sample amounts - what's the ratio between voucher debit and ledger amount for imported?
  const ratioCheck = await prisma.tallyVoucher.findMany({
    where: { importStatus: "IMPORTED", ledgerEntryId: { not: null } },
    take: 5,
    select: { id: true, debit: true, credit: true, ledgerEntryId: true },
  });
  console.log("\nRatio check (voucher vs ledger):");
  for (const v of ratioCheck) {
    const ledger = await prisma.creditLedger.findUnique({ where: { id: v.ledgerEntryId! }, select: { amount: true } });
    if (ledger) {
      const vAmt = Math.max(Number(v.debit), Number(v.credit));
      console.log(`  Voucher amount: ${vAmt}, Ledger amount: ${Number(ledger.amount)}, Ratio: ${vAmt > 0 ? (Number(ledger.amount) / vAmt).toFixed(4) : "N/A"}`);
    }
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });