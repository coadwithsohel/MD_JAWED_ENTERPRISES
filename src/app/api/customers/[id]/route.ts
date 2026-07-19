import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';

const UpdateCustomerSchema = z.object({
  fullName: z.string().min(2).optional(),
  alternateMobile: z.string().optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  pinCode: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  creditLimit: z.number().min(0).optional(),
  isActive: z.boolean().optional(),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireAuth(req);
  if (error) return error;
  const { id } = await params;

  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      sales: {
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: { saleItems: { include: { product: { select: { name: true, sku: true } } } } },
      },
      ledgers: { orderBy: { createdAt: 'desc' }, take: 50 },
      payments: { orderBy: { paymentDate: 'desc' }, take: 20 },
    },
  });

  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
  return NextResponse.json({ customer });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, error } = await requireAuth(req);
  if (error) return error;
  const { id } = await params;

  try {
    const body = await req.json();
    const parsed = UpdateCustomerSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const existing = await prisma.customer.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: 'Customer not found' }, { status: 404 });

    const customer = await prisma.customer.update({
      where: { id },
      data: parsed.data,
    });

    await prisma.auditLog.create({
      data: {
        userId: auth.userId,
        action: 'UPDATE',
        entityType: 'Customer',
        entityId: id,
        oldData: existing as object,
        newData: parsed.data,
      },
    });

    return NextResponse.json({ customer });
  } catch (err) {
    console.error('[PATCH /api/customers/:id]', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
