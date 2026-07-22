import { toPaise } from "./money";

export interface CustomerDeletionEligibilityInput {
  openingBalance?: unknown;
  currentBalance?: unknown;
  _count: {
    sales: number;
    payments: number;
    ledgers: number;
    ledgerTransactions: number;
    reminders: number;
    importRows: number;
    tallyVouchers: number;
  };
}

export interface CustomerDeletionEligibility {
  isEligible: boolean;
  reasons: string[];
}

export function getCustomerDeletionEligibility(
  customer: CustomerDeletionEligibilityInput,
): CustomerDeletionEligibility {
  const reasons: string[] = [];

  if (customer._count.sales > 0) reasons.push("invoices");
  if (customer._count.payments > 0) reasons.push("payments");
  if (customer._count.ledgers > 0) reasons.push("ledgerEntries");
  if (customer._count.ledgerTransactions > 0)
    reasons.push("ledgerTransactions");
  // Import rows and staged Tally vouchers are audit metadata, not financial
  // history. They are detached before permanent deletion and must not block an
  // otherwise empty customer. Reminders are operational references and do block.
  if (customer._count.reminders > 0) {
    reasons.push("otherReferences");
  }

  if (
    toPaise(customer.openingBalance) !== 0 ||
    toPaise(customer.currentBalance) !== 0
  ) {
    reasons.push("nonZeroBalance");
  }

  return {
    isEligible: reasons.length === 0,
    reasons,
  };
}
