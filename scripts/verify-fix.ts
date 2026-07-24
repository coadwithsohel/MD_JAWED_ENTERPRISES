/**
 * Quick verification script
 * Run: npx tsx scripts/verify-fix.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const cltCount = await prisma.customerLedgerTransaction.count();
  console.log("CLT count:", cltCount);
  const clCount = await prisma.creditLedger.count();
  console.log("CL count:", clCount);
  const payCount = await prisma.payment.count();
  console.log("Payment count:", payCount);
  const clWithPayment = await prisma.creditLedger.count({ where: { paymentId: { not: null } } });
  console.log("CL with paymentId:", clWithPayment);

  // Ganesh specific
  const cid = "cmrxg4o4t05mtgcxvsjqnbjeq";
  const ganesh = await prisma.customer.findUnique({ where: { id: cid } });
  console.log("\nGanesh:", ganesh?.fullName, "Balance:", Number(ganesh?.currentBalance ?? 0));

  const ganeshCL = await prisma.creditLedger.findMany({ where: { customerId: cid, transactionType: { not: "OPENING_BALANCE" } } });
  console.log("Ganesh CL records:", ganeshCL.length);
  const ganeshCLPaymentIds = new Set(ganeshCL.filter(c => c.paymentId).map(c => c.paymentId as string));
  const ganeshOrphaned = await prisma.payment.findMany({ where: { customerId: cid, id: { notIn: Array.from(ganeshCLPaymentIds) }, status: "COMPLETED" } });
  console.log("Ganesh orphaned payments:", ganeshOrphaned.length);
  for (const p of ganeshOrphaned) console.log("  Orphaned:", p.receiptNumber, Number(p.amount));

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });