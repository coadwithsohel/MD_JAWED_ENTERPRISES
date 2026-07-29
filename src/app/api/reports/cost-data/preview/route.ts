import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { saleItemIds, saleIds } = body;

    const previewResults: any[] = [];

    if (saleItemIds && saleItemIds.length > 0) {
      const saleItems = await prisma.saleItem.findMany({
        where: { id: { in: saleItemIds } },
        include: { product: true, sale: true }
      });

      for (const item of saleItems) {
        let proposedUnitCost = 0;
        let source = "UNAVAILABLE";
        let isEstimated = true;

        if (item.purchasePriceSnapshot && Number(item.purchasePriceSnapshot) > 0) {
          proposedUnitCost = Number(item.purchasePriceSnapshot);
          source = "EXACT";
          isEstimated = false;
        } else if (item.product?.purchasePrice && Number(item.product.purchasePrice) > 0) {
          proposedUnitCost = Number(item.product.purchasePrice);
          source = "ESTIMATED";
          isEstimated = true;
        }

        previewResults.push({
          type: "SALE_ITEM",
          id: item.id,
          saleId: item.saleId,
          invoiceNumber: item.sale.invoiceNumber,
          productName: item.product?.name || "Unknown Product",
          quantity: item.quantity,
          sellingAmount: Number(item.lineTotal),
          oldCost: Number(item.purchasePriceSnapshot || 0),
          proposedUnitCost,
          proposedTotalCost: proposedUnitCost * item.quantity,
          source,
          isEstimated
        });
      }
    }

    if (saleIds && saleIds.length > 0) {
      const sales = await prisma.sale.findMany({
        where: { id: { in: saleIds } },
        include: { costAllocation: true }
      });

      for (const sale of sales) {
        previewResults.push({
          type: "SALE_ALLOCATION",
          id: sale.id,
          saleId: sale.id,
          invoiceNumber: sale.invoiceNumber,
          productName: "Invoice Total (Manual)",
          quantity: 1,
          sellingAmount: Number(sale.grandTotal),
          oldCost: sale.costAllocation ? Number(sale.costAllocation.totalCostAmount) : 0,
          proposedUnitCost: 0,
          proposedTotalCost: 0, // Admin must provide this manually
          source: "MANUAL",
          isEstimated: false
        });
      }
    }

    return NextResponse.json({ preview: previewResults });
  } catch (error) {
    console.error("Preview error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
