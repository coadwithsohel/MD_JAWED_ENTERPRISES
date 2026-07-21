import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/auth';
import { toPaise, fromPaise } from '@/lib/money';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Auth — OWNER or MANAGER only
  const { auth, error } = await requireRole(req, ['OWNER', 'MANAGER']);
  if (error) return error;

  const { id: customerId } = await params;

  if (!customerId || customerId.length < 4) {
    return NextResponse.json({ error: 'Invalid customer ID' }, { status: 400 });
  }

  try {
    const existing = await prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        fullName: true,
        customerCode: true,
        isActive: true,
        deletedAt: true,
        currentBalance: true,
      },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }

    if (existing.isActive && !existing.deletedAt) {
      return NextResponse.json(
        { error: 'Customer is already active' },
        { status: 409 },
      );
    }

    const customer = await prisma.$transaction(async (tx) => {
      const restored = await tx.customer.update({
        where: { id: customerId },
        data: {
          isActive: true,
          deletedAt: null,
          deletedBy: null,
          deleteReason: null,
        },
        select: {
          id: true,
          customerCode: true,
          fullName: true,
          mobile: true,
          isActive: true,
          currentBalance: true,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: auth.userId,
          action: 'CUSTOMER_RESTORED',
          entityType: 'Customer',
          entityId: customerId,
          newData: {
            fullName: existing.fullName,
            customerCode: existing.customerCode,
            restoredBy: auth.userId,
          },
        },
      });

      return restored;
    });

    return NextResponse.json({
      customer: {
        ...customer,
        currentBalance: fromPaise(Math.abs(toPaise(customer.currentBalance))),
      },
      message: 'Customer restored successfully.',
    });
  } catch (err) {
    console.error('[POST /api/customers/:id/restore]', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
