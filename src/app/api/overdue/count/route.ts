import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getOverdueCount } from '@/lib/overdue';

export async function GET(req: NextRequest) {
  const { error } = await requireAuth(req);
  if (error) return error;

  const count = await getOverdueCount();
  return NextResponse.json({ count });
}
