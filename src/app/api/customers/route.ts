import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { normalizePhone, isValidIndianMobile } from '@/lib/utils';
import { generateCustomerCode } from '@/lib/counters';

const CreateCustomerSchema = z.object({
  fullName: z.string().min(2, 'Name must be at least 2 characters'),
  mobile: z.string().refine((v) => isValidIndianMobile(v), 'Invalid Indian mobile number'),
  alternateMobile: z.string().optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  pinCode: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  creditLimit: z.number().min(0).default(0),
  openingBalance: z.number().min(0).default(0),
});

export async function GET(req: NextRequest) {
  const { error } = await requireAuth(req);
  if (error) return error;

  const url = req.nextUrl;
  const search = url.searchParams.get('search') ?? '';
  const page = parseInt(url.searchParams.get('page') ?? '1');
  const limit = parseInt(url.searchParams.get('limit') ?? '50');
  const skip = (page - 1) * limit;

  const where = search
    ? {
        OR: [
          { fullName: { contains: search, mode: 'insensitive' as const } },
          { mobile: { contains: search } },
          { customerCode: { contains: search, mode: 'insensitive' as const } },
          { city: { contains: search, mode: 'insensitive' as const } },
        ],
      }
    : {};

  const [customers, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      select: {
        id: true,
        customerCode: true,
        fullName: true,
        mobile: true,
        alternateMobile: true,
        email: true,
        address: true,
        city: true,
        state: true,
        creditLimit: true,
        openingBalance: true,
        currentBalance: true,
        isActive: true,
        createdAt: true,
      },
    }),
    prisma.customer.count({ where }),
  ]);

  return NextResponse.json({ customers, total, page, pages: Math.ceil(total / limit) });
}

export async function POST(req: NextRequest) {
  const { auth, error } = await requireAuth(req);
  if (error) return error;

  try {
    const body = await req.json();
    const parsed = CreateCustomerSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const data = parsed.data;
    const normalizedMobile = normalizePhone(data.mobile);

    // Check for duplicate mobile
    const existing = await prisma.customer.findFirst({
      where: { OR: [{ normalizedMobile }, { mobile: data.mobile }] },
    });
    if (existing) {
      return NextResponse.json(
        { error: `A customer with mobile ${data.mobile} already exists (${existing.customerCode} — ${existing.fullName})` },
        { status: 409 }
      );
    }

    // Create customer inside a transaction with unique code generation
    const customer = await prisma.$transaction(async (tx) => {
      const customerCode = await generateCustomerCode(tx);

      const newCustomer = await tx.customer.create({
        data: {
          customerCode,
          fullName: data.fullName,
          mobile: data.mobile,
          normalizedMobile,
          alternateMobile: data.alternateMobile || null,
          email: data.email || null,
          address: data.address || null,
          city: data.city || null,
          state: data.state || null,
          pinCode: data.pinCode || null,
          notes: data.notes || null,
          creditLimit: data.creditLimit,
          openingBalance: data.openingBalance,
          currentBalance: data.openingBalance, // currentBalance starts at openingBalance
        },
      });

      // Create opening balance ledger if non-zero
      if (data.openingBalance > 0) {
        await tx.creditLedger.create({
          data: {
            customerId: newCustomer.id,
            transactionType: 'OPENING_BALANCE',
            amount: data.openingBalance,
            balanceAfter: data.openingBalance,
            description: 'Opening balance',
          },
        });
      }

      await tx.auditLog.create({
        data: {
          userId: auth.userId,
          action: 'CREATE',
          entityType: 'Customer',
          entityId: newCustomer.id,
          newData: { customerCode, fullName: data.fullName, mobile: data.mobile },
        },
      });

      return newCustomer;
    });

    return NextResponse.json({ customer }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/customers]', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
