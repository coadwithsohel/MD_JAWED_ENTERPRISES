/**
 * DIAGNOSTIC SCRIPT: Find exact duplicate records for invoice 647 and receipt 8.
 * Run: npx tsx scripts/diagnose-duplicates.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("=".repeat(80));
  console.log("DIAGNOSTIC: Finding duplicate financial records");
  console.log("=".repeat(80));

  // ─── 1. Find customer by searching all models for 647 ────────────────
  console.log("\n=== SEARCHING FOR INVOICE 647 ===");

  const sales647 = await prisma.sale.findMany({
    where: { invoiceNumber: { contains: "647" } },
  });
  console.log(`\nSale records containing "647": ${sales647.length}`);
  for (const s of sales647) {
    console.log(
      `  Sale: id=${s.id} invoiceNumber=${s.invoiceNumber} customerId=${s.customerId} grandTotal=${Number(s.grandTotal)} createdAt=${s.createdAt.toISOString()}`
    );
  }

  const tallySales647 = await prisma.tallyVoucher.findMany({
    where: { voucherNumber: { contains: "647" }, voucherType: "SALES" },
  });
  console.log(`\nTallyVoucher SALES containing "647": ${tallySales647.length}`);
  for (const t of tallySales647) {
    console.log(
      `  TV: id=${t.id} vchNum=${t.voucherNumber} customerId=${t.customerId} debit=${Number(t.debit)} credit=${Number(t.credit)} date=${t.voucherDate.toISOString()} status=${t.importStatus} isDup=${t.isDuplicate} guid=${t.tallyGuid || "null"} vchKey=${t.voucherKey || "null"}`
    );
  }

  const cl647 = await prisma.creditLedger.findMany({
    where: { description: { contains: "647" } },
  });
  console.log(`\nCreditLedger containing "647": ${cl647.length}`);
  for (const c of cl647) {
    console.log(
      `  CL: id=${c.id} customerId=${c.customerId} type=${c.transactionType} amount=${Number(c.amount)} saleId=${c.saleId || "null"} paymentId=${c.paymentId || "null"} createdAt=${c.createdAt.toISOString()} balAfter=${Number(c.balanceAfter)}`
    );
  }

  const clt647 = await prisma.customerLedgerTransaction.findMany({
    where: { voucherNumber: { contains: "647" } },
  });
  console.log(`\nCustomerLedgerTransaction containing "647": ${clt647.length}`);
  for (const c of clt647) {
    console.log(
      `  CLT: id=${c.id} customerId=${c.customerId} type=${c.voucherType} vchNum=${c.voucherNumber} debit=${Number(c.debit)} credit=${Number(c.credit)} date=${c.transactionDate.toISOString()} createdAt=${c.createdAt.toISOString()} guid=${c.sourceGuid || "null"}`
    );
  }

  // ─── 2. Find receipt 8 ──────────────────────────────────────────────
  console.log("\n=== SEARCHING FOR RECEIPT 8 ===");

  const payments8 = await prisma.payment.findMany({
    where: { receiptNumber: { contains: "8" } },
  });
  console.log(`\nPayment records: ${payments8.length}`);
  for (const p of payments8) {
    console.log(
      `  Pay: id=${p.id} receiptNumber=${p.receiptNumber} customerId=${p.customerId} amount=${Number(p.amount)} date=${p.paymentDate.toISOString()} status=${p.status} saleId=${p.saleId || "null"}`
    );
  }

  const tallyReceipts8 = await prisma.tallyVoucher.findMany({
    where: { voucherNumber: { contains: "8" }, voucherType: "RECEIPT" },
  });
  console.log(`\nTallyVoucher RECEIPT containing "8": ${tallyReceipts8.length}`);
  for (const t of tallyReceipts8) {
    console.log(
      `  TV: id=${t.id} vchNum=${t.voucherNumber} customerId=${t.customerId} debit=${Number(t.debit)} credit=${Number(t.credit)} date=${t.voucherDate.toISOString()} status=${t.importStatus} isDup=${t.isDuplicate} guid=${t.tallyGuid || "null"} vchKey=${t.voucherKey || "null"}`
    );
  }

  // ─── 3. Find receipt 14 ─────────────────────────────────────────────
  console.log("\n=== SEARCHING FOR RECEIPT 14 ===");

  const payments14 = await prisma.payment.findMany({
    where: { receiptNumber: { contains: "14" } },
  });
  console.log(`\nPayment records: ${payments14.length}`);
  for (const p of payments14) {
    console.log(
      `  Pay: id=${p.id} receiptNumber=${p.receiptNumber} customerId=${p.customerId} amount=${Number(p.amount)} date=${p.paymentDate.toISOString()} status=${p.status} saleId=${p.saleId || "null"}`
    );
  }

  const tallyReceipts14 = await prisma.tallyVoucher.findMany({
    where: { voucherNumber: { contains: "14" }, voucherType: "RECEIPT" },
  });
  console.log(`\nTallyVoucher RECEIPT containing "14": ${tallyReceipts14.length}`);
  for (const t of tallyReceipts14) {
    console.log(
      `  TV: id=${t.id} vchNum=${t.voucherNumber} customerId=${t.customerId} debit=${Number(t.debit)} credit=${Number(t.credit)} date=${t.voucherDate.toISOString()} status=${t.importStatus} isDup=${t.isDuplicate} guid=${t.tallyGuid || "null"}`
    );
  }

  // ─── 4. ALL records in CreditLedger ─────────────────────────────────
  console.log("\n=== ALL CREDIT LEDGER RECORDS (last 50) ===");
  const allCL = await prisma.creditLedger.findMany({
    orderBy: [{ createdAt: "desc" }],
    take: 50,
  });
  for (const c of allCL) {
    console.log(
      `  CL: id=${c.id} customerId=${c.customerId} type=${c.transactionType} amount=${Number(c.amount)} saleId=${c.saleId || "null"} paymentId=${c.paymentId || "null"} createdAt=${c.createdAt.toISOString()} balAfter=${Number(c.balanceAfter)}`
    );
  }

  // ─── 5. ALL records in CustomerLedgerTransaction ─────────────────────
  console.log("\n=== ALL CUSTOMERLEDGERTRANSACTION (last 50) ===");
  const allCLT = await prisma.customerLedgerTransaction.findMany({
    orderBy: [{ createdAt: "desc" }],
    take: 50,
  });
  for (const c of allCLT) {
    console.log(
      `  CLT: id=${c.id} customerId=${c.customerId} type=${c.voucherType} vchNum=${c.voucherNumber} debit=${Number(c.debit)} credit=${Number(c.credit)} date=${c.transactionDate.toISOString()} createdAt=${c.createdAt.toISOString()}`
    );
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("Diagnostic failed:", e);
  process.exit(1);
});