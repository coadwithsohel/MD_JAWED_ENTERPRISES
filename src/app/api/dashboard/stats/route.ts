import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { getOverdueSummary } from '@/lib/overdue';
import { getTotalPendingCredit } from '@/lib/accounting';

export async function GET(req: NextRequest) {
  const { error } = await requireAuth(req);
  if (error) return error;

  try {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);

    const [todaySales, pendingCredit, lowStockCount, totalCustomers, overdueStats] = await Promise.all([
      prisma.sale.aggregate({
        where: {
          createdAt: { gte: todayStart, lte: todayEnd },
          status: 'COMPLETED',
        },
        _sum: { grandTotal: true, paidAmount: true },
        _count: { _all: true },
      }),
      getTotalPendingCredit(),
      prisma.product.count({ where: { stockQuantity: { lte: 5 }, isActive: true } }),
      prisma.customer.count({ where: { isActive: true, deletedAt: null } }),
      getOverdueSummary(),
    ]);

    // Today's cash revenue
    const todayCash = await prisma.sale.aggregate({
      where: {
        createdAt: { gte: todayStart, lte: todayEnd },
        status: 'COMPLETED',
        saleType: 'CASH',
      },
      _sum: { grandTotal: true },
    });

    return NextResponse.json({
      todayRevenue: todaySales._sum.grandTotal ?? 0,
      todayInvoices: todaySales._count._all,
      todayCashRevenue: todayCash._sum.grandTotal ?? 0,
      pendingCreditTotal: pendingCredit.total,
      customersWithDues: pendingCredit.count,
      lowStockCount,
      totalCustomers,
      overdueCount: overdueStats.overdueCount,
      overdueAmount: overdueStats.overdueAmount,
    });
  } catch (err) {
    console.error('[GET /api/dashboard/stats]', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
