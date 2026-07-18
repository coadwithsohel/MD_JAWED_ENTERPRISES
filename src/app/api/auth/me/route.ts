import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const { auth, error } = await requireAuth(req);
  if (error) return error;

  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { id: true, fullName: true, mobile: true, email: true, role: true, isActive: true },
  });

  if (!user || !user.isActive) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  return NextResponse.json({ user });
}
