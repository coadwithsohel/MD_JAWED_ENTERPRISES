// ─── Customer Matching ─────────────────────────────────────────────────────
// Matches transactions to customers in order:
// 1. Exact normalized mobile
// 2. Exact normalized customer name
// 3. Manual match required

import { normalizeMobile } from "./amount-parser";
import type { MatchStatus } from "./types";

export interface CustomerMatchResult {
  status: MatchStatus;
  customerId: string | null;
  customerName: string | null;
  matchMethod: "mobile" | "name" | "none";
}

export interface CustomerLookup {
  id: string;
  fullName: string;
  mobile: string | null;
  normalizedMobile: string | null;
}

/**
 * Normalize customer name for fuzzy matching.
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

/**
 * Match a transaction to a customer using mobile and name.
 *
 * Priority:
 * 1. Exact normalized mobile
 * 2. Exact normalized customer name
 * 3. Returns unmatched
 */
export function matchCustomer(
  mobile: string | null | undefined,
  customerName: string,
  customers: CustomerLookup[],
): CustomerMatchResult {
  // Try mobile match first
  if (mobile) {
    const normalizedMobile = normalizeMobile(mobile);
    if (normalizedMobile) {
      const mobileMatch = customers.find(
        (c) => c.normalizedMobile === normalizedMobile || c.mobile === normalizedMobile,
      );
      if (mobileMatch) {
        return {
          status: "AUTO_MATCHED",
          customerId: mobileMatch.id,
          customerName: mobileMatch.fullName,
          matchMethod: "mobile",
        };
      }
    }
  }

  // Try exact name match
  if (customerName) {
    const normalizedInput = normalizeName(customerName);
    const nameMatch = customers.find(
      (c) => normalizeName(c.fullName) === normalizedInput,
    );
    if (nameMatch) {
      return {
        status: "AUTO_MATCHED",
        customerId: nameMatch.id,
        customerName: nameMatch.fullName,
        matchMethod: "name",
      };
    }

    // Try fuzzy name match (contains)
    const fuzzyMatch = customers.find(
      (c) =>
        normalizeName(c.fullName).includes(normalizedInput) ||
        normalizedInput.includes(normalizeName(c.fullName)),
    );
    if (fuzzyMatch) {
      return {
        status: "AMBIGUOUS",
        customerId: fuzzyMatch.id,
        customerName: fuzzyMatch.fullName,
        matchMethod: "name",
      };
    }
  }

  return {
    status: "UNMATCHED",
    customerId: null,
    customerName: null,
    matchMethod: "none",
  };
}

/**
 * Build a customer lookup index from database customers.
 */
export function buildCustomerLookup(
  customers: Array<{
    id: string;
    fullName: string;
    mobile: string | null;
    normalizedMobile: string | null;
  }>,
): CustomerLookup[] {
  return customers.map((c) => ({
    id: c.id,
    fullName: c.fullName,
    mobile: c.mobile,
    normalizedMobile: c.normalizedMobile,
  }));
}

/**
 * Create lookup maps for faster matching.
 */
export function createCustomerMaps(customers: CustomerLookup[]) {
  const mobileMap = new Map<string, CustomerLookup>();
  const nameMap = new Map<string, CustomerLookup>();
  const idMap = new Map<string, CustomerLookup>();

  for (const c of customers) {
    idMap.set(c.id, c);
    if (c.normalizedMobile) mobileMap.set(c.normalizedMobile, c);
    if (c.mobile) mobileMap.set(c.mobile, c);
    const normalized = normalizeName(c.fullName);
    if (normalized) nameMap.set(normalized, c);
  }

  return { mobileMap, nameMap, idMap };
}