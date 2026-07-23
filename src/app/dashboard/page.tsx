import { prisma } from "@/lib/prisma";
import { getOverdueSummary } from "@/lib/overdue";
import { Decimal } from "@prisma/client/runtime/library";
import Link from "next/link";
import {
  TrendingUp,
  CreditCard,
  Users,
  Package,
  AlertTriangle,
  ShoppingCart,
  ArrowRight,
  FileText,
  Upload,
} from "lucide-react";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// ─── Query timeout helper ──────────────────────────────────────────────────
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

// ─── Dashboard trace helper (safe, no sensitive data) ──────────────────────
const traceStage = (stage: string) => {
  if (process.env.NODE_ENV === "development" || process.env.VERCEL_ENV) {
    console.info("[dashboard-trace]", { stage });
  }
};

// ─── Formatting ────────────────────────────────────────────────────────────
function fmt(n: Decimal | number | null | undefined): string {
  const num =
    n == null ? 0 : typeof n === "number" ? n : parseFloat(n.toString());
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(num);
}

// ─── Data fetching ────────────────────────────────────────────────────────
async function getDashboardData() {
  traceStage("request-start");
  const startTotal = performance.now();

  // No auth call here — this is a server component rendered after auth in middleware/layout
  traceStage("auth-complete");

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  const QUERY_TIMEOUT = 8_000; // 8 seconds per query

  const [
    todaySales,
    pendingCredit,
    lowStockCount,
    totalCustomers,
    overdueStats,
    recentSales,
    recentImport,
  ] = await Promise.all([
    withTimeout(
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
    ),
    withTimeout(
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
    ),
    withTimeout(
      prisma.product.count({
        where: { stockQuantity: { lte: 5 }, isActive: true },
      }),
      QUERY_TIMEOUT,
      "LOW_STOCK",
    ),
    withTimeout(
      prisma.customer.count({ where: { isActive: true, deletedAt: null } }),
      QUERY_TIMEOUT,
      "CUSTOMER_COUNT",
    ),
    withTimeout(
      getOverdueSummary(),
      QUERY_TIMEOUT,
      "OVERDUE_SUMMARY",
    ),
    withTimeout(
      prisma.sale.findMany({
        where: { status: "COMPLETED" },
        orderBy: { createdAt: "desc" },
        take: 8,
        include: { customer: { select: { fullName: true, mobile: true } } },
      }),
      QUERY_TIMEOUT,
      "RECENT_SALES",
    ),
    withTimeout(
      prisma.customerImportBatch
        .findFirst({
          orderBy: { createdAt: "desc" },
          include: { importedBy: { select: { fullName: true } } },
        })
        .catch((error) => {
          const code =
            typeof error === "object" && error !== null && "code" in error
              ? String((error as { code?: unknown }).code)
              : "";
          if (code === "P2021") {
            return null;
          }
          throw error;
        }),
      QUERY_TIMEOUT,
      "RECENT_IMPORT",
    ),
  ]);

  traceStage("queries-complete");
  const endTotal = performance.now();

  // Safe timing log (no credentials, hashes, or personal data)
  console.info("[dashboard-performance]", {
    durationMs: Math.round(endTotal - startTotal),
    totalCustomers,
    pendingCreditCount: pendingCredit._count._all,
    overdueCount: overdueStats.overdueCount,
    todaySalesCount: todaySales._count._all,
  });

  traceStage("response-return");

  return {
    todaySales,
    pendingCredit,
    lowStockCount,
    totalCustomers,
    overdueStats,
    recentSales,
    recentImport,
  };
}

function StatCard({
  title,
  value,
  sub,
  icon: Icon,
  color,
  href,
}: {
  title: string;
  value: string;
  sub: string;
  icon: React.ElementType;
  color: string;
  href?: string;
}) {
  const content = (
    <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm hover:shadow-md transition-shadow h-full">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-500">{title}</h3>
        <span
          className={`h-9 w-9 rounded-xl ${color} flex items-center justify-center`}
        >
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-4 text-2xl font-bold text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{sub}</p>
    </div>
  );
  return href ? <Link href={href}>{content}</Link> : <div>{content}</div>;
}

