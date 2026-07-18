import { NextRequest, NextResponse } from 'next/server';
import { clearAuthCookie } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const res = NextResponse.json({ message: 'Logged out' });
  clearAuthCookie(res);
  return res;
}
