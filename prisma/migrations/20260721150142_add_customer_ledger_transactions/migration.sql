-- CreateTable
CREATE TABLE "CustomerLedgerTransaction" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "voucherType" TEXT NOT NULL,
    "voucherNumber" TEXT,
    "particulars" TEXT NOT NULL,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sourceSystem" TEXT DEFAULT 'TALLY',
    "sourceGuid" TEXT,
    "sourceRemoteId" TEXT,
    "sourceVchKey" TEXT,
    "sourceMasterId" TEXT,
    "importBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerLedgerTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerLedgerTransaction_customerId_transactionDate_idx" ON "CustomerLedgerTransaction"("customerId", "transactionDate");

-- CreateIndex
CREATE INDEX "CustomerLedgerTransaction_importBatchId_idx" ON "CustomerLedgerTransaction"("importBatchId");

-- CreateIndex
CREATE INDEX "CustomerLedgerTransaction_sourceGuid_idx" ON "CustomerLedgerTransaction"("sourceGuid");

-- CreateIndex
CREATE INDEX "CustomerLedgerTransaction_sourceRemoteId_idx" ON "CustomerLedgerTransaction"("sourceRemoteId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerLedgerTransaction_sourceSystem_sourceGuid_key" ON "CustomerLedgerTransaction"("sourceSystem", "sourceGuid");

-- AddForeignKey
ALTER TABLE "CustomerLedgerTransaction" ADD CONSTRAINT "CustomerLedgerTransaction_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerLedgerTransaction" ADD CONSTRAINT "CustomerLedgerTransaction_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "TallyImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
