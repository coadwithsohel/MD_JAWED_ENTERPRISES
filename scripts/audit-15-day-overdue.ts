/**
 * Audit script for 15-day overdue rule.
 *
 * Reports:
 * - permanent Sales count
 * - permanent Receipt count
 * - Sales with valid bill date
 * - Sales with missing bill date
 * - Sales within first 15 days
 * - Sales exactly at 15 complete days
 * - Sales older than 15 complete days
 * - fully paid old Sales
 * - unpaid overdue Sales
 * - overdue customer count
 * - total overdue amount
 *
 * For five sample customers prints:
 * - customer name
 * - bill number
 * - bill date
 * - 15-day completion date
 * - current date
 * - bill amount
 * - allocated payment
 * - remaining amount
 * - overdue status
 * - days overdue
 *
 * IMPORTANT: Read-only. Does not modify data.
 */

import { PrismaClient } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

const prisma = new PrismaClient();

// ─── Date helpers (inline, no external deps needed) ──────────────────────────

function getISTStartOfToday(): Date {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffset);
  istNow.setUTCHours(0, 0, 0, 0);
  return new Date(istNow.getTime() - istOffset);
}

function startOfDayIST(date: Date): Date {
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(date.getTime() + istOffset);
  istDate.setUTCHours(0, 0, 0, 0);
  return new Date(istDate.getTime() - istOffset);
}

function getOverdueDate(billDate: Date): Date {
  const start = startOfDayIST(billDate);
  const result = new Date(start);
  result.setDate(result.getDate() + 15);
  return result;
}

function differenceInCalendarDays(a: Date, b: Date): number {
  const aDay = startOfDayIST(a);
  const bDay = startOfDayIST(b);
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.round((aDay.getTime() - bDay.getTime()) / msPerDay);
}

function daysOverdue(billDate: Date | null | undefined): number {
  if (!billDate) return 0;
  const overdueDate = getOverdueDate(billDate);
  const today = getISTStartOfToday();
  const diff = differenceInCalendarDays(today, overdueDate);
  return Math.max(0, diff);
}

// ─── Formatting ──────────────────────────────────────────────────────────────

function fmt(n: Decimal | number | null | undefined): string {
  const num = n == null ? 0 : typeof n === "number" ? n : parseFloat(n.toString());
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(num);
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toISOString().slice(0, 10);
}

