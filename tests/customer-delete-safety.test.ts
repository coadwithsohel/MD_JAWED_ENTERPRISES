import test from "node:test";
import assert from "node:assert/strict";
import { getCustomerDeletionEligibility } from "../src/lib/customer-delete-safety.ts";

test("getCustomerDeletionEligibility blocks customers with ledger transactions or import references", () => {
  const eligibility = getCustomerDeletionEligibility({
    openingBalance: 0,
    currentBalance: 0,
    _count: {
      sales: 0,
      payments: 0,
      ledgers: 0,
      ledgerTransactions: 1,
      reminders: 0,
      importRows: 2,
      tallyVouchers: 0,
    },
  });

  assert.equal(eligibility.isEligible, false);
  assert.ok(eligibility.reasons.includes("ledgerTransactions"));
  assert.ok(eligibility.reasons.includes("otherReferences"));
});

test("getCustomerDeletionEligibility allows customers with no financial or import references", () => {
  const eligibility = getCustomerDeletionEligibility({
    openingBalance: 0,
    currentBalance: 0,
    _count: {
      sales: 0,
      payments: 0,
      ledgers: 0,
      ledgerTransactions: 0,
      reminders: 0,
      importRows: 0,
      tallyVouchers: 0,
    },
  });

  assert.equal(eligibility.isEligible, true);
  assert.deepEqual(eligibility.reasons, []);
});
