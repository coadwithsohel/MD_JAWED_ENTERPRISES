import { prisma } from "@/lib/prisma";
import { Decimal } from "@prisma/client/runtime/library";

export interface DailySale {
  date: string;
  invoiceCount: number;
  cashSales: number;
  creditSales: number;
  totalSales: number;
}

export interface MonthlySalesSummary {
  month: number;
  year: number;
  totalSales: number;
  invoiceCount: number;
  cashSales: number;
  creditSales: number;
  averageInvoiceValue: number;
  growthPercent: number | null;
  dailyBreakdown: DailySale[];
}

export function getISTMonthBoundaries(year: number, month: number) {
  // month is 1-12
  // start of month in IST
  // Since we want exactly calendar month in Asia/Kolkata
  // We can construct the date in IST and convert to UTC
  // Using string format "YYYY-MM-01T00:00:00+05:30"
  
  const formattedMonth = month.toString().padStart(2, '0');
  const nextMonthNum = month === 12 ? 1 : month + 1;
  const nextYearNum = month === 12 ? year + 1 : year;
  const formattedNextMonth = nextMonthNum.toString().padStart(2, '0');

  const startIstString = `${year}-${formattedMonth}-01T00:00:00+05:30`;
  const endIstString = `${nextYearNum}-${formattedNextMonth}-01T00:00:00+05:30`;

  const startUtc = new Date(startIstString);
  const endUtc = new Date(new Date(endIstString).getTime() - 1); // 1 ms before next month start

  return { start: startUtc, end: endUtc };
}

export function formatISTDate(date: Date): string {
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(date.getTime() + istOffset);
  const y = istDate.getUTCFullYear();
  const m = (istDate.getUTCMonth() + 1).toString().padStart(2, '0');
  const d = istDate.getUTCDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export async function getMonthlySales(month: number, year: number): Promise<MonthlySalesSummary> {
  const { start, end } = getISTMonthBoundaries(year, month);
  
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const { start: prevStart, end: prevEnd } = getISTMonthBoundaries(prevYear, prevMonth);

  // Exclude CANCELLED and VOIDED statuses. (Also RETURNED? A returned sale is typically a return, 
  // but if the prompt specifically says "Exclude: voided invoices, cancelled invoices", we'll exclude CANCELLED.
  // There is no VOIDED in SaleStatus enum according to schema, only voidedAt field!)
  const validStatus: ("COMPLETED" | "CANCELLED" | "RETURNED" | "PARTIALLY_RETURNED")[] = ["COMPLETED"];

  const currentMonthSales = await prisma.sale.findMany({
    where: {
      status: { in: validStatus },
      voidedAt: null, // exclude voided
      OR: [
        { saleDate: { gte: start, lte: end } },
        { saleDate: null, createdAt: { gte: start, lte: end } }
      ]
    },
    select: {
      id: true,
      saleDate: true,
      createdAt: true,
      saleType: true,
      grandTotal: true,
    }
  });

  const prevMonthSales = await prisma.sale.findMany({
    where: {
      status: { in: validStatus },
      voidedAt: null,
      OR: [
        { saleDate: { gte: prevStart, lte: prevEnd } },
        { saleDate: null, createdAt: { gte: prevStart, lte: prevEnd } }
      ]
    },
    select: {
      grandTotal: true
    }
  });

  let totalSales = new Decimal(0);
  let cashSales = new Decimal(0);
  let creditSales = new Decimal(0);
  const invoiceCount = currentMonthSales.length;

  const dailyMap = new Map<string, DailySale>();

  for (const sale of currentMonthSales) {
    const amt = sale.grandTotal ?? new Decimal(0);
    totalSales = totalSales.add(amt);
    
    // Cash vs Credit
    // Cash Sale: saleType === "CASH"
    // Credit Sale: saleType === "CREDIT" || saleType === "PARTIAL"
    const isCash = sale.saleType === "CASH";
    if (isCash) {
      cashSales = cashSales.add(amt);
    } else {
      creditSales = creditSales.add(amt);
    }

    // Daily breakdown
    const accDate = sale.saleDate ?? sale.createdAt;
    const dateStr = formatISTDate(accDate);
    
    const dayStat = dailyMap.get(dateStr) ?? {
      date: dateStr,
      invoiceCount: 0,
      cashSales: 0,
      creditSales: 0,
      totalSales: 0
    };

    dayStat.invoiceCount += 1;
    dayStat.totalSales += amt.toNumber();
    if (isCash) dayStat.cashSales += amt.toNumber();
    else dayStat.creditSales += amt.toNumber();

    dailyMap.set(dateStr, dayStat);
  }

  let prevTotalSales = new Decimal(0);
  for (const p of prevMonthSales) {
    prevTotalSales = prevTotalSales.add(p.grandTotal ?? new Decimal(0));
  }

  let growthPercent: number | null = null;
  const currentTotal = totalSales.toNumber();
  const prevTotal = prevTotalSales.toNumber();

  if (prevTotal === 0) {
    if (currentTotal > 0) growthPercent = 100;
    else growthPercent = 0;
  } else {
    growthPercent = ((currentTotal - prevTotal) / prevTotal) * 100;
  }

  // Sort daily breakdown by date
  const dailyBreakdown = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  return {
    month,
    year,
    totalSales: currentTotal,
    invoiceCount,
    cashSales: cashSales.toNumber(),
    creditSales: creditSales.toNumber(),
    averageInvoiceValue: invoiceCount > 0 ? currentTotal / invoiceCount : 0,
    growthPercent: growthPercent !== null ? Number(growthPercent.toFixed(2)) : null,
    dailyBreakdown
  };
}

