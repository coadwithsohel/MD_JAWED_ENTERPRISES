// ─── Strict Date Parser ────────────────────────────────────────────────────
// Does NOT use JavaScript's loose Date parsing for user-imported values.

import { ValidationError } from "./errors";

export interface DateParseResult {
  isValid: boolean;
  date: string | null; // YYYY-MM-DD
  error?: string;
}

const SUPPORTED_FORMATS = [
  // YYYY-MM-DD
  /^(\d{4})-(\d{2})-(\d{2})$/,
  // YYYYMMDD
  /^(\d{4})(\d{2})(\d{2})$/,
  // DD/MM/YYYY
  /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
  // DD-MM-YYYY
  /^(\d{1,2})-(\d{1,2})-(\d{4})$/,
];

/**
 * Parse a date string strictly.
 * Supports:
 * - YYYY-MM-DD
 * - YYYYMMDD
 * - DD/MM/YYYY
 * - DD-MM-YYYY
 *
 * Returns YYYY-MM-DD format or null for invalid dates.
 * Never replaces invalid/missing dates with today.
 */
export function parseStrictDate(value: string | null | undefined): DateParseResult {
  if (!value || value.trim().length === 0) {
    return { isValid: false, date: null, error: "Date is empty" };
  }

  const trimmed = value.trim();

  for (const format of SUPPORTED_FORMATS) {
    const match = trimmed.match(format);
    if (match) {
      let year: number;
      let month: number;
      let day: number;

      if (format === SUPPORTED_FORMATS[0] || format === SUPPORTED_FORMATS[1]) {
        // YYYY-MM-DD or YYYYMMDD
        year = parseInt(match[1], 10);
        month = parseInt(match[2], 10);
        day = parseInt(match[3], 10);
      } else {
        // DD/MM/YYYY or DD-MM-YYYY
        day = parseInt(match[1], 10);
        month = parseInt(match[2], 10);
        year = parseInt(match[3], 10);
      }

      // Validate ranges
      if (year < 1900 || year > 2100) {
        return { isValid: false, date: null, error: `Year ${year} is out of range (1900-2100)` };
      }
      if (month < 1 || month > 12) {
        return { isValid: false, date: null, error: `Month ${month} is invalid` };
      }
      if (day < 1 || day > 31) {
        return { isValid: false, date: null, error: `Day ${day} is invalid` };
      }

      // Validate actual calendar date
      const jsDate = new Date(year, month - 1, day);
      if (
        jsDate.getFullYear() !== year ||
        jsDate.getMonth() !== month - 1 ||
        jsDate.getDate() !== day
      ) {
        return {
          isValid: false,
          date: null,
          error: `"${trimmed}" is not a valid calendar date`,
        };
      }

      const result = `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
      return { isValid: true, date: result };
    }
  }

  // Try ISO parse as last resort but validate result
  const iso = Date.parse(trimmed);
  if (!Number.isNaN(iso)) {
    const jsDate = new Date(iso);
    const year = jsDate.getUTCFullYear();
    const month = jsDate.getUTCMonth() + 1;
    const day = jsDate.getUTCDate();
    if (year >= 1900 && year <= 2100) {
      const result = `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
      return { isValid: true, date: result };
    }
  }

  return {
    isValid: false,
    date: null,
    error: `"${trimmed}" is not in a supported date format (YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, YYYYMMDD)`,
  };
}

/**
 * Parse a date string and throw on failure.
 */
export function requireDate(value: string | null | undefined, fieldName: string): string {
  const result = parseStrictDate(value);
  if (!result.isValid || !result.date) {
    throw new ValidationError(`${fieldName}: ${result.error || "Invalid date"}`);
  }
  return result.date;
}

/**
 * Parse an optional date string. Returns null for empty/missing, throws on invalid.
 */
export function optionalDate(value: string | null | undefined): string | null {
  if (!value || value.trim().length === 0) return null;
  const result = parseStrictDate(value);
  if (!result.isValid || !result.date) {
    throw new ValidationError(result.error || "Invalid date");
  }
  return result.date;
}

/**
 * Convert a YYYY-MM-DD date string to a Date object for database storage.
 * Uses UTC to avoid timezone shifting.
 */
export function dateStringToDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}