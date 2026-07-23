import { prisma } from "./prisma";
import { Decimal } from "@prisma/client/runtime/library";
import { getISTStartOfToday, getDefaultCreditDays, allocateCreditsToSales } from "./accounting";
export type { SaleWithOutstanding } from "./accounting";

// ─── Date helpers ─────────────────────────────────────────────────────────────
// Use getISTStartOfToday from accounting for midnight comparisons.
// This file provides non-midnight IST for backward compatibility.

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

// ─── Core Overdue Query ───────────────────────────────────────────────────────
// Single source of truth for overdue logic — used by sidebar, dashboard, and overdue page

export async function getOverdueData(options?: {
  page?: number;
  limit?: number;
  customerId?: string;
  search?: string;
}): Promise<OverdueDataResponse> {
  const page = options?.page ?? 1;
  const limit = options?.limit ?? 50;
  const skip = (page - 1) * limit;

  // Get active customers with credit sales
  const customerWhere: Record<string, unknown> = {
    isActive: true,
    deletedAt: null,
  };

  if (options?.customerId) {
    customerWhere.id = options.customerId;
  }

  const activeCustomers = await prisma.customer.findMany({
    where: customerWhere,
    select: { id: true },
  });

  const activeCustomerIds = activeCustomers.map((c) => c.id);

  if (activeCustomerIds.length === 0) {
    return {
      invoices: [],
      customers: [],
      total: 0,
      page,
      pages: 0,
      summary: { overdueCustomers: 0, overdueInvoices: 0, totalOverdueAmount: new Decimal(0) },
    };
  }

  // Process overdue for each customer using shared FIFO allocation
  const allOverdueInvoices: OverdueInvoice[] = [];

  // Process in chunks to avoid memory issues
  const chunkSize = 50;
  const defaultCreditDays = await getDefaultCreditDays();
  const istToday = getISTStartOfToday();

  for (let i = 0; i < activeCustomerIds.length; i += chunkSize) {
    const chunk = activeCustomerIds.slice(i, i + chunkSize);
    const results = await Promise.all(
      chunk.map(async (cid) => {
        const salesWithOutstanding = await allocateCreditsToSales(cid);
        // Return only overdue ones
        return salesWithOutstanding.filter((s) => s.isOverdue);
      }),
    );

    for (const overdueSales of results) {
      // Fetch customer details for each overdue sale
      const customerIds = [...new Set(overdueSales.map((s) => s.customerId!))];
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

      for (const sale of overdueSales) {
        const cust = sale.customerId ? customerMap.get(sale.customerId) : undefined;
        const daysOd = daysBetween(sale.effectiveDueDate, istToday);
        allOverdueInvoices.push({
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
          remainingAfterAllocation: sale.remainingAfterAllocation,
          paymentStatus: sale.paymentStatus,
          saleType: sale.saleType,
        });
      }
    }
  }

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
  const customerMap = new Map<string, OverdueCustomerSummary>();
  for (const inv of filteredInvoices) {
    if (!inv.customer) continue;
    const cid = inv.customer.id;
    const existing = customerMap.get(cid);
    const daysOd = daysBetween(inv.effectiveDueDate, istToday);

    if (!existing) {
      customerMap.set(cid, {
        customer: inv.customer,
        overdueInvoiceCount: 1,
        totalOverdueAmount: inv.remainingAfterAllocation,
        oldestDueDate: inv.effectiveDueDate,
        maxDaysOverdue: Math.max(0, daysOd),
      });
    } else {
      existing.overdueInvoiceCount += 1;
      existing.totalOverdueAmount = existing.totalOverdueAmount.add(inv.remainingAfterAllocation);
      if (inv.effectiveDueDate < existing.oldestDueDate) {
        existing.oldestDueDate = inv.effectiveDueDate;
      }
      if (daysOd > existing.maxDaysOverdue) {
        existing.maxDaysOverdue = daysOd;
      }
    }
  }

  const customers = Array.from(customerMap.values());

  const totalOverdueAmount = customers.reduce(
    (sum, c) => sum.add(c.totalOverdueAmount),
    new Decimal(0),
  );

  return {
    invoices: pagedInvoices,
    customers,
    total,
    page,
    pages: Math.ceil(total / limit),
    summary: {
      overdueCustomers: customers.length,
      overdueInvoices: total,
      totalOverdueAmount,
    },
  };
}

// ─── Sidebar count (fast, just needs the number) ─────────────────────────────
export async function getOverdueCount(): Promise<number> {
  const activeCustomers = await prisma.customer.findMany({
    where: { isActive: true, deletedAt: null },
    select: { id: true },
  });

  let totalOverdue = 0;

  for (const customer of activeCustomers) {
    // For count, we just check if there's any overdue balance
    const salesWithOutstanding = await allocateCreditsToSales(customer.id);
    const overdueCount = salesWithOutstanding.filter((s) => s.isOverdue).length;
    totalOverdue += overdueCount;
  }

  return totalOverdue;
}

// ─── Dashboard overdue stats ──────────────────────────────────────────────────
export async function getOverdueSummary(): Promise<{
  overdueCount: number;
  overdueAmount: Decimal;
}> {
  const activeCustomers = await prisma.customer.findMany({
    where: { isActive: true, deletedAt: null },
    select: { id: true },
  });

  let totalOverdueAmount = new Decimal(0);
  let overdueInvoiceCount = 0;

  for (const customer of activeCustomers) {
    const salesWithOutstanding = await allocateCreditsToSales(customer.id);
    for (const sale of salesWithOutstanding) {
      if (sale.isOverdue) {
        overdueInvoiceCount++;
        totalOverdueAmount = totalOverdueAmount.add(sale.remainingAfterAllocation);
      }
    }
  }

  return {
    overdueCount: overdueInvoiceCount,
    overdueAmount: totalOverdueAmount,
  };
}