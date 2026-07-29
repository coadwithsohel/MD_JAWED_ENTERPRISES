import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function runAudit() {
  const start = new Date("2026-01-01T00:00:00.000+05:30");
  const end = new Date("2026-12-31T23:59:59.999+05:30");

  const sales = await prisma.sale.findMany({
    where: {
      status: "COMPLETED",
      voidedAt: null,
      OR: [
        { saleDate: { gte: start, lte: end } },
        { saleDate: null, createdAt: { gte: start, lte: end } }
      ]
    },
    include: {
      saleItems: {
        include: {
          product: true
        }
      }
    }
  });

  console.log(`Total 2026 Active Sales: ${sales.length}`);
  
  let totalInvoices = 0;
  let completeCostInvoices = 0;
  let partialCostInvoices = 0;
  let noCostInvoices = 0;

  let salesWithCompleteCost = 0;
  let salesWithoutReliableCost = 0;
  let totalCogs = 0;

  let exactCogs = 294500; // Expected from current output

  for (const sale of sales) {
    totalInvoices++;
    let invoiceCogs = 0;
    let missingCostAmount = 0;
    
    let hasItems = sale.saleItems.length > 0;
    let hasMissingCost = false;
    let hasAnyCost = false;

    if (!hasItems) {
      hasMissingCost = true;
    }

    for (const item of sale.saleItems) {
      let itemCost = 0;
      if (item.purchasePriceSnapshot && Number(item.purchasePriceSnapshot) > 0) {
        itemCost = Number(item.purchasePriceSnapshot);
        hasAnyCost = true;
      } else if (item.product && item.product.purchasePrice && Number(item.product.purchasePrice) > 0) {
        itemCost = Number(item.product.purchasePrice);
        hasAnyCost = true;
      } else {
        hasMissingCost = true;
      }
      invoiceCogs += itemCost * item.quantity;
    }

    totalCogs += invoiceCogs;

    const saleTotal = Number(sale.grandTotal || 0);

    if (hasMissingCost && hasAnyCost) {
      partialCostInvoices++;
      salesWithoutReliableCost += saleTotal;
    } else if (hasMissingCost && !hasAnyCost) {
      noCostInvoices++;
      salesWithoutReliableCost += saleTotal;
    } else {
      completeCostInvoices++;
      salesWithCompleteCost += saleTotal;
    }

    console.log(`Invoice ${sale.invoiceNumber} | Date: ${sale.saleDate || sale.createdAt} | Total: ${saleTotal} | Items: ${sale.saleItems.length} | Calc COGS: ${invoiceCogs} | Missing Cost: ${hasMissingCost}`);
  }

  console.log("--------------------------------------------------");
  console.log(`Total Invoices: ${totalInvoices}`);
  console.log(`Complete Cost Invoices: ${completeCostInvoices}`);
  console.log(`Partial Cost Invoices: ${partialCostInvoices}`);
  console.log(`No Cost Invoices: ${noCostInvoices}`);
  console.log(`Sales Covered by Complete Cost: ${salesWithCompleteCost}`);
  console.log(`Sales Without Reliable Cost: ${salesWithoutReliableCost}`);
  console.log(`Cost Data Coverage % (Amount based): ${((salesWithCompleteCost / (salesWithCompleteCost + salesWithoutReliableCost)) * 100).toFixed(2)}%`);
  console.log(`Cost Data Coverage % (Count based): ${((completeCostInvoices / totalInvoices) * 100).toFixed(2)}%`);
  console.log(`Total Calculated COGS: ${totalCogs}`);
}

runAudit().catch(console.error).finally(() => prisma.$disconnect());
