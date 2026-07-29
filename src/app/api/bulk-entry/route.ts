import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/auth';
import { Decimal } from '@prisma/client/runtime/library';
import { processCanonicalPayment } from '@/lib/payments';
import { processCanonicalAdjustment } from '@/lib/adjustments';
import { startOfDayIST } from '@/lib/accounting';
import { revalidatePath } from 'next/cache';

const RowSchema = z.object({
  customerId: z.string(),
  amount: z.number().positive('Amount must be positive'),
  entryType: z.enum(['PAYMENT', 'MANUAL_DEBIT', 'MANUAL_CREDIT']),
  paymentMode: z.enum(['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CHEQUE', 'OTHER']).optional(),
  referenceNumber: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const BulkEntrySchema = z.object({
  idempotencyKey: z.string().min(1),
  entryDate: z.string(), // ISO string YYYY-MM-DD
  batchType: z.enum(['PAYMENT', 'MANUAL_ADJUSTMENT']),
  defaultPaymentMode: z.enum(['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CHEQUE', 'OTHER']).optional().nullable(),
  notes: z.string().optional().nullable(),
  rows: z.array(RowSchema).min(1),
});

export async function POST(req: NextRequest) {
  const { auth, error } = await requireRole(req, ['OWNER', 'MANAGER']);
  if (error) return error;

  let reqIdempotencyKey: string | null = null;
  try {
    const body = await req.json();
    reqIdempotencyKey = body?.idempotencyKey || null;
    const parsed = BulkEntrySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, code: 'VALIDATION_ERROR', message: 'Invalid payload' }, { status: 422 });
    }

    const { idempotencyKey, entryDate: rawDate, batchType, defaultPaymentMode, notes, rows } = parsed.data;
    // Verify Prisma client configuration
    if (!prisma.bulkEntryBatch) {
      return NextResponse.json({
        success: false,
        code: "BULK_BATCH_CONFIGURATION_ERROR",
        message: "Bulk payment batch storage is not configured correctly."
      }, { status: 500 });
    }

    // Check idempotency first (outside transaction to fail fast)
    const existingBatch = await prisma.bulkEntryBatch.findUnique({
      where: { idempotencyKey },
    });
    if (existingBatch) {
      return NextResponse.json({ success: true, message: 'Already posted', batch: existingBatch });
    }

    const resolvedPaymentDate = startOfDayIST(new Date(`${rawDate.trim()}T00:00:00+05:30`));
    if (isNaN(resolvedPaymentDate.getTime())) {
      return NextResponse.json({ success: false, code: 'VALIDATION_ERROR', message: 'Invalid entry date' }, { status: 422 });
    }

    const totalAmount = rows.reduce((sum, row) => sum + row.amount, 0);

    const result = await prisma.$transaction(async (tx) => {
      // Create batch
      const batchReference = `BLK-${Date.now()}`;
      const batch = await tx.bulkEntryBatch.create({
        data: {
          batchReference,
          batchType,
          entryDate: resolvedPaymentDate,
          defaultPaymentMode: defaultPaymentMode || null,
          notes: notes ?? null,
          rowCount: rows.length,
          totalAmount: new Decimal(totalAmount),
          status: 'POSTED',
          idempotencyKey,
          createdById: auth.userId,
        },
      });

      // Loop through valid rows
      for (const [index, row] of rows.entries()) {
        try {
          if (row.entryType === 'PAYMENT') {
            await processCanonicalPayment(tx, {
              customerId: row.customerId,
              saleId: null, // Bulk payments apply via FIFO
              amount: new Decimal(row.amount),
              paymentMode: row.paymentMode || 'CASH',
              referenceNumber: row.referenceNumber ?? null,
              notes: row.notes ?? null,
              receivedById: auth.userId,
              resolvedPaymentDate,
              bulkBatchId: batch.id,
            });
          } else {
            await processCanonicalAdjustment(tx, {
              customerId: row.customerId,
              entryType: row.entryType === 'MANUAL_DEBIT' ? 'DEBIT' : 'CREDIT',
              amount: new Decimal(row.amount),
              transactionDate: resolvedPaymentDate,
              referenceNumber: row.referenceNumber ?? null,
              particulars: row.notes || 'Bulk Manual Adjustment',
              notes: row.notes ?? null,
              reason: null,
              createdById: auth.userId,
              bulkBatchId: batch.id,
            });
          }
        } catch (err: any) {
          throw new Error(`Row ${index + 1}: ${err.message}`);
        }
      }

      const auditAction = batchType === 'PAYMENT' 
        ? 'BULK_PAYMENT_BATCH_CREATED' 
        : 'BULK_MANUAL_ADJUSTMENT_BATCH_CREATED';

      await tx.auditLog.create({
        data: {
          userId: auth.userId,
          action: auditAction,
          entityType: 'BulkEntryBatch',
          entityId: batch.id,
          newData: {
            batchReference,
            batchType,
            rowCount: rows.length,
            totalAmount: totalAmount,
          },
        },
      });

      return batch;
    }, {
      maxWait: 5000,
      timeout: 20000,
    });

    revalidatePath('/dashboard');
    revalidatePath('/dashboard/customers');
    revalidatePath('/dashboard/credit');
    revalidatePath('/dashboard/overdue-customers');
    revalidatePath('/dashboard/bulk-entry/history');

    return NextResponse.json({ success: true, message: 'Batch posted successfully', batch: result });
  } catch (err: any) {
    console.error('[POST /api/bulk-entry]', err);
    
    // Handle transient connection errors securely
    const isConnectionError =
      err?.code === "P2010" ||
      err?.code === "P2024" ||
      err?.code === "P2028" ||
      err?.message?.includes("57P01") ||
      err?.message?.includes("terminating connection due to administrator command") ||
      err?.message?.includes("Connection pool is full");

    if (isConnectionError) {
      // It might have committed before the connection died. Check idempotency again.
      try {
        if (reqIdempotencyKey) {
           const existingBatch = await prisma.bulkEntryBatch.findUnique({
             where: { idempotencyKey: reqIdempotencyKey },
           });
           if (existingBatch) {
             return NextResponse.json({ success: true, message: 'Already posted (recovered)', batch: existingBatch });
           }
        }
      } catch (recoveryErr) {
        console.error('[POST /api/bulk-entry] Recovery check failed', recoveryErr);
      }
      return NextResponse.json({ success: false, code: 'SERVICE_UNAVAILABLE', message: 'Database is temporarily unavailable. Please retry.' }, { status: 503 });
    }

    const msg = err instanceof Error ? err.message : 'Server error';
    return NextResponse.json({ success: false, code: 'SERVER_ERROR', message: msg }, { status: 422 });
  }
}
