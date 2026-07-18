import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const start = Date.now();
  let dbStatus = 'ok';
  let dbMs = 0;

  try {
    await prisma.$queryRaw`SELECT 1`;
    dbMs = Date.now() - start;
  } catch {
    dbStatus = 'error';
  }

  const status = dbStatus === 'ok' ? 200 : 503;

  return NextResponse.json(
    {
      status: dbStatus === 'ok' ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: { status: dbStatus, latencyMs: dbMs },
      version: process.env.npm_package_version ?? '0.1.0',
    },
    { status }
  );
}
