// ─── Strict Signed Amount Parser ───────────────────────────────────────────
// Does NOT use replace(/[^0-9.]/g, "") which removes negative signs.

import { ValidationError } from "./errors";

export interface AmountParseResult {
  isValid: boolean;
  value: number | null;
  error?: string;
}

/**
 * Parse a signed monetary amount string.
 *
 * Accounting convention:
 *   positive value = debit / customer owes business
 *   negative value = credit / customer advance
 *
 * Supported formats:
 *   1000
 *   1,000
 *   ₹1,000
 *   -500
 *   500 Cr
 *   500 cr
 *   500 Dr
 *   500 dr
 *   (500)  → -500
 *   ₹-500
 *   -₹500
 *
 * Credit Limit: finite, >= 0
 * Opening Balance: finite, positive, zero, or negative
 *
 * Rejects invalid amounts instead of converting them to zero.
 */
export function parseSignedAmount(value: string | null | undefined): AmountParseResult {
  if (!value || value.trim().length === 0) {
    return { isValid: false, value: null, error: "Amount is empty" };
  }

  const trimmed = value.trim();

  // Handle parenthetical notation: (500) = -500
  const parenMatch = trimmed.match(/^\(([^)]+)\)$/);
  if (parenMatch) {
    return parseSignedAmount(`-${parenMatch[1]}`);
  }

  // Handle Dr/Cr suffix
  let workingValue = trimmed;
  let signMultiplier = 1;

  const drMatch = workingValue.match(/^(.+?)\s+(Dr|dr|DR|DEBIT|Debit|debit)$/);
  const crMatch = workingValue.match(/^(.+?)\s+(Cr|cr|CR|CREDIT|Credit|credit)$/);

  if (drMatch) {
    workingValue = drMatch[1].trim();
    signMultiplier = 1; // Dr = positive (debit)
  } else if (crMatch) {
    workingValue = crMatch[1].trim();
    signMultiplier = -1; // Cr = negative (credit)
  }

  // Remove currency symbols and commas. Preserve decimal point.
  let cleaned = workingValue
    .replace(/[₹Rs,\s]/g, "")  // removed '.' from the character class
    .trim();

  // Handle negative sign
  let isNegative = false;
  if (cleaned.startsWith("-")) {
    isNegative = true;
    cleaned = cleaned.slice(1);
  }

  // Validate remaining characters
  if (!/^\d+(\.\d+)?$/.test(cleaned)) {
    return {
      isValid: false,
      value: null,
      error: `"${trimmed}" is not a valid amount`,
    };
  }

  const parsed = parseFloat(cleaned);
  if (!Number.isFinite(parsed)) {
    return {
      isValid: false,
      value: null,
      error: `"${trimmed}" is not a finite number`,
    };
  }

  const finalValue = (isNegative ? -parsed : parsed) * signMultiplier;
  return { isValid: true, value: finalValue };
}

/**
 * Parse a signed amount and throw on failure.
 */
export function requireAmount(value: string | null | undefined, fieldName: string): number {
  const result = parseSignedAmount(value);
  if (!result.isValid || result.value === null) {
    throw new ValidationError(`${fieldName}: ${result.error || "Invalid amount"}`);
  }
  return result.value;
}

/**
 * Parse an optional amount. Returns null for empty/missing, throws on invalid.
 */
export function optionalAmount(value: string | null | undefined): number | null {
  if (!value || value.trim().length === 0) return null;
  const result = parseSignedAmount(value);
  if (!result.isValid || result.value === null) {
    throw new ValidationError(result.error || "Invalid amount");
  }
  return result.value;
}

/**
 * Parse a credit limit (must be >= 0).
 */
export function parseCreditLimit(value: string | null | undefined): AmountParseResult {
  const result = parseSignedAmount(value);
  if (result.isValid && result.value !== null && result.value < 0) {
    return { isValid: false, value: null, error: "Credit limit cannot be negative" };
  }
  return result;
}

/**
 * Normalize phone number for Indian mobile numbers.
 * Preserves as string, does NOT convert to number.
 */
export function normalizeMobile(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let cleaned = phone.replace(/[\s\-\.\(\)]/g, "");
  if (cleaned.startsWith("+91")) cleaned = cleaned.slice(3);
  if (cleaned.startsWith("91") && cleaned.length > 10) cleaned = cleaned.slice(2);
  if (cleaned.startsWith("0")) cleaned = cleaned.slice(1);
  return cleaned || null;
}

/**
 * Validate Indian mobile number (10 digits, starts with 6-9).
 */
export function isValidIndianMobile(phone: string | null | undefined): boolean {
  const normalized = normalizeMobile(phone);
  if (!normalized) return false;
  return /^[6-9]\d{9}$/.test(normalized);
}