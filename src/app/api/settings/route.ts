import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const { auth, error } = await requireAuth(req);
  if (error) return error;

  const settings = await prisma.shopSettings.findFirst();
  return NextResponse.json({ settings });
}

export async function POST(req: NextRequest) {
  const { auth, error } = await requireAuth(req);
  if (error) return error;

  if (auth.role !== 'OWNER' && auth.role !== 'MANAGER') {
    return NextResponse.json({ error: 'Only owners can update settings' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const existing = await prisma.shopSettings.findFirst();

    let settings;
    if (existing) {
      settings = await prisma.shopSettings.update({ where: { id: existing.id }, data: body });
    } else {
      settings = await prisma.shopSettings.create({ data: body });
    }

    return NextResponse.json({ settings });
  } catch (err) {
    console.error('[POST /api/settings]', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
