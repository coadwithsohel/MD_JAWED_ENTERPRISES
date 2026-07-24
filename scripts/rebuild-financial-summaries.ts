/**
 * One-time maintenance script to rebuild stale financial derived fields.
 *
 * This script:
 * - Reads canonical CreditLedger transactions
 * - Rebuilds Sale.pendingAmount and Sale.paidAmount
 * - Rebuilds Customer.currentBalance
 * - Does NOT create new Sales or Receipts
 * - Does NOT require import files
 *
 * Run: npx tsx scripts/rebuild-financial-summaries.ts --dry-run
 * Run: npx tsx scripts/rebuild-financial-summaries.ts --execute
 */
import { PrismaClient } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");
const isExecute = args.includes("--execute");

if (!isDryRun && !isExecute) {
  console.error("Usage: npx tsx scripts/rebuild-financial-summaries.ts --dry-run | --execute");
  process.exit(1);
}

async function main() {
  console.log(`Mode: ${isDryRun ? "DRY RUN (no changes)" : "EXECUTE"}`);
  console.log("");

  // ─── Step 1: Rebuild Sale.pendingAmount and Sale.paidAmount ───────────────
  console.log("=== Step 1: Rebuilding Sale pending/paid amounts ===");

  const sales = await prisma.sale.findMany({
    where: {
      status: { in: ["COMPLETED", "PARTIALLY_RETURNED"] },
      saleType: { in: ["CREDIT", "PARTIAL"] },
    },
    select: {
      id: true,
      invoiceNumber: true,
      customerId: true,
      grandTotal: true,
      paidAmount: true,
      pendingAmount: true,
    },
  });

  console.log(`Found ${sales.length} credit/partial sales to check.`);

  let saleUpdates = 0;
  for (const sale of sales) {
    if (!sale.customerId) continue;

    // Get canonical receipts from CreditLedger for this customer
    const receiptsAgg = await prisma.creditLedger.aggregate({
      where: {
        customerId: sale.customerId,
        transactionType: "PAYMENT_RECEIVED",
      },
      _sum: { amount: true },
    });

    const totalReceipts = receiptsAgg._sum.amount ?? new Decimal(0);

    // Get direct payment allocations for this specific sale
    const directPaymentsAgg = await prisma.payment.aggregate({
      where: {
        saleId: sale.id,
        status: "COMPLETED",
      },
      _sum: { amount: true },
    });

    const directAlloc = directPaymentsAgg._sum.amount ?? new Decimal(0);

    // Calculate new paidAmount and pendingAmount
    // paidAmount = min(grandTotal, totalReceipts allocated to this sale)
    // For simplicity, we use the direct allocation + FIFO share
    // But since we can't perfectly determine FIFO share per sale here,
    // we set paidAmount = directAlloc and pendingAmount = grandTotal - directAlloc
    // The FIFO allocation is done at query time in getSalesWithFifoAllocation
    const newPaidAmount = Decimal.min(directAlloc, sale.grandTotal);
    const newPendingAmount = Decimal.max(sale.grandTotal.sub(newPaidAmount), new Decimal(0));

    if (!sale.paidAmount.equals(newPaidAmount) || !sale.pendingAmount.equals(newPendingAmount)) {
      console.log(
        `  Sale ${sale.invoiceNumber}: paid ${Number(sale.paidAmount)}→${Number(newPaidAmount)}, ` +
        `pending ${Number(sale.pendingAmount)}→${Number(newPendingAmount)}`
      );
      saleUpdates++;

      if (isExecute) {
        await prisma.sale.update({
          where: { id: sale.id },
          data: {
            paidAmount: newPaidAmount,
            pendingAmount: newPendingAmount,
          },
        });
      }
    }
  }

  console.log(`Sale updates needed: ${saleUpdates}`);
  console.log("");

  // ─── Step 2: Rebuild Customer.currentBalance ─────────────────────────────
  console.log("=== Step 2: Rebuilding Customer.currentBalance ===");

  const customers = await prisma.customer.findMany({
    where: { isActive: true, deletedAt: null },
    select: { id: true, customerCode: true, fullName: true, openingBalance: true, currentBalance: true },
  });

  console.log(`Found ${customers.length} active customers to check.`);

  let customerUpdates = 0;
  for (const customer of customers) {
    const openingBalance = customer.openingBalance ?? new Decimal(0);

    // Get total debits from CreditLedger
    const debitAgg = await prisma.creditLedger.aggregate({
      where: {
        customerId: customer.id,
        transactionType: { in: ["CREDIT_SALE", "PAYMENT_REVERSAL", "ADJUSTMENT"] },
      },
      _sum: { amount: true },
    });

    // Get total credits from CreditLedger
    const creditAgg = await prisma.creditLedger.aggregate({
      where: {
        customerId: customer.id,
        transactionType: { in: ["PAYMENT_RECEIVED", "SALE_CANCELLED", "RETURN_CREDIT"] },
      },
      _sum: { amount: true },
    });

    const totalDebit = debitAgg._sum.amount ?? new Decimal(0);
    const totalCredit = creditAgg._sum.amount ?? new Decimal(0);
    const newBalance = openingBalance.add(totalDebit).sub(totalCredit);

    if (!customer.currentBalance.equals(newBalance)) {
      console.log(
        `  ${customer.customerCode} ${customer.fullName}: ` +
        `${Number(customer.currentBalance)}→${Number(newBalance)}`
      );
      customerUpdates++;

      if (isExecute) {
        await prisma.customer.update({
          where: { id: customer.id },
          data: { currentBalance: newBalance },
        });
      }
    }
  }

  console.log(`Customer balance updates needed: ${customerUpdates}`);
  console.log("");

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log("=== Summary ===");
  console.log(`Sales updated: ${saleUpdates}`);
  console.log(`Customers updated: ${customerUpdates}`);
  console.log(`Mode: ${isDryRun ? "DRY RUN" : "EXECUTED"}`);

  if (isDryRun) {
    console.log("");
    console.log("Run with --execute to apply changes.");
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("Script failed:", e);
  process.exit(1);
});