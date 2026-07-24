#!/usr/bin/env tsx
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const pendingBatches = await prisma.tallyImportBatch.findMany({
    where: { status: { in: ["UPLOADED", "READY"] } },
    select: { id: true, originalFileName: true, status: true, _count: { select: { vouchers: true } } },
  });

  console.log(`Found ${pendingBatches.length} pending batches:`);
  for (const b of pendingBatches) {
    console.log(`  ${b.id} — ${b.originalFileName} (${b.status}, ${b._count.vouchers} vouchers)`);
  }

  for (const b of pendingBatches) {
    await prisma.tallyVoucher.deleteMany({ where: { importBatchId: b.id } });
    await prisma.tallyImportBatch.delete({ where: { id: b.id } });
    console.log(`Deleted batch: ${b.id}`);
  }

  console.log(`✓ Cancelled ${pendingBatches.length} pending batches`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });