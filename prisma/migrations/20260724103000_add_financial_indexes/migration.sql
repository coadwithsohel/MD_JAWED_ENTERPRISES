-- Add indexes for financial consistency queries
-- These improve performance of canonical accounting queries used by all pages.

-- CreditLedger: filtered by transactionType (used by getAllCustomerAccountingSummaries)
CREATE INDEX IF NOT EXISTS "CreditLedger_customerId_transactionType_idx" ON "CreditLedger" ("customerId", "transactionType");

-- CreditLedger: index on paymentId for joins
CREATE INDEX IF NOT EXISTS "CreditLedger_paymentId_idx" ON "CreditLedger" ("paymentId");

-- CreditLedger: index on transactionType for aggregate queries
CREATE INDEX IF NOT EXISTS "CreditLedger_transactionType_createdAt_idx" ON "CreditLedger" ("transactionType", "createdAt");

-- TallyVoucher: index for overdue query on customerId
CREATE INDEX IF NOT EXISTS "TallyVoucher_voucherDate_customerId_idx" ON "TallyVoucher" ("voucherDate", "customerId");