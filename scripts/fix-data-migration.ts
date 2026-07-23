// ─── Database Data Migration Script ──────────────────────────────────────
// Run: npx tsx scripts/fix-data-migration.ts
// Fixes the 2,976 soft-deleted customers and stale import batches

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("=== DATA MIGRATION START ===\n");

  // Fix 1: Convert all soft-deleted (deletedAt != null) customers
  // to properly deactivated (isActive=false, deletedAt=null)
  const softDeletedCount = await prisma.customer.count({
    where: { deletedAt: { not: null } },
  });
  console.log(`Soft-deleted customers to fix: ${softDeletedCount}`);

  const fixed1 = await prisma.customer.updateMany({
    where: { deletedAt: { not: null } },
    data: {
      isActive: false,
      deletedAt: null,
      deleteReason: "Migration: fixed from incorrect soft-delete to proper deactivation",
    },
  });
  console.log(`Fixed soft-deleted -> deactivated: ${fixed1.count}`);

  // Fix 2: Delete stale tally batches that have 0 imported rows
  const staleBatches = await prisma.tallyImportBatch.findMany({
    where: { status: { in: ["UPLOADED", "READY", "FAILED"] } },
  });
  console.log(`\nStale tally batches to remove: ${staleBatches.length}`);
  for (const b of staleBatches) {
    const voucherCount = await prisma.tallyVoucher.count({
      where: { importBatchId: b.id },
    });
    await prisma.tallyVoucher.deleteMany({ where: { importBatchId: b.id } });
    await prisma.tallyImportBatch.delete({ where: { id: b.id } });
    console.log(`  Removed batch: ${b.id} (${b.originalFileName}, status=${b.status}, ${voucherCount} vouchers deleted)`);
  }

  // Fix 3: Fix stale customer import batches
  const staleCustomerBatches = await prisma.customerImportBatch.findMany({
    where: { status: { in: ["FAILED", "UPLOADED", "VALIDATING"] }, importedRows: 0 },
  });
  console.log(`\nStale customer batches to remove: ${staleCustomerBatches.length}`);
  for (const b of staleCustomerBatches) {
    await prisma.customerImportRow.deleteMany({ where: { importBatchId: b.id } });
    await prisma.customerImportBatch.delete({ where: { id: b.id } });
    console.log(`  Removed: ${b.id} (${b.originalFileName}, status=${b.status})`);
  }

  // Verify counts after fix
  console.log("\n=== AFTER MIGRATION ===");
  const total = await prisma.customer.count();
  const active = await prisma.customer.count({ where: { isActive: true, deletedAt: null } });
  const inactive = await prisma.customer.count({ where: { isActive: false, deletedAt: null } });
  const softDel = await prisma.customer.count({ where: { deletedAt: { not: null } } });
  const tallyBatches = await prisma.tallyImportBatch.count();
  const customerBatches = await prisma.customerImportBatch.count();

  console.log(`Total customers: ${total}`);
  console.log(`Active: ${active}`);
  console.log(`Inactive: ${inactive}`);
  console.log(`Soft-deleted: ${softDel}`);
  console.log(`Tally batches remaining: ${tallyBatches}`);
  console.log(`Customer batches remaining: ${customerBatches}`);

  // Verify Dashboard values now
  const pendingActive = await prisma.sale.aggregate({
    where: {
      status: { in: ["COMPLETED", "PARTIALLY_RETURNED"] },
      saleType: { in: ["CREDIT", "PARTIAL"] },
      pendingAmount: { gt: 0 },
      customer: { isActive: true, deletedAt: null },
    },
    _sum: { pendingAmount: true },
    _count: { _all: true },
  });
  console.log(`\nPending Credit (active customers): ₹${Number(pendingActive._sum.pendingAmount ?? 0)} - ${pendingActive._count._all} sales`);

  const overdueActive = await prisma.sale.aggregate({
    where: {
      status: { in: ["COMPLETED", "PARTIALLY_RETURNED"] },
      saleType: { in: ["CREDIT", "PARTIAL"] },
      pendingAmount: { gt: 0 },
      dueDate: { lt: new Date() },
      customer: { isActive: true, deletedAt: null },
    },
    _sum: { pendingAmount: true },
    _count: { _all: true },
  });
  console.log(`Overdue (active customers): ₹${Number(overdueActive._sum.pendingAmount ?? 0)} - ${overdueActive._count._all} invoices`);

  console.log("\n=== MIGRATION COMPLETE ===");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});