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
 * Get start of day for a given date in IST timezone.
 */
export function startOfDayIST(date: Date): Date {
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(date.getTime() + istOffset);
  istDate.setUTCHours(0, 0, 0, 0);
  return new Date(istDate.getTime() - istOffset);
}

/**
 * Overdue date calculation — SINGLE SHARED HELPER.
 *
 * The business rule is FIXED at 15 days from the original bill date.
 * No credit days, no dueDate override, no fallback.
 *
 * effectiveDueDate = addDays(startOfDay(billDate), 15)
 *
 * A bill is overdue only when startOfToday > effectiveDueDate.
 * This means:
 *   bill date = 1 July
 *   15 days complete on 16 July
 *   Show as overdue from 17 July
 */
export function getOverdueDate(billDate: Date): Date {
  const start = startOfDayIST(billDate);
  const result = new Date(start);
  result.setDate(result.getDate() + 15);
  return result;
}

/**
 * Check if a bill is overdue using the 15-day fixed rule.
 * Returns true only when 15 complete calendar days have passed after the bill date.
 */
export function isBillOverdue(billDate: Date | null | undefined): boolean {
  if (!billDate) return false;
  const overdueDate = getOverdueDate(billDate);
  const today = getISTStartOfToday();
  return today > overdueDate;
}

/**
 * Calculate calendar days overdue.
 * daysOverdue = differenceInCalendarDays(startOfToday, overdueDate)
 * Only returns positive values.
 */
export function daysOverdue(billDate: Date | null | undefined): number {
  if (!billDate) return 0;
  const overdueDate = getOverdueDate(billDate);
  const today = getISTStartOfToday();
  const diff = differenceInCalendarDays(today, overdueDate);
  return Math.max(0, diff);
}

/**
 * Difference in calendar days between two dates (date-only, no time).
 */
export function differenceInCalendarDays(a: Date, b: Date): number {
  const aDay = startOfDayIST(a);
  const bDay = startOfDayIST(b);
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.round((aDay.getTime() - bDay.getTime()) / msPerDay);
}

/**
 * Add days to a date.
 */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Resolve an effective due date for a transaction.
 * NOTE: This is NOT used for overdue calculation anymore.
 * Overdue uses getOverdueDate() which is fixed at 15 days.
 * This remains for backward compatibility and other display purposes.
 *
 * Priority:
 * 1. transaction.dueDate (if present)
 * 2. transactionDate + customer.defaultCreditDays
 * 3. transactionDate + businessSettings.defaultCreditDays
 * 4. transactionDate + 30 days (fallback)
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

// ─── Shared Customer Accounting Summary ──────────────────────────────────────
// Single canonical source for all financial summaries.
// Uses CreditLedger as the authoritative transaction source (same as the ledger API).
// Does NOT use Sale.pendingAmount, Customer.currentBalance, or Payment.amount directly.

export interface CustomerAccountingSummary {
  customerId: string;
  openingBalance: Decimal;
  totalDebit: Decimal;   // sum of CREDIT_SALE, DEBIT_NOTE, ADJUSTMENT (debit-side)
  totalCredit: Decimal;  // sum of PAYMENT_RECEIVED, CREDIT_NOTE, SALE_CANCELLED, RETURN_CREDIT
  closingBalance: Decimal; // openingBalance + totalDebit - totalCredit
  outstanding: Decimal;  // Math.max(closingBalance, 0)
  advance: Decimal;      // Math.max(-closingBalance, 0)
  sales: Decimal;        // total CREDIT_SALE amount
  receipts: Decimal;     // total PAYMENT_RECEIVED amount
}

/**
 * Get single customer accounting summary from canonical CreditLedger source.
 */
export async function getCustomerAccountingSummary(
  customerId: string
): Promise<CustomerAccountingSummary> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { openingBalance: true },
  });

  const openingBalance = customer?.openingBalance ?? new Decimal(0);

  // Debit transactions: CREDIT_SALE, PAYMENT_REVERSAL, ADJUSTMENT (amount is positive in CreditLedger for these, they increase the balance)
  const debitAgg = await prisma.creditLedger.aggregate({
    where: {
      customerId,
      transactionType: { in: ["CREDIT_SALE", "PAYMENT_REVERSAL", "ADJUSTMENT"] },
    },
    _sum: { amount: true },
  });

  // Credit transactions: PAYMENT_RECEIVED, SALE_CANCELLED, RETURN_CREDIT (these reduce the balance)
  const creditAgg = await prisma.creditLedger.aggregate({
    where: {
      customerId,
      transactionType: { in: ["PAYMENT_RECEIVED", "SALE_CANCELLED", "RETURN_CREDIT"] },
    },
    _sum: { amount: true },
  });

  const totalDebit = (debitAgg._sum?.amount) ?? new Decimal(0);
  const totalCredit = (creditAgg._sum?.amount) ?? new Decimal(0);
  const closingBalance = openingBalance.add(totalDebit).sub(totalCredit);
  const outstanding = Decimal.max(closingBalance, new Decimal(0));
  const advance = Decimal.max(closingBalance.negated(), new Decimal(0));

  // Sales and receipts breakdown
  const salesAgg = await prisma.creditLedger.aggregate({
    where: {
      customerId,
      transactionType: "CREDIT_SALE",
    },
    _sum: { amount: true },
  });

  const receiptsAgg = await prisma.creditLedger.aggregate({
    where: {
      customerId,
      transactionType: "PAYMENT_RECEIVED",
    },
    _sum: { amount: true },
  });

  return {
    customerId,
    openingBalance,
    totalDebit,
    totalCredit,
    closingBalance,
    outstanding,
    advance,
    sales: salesAgg._sum.amount ?? new Decimal(0),
    receipts: receiptsAgg._sum.amount ?? new Decimal(0),
  };
}