export default async function DashboardPage() {
  const {
    todaySales,
    pendingCredit,
    lowStockCount,
    totalCustomers,
    overdueStats,
    recentSales,
    recentImport,
  } = await getDashboardData();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <span className="text-sm text-slate-500 bg-white border border-slate-200 px-3 py-1.5 rounded-lg shadow-sm">
          {new Date().toLocaleDateString("en-IN", {
            weekday: "short",
            day: "2-digit",
            month: "short",
            year: "numeric",
            timeZone: "Asia/Kolkata",
          })}
        </span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Today's Revenue"
          value={fmt(todaySales._sum.grandTotal)}
          sub={`${todaySales._count._all} invoices today`}
          icon={TrendingUp}
          color="bg-blue-100 text-blue-600"
        />
        <StatCard
          title="Pending Credit"
          value={fmt(pendingCredit._sum.pendingAmount)}
          sub={`${pendingCredit._count._all} outstanding sales`}
          icon={CreditCard}
          color="bg-orange-100 text-orange-600"
          href="/dashboard/credit"
        />
        <StatCard
          title="Total Customers"
          value={String(totalCustomers)}
          sub="Active accounts"
          icon={Users}
          color="bg-green-100 text-green-600"
          href="/dashboard/customers"
        />
        <StatCard
          title="Low Stock Items"
          value={String(lowStockCount)}
          sub="Need reordering"
          icon={Package}
          color="bg-red-100 text-red-600"
          href="/dashboard/products"
        />
      </div>

      {/* Overdue alert */}
      {overdueStats.overdueCount > 0 && (
        <Link
          href="/dashboard/overdue-customers"
          className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-xl px-6 py-4 hover:bg-amber-100 transition-colors"
        >
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            <div>
              <p className="text-sm font-semibold text-amber-900">
                {overdueStats.overdueCount} overdue invoice
                {overdueStats.overdueCount !== 1 ? "s" : ""} —{" "}
                {fmt(overdueStats.overdueAmount)} pending
              </p>
              <p className="text-xs text-amber-700 mt-0.5">
                Click to view and collect payments
              </p>
            </div>
          </div>
          <ArrowRight className="h-4 w-4 text-amber-600" />
        </Link>
      )}

      {/* Quick Actions */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          {
            label: "New Sale",
            href: "/dashboard/sales",
            icon: ShoppingCart,
            color: "bg-blue-600 text-white hover:bg-blue-700",
          },
          {
            label: "Add Customer",
            href: "/dashboard/customers",
            icon: Users,
            color: "bg-green-600 text-white hover:bg-green-700",
          },
          {
            label: "Sales History",
            href: "/dashboard/invoices",
            icon: FileText,
            color: "bg-slate-700 text-white hover:bg-slate-800",
          },
          {
            label: "Import Excel",
            href: "/dashboard/customers/import",
            icon: Upload,
            color: "bg-purple-600 text-white hover:bg-purple-700",
          },
        ].map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className={`${a.color} rounded-xl p-4 flex flex-col items-center gap-2 transition-colors text-center`}
          >
            <a.icon className="h-5 w-5" />
            <span className="text-sm font-semibold">{a.label}</span>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Sales */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
            <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-blue-500" /> Recent Sales
            </h2>
            <Link
              href="/dashboard/invoices"
              className="text-xs text-blue-600 hover:underline flex items-center gap-1"
            >
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="divide-y divide-slate-50">
            {recentSales.length === 0 ? (
              <p className="px-6 py-10 text-center text-slate-400 text-sm">
                No sales today yet.
              </p>
            ) : (
              recentSales.map((sale) => (
                <Link
                  key={sale.id}
                  href={`/dashboard/invoices/${sale.id}`}
                  className="px-6 py-3 flex items-center justify-between hover:bg-slate-50 transition-colors"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {sale.customer?.fullName || "Walk-in Customer"}
                    </p>
                    <p className="text-xs text-slate-500">
                      {sale.invoiceNumber} ·{" "}
                      {new Date(sale.createdAt).toLocaleTimeString("en-IN", {
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: "Asia/Kolkata",
                      })}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-slate-900">
                      {fmt(sale.grandTotal)}
                    </p>
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full ${sale.saleType === "CREDIT" ? "bg-orange-100 text-orange-700" : sale.saleType === "PARTIAL" ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"}`}
                    >
                      {sale.saleType}
                    </span>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>

        {/* Import Status */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
            <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <Upload className="h-4 w-4 text-purple-500" /> Recent Import
            </h2>
            <Link
              href="/dashboard/customers/import"
              className="text-xs text-blue-600 hover:underline flex items-center gap-1"
            >
              Import Excel <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="px-6 py-6">
            {!recentImport ? (
              <div className="text-center py-4">
                <Upload className="h-10 w-10 text-slate-200 mx-auto mb-3" />
                <p className="text-slate-500 text-sm font-medium">
                  No imports yet
                </p>
                <p className="text-slate-400 text-xs mt-1">
                  Import customer data from Excel to get started
                </p>
                <Link
                  href="/dashboard/customers/import"
                  className="mt-4 inline-flex items-center gap-2 text-sm text-purple-600 hover:underline font-medium"
                >
                  Import Now <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-900 truncate">
                    {recentImport.originalFileName}
                  </span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      recentImport.status === "COMPLETED"
                        ? "bg-green-100 text-green-700"
                        : recentImport.status === "FAILED"
                          ? "bg-red-100 text-red-700"
                          : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {recentImport.status}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  {[
                    {
                      label: "Created",
                      value: recentImport.importedRows,
                      color: "text-green-600",
                    },
                    {
                      label: "Updated",
                      value: recentImport.updatedRows,
                      color: "text-blue-600",
                    },
                    {
                      label: "Skipped",
                      value: recentImport.skippedRows,
                      color: "text-slate-500",
                    },
                  ].map((s) => (
                    <div key={s.label} className="bg-slate-50 rounded-lg p-3">
                      <p className={`text-xl font-bold ${s.color}`}>
                        {s.value}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">{s.label}</p>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-slate-500">
                  Imported by {recentImport.importedBy.fullName} ·{" "}
                  {new Date(recentImport.createdAt).toLocaleDateString(
                    "en-IN",
                    { timeZone: "Asia/Kolkata" },
                  )}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}