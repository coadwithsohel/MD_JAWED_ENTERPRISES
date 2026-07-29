import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const month = searchParams.get('month');
    const year = searchParams.get('year');
    const status = searchParams.get('status') || 'missing'; // 'missing', 'partial', 'complete', 'all'
    const source = searchParams.get('source'); // 'pos', 'imported', 'all'

    const whereClause: any = {
      status: "COMPLETED",
      voidedAt: null
    };

    if (year) {
      const yearNum = parseInt(year);
      let startUtc, endUtc;
      if (month && month !== 'all') {
        const monthNum = parseInt(month);
        startUtc = new Date(Date.UTC(yearNum, monthNum - 1, 1, -5, -30, 0)); // IST boundaries simplified
        endUtc = new Date(Date.UTC(yearNum, monthNum, 1, -5, -30, 0));
        endUtc = new Date(endUtc.getTime() - 1);
      } else {
        startUtc = new Date(Date.UTC(yearNum, 0, 1, -5, -30, 0));
        endUtc = new Date(Date.UTC(yearNum + 1, 0, 1, -5, -30, 0));
        endUtc = new Date(endUtc.getTime() - 1);
      }
      whereClause.OR = [
        { saleDate: { gte: startUtc, lte: endUtc } },
        { saleDate: null, createdAt: { gte: startUtc, lte: endUtc } }
      ];
    }

    const sales = await prisma.sale.findMany({
      where: whereClause,
      include: {
        customer: true,
        saleItems: {
          include: {
            product: true
          }
        },
        costAllocation: true
      },
      orderBy: { createdAt: 'desc' }
    });

    const result = [];

    for (const sale of sales) {
      const isImported = sale.saleItems.length === 0;
      
      if (source === 'pos' && isImported) continue;
      if (source === 'imported' && !isImported) continue;

      let saleStatus = 'complete';

      if (isImported) {
        if (!sale.costAllocation) {
          saleStatus = 'missing';
        }
      } else {
        let hasMissing = false;
        let hasCost = false;
        for (const item of sale.saleItems) {
          if (item.purchasePriceSnapshot && Number(item.purchasePriceSnapshot) > 0) {
            hasCost = true;
          } else {
            hasMissing = true;
          }
        }
        if (hasMissing && !hasCost) saleStatus = 'missing';
        else if (hasMissing && hasCost) saleStatus = 'partial';
      }

      if (status !== 'all' && status !== saleStatus) continue;

      result.push({
        ...sale,
        computedCostStatus: saleStatus
      });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching cost data:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
