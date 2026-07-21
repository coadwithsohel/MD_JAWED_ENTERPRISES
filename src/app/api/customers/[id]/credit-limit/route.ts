import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/auth';
import { Decimal } from '@prisma/client/runtime/library';
import { toPaise, fromPaise } from '@/lib/money';

// ─── Validation ───────────────────────────────────────────────────────────────

const MAX_CREDIT_RUPEES = 9_99_99_999.99; // ₹9,99,99,999.99

const ChangeCreditLimitSchema = z.object({
  creditLimit: z
    .string()
    .or(z.number())
    .transform((v) => String(v).trim().replace(/,/g, ''))
    .refine((v) => v !== '' && isFinite(parseFloat(v)) && !isNaN(parseFloat(v)), {
      message: 'Credit limit must be a valid number',
    })
    .refine((v) => parseFloat(v) >= 0, {
      message: 'Credit limit cannot be negative',
    })
    .refine((v) => parseFloat(v) <= MAX_CREDIT_RUPEES, {
      message: `Credit limit cannot exceed ₹${MAX_CREDIT_RUPEES.toLocaleString('en-IN')}`,
    }),
  reason: z.string().max(500).optional().nullable(),
});

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // 1. Auth — OWNER or MANAGER only
  const { auth, error } = await requireRole(req, ['OWNER', 'MANAGER']);
  if (error) return error;

  const { id: customerId } = await params;

  if (!customerId || customerId.length < 4) {
    return NextResponse.json({ error: 'Invalid customer ID' }, { status: 400 });
  }

  try {
    // 2. Parse + validate body
    const body = await req.json();
    const parsed = ChangeCreditLimitSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }

    const newLimitDecimal = new Decimal(parsed.data.creditLimit);
    const reason = parsed.data.reason ?? null;

    // 3. Fetch existing customer
    const existing = await prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        fullName: true,
        customerCode: true,
        creditLimit: true,
        currentBalance: true,
        isActive: true,
        deletedAt: true,
      },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }

    if (!existing.isActive || existing.deletedAt) {
      return NextResponse.json(
        { error: 'Cannot update credit limit for an inactive customer' },
        { status: 409 },
      );
    }

    const oldLimitPaise = toPaise(existing.creditLimit);
    const newLimitPaise = toPaise(newLimitDecimal.toString());
    const outstandingPaise = toPaise(existing.currentBalance);

    // 4. Business rule: warn if new limit < outstanding (allow with warning, don't block)
    const belowOutstanding = newLimitPaise > 0 && newLimitPaise < outstandingPaise;

    // 5. Update inside transaction
    const updated = await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.update({
        where: { id: customerId },
        data: {
          creditLimit: newLimitDecimal,
          creditLimitUpdatedAt: new Date(),
          creditLimitUpdatedBy: auth.userId,
        },
        select: {
          id: true,
          customerCode: true,
          fullName: true,
          mobile: true,
          creditLimit: true,
          currentBalance: true,
          isActive: true,
          creditLimitUpdatedAt: true,
          creditLimitUpdatedBy: true,
        },
      });

      // Audit log
      await tx.auditLog.create({
        data: {
          userId: auth.userId,
          action: 'CREDIT_LIMIT_CHANGED',
          entityType: 'Customer',
          entityId: customerId,
          oldData: {
            creditLimit: fromPaise(oldLimitPaise),
            creditLimitPaise: oldLimitPaise,
          },
          newData: {
            creditLimit: fromPaise(newLimitPaise),
            creditLimitPaise: newLimitPaise,
            reason: reason ?? undefined,
          },
        },
      });

      return customer;
    });

    return NextResponse.json({
      customer: {
        ...updated,
        creditLimit: fromPaise(toPaise(updated.creditLimit)),
        currentBalance: fromPaise(Math.abs(toPaise(updated.currentBalance))),
      },
      belowOutstanding,
      message: 'Credit limit updated successfully.',
    });
  } catch (err) {
    console.error('[PATCH /api/customers/:id/credit-limit]', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