/**
 * Get accounting summaries for all active customers (grouped query).
 * Used by Dashboard, Credit Management, and Overdue pages.
 */
export async function getAllCustomerAccountingSummaries(): Promise<Map<string, CustomerAccountingSummary>> {
  const customers = await prisma.customer.findMany({
    where: { isActive: true, deletedAt: null },
    select: { id: true, openingBalance: true },
  });

  const customerIds = customers.map(c => c.id);
  const openingMap = new Map(customers.map(c => [c.id, c.openingBalance ?? new Decimal(0)]));

  // Get all CreditLedger entries for these customers
  const ledgerEntries = await prisma.creditLedger.findMany({
    where: {
      customerId: { in: customerIds },
      transactionType: { not: "OPENING_BALANCE" },
    },
    select: {
      customerId: true,
      transactionType: true,
      amount: true,
    },
  });

  // Aggregate per customer
  type Agg = { totalDebit: Decimal; totalCredit: Decimal; sales: Decimal; receipts: Decimal };
  const aggMap = new Map<string, Agg>();

  for (const entry of ledgerEntries) {
    const agg = aggMap.get(entry.customerId) ?? {
      totalDebit: new Decimal(0),
      totalCredit: new Decimal(0),
      sales: new Decimal(0),
      receipts: new Decimal(0),
    };

    const amount = entry.amount ?? new Decimal(0);

    switch (entry.transactionType) {
      case "CREDIT_SALE":
      case "PAYMENT_REVERSAL":
      case "ADJUSTMENT":
        agg.totalDebit = agg.totalDebit.add(amount);
        break;
      case "PAYMENT_RECEIVED":
      case "SALE_CANCELLED":
      case "RETURN_CREDIT":
        agg.totalCredit = agg.totalCredit.add(amount);
        break;
    }

    if (entry.transactionType === "CREDIT_SALE") {
      agg.sales = agg.sales.add(amount);
    }
    if (entry.transactionType === "PAYMENT_RECEIVED") {
      agg.receipts = agg.receipts.add(amount);
    }

    aggMap.set(entry.customerId, agg);
  }

  // Build results
  const result = new Map<string, CustomerAccountingSummary>();
  for (const customerId of customerIds) {
    const openingBalance = openingMap.get(customerId) ?? new Decimal(0);
    const agg = aggMap.get(customerId) ?? {
      totalDebit: new Decimal(0),
      totalCredit: new Decimal(0),
      sales: new Decimal(0),
      receipts: new Decimal(0),
    };

    const closingBalance = openingBalance.add(agg.totalDebit).sub(agg.totalCredit);
    const outstanding = Decimal.max(closingBalance, new Decimal(0));
    const advance = Decimal.max(closingBalance.negated(), new Decimal(0));

    result.set(customerId, {
      customerId,
      openingBalance,
      totalDebit: agg.totalDebit,
      totalCredit: agg.totalCredit,
      closingBalance,
      outstanding,
      advance,
      sales: agg.sales,
      receipts: agg.receipts,
    });
  }

  return result;
}

/**
 * Get total pending credit (sum of all outstanding balances) for Dashboard.
 */
export async function getTotalPendingCredit(): Promise<{ total: Decimal; count: number }> {
  const summaries = await getAllCustomerAccountingSummaries();
  let total = new Decimal(0);
  let count = 0;
  for (const summary of summaries.values()) {
    if (summary.outstanding.gt(0)) {
      total = total.add(summary.outstanding);
      count++;
    }
  }
  return { total, count };
}

/**
 * Get total overdue amount from all customers, using the shared accounting summary
 * as a cap: overdue amount cannot exceed outstanding balance.
 */
export async function getTotalOverdue(): Promise<{ total: Decimal; count: number }> {
  // Get all overdue invoices using the same FIFO logic from overdue.ts
  // but cap each customer's overdue at their outstanding balance
  const { getSalesWithFifoAllocation } = await import("./overdue");
  const { sales: overdueSales } = await getSalesWithFifoAllocation();

  // Get all customer accounting summaries for capping
  const summaries = await getAllCustomerAccountingSummaries();

  // Group overdue sales by customer
  const customerSales = new Map<string, Decimal[]>();
  for (const sale of overdueSales) {
    if (!sale.customerId) continue;
    const list = customerSales.get(sale.customerId) ?? [];
    list.push(sale.remainingAfterAllocation);
    customerSales.set(sale.customerId, list);
  }

  // For each customer, cap overdue at outstanding balance
  let totalOverdue = new Decimal(0);
  for (const [cid, amounts] of customerSales) {
    const summary = summaries.get(cid);
    const outstanding = summary?.outstanding ?? new Decimal(0);
    const sumOverdue = amounts.reduce((s, a) => s.add(a), new Decimal(0));
    const capped = Decimal.min(sumOverdue, outstanding);
    totalOverdue = totalOverdue.add(capped);
  }

  return {
    total: totalOverdue,
    count: customerSales.size,
  };
}