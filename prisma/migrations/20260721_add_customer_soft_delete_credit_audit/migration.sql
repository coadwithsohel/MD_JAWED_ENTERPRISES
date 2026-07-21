-- Safe migration: adds nullable columns to Customer table for soft-delete and credit limit audit
-- Does NOT reset the database, does NOT delete existing data
-- All columns are nullable so existing rows are unaffected

-- Soft-delete fields
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "deleteReason" TEXT;

-- Credit limit audit fields
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "creditLimitUpdatedAt" TIMESTAMP(3);
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "creditLimitUpdatedBy" TEXT;

-- Index for soft-delete queries (finding deleted/active customers efficiently)
CREATE INDEX IF NOT EXISTS "Customer_deletedAt_idx" ON "Customer"("deletedAt");
