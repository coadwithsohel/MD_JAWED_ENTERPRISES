import { Decimal } from "@prisma/client/runtime/library";
import { generateReceiptNumber } from "@/lib/counters";
import { rebuildCustomerPaymentAllocations } from "@/lib/payment-allocation";

import { Prisma } from "@prisma/client";

type PrismaTx = Prisma.TransactionClient;

export async function processCanonicalPayment(
  tx: PrismaTx,
  data: {
    customerId: string;
    saleId: string | null;
    amount: Decimal;
    paymentMode: 'CASH' | 'UPI' | 'CARD' | 'BANK_TRANSFER' | 'CHEQUE' | 'OTHER';
    referenceNumber: string | null;
    notes: string | null;
    receivedById: string;
    resolvedPaymentDate: Date;
    bulkBatchId?: string | null;
  }
) {
  const {
    customerId,
    saleId,
    amount,
    paymentMode,
    referenceNumber,
    notes,
    receivedById,
    resolvedPaymentDate,
    bulkBatchId,
  } = data;

  const customer = await tx.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw new Error('Customer not found');

  if (amount.lte(0)) throw new Error('Amount must be positive');

  let sale = null;
  if (saleId) {
    sale = await tx.sale.findUnique({ where: { id: saleId } });
    if (!sale) throw new Error('Sale not found');
    if (sale.pendingAmount.lt(amount)) {
      throw new Error(`Overpayment: outstanding is ₹${sale.pendingAmount}, you are paying ₹${amount}`);
    }
  }

  const receiptNumber = await generateReceiptNumber();
  const payment = await tx.payment.create({
    data: {
      receiptNumber,
      customerId,
      saleId,
      amount,
      paymentMode,
      referenceNumber,
      notes,
      receivedById,
      paymentDate: resolvedPaymentDate,
      bulkBatchId: bulkBatchId ?? null,
    },
  });

  if (saleId) {
    const newPaid = sale!.paidAmount.add(amount);
    const newPending = sale!.pendingAmount.sub(amount);
    const newPaymentStatus = newPending.eq(0) ? 'PAID' : 'PARTIALLY_PAID';

    await tx.sale.update({
      where: { id: saleId },
      data: {
        paidAmount: newPaid,
        pendingAmount: newPending,
        paymentStatus: newPaymentStatus,
      },
    });

    if (newPending.eq(0)) {
      await tx.reminder.updateMany({
        where: { saleId: saleId, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });
    }
  } else {
    await rebuildCustomerPaymentAllocations(customerId, tx);
  }

  const newBalance = customer.currentBalance.sub(amount);
  await tx.customer.update({
    where: { id: customerId },
    data: { currentBalance: newBalance },
  });

  await tx.creditLedger.create({
    data: {
      customerId,
      saleId,
      paymentId: payment.id,
      transactionType: 'PAYMENT_RECEIVED',
      amount,
      balanceAfter: newBalance,
      description: `Payment received — ${paymentMode}${referenceNumber ? ` (Ref: ${referenceNumber})` : ''}`,
      accountingDate: resolvedPaymentDate,
    },
  });

  await tx.notification.create({
    data: {
      title: 'Payment Received',
      message: `₹${amount.toString()} received from ${customer.fullName} (${customer.customerCode})`,
      type: 'PAYMENT',
      relatedEntityType: 'Payment',
      relatedEntityId: payment.id,
    },
  });

  await tx.auditLog.create({
    data: {
      userId: receivedById,
      action: bulkBatchId ? 'BULK_PAYMENT_CREATED' : 'CREATE',
      entityType: 'Payment',
      entityId: payment.id,
      newData: { amount: amount.toString(), paymentMode, customerId, saleId, paymentDate: resolvedPaymentDate.toISOString(), bulkBatchId },
    },
  });

  return { payment, newBalance };
}
