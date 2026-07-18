import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { Decimal } from '@prisma/client/runtime/library';
import { generateInvoiceNumber, generateReceiptNumber } from '@/lib/counters';
import { addDays, getISTNow } from '@/lib/overdue';

const SaleItemInput = z.object({
  productId: z.string(),
  quantity: z.number().int().positive(),
  unitPriceOverride: z.number().optional(), // only for authorized discounts
  discountAmount: z.number().min(0).default(0),
});

const CreateSaleSchema = z.object({
  customerId: z.string().optional().nullable(),
  saleType: z.enum(['CASH', 'CREDIT', 'PARTIAL']),
  paidAmount: z.number().min(0).optional(),
  items: z.array(SaleItemInput).min(1, 'At least one item is required'),
  notes: z.string().optional().nullable(),
  discountAmount: z.number().min(0).default(0),
});

export async function GET(req: NextRequest) {
  const { auth, error } = await requireAuth(req);
  if (error) return error;

  const url = req.nextUrl;
  const page = parseInt(url.searchParams.get('page') ?? '1');
  const limit = parseInt(url.searchParams.get('limit') ?? '20');
  const search = url.searchParams.get('search') ?? '';
  const skip = (page - 1) * limit;

  const where = search
    ? {
        OR: [
          { invoiceNumber: { contains: search, mode: 'insensitive' as const } },
          { customer: { fullName: { contains: search, mode: 'insensitive' as const } } },
          { customer: { mobile: { contains: search } } },
        ],
      }
    : {};

  const [sales, total] = await Promise.all([
    prisma.sale.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: {
        customer: { select: { id: true, customerCode: true, fullName: true, mobile: true } },
        createdBy: { select: { fullName: true } },
        saleItems: {
          include: { product: { select: { id: true, name: true, sku: true } } },
        },
      },
    }),
    prisma.sale.count({ where }),
  ]);

  return NextResponse.json({ sales, total, page, pages: Math.ceil(total / limit) });
}

