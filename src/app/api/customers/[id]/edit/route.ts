/**
 * PATCH /api/customers/[id]/edit
 *
 * Duplicate-safe customer edit endpoint.
 * Reads `updatedAt` from request body for optimistic concurrency.
 * Returns 409 CUSTOMER_CHANGED if the record was modified after the form opened.
 * Never creates a second customer record or reimports opening balance.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/auth';
import { Decimal } from '@prisma/client/runtime/library';

// ─── Validation schema ─────────────────────────────────────────────────────────

const EditCustomerSchema = z.object({
  // Editable profile fields
  fullName: z.string().min(2, 'Name must be at least 2 characters').optional(),
  mobile: z.string().min(10, 'Invalid mobile number').optional(),
  alternateMobile: z.string().optional().nullable(),
  email: z.string().email('Invalid email').optional().nullable().or(z.literal('')),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  pinCode: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  // Financial fields
  creditLimit: z.number().min(0, 'Credit limit cannot be negative').optional(),
  openingBalance: z.number().optional(),
  isActive: z.boolean().optional(),
  // Required for all edits
  editReason: z.string().trim().optional().nullable(),
  // Optimistic concurrency token (ISO string from customer.updatedAt)
  updatedAt: z.string(),
});

// ─── Inline balance recalculation ─────────────────────────────────────────────

async function recalcBalance(
  customerId: string,
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
): Promise<Decimal> {
  const cust = await tx.customer.findUnique({
    where: { id: customerId },
    select: { openingBalance: true },
  });
  const openingBalance = cust?.openingBalance ?? new Decimal(0);

  const debitAgg = await tx.creditLedger.aggregate({
    where: { customerId, transactionType: { in: ['CREDIT_SALE', 'PAYMENT_REVERSAL', 'ADJUSTMENT'] } },
    _sum: { amount: true },
  });
  const creditAgg = await tx.creditLedger.aggregate({
    where: { customerId, transactionType: { in: ['PAYMENT_RECEIVED', 'SALE_CANCELLED', 'RETURN_CREDIT'] } },
    _sum: { amount: true },
  });

  const totalDebit = debitAgg._sum?.amount ?? new Decimal(0);
  const totalCredit = creditAgg._sum?.amount ?? new Decimal(0);
  const closingBalance = openingBalance.add(totalDebit).sub(totalCredit);

  await tx.customer.update({
    where: { id: customerId },
    data: { currentBalance: closingBalance },
  });

  return closingBalance;
}

// ─── Route handler ─────────────────────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { auth, error } = await requireRole(req, ['OWNER', 'MANAGER']);
  if (error) return error;
  const { id } = await params;

  try {
    const body = await req.json();
    const parsed = EditCustomerSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 422 },
      );
    }

    const { editReason: rawReason, updatedAt: clientUpdatedAt, openingBalance: newOpeningBalance, creditLimit: newCreditLimit, ...profileFields } = parsed.data;
    const editReason = rawReason || null;

    // 1. Load existing canonical record
    const existing = await prisma.customer.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }

    // 2. Optimistic concurrency check
    const serverUpdatedAt = existing.updatedAt.toISOString();
    if (serverUpdatedAt !== clientUpdatedAt) {
      return NextResponse.json(
        { error: 'CUSTOMER_CHANGED', message: 'This record was modified by another session. Please reload and try again.' },
        { status: 409 },
      );
    }

    // 3. Check mobile uniqueness if changed
    if (profileFields.mobile && profileFields.mobile !== existing.mobile) {
      const mobileConflict = await prisma.customer.findFirst({
        where: { mobile: profileFields.mobile, id: { not: id } },
        select: { id: true, fullName: true },
      });
      if (mobileConflict) {
        return NextResponse.json(
          { error: `Mobile number already used by customer ${mobileConflict.fullName}` },
          { status: 422 },
        );
      }
    }

    // 4. Determine update data
    const updateData: Record<string, unknown> = { ...profileFields };
    if (newCreditLimit !== undefined) updateData.creditLimit = new Decimal(newCreditLimit);
    if (newOpeningBalance !== undefined) updateData.openingBalance = new Decimal(newOpeningBalance);

    const openingBalanceChanged =
      newOpeningBalance !== undefined &&
      !new Decimal(newOpeningBalance).equals(existing.openingBalance);

    // 5. Execute in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Update customer record
      const customer = await tx.customer.update({
        where: { id },
        data: updateData,
      });

      // If opening balance changed, recalculate derived currentBalance
      let newBalance = existing.currentBalance;
      if (openingBalanceChanged) {
        newBalance = await recalcBalance(id, tx);
      }

      // 6. Audit log
      const actions: string[] = ['CUSTOMER_UPDATED'];
      if (openingBalanceChanged) actions.push('OPENING_BALANCE_UPDATED');

      await tx.auditLog.create({
        data: {
          userId: auth.userId,
          action: actions.join(','),
          entityType: 'Customer',
          entityId: id,
          oldData: {
            fullName: existing.fullName,
            mobile: existing.mobile,
            alternateMobile: existing.alternateMobile,
            email: existing.email,
            address: existing.address,
            city: existing.city,
            state: existing.state,
            creditLimit: existing.creditLimit.toString(),
            openingBalance: existing.openingBalance.toString(),
            isActive: existing.isActive,
          } as object,
          newData: {
            ...profileFields,
            editReason,
            editedBy: auth.userId,
          } as object,
        },
      });

      return { customer, newBalance };
    });

    return NextResponse.json({ customer: result.customer });
  } catch (err) {
    console.error('[PATCH /api/customers/:id/edit]', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
