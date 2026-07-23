/**
 * Dashboard Performance Profiler
 *
 * Measures exact timing for every dashboard data-fetching stage.
 *
 * Usage:
 *   npx tsx scripts/profile-dashboard.ts
 *
 * Target:
 *   - individual simple query under 1 second
 *   - complete dashboard calculation under 3 seconds locally near the DB
 *   - Vercel production request under 5 seconds
 *
 * This script does NOT print secrets, hashes, tokens, or customer personal data.
 */

import { prisma } from "@/lib/prisma";
import { getOverdueSummary } from "@/lib/overdue";
import { Decimal } from "@prisma/client/runtime/library";

const QUERY_TIMEOUT = 10_000; // 10 seconds per query

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label}_TIMEOUT`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Format a duration in milliseconds for display.
 */
function formatMs(ms: number): string {
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(2)}s`;
  }
  return `${Math.round(ms)}ms`;
}

function printTiming(label: string, start: number) {
  const elapsed = performance.now() - start;
  console.log(`  ${label}: ${formatMs(elapsed)}`);
  return elapsed;
}

async function profileDashboard() {
  console.log("\n══════════════════════════════════════════════════");
  console.log("  DASHBOARD PERFORMANCE PROFILE");
  console.log("══════════════════════════════════════════════════");
  console.log(`  Started at: ${new Date().toISOString()}\n`);

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  const allStart = performance.now();

  // 1. Database connection test
  console.log("── Database Connection ──");
  const connStart = performance.now();
  await withTimeout(
    prisma.$queryRaw`SELECT 1`,
    QUERY_TIMEOUT,
    "DB_CONNECT",
  );
  printTiming("connection", connStart);

  // 2. Customer count
  console.log("\n── Customer Count ──");
  const custStart = performance.now();
  const totalCustomers = await withTimeout(
    prisma.customer.count({ where: { isActive: true, deletedAt: null } }),
    QUERY_TIMEOUT,
    "CUSTOMER_COUNT",
  );
  printTiming("query", custStart);
  console.log(`  result: ${totalCustomers} customers`);

  // 3. Today's revenue (Sales aggregate)
  console.log("\n── Today's Revenue ──");
  const revStart = performance.now();
  const todaySales = await withTimeout(
    prisma.sale.aggregate({
      where: {
        createdAt: { gte: todayStart, lte: todayEnd },
        status: "COMPLETED",
      },
      _sum: { grandTotal: true },
      _count: { _all: true },
    }),
    QUERY_TIMEOUT,
    "TODAY_SALES",
  );
  printTiming("query", revStart);
  console.log(`  result: ₹${todaySales._sum.grandTotal?.toString() ?? "0"} (${todaySales._count._all} invoices)`);

  // 4. Pending credit
  console.log("\n── Pending Credit ──");
  const creditStart = performance.now();
  const pendingCredit = await withTimeout(
    prisma.sale.aggregate({
      where: {
        status: { in: ["COMPLETED", "PARTIALLY_RETURNED"] },
        saleType: { in: ["CREDIT", "PARTIAL"] },
        pendingAmount: { gt: new Decimal(0) },
        customer: { isActive: true, deletedAt: null },
      },
      _sum: { pendingAmount: true },
      _count: { _all: true },
    }),
    QUERY_TIMEOUT,
    "PENDING_CREDIT",
  );
  printTiming("query", creditStart);
  console.log(`  result: ₹${pendingCredit._sum.pendingAmount?.toString() ?? "0"} (${pendingCredit._count._all} sales)`);

  // 5. Low stock count
  console.log("\n── Low Stock Count ──");
  const stockStart = performance.now();
  const lowStockCount = await withTimeout(
    prisma.product.count({
      where: { stockQuantity: { lte: 5 }, isActive: true },
    }),
    QUERY_TIMEOUT,
    "LOW_STOCK",
  );
  printTiming("query", stockStart);
  console.log(`  result: ${lowStockCount} products`);

  // 6. Overdue summary (the previously problematic query)
  console.log("\n── Overdue Summary ──");
  const overdueStart = performance.now();
  const overdueStats = await withTimeout(
    getOverdueSummary(),
    QUERY_TIMEOUT,
    "OVERDUE_SUMMARY",
  );
  printTiming("query", overdueStart);
  console.log(`  result: ${overdueStats.overdueCount} overdue invoices, ₹${overdueStats.overdueAmount.toString()}`);

  // 7. Recent sales
  console.log("\n── Recent Sales ──");
  const recentSalesStart = performance.now();
  const recentSales = await withTimeout(
    prisma.sale.findMany({
      where: { status: "COMPLETED" },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { customer: { select: { fullName: true, mobile: true } } },
    }),
    QUERY_TIMEOUT,
    "RECENT_SALES",
  );
  printTiming("query", recentSalesStart);
  console.log(`  result: ${recentSales.length} sales fetched`);

  // 8. Complete dashboard service
  console.log("\n── Complete Dashboard Service ──");
  const dashStart = performance.now();
  const allResults = await Promise.all([
    prisma.sale.aggregate({
      where: {
        createdAt: { gte: todayStart, lte: todayEnd },
        status: "COMPLETED",
      },
      _sum: { grandTotal: true },
      _count: { _all: true },
    }),
    prisma.sale.aggregate({
      where: {
        status: { in: ["COMPLETED", "PARTIALLY_RETURNED"] },
        saleType: { in: ["CREDIT", "PARTIAL"] },
        pendingAmount: { gt: new Decimal(0) },
        customer: { isActive: true, deletedAt: null },
      },
      _sum: { pendingAmount: true },
      _count: { _all: true },
    }),
    prisma.product.count({
      where: { stockQuantity: { lte: 5 }, isActive: true },
    }),
    prisma.customer.count({ where: { isActive: true, deletedAt: null } }),
    getOverdueSummary(),
    prisma.sale.findMany({
      where: { status: "COMPLETED" },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { customer: { select: { fullName: true, mobile: true } } },
    }),
  ]);
  const dashElapsed = printTiming("total (Promise.all)", dashStart);

  console.log(`\n── Results ──`);
  console.log(`  Total customers: ${allResults[3]}`);
  console.log(`  Today revenue: ₹${(allResults[0] as typeof todaySales)._sum.grandTotal?.toString() ?? "0"}`);
  console.log(`  Pending credit: ₹${(allResults[1] as typeof pendingCredit)._sum.pendingAmount?.toString() ?? "0"}`);
  console.log(`  Low stock: ${allResults[2]}`);
  console.log(`  Overdue: ${(allResults[4] as typeof overdueStats).overdueCount} invoices`);
  console.log(`  Recent sales: ${(allResults[5] as typeof recentSales).length} entries`);

  // 9. Summary
  const totalElapsed = performance.now() - allStart;
  console.log("\n══════════════════════════════════════════════════");
  console.log("  SUMMARY");
  console.log("══════════════════════════════════════════════════");
  console.log(`  Total dashboard duration: ${formatMs(totalElapsed)}`);
  console.log(`  Target (local):           < 3.00s`);
  console.log(`  Target (Vercel):          < 5.00s`);

  const status =
    dashElapsed < 3_000
      ? "✓ PASS (fast)"
      : dashElapsed < 5_000
        ? "✓ PASS (acceptable for Vercel)"
        : "✗ FAIL (too slow)";

  console.log(`  Status:                   ${status}`);
  console.log("══════════════════════════════════════════════════\n");

  await prisma.$disconnect();
  process.exit(dashElapsed < 5_000 ? 0 : 1);
}

profileDashboard().catch((err) => {
  console.error("\n✗ Profile failed:", err);
  process.exit(1);
});