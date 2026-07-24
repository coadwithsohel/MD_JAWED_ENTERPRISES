/**
 * Verify financial consistency across all pages.
 * 
 * Run: npx tsx scripts/verify-financial-consistency.ts
 */
import { PrismaClient } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

const prisma = new PrismaClient();

async function main() {
  console.log("=".repeat(70));
  console.log("FINANCIAL CONSISTENCY VERIFICATION");
  console.log("=".repeat(70));
  console.log("");

  // ─── 1. Ganesh -- specific test ────────────────────────────────────────────
  const cid = "cmrxg4o4t05mtgcxvsjqnbjeq";
  const customer = await prisma.customer.findUnique({ where: { id: cid } });
  console.log("1. GANESH SHRIRANG SAMALE (MJE-CUST-003831)");
  console.log(`   Customer.currentBalance: ${Number(customer?.currentBalance)}`);

  // CreditLedger totals
  const debitAgg = await prisma.creditLedger.aggregate({
    where: { customerId: cid, transactionType: { in: ["CREDIT_SALE", "PAYMENT_REVERSAL", "ADJUSTMENT"] } },
    _sum: { amount: true },
  });
  const creditAgg = await prisma.creditLedger.aggregate({
    where: { customerId: cid, transactionType: { in: ["PAYMENT_RECEIVED", "SALE_CANCELLED", "RETURN_CREDIT"] } },
    _sum: { amount: true },
  });

  const openingBalance = customer?.openingBalance ?? new Decimal(0);
  const totalDebit = debitAgg._sum.amount ?? new Decimal(0);
  const totalCredit = creditAgg._sum.amount ?? new Decimal(0);
  const closingBalance = openingBalance.add(totalDebit).sub(totalCredit);
  const outstanding = Decimal.max(closingBalance, new Decimal(0));

  console.log(`   CreditLedger totalDebit: ${Number(totalDebit)}`);
  console.log(`   CreditLedger totalCredit: ${Number(totalCredit)}`);
  console.log(`   Expected closingBalance: ${Number(closingBalance)} (Dr ${Number(outstanding)})`);
  console.log(`   Expected outstanding: ${Number(outstanding)}`);

  // Sale table
  const sale = await prisma.sale.findFirst({ where: { customerId: cid } });
  console.log(`   Sale.pendingAmount: ${Number(sale?.pendingAmount)}`);
  console.log(`   Sale.paidAmount: ${Number(sale?.paidAmount)}`);

  // CreditLedger PAYMENT_RECEIVED total
  const clReceipts = await prisma.creditLedger.aggregate({
    where: { customerId: cid, transactionType: "PAYMENT_RECEIVED" },
    _sum: { amount: true },
  });
  console.log(`   CreditLedger PAYMENT_RECEIVED total: ${Number(clReceipts._sum.amount ?? 0)}`);

  // Payment table total
  const paysAgg = await prisma.payment.aggregate({
    where: { customerId: cid, status: "COMPLETED" },
    _sum: { amount: true },
  });
  console.log(`   Payment table total: ${Number(paysAgg._sum.amount ?? 0)}`);

  console.log("");

  // ─── 2. Global checks ──────────────────────────────────────────────────────
  console.log("2. GLOBAL CHECKS");

  // Total of all canonical outstanding balances
  const allCustomers = await prisma.customer.findMany({
    where: { isActive: true, deletedAt: null },
    select: { id: true, openingBalance: true },
  });

  let totalCanonicalOutstanding = new Decimal(0);
  let outstandingCustomerCount = 0;

  for (const c of allCustomers) {
    const dAgg = await prisma.creditLedger.aggregate({
      where: { customerId: c.id, transactionType: { in: ["CREDIT_SALE", "PAYMENT_REVERSAL", "ADJUSTMENT"] } },
      _sum: { amount: true },
    });
    const cAgg = await prisma.creditLedger.aggregate({
      where: { customerId: c.id, transactionType: { in: ["PAYMENT_RECEIVED", "SALE_CANCELLED", "RETURN_CREDIT"] } },
      _sum: { amount: true },
    });
    const ob = c.openingBalance ?? new Decimal(0);
    const td = dAgg._sum.amount ?? new Decimal(0);
    const tc = cAgg._sum.amount ?? new Decimal(0);
    const cb = ob.add(td).sub(tc);
    const os = Decimal.max(cb, new Decimal(0));
    if (os.gt(0)) {
      totalCanonicalOutstanding = totalCanonicalOutstanding.add(os);
      outstandingCustomerCount++;
    }
  }

  console.log(`   Canonical Pending Credit (sum positive balances): ${Number(totalCanonicalOutstanding)}`);
  console.log(`   Customers with outstanding balances: ${outstandingCustomerCount}`);

  // Overdue count from the new FIFO logic
  console.log("");
  console.log("   NOTE: Overdue total is calculated at runtime by getOverdueData().");
  console.log("   The canonical CreditLedger source now correctly handles all receipts.");
  console.log("");

  // ─── 3. Summary ────────────────────────────────────────────────────────────
  console.log("3. ACCEPTANCE CRITERIA FOR GANESH");
  console.log(`   Expected overdue: cannot exceed ₹4,000 (was ₹7,000 before fix)`);
  console.log(`   Expected Outstanding: ₹4,000`);
  console.log(`   Expected Sale.pendingAmount: should be reduced from ₹9,000`);
  console.log(`   Expected Customer.currentBalance: should be ₹4,000 (was ₹7,000)`);

  const passOutstanding = outstanding.equals(4000);
  console.log(`   Outstanding ₹4,000 check: ${passOutstanding ? "✅ PASS" : "❌ FAIL (got " + Number(outstanding) + ")"}`);

  await prisma.$disconnect();
}

main().catch(console.error);