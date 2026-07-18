import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { getOverdueData } from '@/lib/overdue';

export async function GET(req: NextRequest) {
  const { auth, error } = await requireAuth(req);
  if (error) return error;

  const url = req.nextUrl;
  const page = parseInt(url.searchParams.get('page') ?? '1');
  const limit = parseInt(url.searchParams.get('limit') ?? '50');
  const search = url.searchParams.get('search') ?? '';
  const customerId = url.searchParams.get('customerId') ?? undefined;

  try {
    const data = await getOverdueData({ page, limit, search: search || undefined, customerId });
    return NextResponse.json(data);
  } catch (err) {
    console.error('[GET /api/overdue]', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
