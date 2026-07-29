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
 * Get end of day for a given date in IST timezone.
 */
export function endOfDayIST(date: Date): Date {
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(date.getTime() + istOffset);
  istDate.setUTCHours(23, 59, 59, 999);
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
  latestActivityDate: Date | null;
  nextReminderDate: Date | null;
}

/**
 * Get single customer accounting summary from canonical CreditLedger source.
 */
export async function getCustomerAccountingSummary(customerId: string): Promise<CustomerAccountingSummary> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId, isActive: true, deletedAt: null },
    select: { openingBalance: true },
  });

  if (!customer) throw new Error("Customer not found or inactive");
  const openingBalance = customer.openingBalance ?? new Decimal(0);

  const [latestSale, latestPayment, ledgerEntries] = await Promise.all([
    prisma.sale.findFirst({
      where: { customerId, status: { not: "CANCELLED" } },
      orderBy: { saleDate: "desc" },
      select: { saleDate: true },
    }),
    prisma.payment.findFirst({
      where: { customerId, status: { not: "VOIDED" } },
      orderBy: { paymentDate: "desc" },
      select: { paymentDate: true },
    }),
    prisma.creditLedger.findMany({
      where: {
        customerId,
        status: { not: "VOIDED" },
      },
      select: {
        transactionType: true,
        amount: true,
        direction: true,
        accountingDate: true,
      },
    }),
  ]);

  let totalDebit = new Decimal(0);
  let totalCredit = new Decimal(0);
  let sales = new Decimal(0);
  let receipts = new Decimal(0);

  let latestActivityDate: Date | null = null;
  if (latestSale?.saleDate) latestActivityDate = latestSale.saleDate;
  if (latestPayment?.paymentDate && (!latestActivityDate || latestPayment.paymentDate > latestActivityDate)) {
    latestActivityDate = latestPayment.paymentDate;
  }

  for (const entry of ledgerEntries) {
    const amt = entry.amount ?? new Decimal(0);
    const type = entry.transactionType;

    if (type !== "OPENING_BALANCE") {
      if (
        type === "CREDIT_SALE" ||
        type === "PAYMENT_REVERSAL" ||
        type === "MANUAL_DEBIT" ||
        (type === "ADJUSTMENT" && entry.direction !== "CREDIT")
      ) {
        totalDebit = totalDebit.add(amt);
      } else if (
        type === "PAYMENT_RECEIVED" ||
        type === "SALE_CANCELLED" ||
        type === "RETURN_CREDIT" ||
        type === "MANUAL_CREDIT" ||
        (type === "ADJUSTMENT" && entry.direction === "CREDIT")
      ) {
        totalCredit = totalCredit.add(amt);
      }

      if (type === "CREDIT_SALE") {
        sales = sales.add(amt);
      }
      if (type === "PAYMENT_RECEIVED") {
        receipts = receipts.add(amt);
      }
    }

    if (["MANUAL_DEBIT", "MANUAL_CREDIT", "ADJUSTMENT", "OPENING_BALANCE"].includes(type)) {
      if (entry.accountingDate && (!latestActivityDate || entry.accountingDate > latestActivityDate)) {
        latestActivityDate = entry.accountingDate;
      }
    }
  }

  const closingBalance = openingBalance.add(totalDebit).sub(totalCredit);
  const outstanding = Decimal.max(closingBalance, new Decimal(0));
  const advance = Decimal.max(closingBalance.negated(), new Decimal(0));

  let nextReminderDate: Date | null = null;
  if (latestActivityDate && outstanding.gt(0)) {
    nextReminderDate = new Date(startOfDayIST(latestActivityDate));
    nextReminderDate.setDate(nextReminderDate.getDate() + 15);
  }

  return {
    customerId,
    openingBalance,
    totalDebit,
    totalCredit,
    closingBalance,
    outstanding,
    advance,
    sales,
    receipts,
    latestActivityDate,
    nextReminderDate,
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

  const [ledgerEntries, maxSales, maxPayments] = await Promise.all([
    prisma.creditLedger.findMany({
      where: {
        customerId: { in: customerIds },
        status: { not: "VOIDED" },
      },
      select: {
        customerId: true,
        transactionType: true,
        amount: true,
        direction: true,
        accountingDate: true,
      },
    }),
    prisma.sale.groupBy({
      by: ['customerId'],
      _max: { saleDate: true },
      where: { customerId: { in: customerIds }, status: { not: 'CANCELLED' } }
    }),
    prisma.payment.groupBy({
      by: ['customerId'],
      _max: { paymentDate: true },
      where: { customerId: { in: customerIds }, status: { not: 'VOIDED' } }
    })
  ]);

  const saleDateMap = new Map(maxSales.map(m => [m.customerId, m._max.saleDate]));
  const paymentDateMap = new Map(maxPayments.map(m => [m.customerId, m._max.paymentDate]));

  type Agg = { totalDebit: Decimal; totalCredit: Decimal; sales: Decimal; receipts: Decimal; latestActivityDate: Date | null };
  const aggMap = new Map<string, Agg>();

  for (const entry of ledgerEntries) {
    const agg = aggMap.get(entry.customerId) ?? {
      totalDebit: new Decimal(0),
      totalCredit: new Decimal(0),
      sales: new Decimal(0),
      receipts: new Decimal(0),
      latestActivityDate: null,
    };

    const amount = entry.amount ?? new Decimal(0);
    const type = entry.transactionType;

    if (type !== "OPENING_BALANCE") {
      if (
        type === "CREDIT_SALE" ||
        type === "PAYMENT_REVERSAL" ||
        type === "MANUAL_DEBIT" ||
        (type === "ADJUSTMENT" && entry.direction !== "CREDIT")
      ) {
        agg.totalDebit = agg.totalDebit.add(amount);
      } else if (
        type === "PAYMENT_RECEIVED" ||
        type === "SALE_CANCELLED" ||
        type === "RETURN_CREDIT" ||
        type === "MANUAL_CREDIT" ||
        (type === "ADJUSTMENT" && entry.direction === "CREDIT")
      ) {
        agg.totalCredit = agg.totalCredit.add(amount);
      }

      if (type === "CREDIT_SALE") {
        agg.sales = agg.sales.add(amount);
      }
      if (type === "PAYMENT_RECEIVED") {
        agg.receipts = agg.receipts.add(amount);
      }
    }

    if (["MANUAL_DEBIT", "MANUAL_CREDIT", "ADJUSTMENT", "OPENING_BALANCE"].includes(type)) {
      if (entry.accountingDate && (!agg.latestActivityDate || entry.accountingDate > agg.latestActivityDate)) {
        agg.latestActivityDate = entry.accountingDate;
      }
    }

    aggMap.set(entry.customerId, agg);
  }

  const result = new Map<string, CustomerAccountingSummary>();
  for (const customerId of customerIds) {
    const openingBalance = openingMap.get(customerId) ?? new Decimal(0);
    const agg = aggMap.get(customerId) ?? {
      totalDebit: new Decimal(0),
      totalCredit: new Decimal(0),
      sales: new Decimal(0),
      receipts: new Decimal(0),
      latestActivityDate: null,
    };

    const sd = saleDateMap.get(customerId);
    const pd = paymentDateMap.get(customerId);
    if (sd && (!agg.latestActivityDate || sd > agg.latestActivityDate)) agg.latestActivityDate = sd;
    if (pd && (!agg.latestActivityDate || pd > agg.latestActivityDate)) agg.latestActivityDate = pd;

    const closingBalance = openingBalance.add(agg.totalDebit).sub(agg.totalCredit);
    const outstanding = Decimal.max(closingBalance, new Decimal(0));
    const advance = Decimal.max(closingBalance.negated(), new Decimal(0));

    let nextReminderDate: Date | null = null;
    if (agg.latestActivityDate && outstanding.gt(0)) {
      nextReminderDate = new Date(startOfDayIST(agg.latestActivityDate));
      nextReminderDate.setDate(nextReminderDate.getDate() + 15);
    }

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
      latestActivityDate: agg.latestActivityDate,
      nextReminderDate,
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
  const summaries = await getAllCustomerAccountingSummaries();
  let totalOverdue = new Decimal(0);
  let count = 0;
  const today = getISTStartOfToday();

  for (const summary of summaries.values()) {
    if (
      summary.outstanding.gt(0) &&
      summary.nextReminderDate &&
      summary.nextReminderDate <= today
    ) {
      totalOverdue = totalOverdue.add(summary.outstanding);
      count++;
    }
  }

  return {
    total: totalOverdue,
    count,
  };
}

/**
 * Get recent payments summary for the last 30 days.
 * Inclusive date range:
 *   paymentDate >= startOfDay(today - 30 days)
 *   paymentDate <= endOfDay(today)
 * Uses paymentDate.
 */
export async function getRecentPaymentsSummary(): Promise<{
  recentPaymentsAmount: Decimal;
  recentPaymentsCount: number;
}> {
  const today = getISTStartOfToday();
  const thirtyDaysAgo = startOfDayIST(new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000));
  const endOfToday = endOfDayIST(today);

  const agg = await prisma.payment.aggregate({
    where: {
      status: "COMPLETED",
      paymentDate: {
        gte: thirtyDaysAgo,
        lte: endOfToday,
      },
    },
    _sum: { amount: true },
    _count: { _all: true },
  });

  return {
    recentPaymentsAmount: agg._sum.amount ?? new Decimal(0),
    recentPaymentsCount: agg._count._all,
  };
}