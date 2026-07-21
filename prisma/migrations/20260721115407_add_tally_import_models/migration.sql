-- CreateTable
CREATE TABLE "TallyImportBatch" (
    "id" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "storedFileName" TEXT,
    "importDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importedById" TEXT NOT NULL,
    "totalVouchers" INTEGER NOT NULL DEFAULT 0,
    "salesCount" INTEGER NOT NULL DEFAULT 0,
    "receiptCount" INTEGER NOT NULL DEFAULT 0,
    "debitNoteCount" INTEGER NOT NULL DEFAULT 0,
    "creditNoteCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "debitTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "creditTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "ImportStatus" NOT NULL DEFAULT 'UPLOADED',
    "errorSummary" JSONB,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TallyImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TallyVoucher" (
    "id" TEXT NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "tallyGuid" TEXT,
    "tallyRemoteId" TEXT,
    "tallyMasterId" TEXT,
    "voucherKey" TEXT,
    "sourceFileName" TEXT,
    "customerName" TEXT,
    "customerId" TEXT,
    "voucherDate" TIMESTAMP(3) NOT NULL,
    "voucherType" TEXT NOT NULL,
    "voucherNumber" TEXT,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "narration" TEXT,
    "reference" TEXT,
    "isDuplicate" BOOLEAN NOT NULL DEFAULT false,
    "isSkipped" BOOLEAN NOT NULL DEFAULT false,
    "errorMessage" TEXT,
    "importStatus" "ImportRowStatus" NOT NULL DEFAULT 'VALID',
    "ledgerEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TallyVoucher_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TallyImportBatch_importedById_idx" ON "TallyImportBatch"("importedById");

-- CreateIndex
CREATE INDEX "TallyImportBatch_createdAt_idx" ON "TallyImportBatch"("createdAt");

-- CreateIndex
CREATE INDEX "TallyImportBatch_status_idx" ON "TallyImportBatch"("status");

-- CreateIndex
CREATE UNIQUE INDEX "TallyVoucher_tallyGuid_key" ON "TallyVoucher"("tallyGuid");

-- CreateIndex
CREATE INDEX "TallyVoucher_importBatchId_idx" ON "TallyVoucher"("importBatchId");

-- CreateIndex
CREATE INDEX "TallyVoucher_customerId_idx" ON "TallyVoucher"("customerId");

-- CreateIndex
CREATE INDEX "TallyVoucher_tallyGuid_idx" ON "TallyVoucher"("tallyGuid");

-- CreateIndex
CREATE INDEX "TallyVoucher_voucherDate_idx" ON "TallyVoucher"("voucherDate");

-- AddForeignKey
ALTER TABLE "TallyImportBatch" ADD CONSTRAINT "TallyImportBatch_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TallyVoucher" ADD CONSTRAINT "TallyVoucher_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "TallyImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TallyVoucher" ADD CONSTRAINT "TallyVoucher_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
