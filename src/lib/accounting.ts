import { prisma } from "./prisma";
import { Decimal } from "@prisma/client/runtime/library";

/**
 * Shared accounting helper — used by overdue, dashboard, credit management, and customer detail.
 * Single source of truth for due-date resolution and balance calculation.
 */

/**
 * Get IST (Asia/Kolkata) start of today for consistent date comparisons.
 */
export function getISTStartOfToday(): Date {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000; // UTC+5:30
  const istNow = new Date(now.getTime() + istOffset);
  istNow.setUTCHours(0, 0, 0, 0);
  return new Date(istNow.getTime() - istOffset); // Back to UTC midnight IST
}

/**
 * Resolve an effective due date for a transaction.
 *
 * Priority:
 * 1. transaction.dueDate (if present)
 * 2. invoice.dueDate (same as above)
 * 3. transactionDate + customer.defaultCreditDays
 * 4. transactionDate + businessSettings.defaultCreditDays
 * 5. transactionDate + 30 days (fallback)
 */
export function resolveEffectiveDueDate(params: {
  dueDate?: Date | string | null;
  transactionDate: Date | string;
  customerCreditDays?: number | null;
  defaultCreditDays?: number | null;
}): Date {
  const { dueDate, transactionDate, customerCreditDays, defaultCreditDays } = params;

  // Priority 1-2: explicit dueDate
  if (dueDate) {
    const parsed = new Date(dueDate);
    if (!isNaN(parsed.getTime())) return parsed;
  }

  const txnDate = new Date(transactionDate);
  if (isNaN(txnDate.getTime())) {
    // Should not happen, but fallback to now
    return new Date();
  }

  // Priority 3: customer credit days
  if (customerCreditDays != null && customerCreditDays > 0) {
    const result = new Date(txnDate);
    result.setDate(result.getDate() + customerCreditDays);
    return result;
  }

  // Priority 4: business default credit days
  if (defaultCreditDays != null && defaultCreditDays > 0) {
    const result = new Date(txnDate);
    result.setDate(result.getDate() + defaultCreditDays);
    return result;
  }

  // Priority 5: fallback 30 days
  // This fallback exists ONLY for imported Sales where dueDate was blank in source.
  const result = new Date(txnDate);
  result.setDate(result.getDate() + 30);
  return result;
}

/**
 * Get default credit days from shop settings.
 */
let cachedDefaultCreditDays: number | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60_000; // 1 minute

export async function getDefaultCreditDays(): Promise<number> {
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

/**
 * Calculate customer current balance.
 * currentBalance = openingBalance + totalDebit - totalCredit
 */
export async function getCustomerBalance(customerId: string): Promise<{
  currentBalance: Decimal;
  openingBalance: Decimal;
  totalSales: Decimal;
  totalPayments: Decimal;
}> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { openingBalance: true, currentBalance: true },
  });

  if (!customer) {
    return {
      currentBalance: new Decimal(0),
      openingBalance: new Decimal(0),
      totalSales: new Decimal(0),
      totalPayments: new Decimal(0),
    };
  }

  const [salesAgg, paymentAgg] = await Promise.all([
    prisma.sale.aggregate({
      where: {
        customerId,
        status: { in: ["COMPLETED", "PARTIALLY_RETURNED"] },
      },
      _sum: { grandTotal: true },
    }),
    prisma.payment.aggregate({
      where: {
        customerId,
        status: "COMPLETED",
      },
      _sum: { amount: true },
    }),
  ]);

  const totalSales = salesAgg._sum.grandTotal ?? new Decimal(0);
  const totalPayments = paymentAgg._sum.amount ?? new Decimal(0);
  const opening = customer.openingBalance ?? new Decimal(0);
  const currentBalance = new Decimal(opening).add(totalSales).sub(totalPayments);

  return {
    currentBalance,
    openingBalance: opening,
    totalSales,
    totalPayments,
  };
}

/**
 * Apply FIFO credit allocation to Sales.
 *
 * Sorts Sales by transactionDate ascending.
 * Applies available credits (receipts) to oldest unpaid Sales first.
 * Returns Sales with their computed remaining amounts.
 */
export interface SaleWithOutstanding {
  id: string;
  invoiceNumber: string;
  customerId: string | null;
  grandTotal: Decimal;
  paidAmount: Decimal;
  pendingAmount: Decimal;
  transactionDate: Date;
  dueDate: Date | null;
  effectiveDueDate: Date;
  saleType: string;
  status: string;
  paymentStatus: string;
  createdAt: Date;
  remainingAfterAllocation: Decimal;
  isOverdue: boolean;
}

