/**
 * GET /api/payments/[id]
 * Returns a single payment record by ID.
 * Includes customer info and linked sale for the edit form.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireAuth(req);
  if (error) return error;
  const { id } = await params;

  const payment = await prisma.payment.findUnique({
    where: { id },
    include: {
      customer: {
        select: { id: true, customerCode: true, fullName: true, mobile: true },
      },
      sale: {
        select: { id: true, invoiceNumber: true, grandTotal: true },
      },
      receivedBy: { select: { fullName: true } },
    },
  });

  if (!payment) return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
  return NextResponse.json({ payment });
}
