import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';

const ProductSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  categoryId: z.string(),
  brandId: z.string().optional().nullable(),
  purchasePrice: z.number().min(0),
  sellingPrice: z.number().min(0),
  gstPercent: z.number().min(0).max(100).default(0),
  hsnCode: z.string().optional().nullable(),
  stockQuantity: z.number().int().min(0).default(0),
  lowStockThreshold: z.number().int().min(0).default(5),
  description: z.string().optional().nullable(),
  barcode: z.string().optional().nullable(),
});

export async function GET(req: NextRequest) {
  const { error } = await requireAuth(req);
  if (error) return error;

  const url = req.nextUrl;
  const search = url.searchParams.get('search') ?? '';
  const page = parseInt(url.searchParams.get('page') ?? '1');
  const limit = parseInt(url.searchParams.get('limit') ?? '50');
  const skip = (page - 1) * limit;
  const activeOnly = url.searchParams.get('active') !== 'false';

  const where = {
    ...(activeOnly ? { isActive: true } : {}),
    ...(search ? {
      OR: [
        { name: { contains: search, mode: 'insensitive' as const } },
        { sku: { contains: search, mode: 'insensitive' as const } },
        { barcode: { contains: search } },
      ],
    } : {}),
  };

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include: {
        category: { select: { id: true, name: true } },
        brand: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
      skip,
      take: limit,
    }),
    prisma.product.count({ where }),
  ]);

  return NextResponse.json({ products, total, page, pages: Math.ceil(total / limit) });
}

export async function POST(req: NextRequest) {
  const { auth, error } = await requireAuth(req);
  if (error) return error;

  try {
    const body = await req.json();
    const parsed = ProductSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const existing = await prisma.product.findUnique({ where: { sku: parsed.data.sku } });
    if (existing) {
      return NextResponse.json({ error: 'A product with this SKU already exists' }, { status: 409 });
    }

    const product = await prisma.$transaction(async (tx) => {
      const p = await tx.product.create({
        data: {
          sku: parsed.data.sku,
          name: parsed.data.name,
          categoryId: parsed.data.categoryId,
          brandId: parsed.data.brandId ?? null,
          purchasePrice: parsed.data.purchasePrice,
          sellingPrice: parsed.data.sellingPrice,
          gstPercent: parsed.data.gstPercent,
          hsnCode: parsed.data.hsnCode ?? null,
          stockQuantity: parsed.data.stockQuantity,
          lowStockThreshold: parsed.data.lowStockThreshold,
          description: parsed.data.description ?? null,
          barcode: parsed.data.barcode ?? null,
        },
      });

      if (p.stockQuantity > 0) {
        await tx.inventoryMovement.create({
          data: {
            productId: p.id,
            movementType: 'OPENING_STOCK',
            quantity: p.stockQuantity,
            quantityBefore: 0,
            quantityAfter: p.stockQuantity,
            createdById: auth.userId,
            reason: 'Initial stock',
          },
        });
      }

      return p;
    });

    return NextResponse.json({ product }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/products]', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
