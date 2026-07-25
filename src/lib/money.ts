import { Prisma } from "@prisma/client";

/**
 * PHASE 3 — CANONICAL MONEY UNIT UTILITIES
 * Stores and calculates all financial values directly in Rupees using Prisma.Decimal.
 * 12500.00 means ₹12,500
 * 600.00 means ₹600
 * 2400.00 means ₹2,400
 */

/**
 * Parses raw input string/number into a canonical Prisma.Decimal rupee amount.
 * Throws an error on non-finite or invalid monetary values.
 */
export function parseRupeeAmount(raw: unknown): Prisma.Decimal {
  if (raw === null || raw === undefined || raw === "") {
    throw new Error("INVALID_MONEY_VALUE");
  }

  const cleaned = String(raw)
    .replace(/,/g, "")
    .replace(/[₹\s]/g, "");

  const value = Number(cleaned);

  if (!Number.isFinite(value)) {
    throw new Error("INVALID_MONEY_VALUE");
  }

  return new Prisma.Decimal(value);
}

/**
 * Parse a raw rupee value to Javascript number safely.
 */
export function parseRupeeNumber(raw: unknown): number {
  if (raw === null || raw === undefined || raw === "") return 0;
  const cleaned = String(raw)
    .replace(/,/g, "")
    .replace(/[₹\s]/g, "");

  const val = Number(cleaned);
  return Number.isFinite(val) ? val : 0;
}

/**
 * Formats rupee amount as ₹X,XX,XXX.XX (Indian locale).
 */
export function formatINR(value: unknown): string {
  const num = parseRupeeNumber(value);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

/** Alias for formatINR */
export const formatRupee = formatINR;

export function parseSignedAmount(value: unknown): number {
  return parseRupeeNumber(value);
}

export function parseSafeDecimal(
  raw: string,
  options: { allowNegative?: boolean; maxValue?: number } = {},
): number | null {
  const { allowNegative = false, maxValue = 9_99_99_999.99 } = options;
  if (!raw || raw.trim() === "" || raw.trim() === "-") return null;
  const val = parseRupeeNumber(raw);
  if (!allowNegative && val < 0) return null;
  if (val > maxValue) return null;
  return val;
}

export type CreditStatus =
  | "no_limit"
  | "available"
  | "near_limit"
  | "limit_reached"
  | "limit_exceeded";

export function getCreditStatus(
  creditLimit: number,
  outstanding: number,
): CreditStatus {
  if (creditLimit <= 0) return "no_limit";
  if (outstanding > creditLimit) return "limit_exceeded";
  if (outstanding === creditLimit) return "limit_reached";
  const usagePct = (outstanding / creditLimit) * 100;
  if (usagePct >= 80) return "near_limit";
  return "available";
}

export const CREDIT_STATUS_LABELS: Record<CreditStatus, string> = {
  no_limit: "No Limit",
  available: "Available",
  near_limit: "Near Limit",
  limit_reached: "Limit Reached",
  limit_exceeded: "Limit Exceeded",
};

export const CREDIT_STATUS_COLORS: Record<CreditStatus, string> = {
  no_limit: "bg-slate-100 text-slate-600 border-slate-200",
  available: "bg-emerald-50 text-emerald-700 border-emerald-200",
  near_limit: "bg-amber-50 text-amber-700 border-amber-200",
  limit_reached: "bg-orange-50 text-orange-700 border-orange-200",
  limit_exceeded: "bg-rose-50 text-rose-700 border-rose-200",
};
