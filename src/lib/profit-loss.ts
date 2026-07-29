import { getISTMonthBoundaries } from "./monthly-sales";
import { prisma } from "./prisma";
import { ExpenseCategory } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

export interface ProfitAndLossReport {
  period: "monthly" | "yearly";
  month?: number;
  year: number;
  grossSales: number;
  cashSales: number;
  creditSales: number;
  invoiceCount: number;
  salesReturns: number;
  netSales: number;
  costOfGoodsSold: number;
  grossProfit: number;
  totalExpenses: number;
  expensesByCategory: { category: string; amount: number }[];
  netProfit: number;
  profitMargin: number;
  costDataCompleteness: {
    completeInvoices: number;
    partialCostInvoices: number;
    missingCostInvoices: number;
    salesCoveredByCost: number;
    salesWithoutCost: number;
    coveragePercentAmount: number;
    coveragePercentCount: number;
  };
  expenseCount: number;
  monthlyBreakdown?: {
    month: number;
    netSales: number;
    costOfGoodsSold: number;
    missingCostSales: number;
    coveragePercent: number;
    grossProfit: number;
    totalExpenses: number;
    netProfit: number;
  }[];
}

export function getISTBoundaries(params: { period: "monthly" | "yearly", month?: number, year: number }) {
  if (params.period === "yearly") {
    const startIstString = `${params.year}-01-01T00:00:00+05:30`;
    const endIstString = `${params.year + 1}-01-01T00:00:00+05:30`;
    const startUtc = new Date(startIstString);
    const endUtc = new Date(new Date(endIstString).getTime() - 1);
    return { start: startUtc, end: endUtc };
  } else {
    return getISTMonthBoundaries(params.year, params.month!);
  }
}