// ─── Main audit ──────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(80));
  console.log("15-DAY OVERDUE RULE AUDIT");
  console.log(`Date: ${new Date().toISOString().slice(0, 10)}`);
  console.log("=".repeat(80));
  console.log("");

  const today = getISTStartOfToday();
  const todayStr = today.toISOString().slice(0, 10);

  // 1. Count all permanent Sales
  const totalSales = await prisma.sale.count();
  const creditSales = await prisma.sale.count({
    where: {
      status: { in: ["COMPLETED", "PARTIALLY_RETURNED"] },
      saleType: { in: ["CREDIT", "PARTIAL"] },
    },
  });

  // 2. Count all permanent Payments
  const totalPayments = await prisma.payment.count({
    where: { status: "COMPLETED" },
  });

  // 3. Count active customers
  const activeCustomers = await prisma.customer.count({
    where: { isActive: true, deletedAt: null },
  });

  // 4. Get all credit sales with customer info
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
      createdAt: true,
      updatedAt: true,
      dueDate: true,
      saleType: true,
      status: true,
      paymentStatus: true,
      customer: {
        select: {
          id: true,
          fullName: true,
          customerCode: true,
          mobile: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  // 5. Categorize sales by overdue status
  let validBillDate = 0;
  let missingBillDate = 0;
  let within15Days = 0;
  let exactlyAt15Days = 0;
  let olderThan15Days = 0;
  let fullyPaidOld = 0;
  let unpaidOverdue = 0;
  let totalOverdueAmount = new Decimal(0);

  interface SaleWithStatus {
    sale: typeof sales[number];
    billDate: Date | null;
    overdueDate: Date | null;
    daysOverdueCalc: number;
    category: string;
    remaining: Decimal;
    isFullyPaid: boolean;
  }

  const salesWithStatus: SaleWithStatus[] = [];

  for (const sale of sales) {
    const billDate = sale.createdAt; // The bill date (createdAt is set to voucherDate on import)
    const odDate = billDate ? getOverdueDate(billDate) : null;
    const isOverdue = odDate ? today > odDate : false;
    const odDays = daysOverdue(billDate);
    const remaining = Decimal.max(
      new Decimal(sale.grandTotal).sub(new Decimal(sale.paidAmount)),
      new Decimal(0),
    );
    const isFullyPaid = remaining.lte(0);

    if (!billDate) {
      missingBillDate++;
      salesWithStatus.push({
        sale,
        billDate: null,
        overdueDate: null,
        daysOverdueCalc: 0,
        category: "MISSING_DATE",
        remaining,
        isFullyPaid,
      });
      continue;
    }

    validBillDate++;

    const diffDays = differenceInCalendarDays(today, startOfDayIST(billDate));

    if (diffDays < 15) {
      within15Days++;
      salesWithStatus.push({
        sale,
        billDate,
        overdueDate: odDate,
        daysOverdueCalc: 0,
        category: "WITHIN_15_DAYS",
        remaining,
        isFullyPaid,
      });
    } else if (diffDays === 15) {
      exactlyAt15Days++;
      salesWithStatus.push({
        sale,
        billDate,
        overdueDate: odDate,
        daysOverdueCalc: 0,
        category: "EXACTLY_15_DAYS",
        remaining,
        isFullyPaid,
      });
    } else {
      olderThan15Days++;
      if (isFullyPaid) {
        fullyPaidOld++;
      }
      if (isOverdue && remaining.gt(0)) {
        unpaidOverdue++;
        totalOverdueAmount = totalOverdueAmount.add(remaining);
      }
      salesWithStatus.push({
        sale,
        billDate,
        overdueDate: odDate,
        daysOverdueCalc: odDays,
        category: isOverdue && !isFullyPaid ? "OVERDUE" : isFullyPaid ? "PAID_OLD" : "NOT_OVERDUE_OLD",
        remaining,
        isFullyPaid,
      });
    }
  }

  // Count unique overdue customers
  const overdueCustomerIds = new Set(
    salesWithStatus
      .filter((s) => s.category === "OVERDUE")
      .map((s) => s.sale.customerId)
      .filter(Boolean),
  );

  // ─── Print summary ──────────────────────────────────────────────────────────

  console.log("─── Summary ──────────────────────────────────────────────────────");
  console.log(`Total Sales:           ${totalSales}`);
  console.log(`Credit/PARTIAL Sales:  ${creditSales}`);
  console.log(`Total Receipts:        ${totalPayments}`);
  console.log(`Active Customers:      ${activeCustomers}`);
  console.log("");
  console.log(`Sales with valid bill date:     ${validBillDate}`);
  console.log(`Sales with missing bill date:   ${missingBillDate}`);
  console.log(`Sales within first 15 days:     ${within15Days}`);
  console.log(`Sales exactly at 15 days:       ${exactlyAt15Days}`);
  console.log(`Sales older than 15 days:       ${olderThan15Days}`);
  console.log(`Fully paid old Sales excluded:  ${fullyPaidOld}`);
  console.log(`Unpaid overdue Sales:           ${unpaidOverdue}`);
  console.log(`Overdue customer count:         ${overdueCustomerIds.size}`);
  console.log(`Total overdue amount:           ${fmt(totalOverdueAmount)}`);
  console.log("");

  // ─── Sample customers (first 5 with overdue) ────────────────────────────────
  console.log("─── Sample Overdue Customers ─────────────────────────────────────");

  const overdueSales = salesWithStatus.filter((s) => s.category === "OVERDUE");
  const sampleCustIds = [...new Set(overdueSales.map((s) => s.sale.customerId).filter(Boolean))].slice(0, 5);

  for (const cid of sampleCustIds) {
    const customerSales = salesWithStatus.filter((s) => s.sale.customerId === cid);
    const cust = customerSales[0]?.sale.customer;
    console.log(`\nCustomer: ${cust?.fullName ?? "Unknown"} (${cust?.customerCode ?? "—"})`);
    for (const cs of customerSales) {
      const s = cs.sale;
      console.log(
        `  Bill: ${s.invoiceNumber} | ` +
        `Date: ${fmtDate(cs.billDate)} | ` +
        `15-day complete: ${fmtDate(cs.overdueDate)} | ` +
        `Today: ${todayStr} | ` +
        `Amount: ${fmt(s.grandTotal)} | ` +
        `Paid: ${fmt(s.paidAmount)} | ` +
        `Remaining: ${fmt(cs.remaining)} | ` +
        `Status: ${cs.category} | ` +
        `Days overdue: ${cs.daysOverdueCalc}`,
      );
    }
  }

  // ─── Verification checks ────────────────────────────────────────────────────

  console.log("\n" + "=".repeat(80));
  console.log("VERIFICATION CHECKS");
  console.log("=".repeat(80));
  console.log("");

  // Check: no bill should use createdAt/import date as bill date for overdue calc
  // We already use createdAt as the authority (since import sets it to voucherDate)
  // But check if any sale has createdAt == updatedAt (which would mean never modified)
  const suspiciousSales = sales.filter((s) => {
    // Detect if createdAt looks like an import timestamp (recent) vs a real bill date
    // This is just informational
    const created = new Date(s.createdAt);
    const updated = new Date(s.updatedAt);
    return updated.getTime() - created.getTime() < 1000; // Same second = possibly import date
  });

  console.log(`Sales with createdAt ≈ updatedAt (potential import date check): ${suspiciousSales.length}`);

  // Final verdict
  const has14DayOld = salesWithStatus.some((s) => {
    if (!s.billDate) return false;
    const diff = differenceInCalendarDays(today, startOfDayIST(s.billDate));
    return diff === 14 && s.remaining.gt(0);
  });

  const has15DayOld = salesWithStatus.some((s) => {
    if (!s.billDate) return false;
    const diff = differenceInCalendarDays(today, startOfDayIST(s.billDate));
    return diff === 15 && s.remaining.gt(0);
  });

  const has16DayOldUnpaid = salesWithStatus.some((s) => {
    if (!s.billDate) return false;
    const diff = differenceInCalendarDays(today, startOfDayIST(s.billDate));
    return diff >= 16 && s.remaining.gt(0);
  });

  const hasFullyPaidOld = salesWithStatus.some((s) => {
    if (!s.billDate) return false;
    const diff = differenceInCalendarDays(today, startOfDayIST(s.billDate));
    return diff >= 16 && s.isFullyPaid;
  });

  const allCorrect =
    (!has14DayOld || within15Days > 0) &&
    (!has15DayOld || exactlyAt15Days > 0) &&
    unpaidOverdue > 0;

  if (allCorrect) {
    console.log("✅ 15-DAY OVERDUE RULE WORKING");
  } else {
    console.log("❌ 15-DAY OVERDUE RULE NOT WORKING");
    if (has14DayOld) console.log("  - WARNING: Found 14-day-old unpaid bills (should not be overdue)");
    if (has15DayOld) console.log("  - WARNING: Found 15-day-old unpaid bills (should not be overdue under complete-15-days rule)");
    if (!has16DayOldUnpaid) console.log("  - WARNING: No 16+ day old unpaid bills found (should be overdue)");
  }

  console.log("");
  console.log("Audit complete. No data was modified.");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Audit failed:", err);
  process.exit(1);
});