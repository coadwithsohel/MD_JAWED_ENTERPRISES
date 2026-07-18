-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('UPLOADED', 'VALIDATING', 'READY', 'IMPORTING', 'COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ImportRowStatus" AS ENUM ('VALID', 'INVALID', 'CREATED', 'UPDATED', 'SKIPPED', 'FAILED');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "normalizedMobile" TEXT;

-- AlterTable
ALTER TABLE "ShopSettings" ADD COLUMN     "logoUrl" TEXT,
ADD COLUMN     "termsAndConditions" TEXT;

-- CreateTable
CREATE TABLE "InvoiceCounter" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "current" INTEGER NOT NULL DEFAULT 0,
    "prefix" TEXT NOT NULL DEFAULT 'INV',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerCounter" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "current" INTEGER NOT NULL DEFAULT 0,
    "prefix" TEXT NOT NULL DEFAULT 'MJE-CUST',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerImportBatch" (
    "id" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "storedFileName" TEXT,
    "fileHash" TEXT,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "validRows" INTEGER NOT NULL DEFAULT 0,
    "importedRows" INTEGER NOT NULL DEFAULT 0,
    "updatedRows" INTEGER NOT NULL DEFAULT 0,
    "skippedRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "importedById" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'UPLOADED',
    "errorSummary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "CustomerImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerImportRow" (
    "id" TEXT NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "rawData" JSONB NOT NULL,
    "normalizedData" JSONB,
    "resultStatus" "ImportRowStatus" NOT NULL,
    "customerId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerImportBatch_fileHash_key" ON "CustomerImportBatch"("fileHash");

-- CreateIndex
CREATE INDEX "CustomerImportBatch_importedById_idx" ON "CustomerImportBatch"("importedById");

-- CreateIndex
CREATE INDEX "CustomerImportBatch_status_idx" ON "CustomerImportBatch"("status");

-- CreateIndex
CREATE INDEX "CustomerImportBatch_createdAt_idx" ON "CustomerImportBatch"("createdAt");

-- CreateIndex
CREATE INDEX "CustomerImportRow_importBatchId_idx" ON "CustomerImportRow"("importBatchId");

-- CreateIndex
CREATE INDEX "CustomerImportRow_resultStatus_idx" ON "CustomerImportRow"("resultStatus");

-- CreateIndex
CREATE INDEX "CreditLedger_saleId_idx" ON "CreditLedger"("saleId");

-- CreateIndex
CREATE INDEX "Customer_normalizedMobile_idx" ON "Customer"("normalizedMobile");

-- CreateIndex
CREATE INDEX "Customer_isActive_idx" ON "Customer"("isActive");

-- CreateIndex
CREATE INDEX "InventoryMovement_saleId_idx" ON "InventoryMovement"("saleId");

-- CreateIndex
CREATE INDEX "Product_isActive_idx" ON "Product"("isActive");

-- CreateIndex
CREATE INDEX "Sale_status_idx" ON "Sale"("status");

-- CreateIndex
CREATE INDEX "Sale_pendingAmount_idx" ON "Sale"("pendingAmount");

-- AddForeignKey
ALTER TABLE "CustomerImportBatch" ADD CONSTRAINT "CustomerImportBatch_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerImportRow" ADD CONSTRAINT "CustomerImportRow_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "CustomerImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerImportRow" ADD CONSTRAINT "CustomerImportRow_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
