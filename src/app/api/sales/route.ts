import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { Decimal } from "@prisma/client/runtime/library";
import { generateInvoiceNumber, generateReceiptNumber } from "@/lib/counters";
import { addDays, getISTNow } from "@/lib/overdue";

const SaleItemInput = z.object({
  productId: z.string(),
  quantity: z.number().int().positive(),
  unitPriceOverride: z.number().optional(), // only for authorized discounts
  discountAmount: z.number().min(0).default(0),
});

const CreateSaleSchema = z.object({
  customerId: z.string().optional().nullable(),
  saleType: z.enum(["CASH", "CREDIT", "PARTIAL"]),
  paidAmount: z.number().min(0).optional(),
  items: z.array(SaleItemInput).min(1, "At least one item is required"),
  notes: z.string().optional().nullable(),
  discountAmount: z.number().min(0).default(0),
  // Credit limit override — OWNER only
  overrideCreditLimit: z.boolean().optional().default(false),
  overrideReason: z.string().max(500).optional().nullable(),
});

export async function GET(req: NextRequest) {
  const { error } = await requireAuth(req);
  if (error) return error;

  const url = req.nextUrl;
  const page = parseInt(url.searchParams.get("page") ?? "1");
  const limit = parseInt(url.searchParams.get("limit") ?? "20");
  const search = url.searchParams.get("search") ?? "";
  const skip = (page - 1) * limit;

  const where = search
    ? {
        OR: [
          { invoiceNumber: { contains: search, mode: "insensitive" as const } },
          {
            customer: {
              fullName: { contains: search, mode: "insensitive" as const },
            },
          },
          { customer: { mobile: { contains: search } } },
        ],
      }
    : {};

  const [sales, total] = await Promise.all([
    prisma.sale.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        customer: {
          select: {
            id: true,
            customerCode: true,
            fullName: true,
            mobile: true,
          },
        },
        createdBy: { select: { fullName: true } },
        saleItems: {
          include: { product: { select: { id: true, name: true, sku: true } } },
        },
      },
    }),
    prisma.sale.count({ where }),
  ]);

  return NextResponse.json({
    sales,
    total,
    page,
    pages: Math.ceil(total / limit),
  });
}

