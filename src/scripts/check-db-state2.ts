import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const batches = await prisma.tallyImportBatch.findMany({ orderBy: { createdAt: "asc" } });
  for (const b of batches) {
    const imported = await prisma.tallyVoucher.count({ where: { importBatchId: b.id, importStatus: "IMPORTED" } });
    const failed = await prisma.tallyVoucher.count({ where: { importBatchId: b.id, importStatus: "FAILED" } });
    const skipped = await prisma.tallyVoucher.count({ where: { importBatchId: b.id, importStatus: { in: ["SKIPPED"] } } });
    const pending = await prisma.tallyVoucher.count({ where: { importBatchId: b.id, importStatus: { in: ["VALID", "PARSED", "MATCHED"] } } });
    console.log(b.id.slice(0,20), b.originalFileName, "status:", b.status, "total:", b.totalVouchers, "imported:", imported, "failed:", failed, "skipped:", skipped, "pending:", pending, b.createdAt.toISOString().slice(0,16));
  }

  const types = await prisma.tallyVoucher.groupBy({ by: ["voucherType", "importStatus"], _count: true });
  console.log("\nVoucher Type x Status:");
  types.forEach(t => console.log("  ", t.voucherType, t.importStatus, t._count));

  const impSales = await prisma.sale.count({ where: { invoiceNumber: { startsWith: "IMP-" } } });
  console.log("\nIMP- sales:", impSales, "regular sales:", await prisma.sale.count() - impSales);

  const impPayments = await prisma.payment.count({ where: { receiptNumber: { startsWith: "REC-IMP-" } } });
  console.log("REC-IMP payments:", impPayments, "regular payments:", await prisma.payment.count() - impPayments);

  const manualSales = await prisma.sale.findMany({ where: { NOT: { invoiceNumber: { startsWith: "IMP-" } } }, take: 5, select: { invoiceNumber: true, grandTotal: true } });
  console.log("\nManual sales samples:", manualSales.length);
  manualSales.forEach(s => console.log("  ", s.invoiceNumber, s.grandTotal));

  const custImportBatches = await prisma.customerImportBatch.findMany({ select: { id: true, originalFileName: true, status: true, totalRows: true, importedRows: true, createdAt: true } });
  console.log("\nCustomer Import Batches:");
  custImportBatches.forEach(b => console.log("  ", b.id.slice(0,20), b.originalFileName, b.status, b.totalRows, "rows, imported:", b.importedRows, b.createdAt));

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });