#!/usr/bin/env tsx
/**
 * REBUILD PRODUCTION DATA
 *
 * Restores correct financial data from existing TallyVoucher source entries.
 *
 * Strategy:
 * 1. Fix the 100x inflated VALID voucher amounts (parser bug correction)
 * 2. Delete all existing Sales, Payments, CreditLedger (backed up)
 * 3. Re-import from corrected vouchers
 * 4. Recalculate customer balances
 * 5. Verify
 *
 * Usage:
 *   npx tsx src/scripts/rebuild-production-data.ts          # DRY RUN
 *   npx tsx src/scripts/rebuild-production-data.ts --execute # APPLY
 */
import { PrismaClient } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();
const BACKUP_DIR = path.join(process.cwd(), "backups");
const RUN_TS = new Date().toISOString().replace(/[:.]/g, "-");

async function backupTable(name: string, data: unknown[]): Promise<string> {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const fp = path.join(BACKUP_DIR, `rebuild-backup-${name}-${RUN_TS}.json`);
  fs.writeFileSync(fp, JSON.stringify(data, null, 2), "utf-8");
  return fp;
}

async function getDbId(): Promise<string> {
  const rows = await prisma.$queryRaw<Array<{ current_database: string; version: string }>>`
    SELECT current_database(), version()
  `;
  return `${rows[0].current_database} on ${rows[0].version?.split(",")[0] ?? "unknown"}`;
}

async function main() {
  const isExecute = process.argv.includes("--execute");
  const START = Date.now();

  console.log("=".repeat(72));
  console.log(`  REBUILD PRODUCTION DATA`);
  console.log(`  Mode: ${isExecute ? "⚠️ EXECUTE" : "✅ DRY-RUN"}`);
  console.log(`  Time: ${new Date().toISOString()}`);
  console.log("=".repeat(72));

  // ═══ VERIFY DB ═══════════════════════════════════════════════════
  const dbId = await getDbId();
  console.log(`\n  Database: ${dbId}`);

  // ═══ BACKUP CURRENT STATE ════════════════════════════════════════
  console.log("\n  ─── Backing up current state ───");
  const bCustomers = await prisma.customer.findMany({ orderBy: { id: "asc" } });
  const bSales = await prisma.sale.findMany({ orderBy: { id: "asc" } });
  const bPayments = await prisma.payment.findMany({ orderBy: { id: "asc" } });
  const bLedger = await prisma.creditLedger.findMany({ orderBy: { id: "asc" } });
  const bVouchers = await prisma.tallyVoucher.findMany({ orderBy: { id: "asc" } });
  const bBatches = await prisma.tallyImportBatch.findMany({ orderBy: { id: "asc" } });
  const bLedgerTxns = await prisma.customerLedgerTransaction.findMany({ orderBy: { id: "asc" } });

  await backupTable("Customer", bCustomers);
  await backupTable("Sale", bSales);
  await backupTable("Payment", bPayments);
  await backupTable("CreditLedger", bLedger);
  await backupTable("TallyVoucher", bVouchers);
  await backupTable("TallyImportBatch", bBatches);
  await backupTable("CustomerLedgerTransaction", bLedgerTxns);
  console.log("  ✓ All tables backed up");

  // ═══ PHASE 1: FIX VALID/STAGED VOUCHER AMOUNTS ═══════════════════
  console.log("\n" + "=".repeat(72));
  console.log("  PHASE 1: Fix VALID voucher amounts (100x inflation bug)");
  console.log("=".repeat(72));

  const validVouchers = await prisma.tallyVoucher.findMany({
    where: { importStatus: { in: ["VALID", "PARSED", "MATCHED"] } },
    select: { id: true, debit: true, credit: true, voucherType: true },
  });
  console.log(`  VALID vouchers: ${validVouchers.length}`);

  const beforeFixDebit = validVouchers.reduce((s, v) => s + Number(v.debit), 0);
  const beforeFixCredit = validVouchers.reduce((s, v) => s + Number(v.credit), 0);
  const afterFixDebit = beforeFixDebit / 100;
  const afterFixCredit = beforeFixCredit / 100;
  console.log(`  Before fix: debit=${beforeFixDebit.toFixed(2)}, credit=${beforeFixCredit.toFixed(2)}`);
  console.log(`  After fix:  debit=${afterFixDebit.toFixed(2)}, credit=${afterFixCredit.toFixed(2)}`);

  if (isExecute) {
    for (const v of validVouchers) {
      await prisma.tallyVoucher.update({
        where: { id: v.id },
        data: {
          debit: Number(v.debit) / 100,
          credit: Number(v.credit) / 100,
        },
      });
    }
    console.log("  ✓ Fixed VALID voucher amounts");
  }

  // ═══ PHASE 2: DELETE EXISTING FINANCIAL RECORDS ════════════════════
  console.log("\n" + "=".repeat(72));
  console.log("  PHASE 2: Delete existing financial records");
  console.log("=".repeat(72));

  console.log(`  Will delete:`);
  console.log(`    - ${bLedger.length} CreditLedger entries`);
  console.log(`    - ${bPayments.length} Payment records`);
  console.log(`    - ${bSales.length} Sale records`);

  if (isExecute) {
    console.log("  Deleting CreditLedger...");
    await prisma.creditLedger.deleteMany({});
    console.log("  ✓ Deleted CreditLedger");

    console.log("  Deleting Payments...");
    await prisma.payment.deleteMany({});
    console.log("  ✓ Deleted Payments");

    console.log("  Deleting Sales...");
    await prisma.sale.deleteMany({});
    console.log("  ✓ Deleted Sales");

    // Reset customer balances
    console.log("  Resetting customer currentBalance to 0...");
    await prisma.customer.updateMany({ data: { currentBalance: new Decimal(0) } });
    console.log("  ✓ Reset customer balances");
  }

  // ═══ PHASE 3: RE-IMPORT FROM CORRECTED VOUCHERS ══════════════════
  console.log("\n" + "=".repeat(72));
  console.log("  PHASE 3: Re-import from corrected vouchers");
  console.log("=".repeat(72));

  const allVouchers = isExecute
    ? await prisma.tallyVoucher.findMany({
        where: {
          customerId: { not: null },
          isDuplicate: false,
          importStatus: { in: ["IMPORTED", "VALID", "PARSED", "MATCHED"] },
        },
        orderBy: [{ voucherDate: "asc" }, { createdAt: "asc" }],
      })
    : [];

  if (isExecute) {
    console.log(`  Total vouchers to import: ${allVouchers.length}`);

    // Get the first user for createdById
    const firstUser = await prisma.user.findFirst({ select: { id: true } });
    if (!firstUser) throw new Error("No user found in database");
    const userId = firstUser.id;

    // Track sales by invoice number for against-voucher matching
    const saleByInvoice = new Map<string, string>();
    let salesCreated = 0;
    let paymentsCreated = 0;
    let skipped = 0;

    for (const voucher of allVouchers) {
      try {
        const isDebit = Number(voucher.debit) > 0;
        const amount = isDebit ? Number(voucher.debit) : Number(voucher.credit);
        if (amount <= 0) { skipped++; continue; }

        let saleId: string | undefined;

        // Create Sale for SALES vouchers
        if (voucher.voucherType === "SALES") {
          const saleInvoiceNumber = voucher.voucherNumber || `IMP-${voucher.id}`;

          const newSale = await prisma.sale.create({
            data: {
              invoiceNumber: saleInvoiceNumber,
              customerId: voucher.customerId!,
              saleType: "CREDIT",
              subtotal: amount,
              discountAmount: 0,
              gstAmount: 0,
              grandTotal: amount,
              paidAmount: 0,
              pendingAmount: amount,
              dueDate: voucher.dueDate ?? undefined,
              paymentStatus: "UNPAID",
              status: "COMPLETED",
              notes: voucher.narration || `Imported ${voucher.voucherType}`,
              createdById: userId,
              createdAt: voucher.voucherDate,
            },
          });
          saleId = newSale.id;
          saleByInvoice.set(saleInvoiceNumber, newSale.id);
          salesCreated++;
        }

        // Create Payment for RECEIPT vouchers
        let paymentId: string | undefined;
        if (voucher.voucherType === "RECEIPT") {
          const receiptNumber = voucher.voucherNumber || `REC-IMP-${voucher.id}`;

          let linkedSaleId: string | undefined;
          if (voucher.againstVoucherNumber) {
            linkedSaleId = saleByInvoice.get(voucher.againstVoucherNumber);
          }

          const newPayment = await prisma.payment.create({
            data: {
              receiptNumber,
              customerId: voucher.customerId!,
              saleId: linkedSaleId ?? undefined,
              amount,
              paymentMode: "OTHER",
              status: "COMPLETED",
              receivedById: userId,
              paymentDate: voucher.paymentDate || voucher.voucherDate,
              createdAt: voucher.paymentDate || voucher.voucherDate,
              notes: voucher.narration || `Imported receipt against ${voucher.againstVoucherNumber || "unknown"}`,
            },
          });
          paymentId = newPayment.id;
          saleId = linkedSaleId;
          paymentsCreated++;

          // Update linked Sale's paid/pending amounts
          if (linkedSaleId) {
            const linkedSale = await prisma.sale.findUnique({ where: { id: linkedSaleId } });
            if (linkedSale) {
              const newPaid = Number(linkedSale.paidAmount) + amount;
              const newPending = Math.max(0, Number(linkedSale.grandTotal) - newPaid);
              await prisma.sale.update({
                where: { id: linkedSaleId },
                data: {
                  paidAmount: newPaid,
                  pendingAmount: newPending,
                  paymentStatus: newPending <= 0 ? "PAID" : newPending < Number(linkedSale.grandTotal) ? "PARTIALLY_PAID" : "UNPAID",
                },
              });
            }
          }
        }

        // Mark voucher as IMPORTED
        await prisma.tallyVoucher.update({
          where: { id: voucher.id },
          data: { importStatus: "IMPORTED" },
        });
      } catch (err) {
        console.error(`  Error processing voucher ${voucher.id}:`, err instanceof Error ? err.message : err);
      }
    }

    console.log(`  ✓ Created ${salesCreated} sales, ${paymentsCreated} payments, ${skipped} skipped`);
  } else {
    const allCount = await prisma.tallyVoucher.count({
      where: {
        customerId: { not: null },
        isDuplicate: false,
        importStatus: { in: ["IMPORTED", "VALID", "PARSED", "MATCHED"] },
      },
    });
    const salesCount = await prisma.tallyVoucher.count({
      where: { voucherType: "SALES", customerId: { not: null }, isDuplicate: false, importStatus: { in: ["IMPORTED", "VALID", "PARSED", "MATCHED"] } },
    });
    const receiptCount = await prisma.tallyVoucher.count({
      where: { voucherType: "RECEIPT", customerId: { not: null }, isDuplicate: false, importStatus: { in: ["IMPORTED", "VALID", "PARSED", "MATCHED"] } },
    });
    console.log(`  Would import: ${allCount} vouchers (${salesCount} sales, ${receiptCount} receipts)`);
  }

  // ═══ PHASE 4: RECALCULATE CUSTOMER BALANCES ═══════════════════════
  console.log("\n" + "=".repeat(72));
  console.log("  PHASE 4: Recalculate customer balances");
  console.log("=".repeat(72));

  const activeCustomers = isExecute
    ? await prisma.customer.findMany({
        where: { isActive: true, deletedAt: null },
        select: { id: true, openingBalance: true },
      })
    : [];

  if (isExecute) {
    let balUpdated = 0;
    for (const c of activeCustomers) {
      const ob = Number(c.openingBalance);

      // Get all CreditLedger entries for this customer
      const entries = await prisma.creditLedger.findMany({
        where: { customerId: c.id },
        select: { transactionType: true, amount: true },
        orderBy: { createdAt: "asc" },
      });

      let bal = ob;
      for (const e of entries) {
        const amt = Number(e.amount);
        if (["CREDIT_SALE", "PAYMENT_REVERSAL", "ADJUSTMENT"].includes(e.transactionType)) {
          bal += amt;
        } else if (["PAYMENT_RECEIVED", "SALE_CANCELLED", "RETURN_CREDIT"].includes(e.transactionType)) {
          bal -= amt;
        }
      }

      await prisma.customer.update({
        where: { id: c.id },
        data: { currentBalance: Math.max(0, Math.round(bal * 100) / 100) },
      });
      balUpdated++;
    }
    console.log(`  ✓ Updated ${balUpdated} customer balances`);
  } else {
    console.log("  Would recalculate balances for all active customers");
  }

  // ═══ PHASE 5: VERIFY ═════════════════════════════════════════════
  console.log("\n" + "=".repeat(72));
  console.log("  PHASE 5: Verify results");
  console.log("=".repeat(72));

  const finalSales = await prisma.sale.count();
  const finalPayments = await prisma.payment.count();
  const finalLedger = await prisma.creditLedger.count();
  const finalImported = await prisma.tallyVoucher.count({ where: { importStatus: "IMPORTED" } });
  const finalValid = await prisma.tallyVoucher.count({ where: { importStatus: { in: ["VALID", "PARSED", "MATCHED"] } } });

  const saleAgg = await prisma.sale.aggregate({ _sum: { grandTotal: true, paidAmount: true, pendingAmount: true } });
  const payAgg = await prisma.payment.aggregate({ _sum: { amount: true } });
  const ledgerAgg = await prisma.creditLedger.aggregate({ _sum: { amount: true } });
  const custAgg = await prisma.customer.aggregate({
    where: { isActive: true, deletedAt: null },
    _sum: { openingBalance: true, currentBalance: true },
    _count: true,
  });

  console.log(`\n  ─── Final State ───`);
  console.log(`  Sales:              ${finalSales} (grandTotal: ${Number(saleAgg._sum.grandTotal ?? 0).toFixed(2)})`);
  console.log(`  Payments:           ${finalPayments} (amount: ${Number(payAgg._sum.amount ?? 0).toFixed(2)})`);
  console.log(`  CreditLedger:       ${finalLedger} (amount: ${Number(ledgerAgg._sum.amount ?? 0).toFixed(2)})`);
  console.log(`  IMPORTED vouchers:  ${finalImported}`);
  console.log(`  VALID vouchers:     ${finalValid}`);
  console.log(`  Active customers:   ${custAgg._count}`);
  console.log(`  Sum openingBalance: ${Number(custAgg._sum.openingBalance ?? 0).toFixed(2)}`);
  console.log(`  Sum currentBalance: ${Number(custAgg._sum.currentBalance ?? 0).toFixed(2)}`);

  const elapsed = ((Date.now() - START) / 1000).toFixed(1);
  console.log(`\n  Elapsed: ${elapsed}s`);

  if (!isExecute) {
    console.log("\n  ⚠️  DRY-RUN COMPLETE. Use --execute to apply.");
    console.log("  npx tsx src/scripts/rebuild-production-data.ts --execute");
  } else {
    console.log("\n  ✓ REBUILD COMPLETE");
    console.log("  Next: Deploy to Vercel and verify on live URL");
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("❌ Failed:", e.message);
  process.exit(1);
});