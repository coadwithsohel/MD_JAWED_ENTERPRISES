import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  // 3. Fix CreditLedger — by t.id from TallyVoucher
  console.log("3. Fixing CreditLedger...");
  const r3 = await prisma.$executeRawUnsafe(
    'UPDATE "CreditLedger" SET amount = amount / 100, "balanceAfter" = "balanceAfter" / 100 WHERE (description ILIKE \'%SALES%\' OR description ILIKE \'%RECEIPT%\' OR description ILIKE \'%OPENING%\' OR description ILIKE \'%Import%\' OR description ILIKE \'%Imported%\') AND amount > 0'
  );
  console.log(`  Fixed ${r3} ledger entries`);

  // 4. Fix Payments
  console.log("4. Fixing Payments...");
  const r4 = await prisma.$executeRawUnsafe(
    'UPDATE "Payment" SET amount = amount / 100 WHERE amount > 0 AND (notes ILIKE \'%Imported%\' OR "receiptNumber" ~ \'^REC-IMP-\' OR "receiptNumber" ~ \'^\\\\d+$\')'
  );
  console.log(`  Fixed ${r4} payments`);

  // 5. Recalculate Customer balances
  console.log("5. Recalculating Customer balances...");
  const customers = await prisma.customer.findMany({
    where: { isActive: true, deletedAt: null },
    select: { id: true, customerCode: true, openingBalance: true, currentBalance: true },
  });

  let count = 0;
  for (const c of customers) {
    let ob = Number(c.openingBalance);
    if (ob > 999) ob = Math.round(ob * 100) / 10000; // fix if inflated

    const entries = await prisma.creditLedger.findMany({
      where: { customerId: c.id },
      select: { transactionType: true, amount: true },
      orderBy: { createdAt: "asc" },
    });

    let bal = ob;
    for (const e of entries) {
      const a = Number(e.amount);
      if (["CREDIT_SALE", "PAYMENT_REVERSAL", "ADJUSTMENT"].includes(e.transactionType)) bal += a;
      else if (["PAYMENT_RECEIVED", "SALE_CANCELLED", "RETURN_CREDIT"].includes(e.transactionType)) bal -= a;
    }

    const newBal = Math.max(0, Math.round(bal * 100) / 100);
    
    // Update if changed
    if (Math.abs(newBal - Number(c.currentBalance ?? 0)) > 0.01 || ob !== Number(c.openingBalance)) {
      await prisma.customer.update({
        where: { id: c.id },
        data: { openingBalance: ob, currentBalance: newBal },
      });
      count++;
    }
  }
  console.log(`  Recalculated ${count} customer balances`);

  // VERIFICATION
  console.log("\n═".repeat(60));
  console.log("  VERIFICATION");
  console.log("═".repeat(60));

  const { getTotalPendingCredit, getTotalOverdue } = await import("../lib/accounting");
  const pc = await getTotalPendingCredit();
  const od = await getTotalOverdue();
  console.log(`  Pending Credit: ₹${Number(pc.total).toFixed(2)} (${pc.count} customers)`);
  console.log(`  Overdue Total:  ₹${Number(od.total).toFixed(2)} (${od.count} customers)`);

  const d30 = new Date();
  d30.setDate(d30.getDate() - 30);
  const rp = await prisma.payment.findMany({
    where: { paymentDate: { gte: d30 }, status: "COMPLETED" },
    select: { amount: true },
  });
  const total = rp.reduce((s, p) => s + Number(p.amount), 0);
  console.log(`  Last 30d Payments: ₹${total.toFixed(2)} (${rp.length} receipts)`);

  const activeCustomers = await prisma.customer.count({ where: { isActive: true, deletedAt: null } });
  console.log(`  Active Customers: ${activeCustomers}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("❌ Failed:", e);
  process.exit(1);
});