/**
 * POST /api/sales/[id]/void
 *
 * Voids a sale transaction.
 * The record is NOT deleted — it remains in the database and audit history.
 * Its CreditLedger contribution is set to zero so it no longer affects balances.
 * Uses Sale.updatedAt for optimistic concurrency.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/auth';
import { Decimal } from '@prisma/client/runtime/library';

const VoidSaleSchema = z.object({
  voidReason: z.string().trim().optional().nullable(),
  updatedAt: z.string(), // optimistic concurrency token
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
  const { id: saleId } = await params;

  try {
    const body = await req.json();
    const parsed = VoidSaleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 422 });
    }

    const { voidReason: rawReason, updatedAt: clientUpdatedAt, customerId } = parsed.data;
    const voidReason = rawReason || null;

    // Load canonical record
    const existing = await prisma.sale.findUnique({ where: { id: saleId } });
    if (!existing) {
      return NextResponse.json({ error: 'Sale not found' }, { status: 404 });
    }

    // Ownership check
    if (existing.customerId !== customerId) {
      return NextResponse.json({ error: 'Sale does not belong to this customer' }, { status: 403 });
    }

    // Already voided?
    if (existing.voidedAt != null) {
      return NextResponse.json({ error: 'This sale is already voided' }, { status: 409 });
    }

    // Concurrency check
    if (existing.updatedAt.toISOString() !== clientUpdatedAt) {
      return NextResponse.json(
        { error: 'TRANSACTION_CHANGED', message: 'Record was modified in another session. Reload and try again.' },
        { status: 409 },
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      // 1. Mark sale as CANCELLED + record void metadata
      const voidedSale = await tx.sale.update({
        where: { id: saleId },
        data: {
          status: 'CANCELLED',
          voidedAt: new Date(),
          voidReason,
        },
      });

      // 2. Zero-out the CreditLedger CREDIT_SALE entry for this sale
      //    This removes its contribution from all balance calculations
      //    Record count is UNCHANGED (updateMany, not create/delete)
      await tx.creditLedger.updateMany({
        where: { saleId, transactionType: 'CREDIT_SALE' },
        data: { amount: new Decimal(0) },
      });

      // 3. Cancel pending reminders for this sale
      await tx.reminder.updateMany({
        where: { saleId, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });

      // 4. Recalculate customer balance
      const newBalance = await recalcBalance(customerId, tx);

      // 5. Audit log
      await tx.auditLog.create({
        data: {
          userId: auth.userId,
          action: 'TRANSACTION_VOIDED',
          entityType: 'Sale',
          entityId: saleId,
          oldData: {
            status: existing.status,
            grandTotal: existing.grandTotal.toString(),
            pendingAmount: existing.pendingAmount.toString(),
            invoiceNumber: existing.invoiceNumber,
          } as object,
          newData: {
            status: 'CANCELLED',
            voidReason,
            voidedBy: auth.userId,
            newCustomerBalance: newBalance.toString(),
          } as object,
        },
      });

      return { voidedSale, newBalance };
    });

    return NextResponse.json({
      sale: result.voidedSale,
      message: 'Sale voided successfully. Record preserved in audit history.',
    });
  } catch (err) {
    console.error('[POST /api/sales/:id/void]', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
