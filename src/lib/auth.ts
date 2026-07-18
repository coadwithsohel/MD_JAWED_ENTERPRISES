import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";

function readAuthSecret(): string | null {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret || secret.length < 32) {
    return null;
  }
  return secret;
}

function requireAuthSecret(): string {
  const secret = readAuthSecret();
  if (!secret) {
    throw new Error("AUTH_SECRET is not configured or is too short.");
  }
  return secret;
}

export function isAuthSecretConfigured(): boolean {
  return readAuthSecret() !== null;
}

const COOKIE_NAME = "mdjaved_session";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export interface AuthPayload {
  userId: string;
  role: string;
  mobile: string;
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, requireAuthSecret(), { expiresIn: "7d" });
}

export function verifyToken(token: string): AuthPayload | null {
  const secret = readAuthSecret();
  if (!secret) {
    return null;
  }

  try {
    return jwt.verify(token, secret) as AuthPayload;
  } catch {
    return null;
  }
}

export function setAuthCookie(res: NextResponse, token: string) {
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });
}

export function clearAuthCookie(res: NextResponse) {
  res.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
}

export function getAuthFromRequest(req: NextRequest): AuthPayload | null {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyToken(token);
}

export async function requireAuth(
  req: NextRequest,
): Promise<
  { auth: AuthPayload; error: null } | { auth: null; error: NextResponse }
> {
  const auth = getAuthFromRequest(req);
  if (!auth) {
    return {
      auth: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { auth, error: null };
}

export async function requireRole(
  req: NextRequest,
  roles: string[],
): Promise<
  { auth: AuthPayload; error: null } | { auth: null; error: NextResponse }
> {
  const result = await requireAuth(req);
  if (result.error) return result;
  if (!roles.includes(result.auth.role)) {
    return {
      auth: null,
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return result;
}
