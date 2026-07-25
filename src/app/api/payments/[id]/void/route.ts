/**
 * POST /api/payments/[id]/void
 *
 * Voids a payment record.
 * Record is NOT deleted — status set to VOIDED, CreditLedger amount set to zero.
 * If linked to a sale, the sale's paidAmount is restored and pendingAmount increased.
 * Uses Payment.updatedAt for optimistic concurrency.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/auth';
import { Decimal } from '@prisma/client/runtime/library';

const VoidPaymentSchema = z.object({
  voidReason: z.string().min(3, 'Void reason is required').max(500),
  updatedAt: z.string(),
  customerId: z.string(),
});

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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { auth, error } = await requireRole(req, ['OWNER', 'MANAGER']);
  if (error) return error;
  const { id: paymentId } = await params;

  try {
    const body = await req.json();
    const parsed = VoidPaymentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 422 });
    }

    const { voidReason, updatedAt: clientUpdatedAt, customerId } = parsed.data;

    const existing = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        sale: {
          select: { id: true, paidAmount: true, pendingAmount: true, grandTotal: true },
        },
      },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
    }

    if (existing.customerId !== customerId) {
      return NextResponse.json({ error: 'Payment does not belong to this customer' }, { status: 403 });
    }

    if (existing.status === 'VOIDED' || existing.voidedAt != null) {
      return NextResponse.json({ error: 'Payment is already voided' }, { status: 409 });
    }

    if (existing.updatedAt.toISOString() !== clientUpdatedAt) {
      return NextResponse.json(
        { error: 'TRANSACTION_CHANGED', message: 'Payment was modified in another session. Reload and try again.' },
        { status: 409 },
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      // 1. Mark payment as VOIDED
      const voidedPayment = await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: 'VOIDED',
          voidedAt: new Date(),
          voidReason,
        },
      });

      // 2. Zero-out CreditLedger PAYMENT_RECEIVED entry (updateMany, not delete)
      await tx.creditLedger.updateMany({
        where: { paymentId, transactionType: 'PAYMENT_RECEIVED' },
        data: { amount: new Decimal(0) },
      });

      // 3. Restore sale amounts if payment was linked to a sale
      if (existing.saleId && existing.sale) {
        const restoredPaid = existing.sale.paidAmount.sub(existing.amount);
        const restoredPending = existing.sale.grandTotal.sub(restoredPaid);
        const newPaymentStatus =
          restoredPending.gte(existing.sale.grandTotal) ? 'UNPAID' :
          restoredPaid.gt(0) ? 'PARTIALLY_PAID' : 'UNPAID';

        await tx.sale.update({
          where: { id: existing.saleId },
          data: {
            paidAmount: restoredPaid,
            pendingAmount: restoredPending,
            paymentStatus: newPaymentStatus as 'PAID' | 'PARTIALLY_PAID' | 'UNPAID' | 'OVERDUE',
          },
        });
      }

      // 4. Recalculate balance
      const newBalance = await recalcBalance(customerId, tx);

      // 5. Audit log
      await tx.auditLog.create({
        data: {
          userId: auth.userId,
          action: 'TRANSACTION_VOIDED',
          entityType: 'Payment',
          entityId: paymentId,
          oldData: {
            status: existing.status,
            amount: existing.amount.toString(),
            receiptNumber: existing.receiptNumber,
            paymentMode: existing.paymentMode,
          } as object,
          newData: {
            status: 'VOIDED',
            voidReason,
            voidedBy: auth.userId,
            newCustomerBalance: newBalance.toString(),
          } as object,
        },
      });

      return { voidedPayment, newBalance };
    });

    return NextResponse.json({
      payment: result.voidedPayment,
      message: 'Payment voided successfully. Record preserved in audit history.',
    });
  } catch (err) {
    console.error('[POST /api/payments/:id/void]', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