export interface CreditRecord {
  id: string;
  amount: Decimal;
  paymentDate: Date;
  againstReference?: string | null;
}

export async function allocateCreditsToSales(
  customerId: string,
): Promise<SaleWithOutstanding[]> {
  const [sales, payments, settings] = await Promise.all([
    prisma.sale.findMany({
      where: {
        customerId,
        status: { in: ["COMPLETED", "PARTIALLY_RETURNED"] },
        saleType: { in: ["CREDIT", "PARTIAL"] },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.payment.findMany({
      where: {
        customerId,
        status: "COMPLETED",
      },
      orderBy: { paymentDate: "asc" },
    }),
    prisma.shopSettings.findFirst({
      select: { defaultCreditDays: true },
    }),
  ]);

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { creditLimit: true, openingBalance: true },
  });

  const defaultCreditDays = settings?.defaultCreditDays ?? 15;
  const customerCreditDays = null; // No creditDays field on Customer model

  // Build lookup of sale invoices by invoiceNumber for linked payments
  const saleByInvoice = new Map(sales.map((s) => [s.invoiceNumber, s]));

  // Apply directly-linked payments first
  const directlyAllocated = new Map<string, Decimal>();
  for (const payment of payments) {
    if (payment.saleId) {
      const sale = sales.find((s) => s.id === payment.saleId);
      if (sale) {
        const existing = directlyAllocated.get(sale.id) ?? new Decimal(0);
        directlyAllocated.set(sale.id, existing.add(payment.amount));
      }
    } else {
      // Try to find by againstReference in notes (fallback)
      const againstMatch = payment.notes?.match(/against\s+(\S+)/i);
      if (againstMatch) {
        const ref = againstMatch[1];
        const sale = sales.find((s) => s.invoiceNumber === ref);
        if (sale) {
          const existing = directlyAllocated.get(sale.id) ?? new Decimal(0);
          directlyAllocated.set(sale.id, existing.add(payment.amount));
        }
      }
    }
  }

  // Build sales with remaining after direct allocation
  const salesWithAlloc: SaleWithOutstanding[] = sales.map((sale) => {
    const directAlloc = directlyAllocated.get(sale.id) ?? new Decimal(0);
    const pending = new Decimal(sale.grandTotal).sub(
      new Decimal(sale.paidAmount).add(directAlloc),
    );
    const remaining = Decimal.max(pending, new Decimal(0));

    const effectiveDueDate = resolveEffectiveDueDate({
      dueDate: sale.dueDate,
      transactionDate: sale.createdAt,
      customerCreditDays,
      defaultCreditDays,
    });

    const istToday = getISTStartOfToday();
    const isOverdue = remaining.gt(0) && effectiveDueDate < istToday;

    return {
      id: sale.id,
      invoiceNumber: sale.invoiceNumber,
      customerId: sale.customerId,
      grandTotal: sale.grandTotal,
      paidAmount: sale.paidAmount,
      pendingAmount: sale.pendingAmount,
      transactionDate: sale.createdAt,
      dueDate: sale.dueDate,
      effectiveDueDate,
      saleType: sale.saleType,
      status: sale.status,
      paymentStatus: sale.paymentStatus,
      createdAt: sale.createdAt,
      remainingAfterAllocation: remaining,
      isOverdue,
    };
  });

  // FIFO: apply unlinked payments to oldest unpaid sales
  const unlinkedPayments = payments.filter(
    (p) => !p.saleId && !directlyAllocated.has(p.id),
  );

  // Sort unlinked by paymentDate
  unlinkedPayments.sort(
    (a, b) =>
      new Date(a.paymentDate).getTime() - new Date(b.paymentDate).getTime(),
  );

  for (const payment of unlinkedPayments) {
    let remainingCredit = new Decimal(payment.amount);
    for (const saleRecord of salesWithAlloc) {
      if (remainingCredit.lte(0)) break;
      if (saleRecord.remainingAfterAllocation.gt(0)) {
        const applied = Decimal.min(remainingCredit, saleRecord.remainingAfterAllocation);
        saleRecord.remainingAfterAllocation = saleRecord.remainingAfterAllocation.sub(applied);
        remainingCredit = remainingCredit.sub(applied);

        // Recalculate overdue status
        const istToday = getISTStartOfToday();
        saleRecord.isOverdue = saleRecord.remainingAfterAllocation.gt(0) && saleRecord.effectiveDueDate < istToday;
      }
    }
  }

  return salesWithAlloc;
}