export async function getProfitAndLoss(params: { period: "monthly" | "yearly", month?: number, year: number }): Promise<ProfitAndLossReport> {
  const { start, end } = getISTBoundaries(params);

  const validStatus: ("COMPLETED" | "CANCELLED" | "RETURNED" | "PARTIALLY_RETURNED")[] = ["COMPLETED"];
  
  const currentSales = await prisma.sale.findMany({
    where: {
      status: { in: validStatus },
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
      },
      costAllocation: true
    }
  });

  const returnedSales = await prisma.sale.aggregate({
    _sum: { grandTotal: true },
    where: {
      status: { in: ["RETURNED", "PARTIALLY_RETURNED"] },
      voidedAt: null,
      OR: [
        { saleDate: { gte: start, lte: end } },
        { saleDate: null, createdAt: { gte: start, lte: end } }
      ]
    }
  });

  const rawExpenses = await prisma.expense.findMany({
    where: {
      status: "COMPLETED",
      expenseDate: {
        gte: start,
        lte: end
      }
    }
  });

  let grossSales = 0;
  let cashSales = 0;
  let creditSales = 0;
  let invoiceCount = currentSales.length;
  let costOfGoodsSold = 0;
  
  let completeInvoices = 0;
  let partialCostInvoices = 0;
  let missingCostInvoices = 0;
  let salesCoveredByCost = 0;
  let salesWithoutCost = 0;

  const monthlyMap: Record<number, {
    netSales: number;
    costOfGoodsSold: number;
    totalExpenses: number;
    salesReturns: number;
    salesCoveredByCost: number;
    salesWithoutCost: number;
  }> = {};

  for (let m = 1; m <= 12; m++) {
    monthlyMap[m] = { netSales: 0, costOfGoodsSold: 0, totalExpenses: 0, salesReturns: 0, salesCoveredByCost: 0, salesWithoutCost: 0 };
  }

  for (const sale of currentSales) {
    const amt = Number(sale.grandTotal || 0);
    grossSales += amt;
    
    if (sale.saleType === "CASH") cashSales += amt;
    else creditSales += amt;

    let hasItems = sale.saleItems.length > 0;
    let hasMissingCost = false;
    let hasAnyCost = false;
    let saleCost = 0;

    if (!hasItems) {
      if (sale.costAllocation) {
        saleCost = Number(sale.costAllocation.totalCostAmount);
        hasAnyCost = true;
      } else {
        hasMissingCost = true;
      }
    } else {
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
        saleCost += itemCost * item.quantity;
      }
    }

    costOfGoodsSold += saleCost;

    let currentMonth = -1;
    if (params.period === "yearly") {
      const accDate = sale.saleDate || sale.createdAt;
      const istOffset = 5.5 * 60 * 60 * 1000;
      const istDate = new Date(accDate.getTime() + istOffset);
      currentMonth = istDate.getUTCMonth() + 1;
      monthlyMap[currentMonth].netSales += amt;
      monthlyMap[currentMonth].costOfGoodsSold += saleCost;
    }

    if (hasMissingCost && hasAnyCost) {
      partialCostInvoices++;
      salesWithoutCost += amt;
      if (currentMonth !== -1) monthlyMap[currentMonth].salesWithoutCost += amt;
    } else if (hasMissingCost && !hasAnyCost) {
      missingCostInvoices++;
      salesWithoutCost += amt;
      if (currentMonth !== -1) monthlyMap[currentMonth].salesWithoutCost += amt;
    } else {
      completeInvoices++;
      salesCoveredByCost += amt;
      if (currentMonth !== -1) monthlyMap[currentMonth].salesCoveredByCost += amt;
    }
  }

  const salesReturns = Number(returnedSales._sum.grandTotal || 0);
  const netSales = grossSales - salesReturns;
  const grossProfit = netSales - costOfGoodsSold;

  if (params.period === "yearly" && salesReturns > 0) {
      const allReturns = await prisma.sale.findMany({
        where: {
          status: { in: ["RETURNED", "PARTIALLY_RETURNED"] },
          voidedAt: null,
          OR: [
            { saleDate: { gte: start, lte: end } },
            { saleDate: null, createdAt: { gte: start, lte: end } }
          ]
        },
        select: { saleDate: true, createdAt: true, grandTotal: true }
      });
      for (const r of allReturns) {
          const accDate = r.saleDate || r.createdAt;
          const istOffset = 5.5 * 60 * 60 * 1000;
          const istDate = new Date(accDate.getTime() + istOffset);
          const m = istDate.getUTCMonth() + 1;
          monthlyMap[m].netSales -= Number(r.grandTotal || 0);
      }
  }

  let totalExpenses = 0;
  const expMap: Record<string, number> = {};
  const expenseCount = rawExpenses.length;

  for (const exp of rawExpenses) {
    const amt = Number(exp.amount);
    expMap[exp.category] = (expMap[exp.category] || 0) + amt;
    totalExpenses += amt;

    if (params.period === "yearly") {
      const istOffset = 5.5 * 60 * 60 * 1000;
      const istDate = new Date(exp.expenseDate.getTime() + istOffset);
      const m = istDate.getUTCMonth() + 1;
      monthlyMap[m].totalExpenses += amt;
    }
  }

  const expensesByCategory = Object.entries(expMap).map(([cat, amt]) => ({
    category: cat.replace("_", " "),
    amount: amt
  }));

  const netProfit = grossProfit - totalExpenses;
  const profitMargin = netSales > 0 ? (netProfit / netSales) * 100 : 0;
  
  const totalTrackedSales = salesCoveredByCost + salesWithoutCost;
  const coveragePercentAmount = totalTrackedSales > 0 ? (salesCoveredByCost / totalTrackedSales) * 100 : 100;
  const coveragePercentCount = invoiceCount > 0 ? (completeInvoices / invoiceCount) * 100 : 100;

  let monthlyBreakdown = undefined;
  if (params.period === "yearly") {
    monthlyBreakdown = [];
    for (let m = 1; m <= 12; m++) {
      const data = monthlyMap[m];
      const mTotalTracked = data.salesCoveredByCost + data.salesWithoutCost;
      const mCoverage = mTotalTracked > 0 ? (data.salesCoveredByCost / mTotalTracked) * 100 : 100;
      monthlyBreakdown.push({
        month: m,
        netSales: data.netSales,
        costOfGoodsSold: data.costOfGoodsSold,
        missingCostSales: data.salesWithoutCost,
        coveragePercent: mCoverage,
        grossProfit: data.netSales - data.costOfGoodsSold,
        totalExpenses: data.totalExpenses,
        netProfit: (data.netSales - data.costOfGoodsSold) - data.totalExpenses
      });
    }
  }

  return {
    period: params.period,
    month: params.month,
    year: params.year,
    grossSales,
    cashSales,
    creditSales,
    invoiceCount,
    salesReturns,
    netSales,
    costOfGoodsSold,
    grossProfit,
    totalExpenses,
    expensesByCategory,
    netProfit,
    profitMargin,
    expenseCount,
    costDataCompleteness: {
      completeInvoices,
      partialCostInvoices,
      missingCostInvoices,
      salesCoveredByCost,
      salesWithoutCost,
      coveragePercentAmount: Number(coveragePercentAmount.toFixed(2)),
      coveragePercentCount: Number(coveragePercentCount.toFixed(2))
    },
    monthlyBreakdown
  };
}
