import { prisma } from "./prisma";
import { Decimal } from "@prisma/client/runtime/library";
import { getISTStartOfToday } from "./accounting";

// ─── Date helpers ─────────────────────────────────────────────────────────────

export function getISTNow(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function daysBetween(from: Date, to: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.floor((to.getTime() - from.getTime()) / msPerDay);
}

// ─── Overdue response types ──────────────────────────────────────────────────

export interface OverdueInvoice {
  id: string;
  invoiceNumber: string;
  customer: {
    id: string;
    customerCode: string;
    fullName: string;
    mobile: string;
    alternateMobile?: string | null;
    address?: string | null;
    city?: string | null;
  } | null;
  createdAt: Date;
  dueDate: Date | null;
  effectiveDueDate: Date;
  daysOverdue: number;
  grandTotal: Decimal;
  paidAmount: Decimal;
  pendingAmount: Decimal;
  remainingAfterAllocation: Decimal;
  paymentStatus: string;
  saleType: string;
}

export interface OverdueCustomerSummary {
  customer: {
    id: string;
    customerCode: string;
    fullName: string;
    mobile: string;
    alternateMobile?: string | null;
    address?: string | null;
    city?: string | null;
  } | null;
  overdueInvoiceCount: number;
  totalOverdueAmount: Decimal;
  oldestDueDate: Date;
  maxDaysOverdue: number;
}

export interface OverdueDataResponse {
  invoices: OverdueInvoice[];
  customers: OverdueCustomerSummary[];
  total: number;
  page: number;
  pages: number;
  summary: {
    overdueCustomers: number;
    overdueInvoices: number;
    totalOverdueAmount: Decimal;
  };
}

// ─── Get default credit days (cached) ────────────────────────────────────────

let cachedDefaultCreditDays: number | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60_000; // 1 minute

async function getDefaultCreditDaysCached(): Promise<number> {
  const now = Date.now();
  if (cachedDefaultCreditDays !== null && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedDefaultCreditDays;
  }
  const settings = await prisma.shopSettings.findFirst({
    select: { defaultCreditDays: true },
  });
  cachedDefaultCreditDays = settings?.defaultCreditDays ?? 15;
  cacheTimestamp = now;
  return cachedDefaultCreditDays;
}

// ─── Optimized Overdue Query ──────────────────────────────────────────────────
// Uses a single aggregated raw SQL query instead of N+1 per-customer loops.
// This is the primary fix for the 504 FUNCTION_INVOCATION_TIMEOUT.

/**
 * Get overdue sales and their customers using a single grouped query.
 * Avoids the N+1 pattern where each customer's FIFO allocation was done separately.
 */
async function getOverdueSalesAggregated(): Promise<{
  sales: Array<{
    id: string;
    invoiceNumber: string;
    customerId: string | null;
    grandTotal: Decimal;
    paidAmount: Decimal;
    pendingAmount: Decimal;
    saleType: string;
    status: string;
    paymentStatus: string;
    createdAt: Date;
    dueDate: Date | null;
    effectiveDueDate: Date;
  }>;
  totalAmount: Decimal;
  totalCount: number;
}> {
  const defaultCreditDays = await getDefaultCreditDaysCached();
  const istToday = getISTStartOfToday();

  // Get all credit sales with pending amounts for active (non-deleted) customers
  // in a single query — no per-customer loop.
  const sales = await prisma.sale.findMany({
    where: {
      status: { in: ["COMPLETED", "PARTIALLY_RETURNED"] },
      saleType: { in: ["CREDIT", "PARTIAL"] },
      pendingAmount: { gt: new Decimal(0) },
      customer: {
        isActive: true,
        deletedAt: null,
      },
    },
    select: {
      id: true,
      invoiceNumber: true,
      customerId: true,
      grandTotal: true,
      paidAmount: true,
      pendingAmount: true,
      dueDate: true,
      createdAt: true,
      saleType: true,
      status: true,
      paymentStatus: true,
    },
    orderBy: { createdAt: "asc" },
  });

  // Filter overdue sales by effective due date in JavaScript
  // This is faster than N+1 queries even for large datasets
  const overdueSales: Array<{
    id: string;
    invoiceNumber: string;
    customerId: string | null;
    grandTotal: Decimal;
    paidAmount: Decimal;
    pendingAmount: Decimal;
    saleType: string;
    status: string;
    paymentStatus: string;
    createdAt: Date;
    dueDate: Date | null;
    effectiveDueDate: Date;
  }> = [];

  for (const sale of sales) {
    // Calculate effective due date
    let effectiveDueDate: Date;
    if (sale.dueDate) {
      effectiveDueDate = new Date(sale.dueDate);
    } else {
      // Use createdAt + defaultCreditDays as fallback
      effectiveDueDate = new Date(sale.createdAt);
      effectiveDueDate.setDate(effectiveDueDate.getDate() + defaultCreditDays);
    }

    if (effectiveDueDate < istToday) {
      overdueSales.push({
        ...sale,
        effectiveDueDate,
      });
    }
  }

  const totalAmount = overdueSales.reduce(
    (sum, s) => sum.add(s.pendingAmount),
    new Decimal(0),
  );

  return {
    sales: overdueSales,
    totalAmount,
    totalCount: overdueSales.length,
  };
}

// ─── Core Overdue Query (for the overdue-customers page) ──────────────────────
// Uses the optimized grouped query, then applies pagination, search, and summary.

export async function getOverdueData(options?: {
  page?: number;
  limit?: number;
  customerId?: string;
  search?: string;
}): Promise<OverdueDataResponse> {
  const page = options?.page ?? 1;
  const limit = options?.limit ?? 50;
  const skip = (page - 1) * limit;

  const { sales: allOverdueSales } = await getOverdueSalesAggregated();

  if (allOverdueSales.length === 0) {
    return {
      invoices: [],
      customers: [],
      total: 0,
      page,
      pages: 0,
      summary: { overdueCustomers: 0, overdueInvoices: 0, totalOverdueAmount: new Decimal(0) },
    };
  }

  // Filter by customerId if specified
  let filteredSales = allOverdueSales;
  if (options?.customerId) {
    filteredSales = allOverdueSales.filter((s) => s.customerId === options.customerId);
  }

  // Collect unique customer IDs
  const customerIds = [...new Set(filteredSales.map((s) => s.customerId).filter(Boolean))] as string[];

  // Fetch customer details in one batch query (not one-by-one)
  const customers = customerIds.length > 0
    ? await prisma.customer.findMany({
        where: { id: { in: customerIds } },
        select: {
          id: true,
          customerCode: true,
          fullName: true,
          mobile: true,
          alternateMobile: true,
          address: true,
          city: true,
        },
      })
    : [];
  const customerMap = new Map(customers.map((c) => [c.id, c]));

  const istToday = getISTStartOfToday();

  // Build overdue invoices
  const allOverdueInvoices: OverdueInvoice[] = filteredSales.map((sale) => {
    const cust = sale.customerId ? customerMap.get(sale.customerId) : undefined;
    const daysOd = daysBetween(sale.effectiveDueDate, istToday);
    return {
      id: sale.id,
      invoiceNumber: sale.invoiceNumber,
      customer: cust ?? null,
      createdAt: sale.createdAt,
      dueDate: sale.dueDate,
      effectiveDueDate: sale.effectiveDueDate,
      daysOverdue: Math.max(0, daysOd),
      grandTotal: sale.grandTotal,
      paidAmount: sale.paidAmount,
      pendingAmount: sale.pendingAmount,
      remainingAfterAllocation: sale.pendingAmount,
      paymentStatus: sale.paymentStatus,
      saleType: sale.saleType,
    };
  });

  // Apply search filter
  let filteredInvoices = allOverdueInvoices;
  if (options?.search) {
    const q = options.search.toLowerCase();
    filteredInvoices = allOverdueInvoices.filter(
      (inv) =>
        inv.invoiceNumber.toLowerCase().includes(q) ||
        inv.customer?.fullName.toLowerCase().includes(q) ||
        inv.customer?.mobile.includes(q) ||
        inv.customer?.customerCode.toLowerCase().includes(q),
    );
  }

  // Sort by effectiveDueDate ascending (oldest first)
  filteredInvoices.sort(
    (a, b) => a.effectiveDueDate.getTime() - b.effectiveDueDate.getTime(),
  );

  const total = filteredInvoices.length;
  const pagedInvoices = filteredInvoices.slice(skip, skip + limit);

  // Aggregate by customer
  const customerAggMap = new Map<string, OverdueCustomerSummary>();
  for (const inv of filteredInvoices) {
    if (!inv.customer) continue;
    const cid = inv.customer.id;
    const existing = customerAggMap.get(cid);
    const daysOd = daysBetween(inv.effectiveDueDate, istToday);

    if (!existing) {
      customerAggMap.set(cid, {
        customer: inv.customer,
        overdueInvoiceCount: 1,
        totalOverdueAmount: inv.pendingAmount,
        oldestDueDate: inv.effectiveDueDate,
        maxDaysOverdue: Math.max(0, daysOd),
      });
    } else {
      existing.overdueInvoiceCount += 1;
      existing.totalOverdueAmount = existing.totalOverdueAmount.add(inv.pendingAmount);
      if (inv.effectiveDueDate < existing.oldestDueDate) {
        existing.oldestDueDate = inv.effectiveDueDate;
      }
      if (daysOd > existing.maxDaysOverdue) {
        existing.maxDaysOverdue = daysOd;
      }
    }
  }

  const customersAgg = Array.from(customerAggMap.values());

  const totalOverdueAmount = customersAgg.reduce(
    (sum, c) => sum.add(c.totalOverdueAmount),
    new Decimal(0),
  );

  return {
    invoices: pagedInvoices,
    customers: customersAgg,
    total,
    page,
    pages: Math.ceil(total / limit),
    summary: {
      overdueCustomers: customersAgg.length,
      overdueInvoices: total,
      totalOverdueAmount,
    },
  };
}

// ─── Sidebar count (fast) ────────────────────────────────────────────────────
// Uses the same optimized grouped query instead of per-customer loops.

export async function getOverdueCount(): Promise<number> {
  const { totalCount } = await getOverdueSalesAggregated();
  return totalCount;
}

// ─── Dashboard overdue stats (fast) ──────────────────────────────────────────
// Uses the same optimized grouped query instead of per-customer loops.
// This was the PRIMARY cause of the 504 timeout.

export async function getOverdueSummary(): Promise<{
  overdueCount: number;
  overdueAmount: Decimal;
}> {
  const { totalCount, totalAmount } = await getOverdueSalesAggregated();
  return {
    overdueCount: totalCount,
    overdueAmount: totalAmount,
  };
}