/**
 * Decimal-safe money utilities.
 * All monetary values are handled in integer paise (1 rupee = 100 paise)
 * to avoid JavaScript floating-point precision errors.
 */

/** Convert any Decimal / string / number to integer paise. */
export function toPaise(value: unknown): number {
  if (value == null) return 0;
  const f = parseFloat(String(value));
  if (!isFinite(f)) return 0;
  return Math.round(f * 100);
}

/** Format integer paise as ₹1,23,456.00 (Indian locale). */
export function fromPaise(paise: number): string {
  const rupees = Math.abs(paise) / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rupees);
}

/** Format a raw rupee number / string as ₹X,XX,XXX.XX */
export function formatINR(value: unknown): string {
  return fromPaise(toPaise(value));
}

export function parseSignedAmount(value: unknown): number {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;

  const normalized = raw.replace(/[₹,]/g, "").trim();
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
    throw new Error("Invalid amount");
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    throw new Error("Invalid amount");
  }

  return parsed;
}

/**
 * Parse a monetary string safely.
 * Returns null if the value is invalid (NaN, Infinity, negative-disallowed, too large).
 */
export function parseSafeDecimal(
  raw: string,
  options: { allowNegative?: boolean; maxValue?: number } = {},
): number | null {
  const { allowNegative = false, maxValue = 9_99_99_999.99 } = options;

  const trimmed = raw.trim().replace(/,/g, "");
  if (trimmed === "" || trimmed === "-") return null;

  const val = parseFloat(trimmed);
  if (!isFinite(val) || isNaN(val)) return null;
  if (!allowNegative && val < 0) return null;
  if (val > maxValue) return null;

  return val;
}

/**
 * Determine credit status based on limit and outstanding.
 * Returns one of: 'no_limit' | 'available' | 'near_limit' | 'limit_reached' | 'limit_exceeded'
 */
export type CreditStatus =
  | "no_limit"
  | "available"
  | "near_limit"
  | "limit_reached"
  | "limit_exceeded";

export function getCreditStatus(
  creditLimitPaise: number,
  outstandingPaise: number,
): CreditStatus {
  if (creditLimitPaise <= 0) return "no_limit";
  if (outstandingPaise > creditLimitPaise) return "limit_exceeded";
  if (outstandingPaise === creditLimitPaise) return "limit_reached";
  const usagePct = (outstandingPaise / creditLimitPaise) * 100;
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
