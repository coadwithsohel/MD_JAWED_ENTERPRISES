import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const { error } = await requireAuth(req);
  if (error) return error;

  const brands = await prisma.brand.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
  });
  return NextResponse.json({ brands });
}

export async function POST(req: NextRequest) {
  const { error } = await requireAuth(req);
  if (error) return error;

  const body = await req.json();
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

  const existing = await prisma.brand.findUnique({ where: { name } });
  if (existing) return NextResponse.json({ error: 'Brand already exists' }, { status: 409 });

  const brand = await prisma.brand.create({ data: { name } });
  return NextResponse.json({ brand }, { status: 201 });
}
