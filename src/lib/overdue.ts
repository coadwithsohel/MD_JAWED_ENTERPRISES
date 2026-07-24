import { prisma } from "./prisma";
import { Decimal } from "@prisma/client/runtime/library";
import {
  getISTStartOfToday,
  getOverdueDate,
  daysOverdue,
} from "./accounting";

// ─── Re-export for backward compatibility ───────────────────────────────────
// These are used by other modules that import from @/lib/overdue
export { addDays } from "./accounting";

/**
 * Get current time in IST (Asia/Kolkata).
 */
export function getISTNow(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
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

// ─── Resolve original bill date from a Sale record ─────────────────────────
// Priority:
// 1. createdAt (the Sale's creation date, which for imported records
//    is set to the original voucherDate from Tally)
// 2. There is no separate transactionDate, invoiceDate, or billDate field
//    on the Sale model, so createdAt is the authoritative bill date.
//
// IMPORTANT: When importing from Tally, the Sale record's createdAt is set
// to voucherDate (the original Tally bill date), NOT the import timestamp.
// See src/app/api/tally/import/route.ts lines 155: createdAt: voucherDate

function getBillDateFromSale(sale: {
  createdAt: Date;
}): Date | null {
  // createdAt is the authoritative bill date for imported Sales
  // because the import process sets createdAt = voucherDate
  if (sale.createdAt) {
    return sale.createdAt;
  }
  return null;
}

// ─── Get all Sales with outstanding amounts and their FIFO-allocated payments ──

async function getSalesWithFifoAllocation(): Promise<{
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
    remainingAfterAllocation: Decimal;
    isOverdue: boolean;
    daysOverdue: number;
    billDate: Date | null;
  }>;
  totalAmount: Decimal;
  totalCount: number;
}> {
  const istToday = getISTStartOfToday();

  // Get all credit sales with pending amounts for active (non-deleted) customers
  const sales = await prisma.sale.findMany({
    where: {
      status: { in: ["COMPLETED", "PARTIALLY_RETURNED"] },
      saleType: { in: ["CREDIT", "PARTIAL"] },
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

  // Get all completed payments in one batch for FIFO allocation
  const customerIds = [...new Set(sales.map((s) => s.customerId).filter(Boolean))] as string[];
  const payments = await prisma.payment.findMany({
    where: {
      customerId: { in: customerIds },
      status: "COMPLETED",
    },
    orderBy: { paymentDate: "asc" },
  });

  // Group payments by customerId
  const paymentsByCustomer = new Map<string, typeof payments>();
  for (const payment of payments) {
    const cid = payment.customerId;
    if (!paymentsByCustomer.has(cid)) {
      paymentsByCustomer.set(cid, []);
    }
    paymentsByCustomer.get(cid)!.push(payment);
  }

  // Group sales by customerId
  const salesByCustomer = new Map<string, typeof sales>();
  for ( const sale of sales) {
    if (!sale.customerId) continue;
    const cid = sale.customerId;
    if (!salesByCustomer.has(cid)) {
      salesByCustomer.set(cid, []);
    }
    salesByCustomer.get(cid)!.push(sale);
  }

  // Apply FIFO per customer
  const resultSales: Array<{
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
    remainingAfterAllocation: Decimal;
    isOverdue: boolean;
    daysOverdue: number;
    billDate: Date | null;
  }> = [];

  for (const [cid, customerSales] of salesByCustomer) {
    const customerPayments = paymentsByCustomer.get(cid) ?? [];

    // Step 1: Build direct allocation map (by saleId or againstReference)
    const directlyAllocated = new Map<string, Decimal>();
    for (const payment of customerPayments) {
      if (payment.saleId) {
        const sale = customerSales.find((s) => s.id === payment.saleId);
        if (sale) {
          const existing = directlyAllocated.get(sale.id) ?? new Decimal(0);
          directlyAllocated.set(sale.id, existing.add(payment.amount));
        }
      } else {
        const againstMatch = payment.notes?.match(/against\s+(\S+)/i);
        if (againstMatch) {
          const ref = againstMatch[1];
          const sale = customerSales.find((s) => s.invoiceNumber === ref);
          if (sale) {
            const existing = directlyAllocated.get(sale.id) ?? new Decimal(0);
            directlyAllocated.set(sale.id, existing.add(payment.amount));
          }
        }
      }
    }

    // Step 2: Calculate remaining after direct allocation
    const salesWithDirect = customerSales.map((sale) => {
      const directAlloc = directlyAllocated.get(sale.id) ?? new Decimal(0);
      const pending = new Decimal(sale.grandTotal).sub(
        new Decimal(sale.paidAmount).add(directAlloc),
      );
      const remaining = Decimal.max(pending, new Decimal(0));

      const billDate = getBillDateFromSale(sale);
      const effectiveDueDate = billDate ? getOverdueDate(billDate) : istToday;

      return {
        ...sale,
        remainingAfterAllocation: remaining,
        effectiveDueDate,
        billDate,
      };
    });

    // Step 3: FIFO — apply unlinked payments to oldest unpaid sales first
    const unlinkedPayments = customerPayments.filter(
      (p) => !p.saleId && !directlyAllocated.has(p.id),
    );

    for (const payment of unlinkedPayments) {
      let remainingCredit = new Decimal(payment.amount);
      for (const saleRecord of salesWithDirect) {
        if (remainingCredit.lte(0)) break;
        if (saleRecord.remainingAfterAllocation.gt(0)) {
          const applied = Decimal.min(remainingCredit, saleRecord.remainingAfterAllocation);
          saleRecord.remainingAfterAllocation = saleRecord.remainingAfterAllocation.sub(applied);
          remainingCredit = remainingCredit.sub(applied);
        }
      }
    }

    // Step 4: Determine overdue status
    for (const saleRecord of salesWithDirect) {
      const isOverdue =
        saleRecord.remainingAfterAllocation.gt(0) &&
        saleRecord.effectiveDueDate < istToday;

      const od = isOverdue
        ? daysOverdue(saleRecord.billDate)
        : 0;

      resultSales.push({
        id: saleRecord.id,
        invoiceNumber: saleRecord.invoiceNumber,
        customerId: saleRecord.customerId,
        grandTotal: saleRecord.grandTotal,
        paidAmount: saleRecord.paidAmount,
        pendingAmount: saleRecord.pendingAmount,
        saleType: saleRecord.saleType,
        status: saleRecord.status,
        paymentStatus: saleRecord.paymentStatus,
        createdAt: saleRecord.createdAt,
        dueDate: saleRecord.dueDate,
        effectiveDueDate: saleRecord.effectiveDueDate,
        remainingAfterAllocation: saleRecord.remainingAfterAllocation,
        isOverdue,
        daysOverdue: od,
        billDate: saleRecord.billDate,
      });
    }
  }

  // Filter only overdue sales
  const overdueSales = resultSales.filter((s) => s.isOverdue);

  const totalAmount = overdueSales.reduce(
    (sum, s) => sum.add(s.remainingAfterAllocation),
    new Decimal(0),
  );

  return {
    sales: overdueSales,
    totalAmount,
    totalCount: overdueSales.length,
  };
}

// ─── Core Overdue Query (for the overdue-customers page) ──────────────────────

export async function getOverdueData(options?: {
  page?: number;
  limit?: number;
  customerId?: string;
  search?: string;
}): Promise<OverdueDataResponse> {
  const page = options?.page ?? 1;
  const limit = options?.limit ?? 50;
  const skip = (page - 1) * limit;

  const { sales: allOverdueSales } = await getSalesWithFifoAllocation();

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

  // Fetch customer details in one batch query
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

  // Build overdue invoices
  const allOverdueInvoices: OverdueInvoice[] = filteredSales.map((sale) => {
    const cust = sale.customerId ? customerMap.get(sale.customerId) : undefined;
    return {
      id: sale.id,
      invoiceNumber: sale.invoiceNumber,
      customer: cust ?? null,
      createdAt: sale.createdAt,
      dueDate: sale.dueDate,
      effectiveDueDate: sale.effectiveDueDate,
      daysOverdue: sale.daysOverdue,
      grandTotal: sale.grandTotal,
      paidAmount: sale.paidAmount,
      pendingAmount: sale.pendingAmount,
      remainingAfterAllocation: sale.remainingAfterAllocation,
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

    if (!existing) {
      customerAggMap.set(cid, {
        customer: inv.customer,
        overdueInvoiceCount: 1,
        totalOverdueAmount: inv.remainingAfterAllocation,
        oldestDueDate: inv.effectiveDueDate,
        maxDaysOverdue: inv.daysOverdue,
      });
    } else {
      existing.overdueInvoiceCount += 1;
      existing.totalOverdueAmount = existing.totalOverdueAmount.add(inv.remainingAfterAllocation);
      if (inv.effectiveDueDate < existing.oldestDueDate) {
        existing.oldestDueDate = inv.effectiveDueDate;
      }
      if (inv.daysOverdue > existing.maxDaysOverdue) {
        existing.maxDaysOverdue = inv.daysOverdue;
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
// Uses the same FIFO allocation to ensure consistency.

export async function getOverdueCount(): Promise<number> {
  const { totalCount } = await getSalesWithFifoAllocation();
  return totalCount;
}

// ─── Dashboard overdue stats (fast) ──────────────────────────────────────────
// Uses the same FIFO allocation to ensure consistency.

export async function getOverdueSummary(): Promise<{
  overdueCount: number;
  overdueAmount: Decimal;
}> {
  const { totalCount, totalAmount } = await getSalesWithFifoAllocation();
  return {
    overdueCount: totalCount,
    overdueAmount: totalAmount,
  };
}