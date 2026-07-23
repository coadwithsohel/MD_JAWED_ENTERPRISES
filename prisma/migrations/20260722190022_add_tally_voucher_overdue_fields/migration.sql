-- Custom migration: Add overdue-related fields to TallyVoucher and CustomerLedgerTransaction
-- Skip enum alterations that may already exist in the database.

-- AlterTable: CustomerLedgerTransaction
ALTER TABLE "CustomerLedgerTransaction" ADD COLUMN IF NOT EXISTS "againstReference" TEXT;
ALTER TABLE "CustomerLedgerTransaction" ADD COLUMN IF NOT EXISTS "dueDate" TIMESTAMP(3);

-- AlterTable: TallyVoucher (add only if columns do not already exist)
ALTER TABLE "TallyVoucher" ADD COLUMN IF NOT EXISTS "againstVoucherNumber" TEXT;
ALTER TABLE "TallyVoucher" ADD COLUMN IF NOT EXISTS "dueDate" TIMESTAMP(3);
ALTER TABLE "TallyVoucher" ADD COLUMN IF NOT EXISTS "matchedCustomerId" TEXT;
ALTER TABLE "TallyVoucher" ADD COLUMN IF NOT EXISTS "matchedCustomerName" TEXT;
ALTER TABLE "TallyVoucher" ADD COLUMN IF NOT EXISTS "mobile" TEXT;
ALTER TABLE "TallyVoucher" ADD COLUMN IF NOT EXISTS "paymentDate" TIMESTAMP(3);
ALTER TABLE "TallyVoucher" ADD COLUMN IF NOT EXISTS "paymentStatus" TEXT;

-- Add default for importStatus if not already set
ALTER TABLE "TallyVoucher" ALTER COLUMN "importStatus" SET DEFAULT 'PARSED';

-- CreateIndex (use IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS "TallyVoucher_voucherKey_idx" ON "TallyVoucher"("voucherKey");
CREATE INDEX IF NOT EXISTS "TallyVoucher_importStatus_idx" ON "TallyVoucher"("importStatus");
CREATE INDEX IF NOT EXISTS "TallyVoucher_dueDate_idx" ON "TallyVoucher"("dueDate");
CREATE INDEX IF NOT EXISTS "TallyVoucher_againstVoucherNumber_idx" ON "TallyVoucher"("againstVoucherNumber");
CREATE INDEX IF NOT EXISTS "TallyVoucher_importBatchId_importStatus_idx" ON "TallyVoucher"("importBatchId", "importStatus");