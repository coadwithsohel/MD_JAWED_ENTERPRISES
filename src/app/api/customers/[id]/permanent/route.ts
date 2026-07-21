import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/auth';
import { toPaise, fromPaise } from '@/lib/money';

// ─── Validation ───────────────────────────────────────────────────────────────

const PermanentDeleteSchema = z.object({
  confirmation: z.string(),
  reason: z.string().max(500).optional().nullable(),
});

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // 1. Auth — OWNER only
  const { auth, error } = await requireRole(req, ['OWNER']);
  if (error) return error;

  const { id: customerId } = await params;

  if (!customerId || customerId.length < 4) {
    return NextResponse.json({ error: 'Invalid customer ID' }, { status: 400 });
  }

  try {
    // 2. Parse body
    const body = await req.json().catch(() => ({}));
    const parsed = PermanentDeleteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }

    // 3. Confirmation check
    if (parsed.data.confirmation !== 'DELETE') {
      return NextResponse.json(
        { error: 'Confirmation text must be exactly "DELETE"' },
        { status: 400 },
      );
    }

    // 4. Fetch customer
    const existing = await prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        fullName: true,
        customerCode: true,
        mobile: true,
        currentBalance: true,
        isActive: true,
        _count: {
          select: {
            sales: true,
            payments: true,
            ledgers: true,
            reminders: true,
          },
        },
      },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }

    // 5. Safety checks — server-side (never trust frontend)
    const issues: string[] = [];

    if (existing._count.sales > 0) {
      issues.push(`${existing._count.sales} invoice(s)`);
    }
    if (existing._count.payments > 0) {
      issues.push(`${existing._count.payments} payment record(s)`);
    }
    if (existing._count.ledgers > 0) {
      issues.push(`${existing._count.ledgers} ledger entry/entries`);
    }
    if (existing._count.reminders > 0) {
      issues.push(`${existing._count.reminders} reminder(s)`);
    }

    const outstandingPaise = toPaise(existing.currentBalance);
    if (outstandingPaise !== 0) {
      issues.push(`outstanding balance of ${fromPaise(Math.abs(outstandingPaise))}`);
    }

    if (issues.length > 0) {
      return NextResponse.json(
        {
          error: 'Cannot permanently delete this customer.',
          reason: `This customer has ${issues.join(', ')}. Deactivate the customer instead to preserve financial history.`,
          suggestion: 'deactivate',
        },
        { status: 409 },
      );
    }

    // 6. Permanent delete inside a transaction
    await prisma.$transaction(async (tx) => {
      // Audit first (before delete so we have the entity)
      await tx.auditLog.create({
        data: {
          userId: auth.userId,
          action: 'CUSTOMER_PERMANENTLY_DELETED',
          entityType: 'Customer',
          entityId: customerId,
          oldData: {
            fullName: existing.fullName,
            customerCode: existing.customerCode,
            mobile: existing.mobile,
          },
          newData: {
            reason: parsed.data.reason ?? undefined,
            deletedBy: auth.userId,
          },
        },
      });

      await tx.customer.delete({ where: { id: customerId } });
    });

    return NextResponse.json({
      message: `Customer ${existing.fullName} has been permanently deleted.`,
    });
  } catch (err) {
    console.error('[DELETE /api/customers/:id/permanent]', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
