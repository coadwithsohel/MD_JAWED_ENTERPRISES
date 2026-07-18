/**
 * Normalize Indian phone numbers for duplicate detection.
 * - Remove spaces, hyphens, dots
 * - Remove optional +91 or 0 prefix
 * - Return consistent 10-digit form
 */
export function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/[\s\-\.\(\)]/g, '');
  // Remove +91 prefix
  if (cleaned.startsWith('+91')) cleaned = cleaned.slice(3);
  // Remove leading 0
  if (cleaned.startsWith('0')) cleaned = cleaned.slice(1);
  return cleaned;
}

/**
 * Validate Indian mobile number (10 digits, starts with 6-9)
 */
export function isValidIndianMobile(phone: string): boolean {
  const normalized = normalizePhone(phone);
  return /^[6-9]\d{9}$/.test(normalized);
}

/**
 * Format currency in INR
 */
export function formatINR(amount: number | string): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(num);
}

/**
 * Format date in DD/MM/YYYY (Indian format)
 */
export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

/**
 * Sanitize a cell value for CSV export (prevent formula injection)
 */
export function sanitizeCsvCell(value: unknown): string {
  const str = String(value ?? '');
  if (['+', '-', '=', '@', '\t', '\r'].some((c) => str.startsWith(c))) {
    return `'${str}`;
  }
  return str;
}
