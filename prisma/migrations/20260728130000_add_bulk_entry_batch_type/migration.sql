CREATE TYPE "BulkEntryBatchType" AS ENUM (
  'PAYMENT',
  'MANUAL_ADJUSTMENT'
);

ALTER TABLE "BulkEntryBatch"
ALTER COLUMN "batchType" DROP DEFAULT;

ALTER TABLE "BulkEntryBatch"
ALTER COLUMN "batchType" TYPE "BulkEntryBatchType" 
USING "batchType"::"text"::"BulkEntryBatchType";

ALTER TABLE "BulkEntryBatch"
ALTER COLUMN "batchType" SET DEFAULT 'PAYMENT';
