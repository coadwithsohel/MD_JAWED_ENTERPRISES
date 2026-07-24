/**
 * FINAL VERIFICATION SCRIPT
 * Run: npx tsx scripts/verify-final.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const cid = "cmrxg4o4t05mtgcxvsjqnbjeq";

  console.log("=== FINAL VERIFICATION ===");

  // 1. Customer info
  const cust = await prisma.customer.findUnique({ where: { id: cid } });
  console.log("Customer:", cust?.fullName);
  console.log("Opening Balance:", Number(cust?.openingBalance ?? 0));
  console.log("Current Balance (stored):", Number(cust?.currentBalance ?? 0));

  // 2. Sale 647
  const s647 = await prisma.sale.findUnique({ where: { invoiceNumber: "647" } });
  console.log("\nInvoice 647: exists=" + !!s647 + " amount=" + Number(s647?.grandTotal ?? 0));

  // 3. Receipt 14 check
  const pay14 = await prisma.payment.findMany({ where: { customerId: cid, receiptNumber: "14" } });
  console.log("Receipt 14 for Ganesh: " + pay14.length + " amount=" + (pay14.length > 0 ? Number(pay14[0].amount) : 0));

  // 4. CLT count
  const cltCount = await prisma.customerLedgerTransaction.count({ where: { customerId: cid } });
  console.log("\nCLT records for Ganesh: " + cltCount + " (should be 0)");

  // 5. Orphaned payments
  const ganeshCL = await prisma.creditLedger.findMany({ where: { customerId: cid, transactionType: { not: "OPENING_BALANCE" } } });
  const clPayIds = new Set(ganeshCL.filter((c) => c.paymentId).map((c) => c.paymentId as string));
  const orphaned = await prisma.payment.findMany({ where: { customerId: cid, id: { notIn: Array.from(clPayIds) }, status: "COMPLETED" } });
  console.log("Orphaned payments for Ganesh: " + orphaned.length + " (should be 0)");

  // 6. CreditLedger entries detail
  console.log("\nCreditLedger entries for Ganesh:");
  let totalDr = 0;
  let totalCr = 0;
  for (const cl of ganeshCL) {
    const amt = Number(cl.amount);
    if (cl.transactionType === "CREDIT_SALE") {
      totalDr += amt;
      console.log("  Dr " + amt.toFixed(2) + " Sale " + (cl.saleId ? "linked" : "unlinked"));
    } else {
      totalCr += amt;
      console.log("  Cr " + amt.toFixed(2) + " Payment " + (cl.paymentId ? "linked" : "unlinked"));
    }
  }
  console.log("  Total Debit: " + totalDr.toFixed(2));
  console.log("  Total Credit: " + totalCr.toFixed(2));

  // 7. Expected balance
  console.log("\nExpected balance:");
  const opening = Number(cust?.openingBalance ?? 0);
  const totalSalesAgg = await prisma.sale.aggregate({
    where: { customerId: cid, status: { in: ["COMPLETED", "PARTIALLY_RETURNED"] } },
    _sum: { grandTotal: true },
  });
  const totalPayAgg = await prisma.payment.aggregate({
    where: { customerId: cid, status: "COMPLETED" },
    _sum: { amount: true },
  });
  const totalSales = Number(totalSalesAgg._sum.grandTotal ?? 0);
  const totalPayments = Number(totalPayAgg._sum.amount ?? 0);
  const expectedBal = opening + totalSales - totalPayments;
  console.log("Opening: " + opening + " + Sales: " + totalSales + " - Payments: " + totalPayments + " = " + expectedBal);
  console.log("Stored balance: " + Number(cust?.currentBalance ?? 0));
  console.log("Match: " + (Math.abs(expectedBal - Number(cust?.currentBalance ?? 0)) < 0.01 ? "YES" : "NO"));

  // 8. Overall ledger API entry count for Ganesh
  // API returns CreditLedger entries (non-opening) = 11 entries
  // No orphaned payments = 0 extra entries
  // No CLT = 0 extra entries
  console.log("\nExpected ledger entry count: " + ganeshCL.length + " (11 CreditLedger)");
  console.log("  Invoice 647 visible = " + ganeshCL.filter((c) => c.transactionType === "CREDIT_SALE").length + " (should be 1)");
  console.log("  Receipt payments visible = " + ganeshCL.filter((c) => c.transactionType === "PAYMENT_RECEIVED").length + " (should be 10)");

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("Verification failed:", e);
  process.exit(1);
});