import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { normalizePhone, isValidIndianMobile } from "@/lib/utils";
import { generateCustomerCode } from "@/lib/counters";
import { Prisma } from "@prisma/client";
import { toPaise } from "@/lib/money";

const CreateCustomerSchema = z.object({
  fullName: z.string().min(2, "Name must be at least 2 characters"),
  mobile: z
    .string()
    .refine((v) => isValidIndianMobile(v), "Invalid Indian mobile number"),
  alternateMobile: z.string().optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal("")),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  pinCode: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  creditLimit: z.number().finite().min(0).default(0),
  openingBalance: z.number().finite().default(0),
});

export async function GET(req: NextRequest) {
  const { error } = await requireAuth(req);
  if (error) return error;

  const url = req.nextUrl;
  const search = url.searchParams.get("search") ?? "";
  const page = parseInt(url.searchParams.get("page") ?? "1");
  const limit = parseInt(url.searchParams.get("limit") ?? "50");
  const skip = (page - 1) * limit;

  // Status filter: 'active' (default) | 'inactive' | 'all'
  const statusFilter = url.searchParams.get("status") ?? "active";

  // Credit status filter: 'exceeded' | 'near' | 'outstanding' | 'advance'
  const creditFilter = url.searchParams.get("creditStatus") ?? "";

  // Build base where clause
  const where: Prisma.CustomerWhereInput = {};

  // Status filtering
  if (statusFilter === "active") {
    where.isActive = true;
  } else if (statusFilter === "inactive") {
    where.isActive = false;
  }
  // 'all' = no filter on isActive

  // Credit status filtering
  if (creditFilter === "outstanding") {
    // currentBalance > 0 means customer owes us
    where.currentBalance = { gt: 0 };
  } else if (creditFilter === "advance") {
    // currentBalance < 0 means customer has advance/credit balance
    where.currentBalance = { lt: 0 };
  } else if (creditFilter === "exceeded") {
    // creditLimit > 0 AND currentBalance > creditLimit
    where.creditLimit = { gt: 0 };
    where.currentBalance = { gt: 0 };
    // Post-filter in JS since Prisma doesn't support field-to-field comparison directly
  } else if (creditFilter === "near") {
    where.creditLimit = { gt: 0 };
    where.currentBalance = { gt: 0 };
  }

  // Search
  if (search) {
    where.OR = [
      { fullName: { contains: search, mode: "insensitive" } },
      { mobile: { contains: search } },
      { customerCode: { contains: search, mode: "insensitive" } },
      { city: { contains: search, mode: "insensitive" } },
    ];
  }

  const [customers, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
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
        deletedAt: true,
        deleteReason: true,
        creditLimitUpdatedAt: true,
        createdAt: true,
        _count: {
          select: { sales: true, payments: true },
        },
      },
    }),
    prisma.customer.count({ where }),
  ]);

  // Post-filter for exceeded/near (field-to-field comparison not natively supported)
  let filteredCustomers = customers;
  if (creditFilter === "exceeded") {
    filteredCustomers = customers.filter((c) => {
      const limit = toPaise(c.creditLimit);
      const balance = toPaise(c.currentBalance);
      return limit > 0 && balance > limit;
    });
  } else if (creditFilter === "near") {
    filteredCustomers = customers.filter((c) => {
      const limitPaise = toPaise(c.creditLimit);
      const balance = toPaise(c.currentBalance);
      if (limitPaise <= 0 || balance <= 0) return false;
      const pct = (balance / limitPaise) * 100;
      return pct >= 80 && pct < 100;
    });
  }

  return NextResponse.json({
    customers: filteredCustomers,
    total:
      creditFilter === "exceeded" || creditFilter === "near"
        ? filteredCustomers.length
        : total,
    page,
    pages: Math.ceil(total / limit),
  });
}

export async function POST(req: NextRequest) {
  const { auth, error } = await requireAuth(req);
  if (error) return error;

  try {
    const body = await req.json();
    const parsed = CreateCustomerSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }

    const data = parsed.data;
    const normalizedMobile = normalizePhone(data.mobile);

    // Check for duplicate mobile
    const existing = await prisma.customer.findFirst({
      where: { OR: [{ normalizedMobile }, { mobile: data.mobile }] },
    });
    if (existing) {
      return NextResponse.json(
        {
          error: `A customer with mobile ${data.mobile} already exists (${existing.customerCode} — ${existing.fullName})`,
        },
        { status: 409 },
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

      await tx.auditLog.create({
        data: {
          userId: auth.userId,
          action: "CREATE",
          entityType: "Customer",
          entityId: newCustomer.id,
          newData: {
            customerCode,
            fullName: data.fullName,
            mobile: data.mobile,
          },
        },
      });

      return newCustomer;
    });

    return NextResponse.json({ customer }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/customers]", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
