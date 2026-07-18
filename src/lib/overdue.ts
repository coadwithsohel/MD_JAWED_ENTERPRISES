import { prisma } from './prisma';
import { Decimal } from '@prisma/client/runtime/library';

// Use Asia/Kolkata timezone consistently
export function getISTNow(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
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

// ─── Core Overdue Query ───────────────────────────────────────────────────────
// Single source of truth for overdue logic — used by sidebar, dashboard, and overdue page

export async function getOverdueData(options?: {
  page?: number;
  limit?: number;
  customerId?: string;
  search?: string;
}) {
  const now = getISTNow();
  const page = options?.page ?? 1;
  const limit = options?.limit ?? 50;
  const skip = (page - 1) * limit;

  const where = {
    status: { in: ['COMPLETED' as const, 'PARTIALLY_RETURNED' as const] },
    saleType: { in: ['CREDIT' as const, 'PARTIAL' as const] },
    pendingAmount: { gt: new Decimal(0) },
    dueDate: { lt: now },
    ...(options?.customerId ? { customerId: options.customerId } : {}),
    ...(options?.search
      ? {
          OR: [
            { invoiceNumber: { contains: options.search, mode: 'insensitive' as const } },
            { customer: { fullName: { contains: options.search, mode: 'insensitive' as const } } },
            { customer: { mobile: { contains: options.search } } },
            { customer: { customerCode: { contains: options.search, mode: 'insensitive' as const } } },
          ],
        }
      : {}),
  };

  const [sales, total] = await Promise.all([
    prisma.sale.findMany({
      where,
      include: {
        customer: {
          select: {
            id: true,
            customerCode: true,
            fullName: true,
            mobile: true,
            alternateMobile: true,
            address: true,
            city: true,
          },
        },
      },
      orderBy: { dueDate: 'asc' },
      skip,
      take: limit,
    }),
    prisma.sale.count({ where }),
  ]);

  // Aggregate by customer for customer summary view
  const customerMap = new Map<string, {
    customer: typeof sales[0]['customer'];
    invoices: typeof sales;
    totalPending: Decimal;
    oldestDueDate: Date;
    maxDaysOverdue: number;
  }>();

  for (const sale of sales) {
    if (!sale.customer) continue;
    const cid = sale.customer.id;
    const existing = customerMap.get(cid);
    const daysOverdue = daysBetween(sale.dueDate!, now);

    if (!existing) {
      customerMap.set(cid, {
        customer: sale.customer,
        invoices: [sale],
        totalPending: sale.pendingAmount,
        oldestDueDate: sale.dueDate!,
        maxDaysOverdue: daysOverdue,
      });
    } else {
      existing.invoices.push(sale);
      existing.totalPending = new Decimal(existing.totalPending).add(sale.pendingAmount);
      if (sale.dueDate! < existing.oldestDueDate) {
        existing.oldestDueDate = sale.dueDate!;
      }
      if (daysOverdue > existing.maxDaysOverdue) {
        existing.maxDaysOverdue = daysOverdue;
      }
    }
  }

  const invoices = sales.map((s) => ({
    id: s.id,
    invoiceNumber: s.invoiceNumber,
    customer: s.customer,
    createdAt: s.createdAt,
    dueDate: s.dueDate,
    daysOverdue: daysBetween(s.dueDate!, now),
    grandTotal: s.grandTotal,
    paidAmount: s.paidAmount,
    pendingAmount: s.pendingAmount,
    paymentStatus: s.paymentStatus,
    saleType: s.saleType,
  }));

  const customers = Array.from(customerMap.values()).map((v) => ({
    customer: v.customer,
    overdueInvoiceCount: v.invoices.length,
    totalOverdueAmount: v.totalPending,
    oldestDueDate: v.oldestDueDate,
    maxDaysOverdue: v.maxDaysOverdue,
  }));

  return {
    invoices,
    customers,
    total,
    page,
    pages: Math.ceil(total / limit),
  };
}

// ─── Sidebar count (fast, just needs the number) ─────────────────────────────
export async function getOverdueCount(): Promise<number> {
  const now = getISTNow();
  return prisma.sale.count({
    where: {
      status: { in: ['COMPLETED', 'PARTIALLY_RETURNED'] },
      saleType: { in: ['CREDIT', 'PARTIAL'] },
      pendingAmount: { gt: new Decimal(0) },
      dueDate: { lt: now },
    },
  });
}

// ─── Dashboard overdue stats ──────────────────────────────────────────────────
export async function getOverdueSummary() {
  const now = getISTNow();
  const result = await prisma.sale.aggregate({
    where: {
      status: { in: ['COMPLETED', 'PARTIALLY_RETURNED'] },
      saleType: { in: ['CREDIT', 'PARTIAL'] },
      pendingAmount: { gt: new Decimal(0) },
      dueDate: { lt: now },
    },
    _sum: { pendingAmount: true },
    _count: { _all: true },
  });

  return {
    overdueCount: result._count._all,
    overdueAmount: result._sum.pendingAmount ?? new Decimal(0),
  };
}
