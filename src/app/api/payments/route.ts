import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { Decimal } from '@prisma/client/runtime/library';
import { generateReceiptNumber } from '@/lib/counters';

const PaymentSchema = z.object({
  customerId: z.string(),
  saleId: z.string().optional().nullable(),
  amount: z.number().positive('Amount must be positive'),
  paymentMode: z.enum(['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CHEQUE', 'OTHER']),
  referenceNumber: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export async function POST(req: NextRequest) {
  const { auth, error } = await requireAuth(req);
  if (error) return error;

  try {
    const body = await req.json();
    const parsed = PaymentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { customerId, saleId, amount, paymentMode, referenceNumber, notes } = parsed.data;

    const result = await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({ where: { id: customerId } });
      if (!customer) throw new Error('Customer not found');

      const payAmt = new Decimal(amount);
      if (payAmt.lte(0)) throw new Error('Amount must be positive');

      // If linked to a specific sale, validate outstanding amount
      let sale = null;
      if (saleId) {
        sale = await tx.sale.findUnique({ where: { id: saleId } });
        if (!sale) throw new Error('Sale not found');
        if (sale.pendingAmount.lt(payAmt)) {
          throw new Error(`Overpayment: outstanding is ₹${sale.pendingAmount}, you are paying ₹${payAmt}`);
        }
      }

      // Create payment record
      const receiptNumber = await generateReceiptNumber(tx);
      const payment = await tx.payment.create({
        data: {
          receiptNumber,
          customerId,
          saleId: saleId ?? null,
          amount: payAmt,
          paymentMode: paymentMode as "CASH" | "UPI" | "CARD" | "BANK_TRANSFER" | "CHEQUE" | "OTHER",
          referenceNumber: referenceNumber ?? null,
          notes: notes ?? null,
          receivedById: auth.userId,
        },
      });

      // Update sale paid/pending amounts
      if (sale) {
        const newPaid = sale.paidAmount.add(payAmt);
        const newPending = sale.pendingAmount.sub(payAmt);
        const newPaymentStatus = newPending.eq(0) ? 'PAID' : 'PARTIALLY_PAID';

        await tx.sale.update({
          where: { id: saleId! },
          data: {
            paidAmount: newPaid,
            pendingAmount: newPending,
            paymentStatus: newPaymentStatus as "PAID" | "PARTIALLY_PAID" | "UNPAID" | "OVERDUE",
          },
        });

        // Cancel pending reminders if fully paid
        if (newPending.eq(0)) {
          await tx.reminder.updateMany({
            where: { saleId: saleId!, status: 'PENDING' },
            data: { status: 'CANCELLED' },
          });
        }
      }

      // Update customer balance
      const newBalance = customer.currentBalance.sub(payAmt);
      const finalBalance = newBalance.lt(0) ? new Decimal(0) : newBalance;

      await tx.customer.update({
        where: { id: customerId },
        data: { currentBalance: finalBalance },
      });

      // Ledger entry
      await tx.creditLedger.create({
        data: {
          customerId,
          saleId: saleId ?? null,
          paymentId: payment.id,
          transactionType: 'PAYMENT_RECEIVED',
          amount: payAmt,
          balanceAfter: finalBalance,
          description: `Payment received — ${paymentMode}${referenceNumber ? ` (Ref: ${referenceNumber})` : ''}`,
        },
      });

      // Notification
      await tx.notification.create({
        data: {
          title: 'Payment Received',
          message: `₹${amount} received from ${customer.fullName} (${customer.customerCode})`,
          type: 'PAYMENT',
          relatedEntityType: 'Payment',
          relatedEntityId: payment.id,
        },
      });

      // Audit log
      await tx.auditLog.create({
        data: {
          userId: auth.userId,
          action: 'CREATE',
          entityType: 'Payment',
          entityId: payment.id,
          newData: { amount: amount.toString(), paymentMode, customerId, saleId },
        },
      });

      return { payment, newBalance: finalBalance };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err: unknown) {
    console.error('[POST /api/payments]', err);
    const msg = err instanceof Error ? err.message : 'Server error';
    const isClientError = ['not found', 'overpayment', 'must be positive'].some((s) => msg.toLowerCase().includes(s));
    return NextResponse.json({ error: msg }, { status: isClientError ? 400 : 500 });
  }
}