export async function POST(req: NextRequest) {
  const { auth, error } = await requireAuth(req);
  if (error) return error;

  try {
    const body = await req.json();
    const parsed = CreateSaleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }

    const {
      customerId,
      saleType,
      items,
      notes,
      discountAmount,
      paidAmount: clientPaidAmount,
    } = parsed.data;

    // Validate inactive customer
    if (customerId) {
      const customerCheck = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { isActive: true, fullName: true },
      });
      if (customerCheck && !customerCheck.isActive) {
        return NextResponse.json(
          { error: `Customer ${customerCheck.fullName} is inactive. Reactivate the customer before creating a new invoice.` },
          { status: 409 },
        );
      }
    }

    const now = getISTNow();
    const invoiceNumber = await generateInvoiceNumber();

    let customer = null;
    if (saleType === "CREDIT" || saleType === "PARTIAL") {
      if (!customerId) {
        throw new Error("Customer is required for credit and partial sales");
      }
      customer = await prisma.customer.findUnique({
        where: { id: customerId },
      });
      if (!customer || !customer.isActive) {
        throw new Error("Customer not found or inactive");
      }
    } else if (customerId) {
      customer = await prisma.customer.findUnique({
        where: { id: customerId },
      });
    }

    const productIds = items.map((i) => i.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, isActive: true },
    });

    if (products.length !== productIds.length) {
      throw new Error("One or more products not found or inactive");
    }

    const productMap = new Map(products.map((p) => [p.id, p]));

    let subtotal = new Decimal(0);
    let totalGst = new Decimal(0);

    const saleItemsData = items.map((item) => {
      const product = productMap.get(item.productId)!;
      const unitPrice = product.sellingPrice;
      const lineSubtotal = unitPrice.mul(item.quantity);
      const itemDiscount = new Decimal(item.discountAmount);
      const gstPercent = product.gstPercent;
      const gstAmount = lineSubtotal.sub(itemDiscount).mul(gstPercent).div(100);
      const lineTotal = lineSubtotal.sub(itemDiscount).add(gstAmount);

      subtotal = subtotal.add(lineSubtotal);
      totalGst = totalGst.add(gstAmount);

      return {
        productId: item.productId,
        quantity: item.quantity,
        unitPrice,
        purchasePriceSnapshot: product.purchasePrice,
        discountAmount: itemDiscount,
        gstPercent,
        gstAmount,
        lineTotal,
      };
    });

    const saleDiscount = new Decimal(discountAmount);
    const grandTotal = subtotal.add(totalGst).sub(saleDiscount);

    let paidAmount: Decimal;
    let pendingAmount: Decimal;

    if (saleType === "CASH") {
      paidAmount = grandTotal;
      pendingAmount = new Decimal(0);
    } else if (saleType === "CREDIT") {
      paidAmount = new Decimal(0);
      pendingAmount = grandTotal;
    } else {
      paidAmount = new Decimal(
        Math.min(clientPaidAmount ?? 0, grandTotal.toNumber()),
      );
      pendingAmount = grandTotal.sub(paidAmount);
    }

    if (customer && pendingAmount.gt(0) && customer.creditLimit.gt(0)) {
      const newBalance = customer.currentBalance.add(pendingAmount);
      if (newBalance.gt(customer.creditLimit)) {
        const overrideCreditLimit = parsed.data.overrideCreditLimit ?? false;
        const overrideReason = parsed.data.overrideReason ?? null;
        const isOwner = auth.role === 'OWNER';

        if (!overrideCreditLimit || !isOwner) {
          // Return structured 409 so the UI can show a detailed error
          const availablePaise = Math.max(0, Math.round((customer.creditLimit.sub(customer.currentBalance)).toNumber() * 100));
          const exceededPaise = Math.round(newBalance.sub(customer.creditLimit).toNumber() * 100);
          const formatRs = (paise: number) =>
            new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(Math.abs(paise) / 100);
          return NextResponse.json(
            {
              error: 'Credit limit exceeded',
              creditLimitExceeded: true,
              details: {
                currentOutstanding: formatRs(Math.round(customer.currentBalance.toNumber() * 100)),
                creditLimit: formatRs(Math.round(customer.creditLimit.toNumber() * 100)),
                availableCredit: formatRs(availablePaise),
                invoiceCreditAmount: formatRs(Math.round(pendingAmount.toNumber() * 100)),
                exceededBy: formatRs(exceededPaise),
                canOverride: isOwner,
              },
            },
            { status: 409 },
          );
        }

        // OWNER override path — record in audit
        if (!overrideReason) {
          return NextResponse.json(
            { error: 'A reason is required to override the credit limit' },
            { status: 400 },
          );
        }

        // Audit the override (fire-and-forget, non-blocking)
        void prisma.auditLog
          .create({
            data: {
              userId: auth.userId,
              action: 'CREDIT_LIMIT_OVERRIDE',
              entityType: 'Customer',
              entityId: customer.id,
              oldData: {
                currentBalance: customer.currentBalance.toString(),
                creditLimit: customer.creditLimit.toString(),
              },
              newData: {
                pendingAmount: pendingAmount.toString(),
                projectedBalance: newBalance.toString(),
                overrideReason,
              },
            },
          })
          .catch((e) => console.error('[CREDIT_LIMIT_OVERRIDE audit]', e));
      }
    }

    const dueDate =
      saleType !== "CASH" && pendingAmount.gt(0) ? addDays(now, 15) : null;

    const paymentStatus: "PAID" | "UNPAID" | "PARTIALLY_PAID" =
      pendingAmount.eq(0)
        ? "PAID"
        : paidAmount.eq(0)
          ? "UNPAID"
          : "PARTIALLY_PAID";

    const sale = await prisma.$transaction(
      async (tx) => {
        const newSale = await tx.sale.create({
          data: {
            invoiceNumber,
            customerId: customer?.id ?? null,
            saleType,
            subtotal,
            discountAmount: saleDiscount,
            gstAmount: totalGst,
            grandTotal,
            paidAmount,
            pendingAmount,
            dueDate,
            paymentStatus,
            status: "COMPLETED",
            notes: notes ?? null,
            createdById: auth.userId,
            saleItems: { create: saleItemsData },
          },
          include: {
            saleItems: {
              include: { product: { select: { name: true, sku: true } } },
            },
            customer: {
              select: {
                id: true,
                customerCode: true,
                fullName: true,
                mobile: true,
              },
            },
          },
        });

        for (const item of items) {
          const product = productMap.get(item.productId)!;
          const qtyBefore = product.stockQuantity;
          const qtyAfter = qtyBefore - item.quantity;

          const updated = await tx.product.updateMany({
            where: {
              id: item.productId,
              stockQuantity: { gte: item.quantity },
            },
            data: { stockQuantity: { decrement: item.quantity } },
          });

          if (updated.count !== 1) {
            throw new Error(
              `Insufficient stock for ${product.name}. Available: ${product.stockQuantity}`,
            );
          }

          await tx.inventoryMovement.create({
            data: {
              productId: item.productId,
              saleId: newSale.id,
              movementType: "SALE",
              quantity: -item.quantity,
              quantityBefore: qtyBefore,
              quantityAfter: qtyAfter,
              createdById: auth.userId,
            },
          });
        }

        if (paidAmount.gt(0) && customer) {
          const receiptNumber = await generateReceiptNumber(tx);
          await tx.payment.create({
            data: {
              receiptNumber,
              customerId: customer.id,
              saleId: newSale.id,
              amount: paidAmount,
              paymentMode: saleType === "PARTIAL" ? "CASH" : "CASH",
              receivedById: auth.userId,
            },
          });
        }

        if (customer && pendingAmount.gt(0)) {
          const newBalance = customer.currentBalance.add(pendingAmount);

          await tx.creditLedger.create({
            data: {
              customerId: customer.id,
              saleId: newSale.id,
              transactionType: "CREDIT_SALE",
              amount: pendingAmount,
              balanceAfter: newBalance,
              description: `Credit sale — Invoice ${invoiceNumber}`,
            },
          });

          await tx.customer.update({
            where: { id: customer.id },
            data: { currentBalance: newBalance },
          });
        }

        return newSale;
      },
      {
        maxWait: 10_000,
        timeout: 30_000,
      },
    );

    void prisma.auditLog
      .create({
        data: {
          userId: auth.userId,
          action: "CREATE",
          entityType: "Sale",
          entityId: sale.id,
          newData: {
            invoiceNumber,
            saleType,
            grandTotal: grandTotal.toString(),
            paidAmount: paidAmount.toString(),
            pendingAmount: pendingAmount.toString(),
          },
        },
      })
      .catch((auditError) => {
        console.error("[POST /api/sales] audit log failed", auditError);
      });

    if (customer && pendingAmount.gt(0) && dueDate) {
      const reminderSchedules = [
        { type: "THREE_DAYS_BEFORE", daysOffset: -3 },
        { type: "ONE_DAY_BEFORE", daysOffset: -1 },
        { type: "DUE_TODAY", daysOffset: 0 },
        { type: "OVERDUE", daysOffset: 1 },
      ] as const;

      void Promise.all(
        reminderSchedules.map(async (sched) => {
          const scheduledAt = addDays(dueDate, sched.daysOffset);
          if (scheduledAt > now) {
            await prisma.reminder.upsert({
              where: {
                saleId_reminderType_channel: {
                  saleId: sale.id,
                  reminderType: sched.type,
                  channel: "IN_APP",
                },
              },
              create: {
                customerId: customer.id,
                saleId: sale.id,
                reminderType: sched.type,
                channel: "IN_APP",
                scheduledAt,
                message: `Payment reminder for invoice ${invoiceNumber} — Due: ₹${pendingAmount}`,
              },
              update: {},
            });
          }
        }),
      ).catch((reminderError) => {
        console.error(
          "[POST /api/sales] reminder creation failed",
          reminderError,
        );
      });
    }

    return NextResponse.json({ sale }, { status: 201 });
  } catch (err: unknown) {
    console.error("[POST /api/sales]", err);
    const msg = err instanceof Error ? err.message : "Server error";
    const isClientError = [
      "insufficient stock",
      "credit limit",
      "customer is required",
      "not found",
      "inactive",
      "at least one",
    ].some((s) => msg.toLowerCase().includes(s));
    return NextResponse.json(
      { error: msg },
      { status: isClientError ? 400 : 500 },
    );
  }
}
