/**
 * PATCH /api/sales/[id]/edit
 *
 * Duplicate-safe sale edit endpoint.
 * NEVER creates a new Sale, CreditLedger, or Payment record.
 * Updates only the existing canonical Sale record and its linked CreditLedger row.
 * Uses Sale.updatedAt for optimistic concurrency.
 * Returns 409 TRANSACTION_CHANGED if the record was modified after the form opened.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/auth';
import { Decimal } from '@prisma/client/runtime/library';

// ─── Validation schema ─────────────────────────────────────────────────────────

const EditSaleSchema = z.object({
  // Editable fields only — immutable fields are never sent from frontend
  saleDate: z.string().optional().nullable(),        // User-visible invoice date (stored as Sale.saleDate)
  notes: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  debitAmount: z.number().positive('Amount must be positive').optional(),
  // Required
  editReason: z.string().trim().optional().nullable(),
  // Optimistic concurrency — ISO string from sale.updatedAt
  updatedAt: z.string(),
  // Customer context for ownership verification
  customerId: z.string(),
});

// ─── Inline balance recalculation (uses tx client) ────────────────────────────

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
  const { id: saleId } = await params;

  try {
    const body = await req.json();
    const parsed = EditSaleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 422 },
      );
    }

    const {
      saleDate: newSaleDate,
      notes: newNotes,
      dueDate: newDueDate,
      debitAmount: newDebitAmount,
      editReason: rawReason,
      updatedAt: clientUpdatedAt,
      customerId,
    } = parsed.data;

    const editReason = rawReason || null;

    // 1. Load existing canonical record
    const existing = await prisma.sale.findUnique({
      where: { id: saleId },
      include: {
        ledgers: {
          where: { transactionType: 'CREDIT_SALE' },
          select: { id: true, amount: true },
        },
      },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Sale not found' }, { status: 404 });
    }

    // 2. Verify ownership — sale must belong to the stated customer
    if (existing.customerId !== customerId) {
      return NextResponse.json(
        { error: 'Sale does not belong to this customer' },
        { status: 403 },
      );
    }

    // 3. Confirm transaction type (must be CREDIT or PARTIAL — not CASH)
    if (existing.saleType === 'CASH') {
      return NextResponse.json(
        { error: 'Cash sales cannot be edited through this route' },
        { status: 422 },
      );
    }

    // 4. Confirm not already voided
    if (existing.status === 'CANCELLED' && existing.voidedAt != null) {
      return NextResponse.json(
        { error: 'Voided transactions cannot be edited. Restore first.' },
        { status: 422 },
      );
    }

    // 5. Optimistic concurrency check
    const serverUpdatedAt = existing.updatedAt.toISOString();
    if (serverUpdatedAt !== clientUpdatedAt) {
      return NextResponse.json(
        {
          error: 'TRANSACTION_CHANGED',
          message: 'This transaction was modified by another session. Please reload and try again.',
        },
        { status: 409 },
      );
    }

    // 6. Validate new amount (cannot be less than paidAmount)
    if (newDebitAmount !== undefined) {
      const paidAmount = existing.paidAmount;
      if (new Decimal(newDebitAmount).lt(paidAmount)) {
        return NextResponse.json(
          {
            error: `New amount (₹${newDebitAmount}) cannot be less than already-paid amount (₹${paidAmount}). Reverse the payment first.`,
          },
          { status: 422 },
        );
      }
    }

    // 7. Compute derived fields when amount changes
    const amountChanged = newDebitAmount !== undefined && !new Decimal(newDebitAmount).equals(existing.grandTotal);
    const oldDebitAmount = existing.grandTotal;

    const saleUpdateData: Record<string, unknown> = {};
    if (newSaleDate !== undefined) saleUpdateData.saleDate = newSaleDate ? new Date(newSaleDate) : null;
    if (newNotes !== undefined) saleUpdateData.notes = newNotes;
    if (newDueDate !== undefined) saleUpdateData.dueDate = newDueDate ? new Date(newDueDate) : null;

    if (amountChanged && newDebitAmount !== undefined) {
      const newDecimal = new Decimal(newDebitAmount);
      const newPendingAmount = newDecimal.sub(existing.paidAmount);
      const newPaymentStatus = newPendingAmount.lte(0)
        ? 'PAID'
        : existing.paidAmount.gt(0)
          ? 'PARTIALLY_PAID'
          : 'UNPAID';

      saleUpdateData.grandTotal = newDecimal;
      saleUpdateData.subtotal = newDecimal; // simplified: keep subtotal = grandTotal for imported/ledger sales
      saleUpdateData.pendingAmount = newPendingAmount;
      saleUpdateData.paymentStatus = newPaymentStatus;
    }

    // 8. Execute as atomic transaction
    const result = await prisma.$transaction(async (tx) => {
      // 8a. Update the canonical Sale record (ONE update call, never create)
      const updatedSale = await tx.sale.update({
        where: { id: saleId },
        data: saleUpdateData,
      });

      // 8b. If amount changed: update linked CreditLedger row(s) for this sale
      //     Only updates CREDIT_SALE type — never creates a new row
      if (amountChanged && newDebitAmount !== undefined) {
        await tx.creditLedger.updateMany({
          where: { saleId, transactionType: 'CREDIT_SALE' },
          data: { amount: new Decimal(newDebitAmount) },
        });
      }

      // 8c. Recalculate customer balance from canonical CreditLedger source
      const newBalance = await recalcBalance(customerId, tx);

      // 8d. Audit log — preserves all previous values
      await tx.auditLog.create({
        data: {
          userId: auth.userId,
          action: 'SALE_UPDATED',
          entityType: 'Sale',
          entityId: saleId,
          oldData: {
            saleDate: existing.saleDate?.toISOString() ?? existing.createdAt.toISOString(),
            notes: existing.notes,
            dueDate: existing.dueDate?.toISOString(),
            grandTotal: existing.grandTotal.toString(),
            pendingAmount: existing.pendingAmount.toString(),
          } as object,
          newData: {
            ...saleUpdateData,
            debitAmount: newDebitAmount,
            editReason,
            editedBy: auth.userId,
          } as object,
        },
      });

      return { updatedSale, newBalance };
    });

    return NextResponse.json({
      sale: result.updatedSale,
      previousAmount: oldDebitAmount.toString(),
      newAmount: newDebitAmount?.toString() ?? oldDebitAmount.toString(),
    });
  } catch (err) {
    console.error('[PATCH /api/sales/:id/edit]', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
