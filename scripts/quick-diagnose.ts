/**
 * Quick diagnostic - trace Ganesh's exact data.
 * Run: npx tsx scripts/quick-diagnose.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const cid = "cmrxg4o4t05mtgcxvsjqnbjeq";
  
  // Payment table vs CreditLedger comparison
  const pays = await prisma.payment.findMany({ where: { customerId: cid, status: "COMPLETED" } });
  console.log("Payment table: count=", pays.length, "sum=", pays.reduce((s, r) => s + Number(r.amount), 0));
  
  const cls = await prisma.creditLedger.findMany({ where: { customerId: cid, transactionType: "PAYMENT_RECEIVED" } });
  console.log("CreditLedger PAYMENT_RECEIVED: count=", cls.length, "sum=", cls.reduce((s, r) => s + Number(r.amount), 0));
  
  // Show which CL payments have no paymentId
  const orphaned = cls.filter(c => !c.paymentId);
  console.log("CL PAYMENT_RECEIVED without paymentId:", orphaned.length, "sum:", orphaned.reduce((s, r) => s + Number(r.amount), 0));
  for (const o of orphaned) {
    console.log("  orphaned CL:", o.id, "amount=", Number(o.amount), "createdAt=", o.createdAt.toISOString());
  }
  
  // Check Customer.currentBalance
  const cust = await prisma.customer.findUnique({ where: { id: cid } });
  console.log("Customer.currentBalance:", Number(cust?.currentBalance));
  
  // Sale fields
  const sale = await prisma.sale.findFirst({ where: { customerId: cid } });
  console.log("Sale.pendingAmount:", Number(sale?.pendingAmount), "Sale.paidAmount:", Number(sale?.paidAmount));
  
  // Check Sale.payments relation
  const salePays = await prisma.payment.findMany({ where: { saleId: sale?.id } });
  console.log("Payments linked to sale:", salePays.length, "total:", salePays.reduce((s, r) => s + Number(r.amount), 0));

  await prisma.$disconnect();
}

main().catch(console.error);