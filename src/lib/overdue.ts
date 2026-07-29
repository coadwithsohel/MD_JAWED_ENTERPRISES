import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "./prisma";
import { getISTStartOfToday, getAllCustomerAccountingSummaries, differenceInCalendarDays, startOfDayIST } from "./accounting";

// --- Re-export for backward compatibility -----------------------------------
export { addDays } from "./accounting";

export function getISTNow(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
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
  totalOverdueAmount: Decimal;
  latestActivityDate: Date;
  nextReminderDate: Date;
  daysOverdue: number; // Days since nextReminderDate
  daysSinceActivity: number;
}

export interface OverdueDataResponse {
  invoices: unknown[]; // Kept empty to satisfy existing types if they exist, but unused
  customers: OverdueCustomerSummary[];
  total: number;
  page: number;
  pages: number;
  summary: {
    overdueCustomers: number;
    overdueInvoices: number;
    totalOverdueAmount: Decimal;
    criticalOverdueInvoices: number;
  };
}

export async function getOverdueData(options?: {
  page?: number;
  limit?: number;
  customerId?: string;
  search?: string;
}): Promise<OverdueDataResponse> {
  const page = options?.page ?? 1;
  const limit = options?.limit ?? 50;
  const skip = (page - 1) * limit;

  // Get all customer accounting summaries (these now contain latestActivityDate and nextReminderDate)
  const summaries = await getAllCustomerAccountingSummaries();
  const today = getISTStartOfToday();

  // Filter customers due for reminder
  let reminderCustomers = Array.from(summaries.values()).filter((summary) => {
    return (
      summary.outstanding.gt(0) &&
      summary.nextReminderDate &&
      summary.nextReminderDate <= today
    );
  });

  if (options?.customerId) {
    reminderCustomers = reminderCustomers.filter((s) => s.customerId === options.customerId);
  }

  const customerIds = reminderCustomers.map((s) => s.customerId);

  const dbCustomers = customerIds.length > 0
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

  const customerMap = new Map(dbCustomers.map((c) => [c.id, c]));

  let finalCustomers: OverdueCustomerSummary[] = reminderCustomers.map((summary) => {
    const cust = customerMap.get(summary.customerId);
    const nextReminderDate = summary.nextReminderDate!;
    const latestActivityDate = summary.latestActivityDate!;
    return {
      customer: cust ?? null,
      totalOverdueAmount: summary.outstanding,
      latestActivityDate,
      nextReminderDate,
      daysOverdue: differenceInCalendarDays(today, nextReminderDate),
      daysSinceActivity: differenceInCalendarDays(today, latestActivityDate),
    };
  });

  if (options?.search) {
    const q = options.search.toLowerCase();
    finalCustomers = finalCustomers.filter((c) => 
      c.customer?.fullName.toLowerCase().includes(q) ||
      c.customer?.mobile.includes(q) ||
      c.customer?.customerCode.toLowerCase().includes(q)
    );
  }

  // Sort by days overdue descending (oldest first)
  finalCustomers.sort((a, b) => b.daysOverdue - a.daysOverdue);

  const total = finalCustomers.length;
  const pagedCustomers = finalCustomers.slice(skip, skip + limit);

  const totalOverdueAmount = finalCustomers.reduce((sum, c) => sum.add(c.totalOverdueAmount), new Decimal(0));
  const criticalOverdueInvoices = finalCustomers.filter((c) => c.daysOverdue > 30).length;

  return {
    invoices: [],
    customers: pagedCustomers,
    total,
    page,
    pages: Math.ceil(total / limit),
    summary: {
      overdueCustomers: total,
      overdueInvoices: 0,
      totalOverdueAmount,
      criticalOverdueInvoices,
    },
  };
}

// --- Sidebar count (fast) ----------------------------------------------------
export async function getOverdueCount(): Promise<number> {
  const { getTotalOverdue } = await import("./accounting");
  const { count } = await getTotalOverdue();
  return count;
}

// --- Dashboard overdue stats -------------------------------------------------
export async function getOverdueSummary(): Promise<{
  overdueCount: number;
  overdueAmount: Decimal;
}> {
  const { getTotalOverdue } = await import("./accounting");
  const { total, count } = await getTotalOverdue();
  return {
    overdueCount: count,
    overdueAmount: total,
  };
}