export async function POST(req: NextRequest) {
  const { auth, error } = await requireAuth(req);
  if (error) return error;

  try {
    const body = await req.json();
    const parsed = CreateSaleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { customerId, saleType, items, notes, discountAmount, paidAmount: clientPaidAmount } = parsed.data;

    const sale = await prisma.$transaction(async (tx) => {
      // 1. Validate customer required for CREDIT/PARTIAL
      let customer = null;
      if (saleType === 'CREDIT' || saleType === 'PARTIAL') {
        if (!customerId) {
          throw new Error('Customer is required for credit and partial sales');
        }
        customer = await tx.customer.findUnique({ where: { id: customerId } });
        if (!customer || !customer.isActive) {
          throw new Error('Customer not found or inactive');
        }
      } else if (customerId) {
        customer = await tx.customer.findUnique({ where: { id: customerId } });
      }

      // 2. Load products from DB (never trust frontend prices)
      const productIds = items.map((i) => i.productId);
      const products = await tx.product.findMany({
        where: { id: { in: productIds }, isActive: true },
      });

      if (products.length !== productIds.length) {
        throw new Error('One or more products not found or inactive');
      }

      const productMap = new Map(products.map((p) => [p.id, p]));

      // 3. Verify stock
      for (const item of items) {
        const product = productMap.get(item.productId)!;
        if (product.stockQuantity < item.quantity) {
          throw new Error(`Insufficient stock for ${product.name}. Available: ${product.stockQuantity}`);
        }
      }

      // 4. Recalculate totals server-side
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

      // 5. Determine payment amounts
      let paidAmount: Decimal;
      let pendingAmount: Decimal;

      if (saleType === 'CASH') {
        paidAmount = grandTotal;
        pendingAmount = new Decimal(0);
      } else if (saleType === 'CREDIT') {
        paidAmount = new Decimal(0);
        pendingAmount = grandTotal;
      } else {
        // PARTIAL
        paidAmount = new Decimal(Math.min(clientPaidAmount ?? 0, grandTotal.toNumber()));
        pendingAmount = grandTotal.sub(paidAmount);
      }

      // 6. Check credit limit
      if (customer && pendingAmount.gt(0)) {
        const newBalance = customer.currentBalance.add(pendingAmount);
        if (customer.creditLimit.gt(0) && newBalance.gt(customer.creditLimit)) {
          throw new Error(
            `Credit limit exceeded. Limit: ₹${customer.creditLimit}, Current balance: ₹${customer.currentBalance}, New charge: ₹${pendingAmount}`
          );
        }
      }

      // 7. Generate unique invoice number
      const invoiceNumber = await generateInvoiceNumber(tx);

      // 8. Create sale
      const now = getISTNow();
      const dueDate = saleType !== 'CASH' && pendingAmount.gt(0) ? addDays(now, 15) : null;

      const paymentStatus =
        pendingAmount.eq(0) ? 'PAID' :
        paidAmount.eq(0) ? 'UNPAID' : 'PARTIALLY_PAID';

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
          paymentStatus: paymentStatus as any,
          status: 'COMPLETED',
          notes: notes ?? null,
          createdById: auth.userId,
          saleItems: { create: saleItemsData },
        },
        include: {
          saleItems: { include: { product: { select: { name: true, sku: true } } } },
          customer: { select: { id: true, customerCode: true, fullName: true, mobile: true } },
        },
      });

      // 9. Deduct stock + create inventory movements
      for (const item of items) {
        const product = productMap.get(item.productId)!;
        const qtyBefore = product.stockQuantity;
        const qtyAfter = qtyBefore - item.quantity;

        await tx.product.update({
          where: { id: item.productId },
          data: { stockQuantity: { decrement: item.quantity } },
        });

        await tx.inventoryMovement.create({
          data: {
            productId: item.productId,
            saleId: newSale.id,
            movementType: 'SALE',
            quantity: -item.quantity,
            quantityBefore: qtyBefore,
            quantityAfter: qtyAfter,
            createdById: auth.userId,
          },
        });
      }

      // 10. Create payment record for cash or partial
      if (paidAmount.gt(0)) {
        const receiptNumber = await generateReceiptNumber(tx);
        await tx.payment.create({
          data: {
            receiptNumber,
            customerId: customer!.id,
            saleId: newSale.id,
            amount: paidAmount,
            paymentMode: 'CASH',
            receivedById: auth.userId,
          },
        });
      }

      // 11. Update credit ledger and customer balance for credit portion
      if (customer && pendingAmount.gt(0)) {
        const newBalance = customer.currentBalance.add(pendingAmount);

        await tx.creditLedger.create({
          data: {
            customerId: customer.id,
            saleId: newSale.id,
            transactionType: 'CREDIT_SALE',
            amount: pendingAmount,
            balanceAfter: newBalance,
            description: `Credit sale — Invoice ${invoiceNumber}`,
          },
        });

        await tx.customer.update({
          where: { id: customer.id },
          data: { currentBalance: newBalance },
        });

        // 12. Create 15-day reminders for credit sales
        if (dueDate) {
          const reminderSchedules = [
            { type: 'THREE_DAYS_BEFORE', daysOffset: -3 },
            { type: 'ONE_DAY_BEFORE', daysOffset: -1 },
            { type: 'DUE_TODAY', daysOffset: 0 },
            { type: 'OVERDUE', daysOffset: 1 },
          ] as const;

          for (const sched of reminderSchedules) {
            const scheduledAt = addDays(dueDate, sched.daysOffset);
            if (scheduledAt > now) {
              await tx.reminder.upsert({
                where: {
                  saleId_reminderType_channel: {
                    saleId: newSale.id,
                    reminderType: sched.type,
                    channel: 'IN_APP',
                  },
                },
                create: {
                  customerId: customer.id,
                  saleId: newSale.id,
                  reminderType: sched.type,
                  channel: 'IN_APP',
                  scheduledAt,
                  message: `Payment reminder for invoice ${invoiceNumber} — Due: ₹${pendingAmount}`,
                },
                update: {},
              });
            }
          }
        }
      }

      // 13. Audit log
      await tx.auditLog.create({
        data: {
          userId: auth.userId,
          action: 'CREATE',
          entityType: 'Sale',
          entityId: newSale.id,
          newData: {
            invoiceNumber,
            saleType,
            grandTotal: grandTotal.toString(),
            paidAmount: paidAmount.toString(),
            pendingAmount: pendingAmount.toString(),
          },
        },
      });

      return newSale;
    });

    return NextResponse.json({ sale }, { status: 201 });
  } catch (err: any) {
    console.error('[POST /api/sales]', err);
    const msg = err.message || 'Server error';
    const isClientError = [
      'insufficient stock', 'credit limit', 'customer is required',
      'not found', 'inactive', 'at least one'
    ].some((s) => msg.toLowerCase().includes(s));
    return NextResponse.json({ error: msg }, { status: isClientError ? 400 : 500 });
  }
}
