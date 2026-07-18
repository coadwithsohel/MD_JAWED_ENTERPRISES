import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { prisma } from './prisma';

// Validate AUTH_SECRET at startup — fail fast in production
const JWT_SECRET = process.env.AUTH_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('FATAL: AUTH_SECRET environment variable is not set or too short (min 32 chars). Server cannot start.');
  }
  console.warn('[auth] WARNING: AUTH_SECRET is not set. Using insecure fallback. Set AUTH_SECRET in production!');
}
const SECRET = JWT_SECRET || 'mdjaved-dev-secret-DO-NOT-USE-IN-PRODUCTION-min32chars';

const COOKIE_NAME = 'mdjaved_session';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export interface AuthPayload {
  userId: string;
  role: string;
  mobile: string;
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: '7d' });
}

export function verifyToken(token: string): AuthPayload | null {
  try {
    return jwt.verify(token, SECRET) as AuthPayload;
  } catch {
    return null;
  }
}

export function setAuthCookie(res: NextResponse, token: string) {
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  });
}

export function clearAuthCookie(res: NextResponse) {
  res.cookies.set(COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });
}

export function getAuthFromRequest(req: NextRequest): AuthPayload | null {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyToken(token);
}

export async function requireAuth(
  req: NextRequest
): Promise<{ auth: AuthPayload; error: null } | { auth: null; error: NextResponse }> {
  const auth = getAuthFromRequest(req);
  if (!auth) {
    return {
      auth: null,
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }
  return { auth, error: null };
}

export async function requireRole(
  req: NextRequest,
  roles: string[]
): Promise<{ auth: AuthPayload; error: null } | { auth: null; error: NextResponse }> {
  const result = await requireAuth(req);
  if (result.error) return result;
  if (!roles.includes(result.auth.role)) {
    return {
      auth: null,
      error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }
  return result;
}
