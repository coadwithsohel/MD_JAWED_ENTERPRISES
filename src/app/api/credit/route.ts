import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { Prisma } from '@prisma/client';
import { getTotalPendingCredit } from '@/lib/accounting';

export async function GET(req: NextRequest) {
  const { error } = await requireAuth(req);
  if (error) return error;

  const url = req.nextUrl;
  const page = parseInt(url.searchParams.get('page') ?? '1');
  const limit = parseInt(url.searchParams.get('limit') ?? '50');
  const skip = (page - 1) * limit;
  const customerId = url.searchParams.get('customerId');
  const search = url.searchParams.get('search');

  const where: Prisma.CreditLedgerWhereInput = {};
  if (customerId) where.customerId = customerId;
  if (search) {
    where.customer = {
      OR: [
        { fullName: { contains: search, mode: 'insensitive' } },
        { mobile: { contains: search } },
        { customerCode: { contains: search, mode: 'insensitive' } },
      ],
    };
  }

  const [ledgers, total] = await Promise.all([
    prisma.creditLedger.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: {
        customer: { select: { id: true, customerCode: true, fullName: true, mobile: true } },
        sale: { select: { invoiceNumber: true } },
      },
    }),
    prisma.creditLedger.count({ where }),
  ]);

  // Summary — total pending across all credit sales for active, non-deleted customers
  const summary = await prisma.sale.aggregate({
    where: {
      status: { in: ['COMPLETED', 'PARTIALLY_RETURNED'] },
      saleType: { in: ['CREDIT', 'PARTIAL'] },
      pendingAmount: { gt: 0 },
      customer: { isActive: true, deletedAt: null },
    },
    _sum: { pendingAmount: true },
    _count: { _all: true },
  });

  return NextResponse.json({
    ledgers,
    total,
    page,
    pages: Math.ceil(total / limit),
    summary: {
      totalPending: summary._sum.pendingAmount ?? 0,
      customersWithDues: summary._count._all,
    },
  });
}
