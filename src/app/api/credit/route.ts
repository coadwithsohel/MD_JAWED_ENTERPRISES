import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
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

  // FIX: Use canonical accounting summary instead of Sale.pendingAmount
  const pendingCredit = await getTotalPendingCredit();

  // FIX: Recent Payments - use last 30 days from CreditLedger PAYMENT_RECEIVED
  // This is the canonical source, not Payment table which may miss imported records
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  const recentPaymentsAgg = await prisma.creditLedger.aggregate({
    where: {
      transactionType: 'PAYMENT_RECEIVED',
      createdAt: { gte: thirtyDaysAgo },
    },
    _sum: { amount: true },
    _count: { _all: true },
  });

  const recentPaymentsAmount = recentPaymentsAgg._sum.amount ?? new Decimal(0);
  const recentPaymentsCount = recentPaymentsAgg._count._all;

  return NextResponse.json({
    ledgers,
    total,
    page,
    pages: Math.ceil(total / limit),
    summary: {
      totalPending: pendingCredit.total,
      customersWithDues: pendingCredit.count,
      recentPaymentsAmount,
      recentPaymentsCount,
    },
  });
}