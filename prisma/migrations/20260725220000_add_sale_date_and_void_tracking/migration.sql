-- Migration: add_sale_date_and_void_tracking
-- Adds user-editable display date to Sale and void tracking to Sale and Payment.
-- All columns are nullable to avoid data loss on existing records.

-- Sale: add saleDate (user-editable display date, overrides createdAt in ledger view)
ALTER TABLE "Sale"
  ADD COLUMN IF NOT EXISTS "saleDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "voidedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "voidReason" TEXT;

-- Payment: add void tracking
ALTER TABLE "Payment"
  ADD COLUMN IF NOT EXISTS "voidedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "voidReason" TEXT;
