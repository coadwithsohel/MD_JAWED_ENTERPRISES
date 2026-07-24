/**
 * FAST FIX: Link CreditLedger.paymentId and delete duplicate CustomerLedgerTransaction records.
 * Uses batch operations for speed.
 *
 * Run: npx tsx scripts/fix-fast.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("=".repeat(80));
  console.log("FAST FIX: Link CreditLedger → Payment, delete CLT duplicates");
  console.log("=".repeat(80));

  // ─── Step 1: Link CreditLedger.paymentId ────────────────────────────
  console.log("\n📋 STEP 1: Linking CreditLedger → Payment...\n");

  const unlinked = await prisma.creditLedger.findMany({
    where: { paymentId: null, transactionType: "PAYMENT_RECEIVED" },
    select: { id: true, customerId: true, amount: true, createdAt: true },
  });

  console.log(`  Unlinked PAYMENT_RECEIVED CreditLedger records: ${unlinked.length}`);

  if (unlinked.length === 0) {
    console.log("  ✅ No unlinked records found.");
  } else {
    // Get all completed payments
    const payments = await prisma.payment.findMany({
      where: { status: "COMPLETED" },
      select: { id: true, customerId: true, amount: true, paymentDate: true, receiptNumber: true },
    });

    // Build a map for fast lookup: customerId -> payments[]
    const payByCust = new Map<string, typeof payments>();
    for (const p of payments) {
      if (!payByCust.has(p.customerId)) payByCust.set(p.customerId, []);
      payByCust.get(p.customerId)!.push(p);
    }

    // Track which payments we've already linked (avoid double-linking)
    const usedPaymentIds = new Set<string>();
    let linked = 0;
    let skipped = 0;

    for (const cl of unlinked) {
      const custPays = payByCust.get(cl.customerId) ?? [];
      const clAmount = Number(cl.amount);
      const clDate = new Date(cl.createdAt);
      clDate.setHours(0, 0, 0, 0);

      // Find best match among unused payments
      let bestMatch: (typeof payments)[0] | null = null;
      let bestDiff = Infinity;

      for (const p of custPays) {
        if (usedPaymentIds.has(p.id)) continue;
        const pAmount = Number(p.amount);
        if (Math.abs(pAmount - clAmount) > 0.01) continue;
        const pDate = new Date(p.paymentDate);
        pDate.setHours(0, 0, 0, 0);
        const diffMs = Math.abs(pDate.getTime() - clDate.getTime());
        const diffDays = diffMs / (1000 * 60 * 60 * 24);
        if (diffDays <= 1 && diffMs < bestDiff) {
          bestMatch = p;
          bestDiff = diffMs;
        }
      }

      if (bestMatch) {
        usedPaymentIds.add(bestMatch.id);
        await prisma.creditLedger.update({
          where: { id: cl.id },
          data: { paymentId: bestMatch.id },
        });
        linked++;
      } else {
        skipped++;
      }

      if (linked % 50 === 0 && linked > 0) {
        process.stdout.write(`  ⏳ Linked ${linked} / ${unlinked.length}\r`);
      }
    }

    console.log(`  ✅ Linked: ${linked}`);
    console.log(`  ⏭️  Skipped (no matching payment): ${skipped}`);
  }

  // ─── Step 2: Delete CustomerLedgerTransaction duplicates ────────────
  console.log("\n📋 STEP 2: Deleting duplicate CustomerLedgerTransaction records...\n");

  const cltCount = await prisma.customerLedgerTransaction.count();
  console.log(`  Current CLT count: ${cltCount}`);

  if (cltCount > 0) {
    // Get all CLT records
    const allCLT = await prisma.customerLedgerTransaction.findMany({
      select: { id: true, customerId: true, transactionDate: true, debit: true, credit: true },
    });

    // For each CLT, check if a matching CreditLedger exists
    const idsToDelete: string[] = [];

    for (const clt of allCLT) {
      const amount = Number(clt.debit) > 0 ? Number(clt.debit) : Number(clt.credit);
      const isDebit = Number(clt.debit) > 0;
      const cltDate = new Date(clt.transactionDate);
      cltDate.setHours(0, 0, 0, 0);

      const matchingCL = await prisma.creditLedger.findFirst({
        where: {
          customerId: clt.customerId,
          amount: { equals: amount },
          transactionType: isDebit ? "CREDIT_SALE" : "PAYMENT_RECEIVED",
          createdAt: {
            gte: new Date(cltDate.getTime()),
            lt: new Date(cltDate.getTime() + 24 * 60 * 60 * 1000),
          },
        },
        select: { id: true },
      });

      if (matchingCL) {
        idsToDelete.push(clt.id);
      }

      if (idsToDelete.length % 200 === 0 && idsToDelete.length > 0) {
        process.stdout.write(`  ⏳ Found ${idsToDelete.length} duplicates to delete\r`);
      }
    }

    console.log(`  Found ${idsToDelete.length} CLT records to delete`);

    if (idsToDelete.length > 0) {
      // Delete in batches
      let deleted = 0;
      const BATCH = 100;
      for (let i = 0; i < idsToDelete.length; i += BATCH) {
        const batch = idsToDelete.slice(i, i + BATCH);
        await prisma.customerLedgerTransaction.deleteMany({
          where: { id: { in: batch } },
        });
        deleted += batch.length;
        process.stdout.write(`  ⏳ Deleted ${deleted} / ${idsToDelete.length}\r`);
      }
      console.log(`\n  ✅ Deleted ${deleted} CLT records`);
    } else {
      console.log("  ✅ No CLT duplicates found");
    }
  } else {
    console.log("  ✅ No CLT records to process");
  }

  // ─── Step 3: Recalculate customer balances ───────────────────────────
  console.log("\n📋 STEP 3: Recalculating customer balances...\n");

  const affectedCustomers = await prisma.customer.findMany({
    where: {
      isActive: true,
      deletedAt: null,
    },
    select: { id: true, openingBalance: true, currentBalance: true, fullName: true },
  });

  let recalculated = 0;
  let correct = 0;

  for (const c of affectedCustomers) {
    const opening = Number(c.openingBalance);
    const [salesAgg, payAgg] = await Promise.all([
      prisma.sale.aggregate({
        where: { customerId: c.id, status: { in: ["COMPLETED", "PARTIALLY_RETURNED"] } },
        _sum: { grandTotal: true },
      }),
      prisma.payment.aggregate({
        where: { customerId: c.id, status: "COMPLETED" },
        _sum: { amount: true },
      }),
    ]);

    const totalSales = Number(salesAgg._sum.grandTotal ?? 0);
    const totalPayments = Number(payAgg._sum.amount ?? 0);
    const calcBal = opening + totalSales - totalPayments;
    const storedBal = Number(c.currentBalance);

    if (Math.abs(calcBal - storedBal) > 0.01) {
      await prisma.customer.update({
        where: { id: c.id },
        data: { currentBalance: calcBal },
      });
      recalculated++;
      if (recalculated <= 10) {
        console.log(`  ✅ ${c.fullName}: ₹${storedBal.toFixed(2)} → ₹${calcBal.toFixed(2)}`);
      }
    } else {
      correct++;
    }
  }

  console.log(`  Recalculated: ${recalculated}`);
  console.log(`  Already correct: ${correct}`);

  // ─── Verification ────────────────────────────────────────────────────
  console.log("\n📋 VERIFICATION...\n");

  const finalCLT = await prisma.customerLedgerTransaction.count();
  console.log(`  Final CLT count: ${finalCLT}`);

  const clWithPay = await prisma.creditLedger.count({ where: { paymentId: { not: null } } });
  console.log(`  CreditLedger with paymentId: ${clWithPay}`);

  // Ganesh check
  const gid = "cmrxg4o4t05mtgcxvsjqnbjeq";
  const ganesh = await prisma.customer.findUnique({ where: { id: gid } });
  console.log(`\n  Ganesh: ${ganesh?.fullName}`);
  console.log(`  Balance: ₹${Number(ganesh?.currentBalance ?? 0).toFixed(2)}`);

  const ganeshCL = await prisma.creditLedger.findMany({
    where: { customerId: gid, transactionType: { not: "OPENING_BALANCE" } },
    select: { paymentId: true, saleId: true, transactionType: true, amount: true },
  });
  const ganeshCLPayIds = new Set(ganeshCL.filter(c => c.paymentId).map(c => c.paymentId as string));
  const ganeshOrphaned = await prisma.payment.findMany({
    where: { customerId: gid, id: { notIn: Array.from(ganeshCLPayIds) }, status: "COMPLETED" },
  });
  console.log(`  Orphaned Payments: ${ganeshOrphaned.length} (should be 0)`);
  for (const p of ganeshOrphaned) {
    console.log(`    ⚠️  Still orphaned: receipt ${p.receiptNumber} ₹${Number(p.amount)}`);
  }

  const ganeshCLT = await prisma.customerLedgerTransaction.count({ where: { customerId: gid } });
  console.log(`  CLT records for Ganesh: ${ganeshCLT} (should be 0)`);

  // Sale 647
  const s647 = await prisma.sale.findUnique({ where: { invoiceNumber: "647" } });
  console.log(`\n  Sale 647: exists=${!!s647}, amount=₹${Number(s647?.grandTotal ?? 0).toFixed(2)}`);

  await prisma.$disconnect();
}

main().catch(e => {
  console.error("Fix failed:", e);
  process.exit(1);
});