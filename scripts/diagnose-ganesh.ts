/**
 * Targeted diagnostic for Ganesh Shrirang Samale (customerId = cmrxg4o4t05mtgcxvsjqnbjeq)
 * Run: npx tsx scripts/diagnose-ganesh.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const cid = "cmrxg4o4t05mtgcxvsjqnbjeq";

  const c = await prisma.customer.findUnique({ where: { id: cid } });
  console.log("Customer:", c?.fullName, c?.customerCode, "Opening:", Number(c?.openingBalance ?? 0), "Current:", Number(c?.currentBalance ?? 0));

  console.log("\n=== ALL SALES ===");
  const sales = await prisma.sale.findMany({ where: { customerId: cid }, orderBy: { createdAt: "asc" } });
  for (const s of sales) {
    console.log(`  Sale: id=${s.id} inv=${s.invoiceNumber} total=${Number(s.grandTotal)} paid=${Number(s.paidAmount)} pending=${Number(s.pendingAmount)} createdAt=${s.createdAt.toISOString()}`);
  }

  console.log("\n=== ALL PAYMENTS ===");
  const pays = await prisma.payment.findMany({ where: { customerId: cid }, orderBy: { receiptNumber: "asc" } });
  for (const p of pays) {
    console.log(`  Pay: id=${p.id} receipt=${p.receiptNumber} amount=${Number(p.amount)} date=${p.paymentDate.toISOString()} saleId=${p.saleId ?? "null"} status=${p.status}`);
  }

  console.log("\n=== ALL CREDITLEDGER (sorted by createdAt) ===");
  const cls = await prisma.creditLedger.findMany({ where: { customerId: cid }, orderBy: { createdAt: "asc" } });
  for (const cl of cls) {
    console.log(`  CL: id=${cl.id} type=${cl.transactionType} amount=${Number(cl.amount)} balAfter=${Number(cl.balanceAfter)} saleId=${cl.saleId ?? "null"} paymentId=${cl.paymentId ?? "null"} createdAt=${cl.createdAt.toISOString()}`);
  }

  console.log("\n=== ALL CUSTOMERLEDGERTRANSACTION (sorted by transactionDate) ===");
  const clts = await prisma.customerLedgerTransaction.findMany({ where: { customerId: cid }, orderBy: { transactionDate: "asc" } });
  for (const clt of clts) {
    console.log(`  CLT: id=${clt.id} type=${clt.voucherType} vch=${clt.voucherNumber ?? "null"} debit=${Number(clt.debit)} credit=${Number(clt.credit)} date=${clt.transactionDate.toISOString()} createdAt=${clt.createdAt.toISOString()} guid=${clt.sourceGuid ?? "null"}`);
  }

  console.log("\n=== ALL TALLYVOUCHERS ===");
  const tvs = await prisma.tallyVoucher.findMany({ where: { customerId: cid }, orderBy: { voucherDate: "asc" } });
  for (const tv of tvs) {
    console.log(`  TV: id=${tv.id} type=${tv.voucherType} vchNum=${tv.voucherNumber ?? "null"} debit=${Number(tv.debit)} credit=${Number(tv.credit)} date=${tv.voucherDate.toISOString()} status=${tv.importStatus} isDup=${tv.isDuplicate} guid=${tv.tallyGuid ?? "null"}`);
  }

  // Count duplicate sourceEntryKey occurrences
  console.log("\n=== DUPLICATE sourceGuid ANALYSIS ===");
  const allCLT = await prisma.customerLedgerTransaction.findMany({ where: { customerId: cid } });
  const guidMap = new Map<string, typeof allCLT>();
  for (const clt of allCLT) {
    const key = clt.sourceGuid ?? "null";
    if (!guidMap.has(key)) guidMap.set(key, []);
    guidMap.get(key)!.push(clt);
  }
  for (const [guid, records] of guidMap) {
    if (records.length > 1) {
      console.log(`  DUPLICATE sourceGuid=${guid}:`);
      for (const r of records) {
        console.log(`    CLT: id=${r.id} type=${r.voucherType} vch=${r.voucherNumber} debit=${Number(r.debit)} credit=${Number(r.credit)} date=${r.transactionDate.toISOString()}`);
      }
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("Diagnostic failed:", e);
  process.exit(1);
});