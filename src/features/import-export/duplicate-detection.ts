// ─── Duplicate Detection ──────────────────────────────────────────────────

import type { DuplicateStatus } from "./types";

export interface DuplicateCheckResult {
  status: DuplicateStatus;
  key: string;
  existingId?: string;
}

/**
 * Check if a source entry key is a duplicate against existing records.
 * Primary idempotency key: sourceEntryKey
 * Also checks: sourceGuid, sourceRemoteId, sourceVchKey, sourceMasterId
 */
export function checkSourceKeyDuplicate(
  sourceEntryKey: string | null | undefined,
  existingKeys: Set<string>,
): DuplicateCheckResult | null {
  if (!sourceEntryKey) return null;
  const key = sourceEntryKey.trim();
  if (!key) return null;

  if (existingKeys.has(key)) {
    return { status: "DUPLICATE", key };
  }

  return null;
}

/**
 * Build a fallback signature for duplicate detection when source identifiers
 * are unavailable.
 *
 * Signature: customerId + voucherDate + voucherType + voucherNumber + debit + credit
 */
export function buildFallbackSignature(params: {
  customerId: string;
  voucherDate: string;
  voucherType: string;
  voucherNumber?: string | null;
  debit: number;
  credit: number;
}): string {
  const parts = [
    params.customerId,
    params.voucherDate,
    params.voucherType,
    params.voucherNumber || "",
    String(params.debit),
    String(params.credit),
  ];
  return parts.join("::");
}

/**
 * Check a fallback signature against existing signatures.
 */
export function checkFallbackDuplicate(
  signature: string,
  existingSignatures: Set<string>,
): DuplicateCheckResult | null {
  if (existingSignatures.has(signature)) {
    return { status: "DUPLICATE", key: signature };
  }
  return null;
}

/**
 * Collect all existing source keys from the database for duplicate checking.
 */
export async function collectExistingSourceKeys(
  findManyFn: (args: {
    where: {
      OR?: Array<Record<string, unknown>>;
    };
    select: Record<string, boolean>;
  }) => Promise<Array<Record<string, string | null>>>,
  fields: string[],
  excludeBatchId?: string,
): Promise<Set<string>> {
  const keys = new Set<string>();

  const where: Record<string, unknown> = {};
  if (excludeBatchId) {
    where.importBatchId = { not: excludeBatchId };
  }

  const select: Record<string, boolean> = {};
  for (const field of fields) {
    select[field] = true;
  }

  const records = await findManyFn({ where, select });

  for (const record of records) {
    for (const field of fields) {
      const value = record[field];
      if (value) {
        keys.add(value);
      }
    }
  }

  return keys;
}

/**
 * Collect all existing fallback signatures from the database.
 */
export async function collectExistingSignatures(
  findManyFn: (args: {
    where: Record<string, unknown>;
    select: Record<string, boolean>;
  }) => Promise<Array<Record<string, unknown>>>,
  excludeBatchId?: string,
): Promise<Set<string>> {
  const signatures = new Set<string>();

  const where: Record<string, unknown> = {};
  if (excludeBatchId) {
    where.importBatchId = { not: excludeBatchId };
  }

  const records = await findManyFn({
    where,
    select: {
      customerId: true,
      voucherDate: true,
      voucherType: true,
      voucherNumber: true,
      debit: true,
      credit: true,
    },
  });

  for (const record of records) {
    const sig = buildFallbackSignature({
      customerId: String(record.customerId),
      voucherDate: record.voucherDate instanceof Date
        ? record.voucherDate.toISOString().slice(0, 10)
        : String(record.voucherDate),
      voucherType: String(record.voucherType),
      voucherNumber: record.voucherNumber ? String(record.voucherNumber) : null,
      debit: Number(record.debit),
      credit: Number(record.credit),
    });
    signatures.add(sig);
  }

  return signatures;
}