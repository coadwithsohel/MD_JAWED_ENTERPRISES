/**
 * PATCH /api/payments/[id]/edit
 *
 * Duplicate-safe payment edit endpoint.
 * NEVER creates a new Payment, CreditLedger, or Sale record.
 * Updates only the existing canonical Payment record and its linked CreditLedger row.
 * Uses Payment.updatedAt for optimistic concurrency.
 * Returns 409 TRANSACTION_CHANGED if modified after the form opened.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/auth';
import { Decimal } from '@prisma/client/runtime/library';

// ─── Validation schema ─────────────────────────────────────────────────────────

const EditPaymentSchema = z.object({
  paymentDate: z.string().optional(),
  paymentMode: z.enum(['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CHEQUE', 'OTHER']).optional(),
  referenceNumber: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  amount: z.number().positive('Amount must be positive').optional(),
  // Required
  editReason: z.string().min(3, 'Edit reason is required').max(500),
  // Optimistic concurrency
  updatedAt: z.string(),
  // Customer context for ownership verification
  customerId: z.string(),
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
  const { id: paymentId } = await params;

  try {
    const body = await req.json();
    const parsed = EditPaymentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 422 },
      );
    }

    const {
      paymentDate: newPaymentDate,
      paymentMode: newPaymentMode,
      referenceNumber: newReferenceNumber,
      notes: newNotes,
      amount: newAmount,
      editReason,
      updatedAt: clientUpdatedAt,
      customerId,
    } = parsed.data;

    // 1. Load existing canonical record
    const existing = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        sale: {
          select: { id: true, paidAmount: true, pendingAmount: true, grandTotal: true, paymentStatus: true },
        },
      },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
    }

    // 2. Ownership check
    if (existing.customerId !== customerId) {
      return NextResponse.json({ error: 'Payment does not belong to this customer' }, { status: 403 });
    }

    // 3. Not voided/reversed
    if (existing.status === 'VOIDED' || existing.status === 'REVERSED') {
      return NextResponse.json(
        { error: 'Voided or reversed payments cannot be edited' },
        { status: 422 },
      );
    }

    // 4. Optimistic concurrency check
    if (existing.updatedAt.toISOString() !== clientUpdatedAt) {
      return NextResponse.json(
        {
          error: 'TRANSACTION_CHANGED',
          message: 'This payment was modified in another session. Reload and try again.',
        },
        { status: 409 },
      );
    }

    const oldAmount = existing.amount;
    const amountChanged = newAmount !== undefined && !new Decimal(newAmount).equals(oldAmount);

    // 5. Build payment update data
    const paymentUpdateData: Record<string, unknown> = {};
    if (newPaymentDate !== undefined) paymentUpdateData.paymentDate = new Date(newPaymentDate);
    if (newPaymentMode !== undefined) paymentUpdateData.paymentMode = newPaymentMode;
    if (newReferenceNumber !== undefined) paymentUpdateData.referenceNumber = newReferenceNumber;
    if (newNotes !== undefined) paymentUpdateData.notes = newNotes;
    if (amountChanged && newAmount !== undefined) paymentUpdateData.amount = new Decimal(newAmount);

    // 6. Execute atomic transaction
    const result = await prisma.$transaction(async (tx) => {
      // 6a. Update the canonical Payment record (ONE update call)
      const updatedPayment = await tx.payment.update({
        where: { id: paymentId },
        data: paymentUpdateData,
      });

      // 6b. If amount changed: update linked CreditLedger PAYMENT_RECEIVED row
      //     Uses updateMany with paymentId filter — never creates new rows
      if (amountChanged && newAmount !== undefined) {
        await tx.creditLedger.updateMany({
          where: { paymentId, transactionType: 'PAYMENT_RECEIVED' },
          data: { amount: new Decimal(newAmount) },
        });

        // 6c. If payment was linked to a sale, update sale's paidAmount/pendingAmount
        if (existing.saleId && existing.sale) {
          const oldPaymentAmount = oldAmount;
          const newPaymentAmount = new Decimal(newAmount);
          const amountDelta = newPaymentAmount.sub(oldPaymentAmount); // positive = increase, negative = decrease

          const newPaidAmount = existing.sale.paidAmount.add(amountDelta);
          const newPendingAmount = existing.sale.grandTotal.sub(newPaidAmount);

          // Validate: paidAmount cannot exceed grandTotal
          if (newPaidAmount.gt(existing.sale.grandTotal)) {
            throw new Error(
              `Edited payment amount (₹${newAmount}) would exceed invoice total (₹${existing.sale.grandTotal}). Reduce the amount.`,
            );
          }

          const newPaymentStatus =
            newPendingAmount.lte(0)
              ? 'PAID'
              : newPaidAmount.gt(0)
                ? 'PARTIALLY_PAID'
                : 'UNPAID';

          await tx.sale.update({
            where: { id: existing.saleId },
            data: {
              paidAmount: newPaidAmount,
              pendingAmount: newPendingAmount,
              paymentStatus: newPaymentStatus as 'PAID' | 'PARTIALLY_PAID' | 'UNPAID' | 'OVERDUE',
            },
          });
        }
      }

      // 6d. Recalculate customer balance from canonical source
      const newBalance = await recalcBalance(customerId, tx);

      // 6e. Audit log
      await tx.auditLog.create({
        data: {
          userId: auth.userId,
          action: 'PAYMENT_UPDATED',
          entityType: 'Payment',
          entityId: paymentId,
          oldData: {
            paymentDate: existing.paymentDate.toISOString(),
            paymentMode: existing.paymentMode,
            referenceNumber: existing.referenceNumber,
            notes: existing.notes,
            amount: existing.amount.toString(),
          } as object,
          newData: {
            ...paymentUpdateData,
            editReason,
            editedBy: auth.userId,
            newCustomerBalance: newBalance.toString(),
          } as object,
        },
      });

      return { updatedPayment, newBalance };
    });

    return NextResponse.json({
      payment: result.updatedPayment,
      previousAmount: oldAmount.toString(),
      newAmount: newAmount?.toString() ?? oldAmount.toString(),
    });
  } catch (err) {
    console.error('[PATCH /api/payments/:id/edit]', err);
    const msg = err instanceof Error ? err.message : 'Server error';
    const isClientError = ['exceed', 'cannot'].some((s) => msg.toLowerCase().includes(s));
    return NextResponse.json({ error: msg }, { status: isClientError ? 422 : 500 });
  }
}
