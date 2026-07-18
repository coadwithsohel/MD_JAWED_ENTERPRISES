import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import * as argon2 from 'argon2';
import { prisma } from '@/lib/prisma';
import { signToken, setAuthCookie } from '@/lib/auth';

// Simple in-memory rate limiter — 5 attempts per IP per 15 minutes
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 15 * 60 * 1000;

function getRateLimitKey(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0].trim() : '127.0.0.1';
  return `login:${ip}`;
}

function checkRateLimit(key: string): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const entry = loginAttempts.get(key);

  if (!entry || entry.resetAt < now) {
    loginAttempts.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return { allowed: true, remaining: RATE_LIMIT - 1, resetAt: now + RATE_WINDOW_MS };
  }

  if (entry.count >= RATE_LIMIT) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count++;
  return { allowed: true, remaining: RATE_LIMIT - entry.count, resetAt: entry.resetAt };
}

function clearRateLimit(key: string) {
  loginAttempts.delete(key);
}

const LoginSchema = z.object({
  mobile: z.string().min(10),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    // Rate limiting
    const rateLimitKey = getRateLimitKey(req);
    const rateLimit = checkRateLimit(rateLimitKey);

    if (!rateLimit.allowed) {
      const retryAfterSec = Math.ceil((rateLimit.resetAt - Date.now()) / 1000);
      return NextResponse.json(
        { error: 'Too many login attempts. Please try again later.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(retryAfterSec),
            'X-RateLimit-Remaining': '0',
          },
        }
      );
    }

    const body = await req.json();
    const parsed = LoginSchema.safeParse(body);
    if (!parsed.success) {
      // Generic error — don't reveal format details
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 400 });
    }

    const { mobile, password } = parsed.data;

    const user = await prisma.user.findUnique({ where: { mobile } });

    // Always run argon2 verify to prevent timing attacks
    const dummyHash = '$argon2id$v=19$m=65536,t=3,p=4$dummy$dummy';
    const valid = user ? await argon2.verify(user.passwordHash, password) : await argon2.verify(dummyHash, 'dummy').catch(() => false);

    if (!user || !user.isActive || !valid) {
      return NextResponse.json({ error: 'Invalid mobile number or password' }, { status: 401 });
    }

    // Clear rate limit on success
    clearRateLimit(rateLimitKey);

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const token = signToken({ userId: user.id, role: user.role, mobile: user.mobile });

    const res = NextResponse.json({
      user: {
        id: user.id,
        fullName: user.fullName,
        mobile: user.mobile,
        email: user.email,
        role: user.role,
      },
    });

    setAuthCookie(res, token);
    return res;
  } catch (err) {
    console.error('[POST /api/auth/login]', err instanceof Error ? err.message : 'Unknown error');
    return NextResponse.json({ error: 'Authentication failed' }, { status: 500 });
  }
}
