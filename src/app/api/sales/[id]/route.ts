import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireAuth(req);
  if (error) return error;
  const { id } = await params;

  const sale = await prisma.sale.findUnique({
    where: { id },
    include: {
      customer: {
        select: {
          id: true, customerCode: true, fullName: true, mobile: true,
          alternateMobile: true, address: true, city: true, state: true, pinCode: true,
        },
      },
      createdBy: { select: { fullName: true } },
      saleItems: {
        include: {
          product: { select: { id: true, name: true, sku: true, hsnCode: true } },
          productSerials: { select: { serialNumber: true, imei1: true, imei2: true } },
        },
      },
      payments: { orderBy: { paymentDate: 'desc' } },
    },
  });

  if (!sale) return NextResponse.json({ error: 'Sale not found' }, { status: 404 });
  return NextResponse.json({ sale });
}
