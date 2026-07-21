import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireRole } from '@/lib/auth';
import { toPaise, fromPaise } from '@/lib/money';

const UpdateCustomerSchema = z.object({
  fullName: z.string().min(2).optional(),
  alternateMobile: z.string().optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  pinCode: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const DeactivateSchema = z.object({
  reason: z.string().max(500).optional().nullable(),
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
        oldData: {
          fullName: existing.fullName,
          email: existing.email,
          address: existing.address,
          city: existing.city,
          state: existing.state,
        } as object,
        newData: parsed.data,
      },
    });

    return NextResponse.json({ customer });
  } catch (err) {
    console.error('[PATCH /api/customers/:id]', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

/**
 * DELETE — Soft-deactivate a customer.
 * Preserves all invoices, payments, ledger history, and reports.
 * Sets isActive=false and records who deactivated it.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // OWNER or MANAGER only
  const { auth, error } = await requireRole(req, ['OWNER', 'MANAGER']);
  if (error) return error;
  const { id } = await params;

  if (!id || id.length < 4) {
    return NextResponse.json({ error: 'Invalid customer ID' }, { status: 400 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const parsed = DeactivateSchema.safeParse(body);
    const reason = parsed.success ? (parsed.data.reason ?? null) : null;

    // Fetch with counts for the response
    const existing = await prisma.customer.findUnique({
      where: { id },
      select: {
        id: true,
        fullName: true,
        customerCode: true,
        mobile: true,
        isActive: true,
        deletedAt: true,
        currentBalance: true,
        _count: {
          select: { sales: true, payments: true },
        },
      },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }

    if (!existing.isActive || existing.deletedAt) {
      return NextResponse.json(
        { error: 'Customer is already inactive' },
        { status: 409 },
      );
    }

    const outstandingPaise = toPaise(existing.currentBalance);

    const customer = await prisma.$transaction(async (tx) => {
      const updated = await tx.customer.update({
        where: { id },
        data: {
          isActive: false,
          deletedAt: new Date(),
          deletedBy: auth.userId,
          deleteReason: reason,
        },
        select: {
          id: true,
          customerCode: true,
          fullName: true,
          mobile: true,
          isActive: true,
          deletedAt: true,
          currentBalance: true,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: auth.userId,
          action: 'CUSTOMER_DEACTIVATED',
          entityType: 'Customer',
          entityId: id,
          oldData: {
            isActive: true,
            fullName: existing.fullName,
            customerCode: existing.customerCode,
          },
          newData: {
            isActive: false,
            reason: reason ?? undefined,
            deactivatedBy: auth.userId,
            outstandingBalance: fromPaise(Math.abs(outstandingPaise)),
          },
        },
      });

      return updated;
    });

    return NextResponse.json({
      customer: {
        ...customer,
        currentBalance: fromPaise(Math.abs(outstandingPaise)),
      },
      message: 'Customer deactivated. Financial history has been preserved.',
      hadOutstanding: outstandingPaise > 0,
    });
  } catch (err) {
    console.error('[DELETE /api/customers/:id]', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
