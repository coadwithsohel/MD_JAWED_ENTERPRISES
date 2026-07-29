import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { Decimal } from '@prisma/client/runtime/library';
import { generateReceiptNumber } from '@/lib/counters';
import { startOfDayIST } from '@/lib/accounting';
import { revalidatePath } from 'next/cache';
import { processCanonicalPayment } from '@/lib/payments';

const PaymentSchema = z.object({
  customerId: z.string(),
  saleId: z.string().optional().nullable(),
  amount: z.number().positive('Amount must be positive'),
  paymentMode: z.enum(['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CHEQUE', 'OTHER']),
  referenceNumber: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  // ISO date string YYYY-MM-DD or full ISO datetime. Defaults to today.
  paymentDate: z.string().optional().nullable(),
});

/** Parse a YYYY-MM-DD or full ISO datetime string to a UTC Date representing the start of that IST day. */
function parsePaymentDate(raw: string | null | undefined): Date {
  if (!raw) return startOfDayIST(new Date());
  // Try full ISO first
  const d = new Date(raw);
  if (!isNaN(d.getTime())) {
    // If it looks like a date-only string (YYYY-MM-DD), interpret as IST start of day
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) {
      // Build a date in IST: YYYY-MM-DDT00:00:00+05:30
      const istDate = new Date(`${raw.trim()}T00:00:00+05:30`);
      return isNaN(istDate.getTime()) ? startOfDayIST(new Date()) : istDate;
    }
    return d;
  }
  return startOfDayIST(new Date());
}

export async function POST(req: NextRequest) {
  const { auth, error } = await requireAuth(req);
  if (error) return error;

  try {
    const body = await req.json();
    const parsed = PaymentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { customerId, saleId, amount, paymentMode, referenceNumber, notes, paymentDate: rawDate } = parsed.data;

    // Resolve the accounting date — use user-selected date, not createdAt
    const resolvedPaymentDate = parsePaymentDate(rawDate);

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

      const { payment, newBalance } = await processCanonicalPayment(tx, {
        customerId,
        saleId: saleId ?? null,
        amount: payAmt,
        paymentMode: paymentMode as any,
        referenceNumber: referenceNumber ?? null,
        notes: notes ?? null,
        receivedById: auth.userId,
        resolvedPaymentDate,
      });

      return { payment, newBalance };
    });

    revalidatePath('/dashboard');
    revalidatePath('/dashboard/customers');
    revalidatePath('/dashboard/credit');
    revalidatePath('/dashboard/overdue-customers');
    revalidatePath(`/dashboard/customers/${customerId}`);

    return NextResponse.json(result, { status: 201 });
  } catch (err: unknown) {
    console.error('[POST /api/payments]', err);
    const msg = err instanceof Error ? err.message : 'Server error';
    const isClientError = ['not found', 'overpayment', 'must be positive'].some((s) => msg.toLowerCase().includes(s));
    return NextResponse.json({ error: msg }, { status: isClientError ? 400 : 500 });
  }
}
