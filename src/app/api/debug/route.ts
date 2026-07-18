import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const cookies = req.cookies.getAll();
  const token = req.cookies.get('mdjaved_session')?.value;
  return NextResponse.json({
    cookies: cookies.map((c) => ({ name: c.name, valueLength: c.value.length })),
    hasSession: !!token,
    tokenPreview: token ? token.substring(0, 30) + '...' : null,
    authSecret: process.env.AUTH_SECRET ? 'SET' : 'NOT SET',
  });
}
