import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface DeleteAllPreviewResult {
  customers: number;
  invoices: number;
  payments: number;
  ledgerEntries: number;
  ledgerTransactions: number;
  balances: number;
  importBatches: number;
  stagingRows: number;
  voucherCount: number;
  saleItems: number;
  reminders: number;
  inventoryMovements: number;
  productSerials: number;
  message: string;
}

export interface DeleteAllExecuteResult {
  success: boolean;
  action: "DELETE_ALL_BUSINESS_DATA";
  deleted: {
    customers: number;
    invoices: number;
    payments: number;
    ledgerEntries: number;
    ledgerTransactions: number;
    balances: number;
    importBatches: number;
    stagingRows: number;
    tallyVouchers: number;
    saleItems: number;
    reminders: number;
    inventoryMovements: number;
    productSerials: number;
  };
  verification: {
    customersRemaining: number;
    financialRecordsRemaining: number;
    orphanRecordsRemaining: number;
    adminUsersRemaining: number;
    importRecordsRemaining: number;
  };
}

export interface DeleteAllBackupData {
  customers: unknown[];
  invoices: unknown[];
  saleItems: unknown[];
  payments: unknown[];
  ledgerEntries: unknown[];
  ledgerTransactions: unknown[];
  balances: unknown[];
  tallyVouchers: unknown[];
  importBatches: unknown[];
  stagingRows: unknown[];
}

// ─── Preview ───────────────────────────────────────────────────────────────────

export async function previewDeleteAllBusinessData(): Promise<DeleteAllPreviewResult> {
  const [customerCount, invoiceCount, paymentCount, ledgerEntryCount, ledgerTransactionCount, voucherCount, tallyVoucherCount, tallyImportBatchCount, importBatchCount, stagingRowCount, custImportBatchCount, reminderCount, inventoryMovementCount, productSerialCount, saleItemCount] = await Promise.all([
    prisma.customer.count(),
    prisma.sale.count(),
    prisma.payment.count(),
    prisma.creditLedger.count(),
    prisma.customerLedgerTransaction.count(),
    prisma.tallyVoucher.count(),
    prisma.tallyVoucher.count(),
    prisma.tallyImportBatch.count(),
    prisma.customerImportBatch.count(),
    prisma.customerImportRow.count(),
    prisma.customerImportBatch.count(),
    prisma.reminder.count(),
    prisma.inventoryMovement.count(),
    prisma.productSerial.count({ where: { saleItemId: { not: null } } }),
    prisma.saleItem.count(),
  ]);

  return {
    customers: customerCount,
    invoices: invoiceCount,
    payments: paymentCount,
    ledgerEntries: ledgerEntryCount,
    ledgerTransactions: ledgerTransactionCount,
    balances: ledgerEntryCount, // CreditLedger entries ARE the balance records
    importBatches: custImportBatchCount + tallyImportBatchCount,
    stagingRows: stagingRowCount,
    voucherCount: tallyVoucherCount,
    saleItems: saleItemCount,
    reminders: reminderCount,
    inventoryMovements: inventoryMovementCount,
    productSerials: productSerialCount,
    message: "All listed business data will be permanently deleted. This action cannot be undone.",
  };
}

// ─── Delete in FK-safe order ──────────────────────────────────────────────────

async function deleteInOrder(): Promise<DeleteAllExecuteResult["deleted"]> {
  const deleted: DeleteAllExecuteResult["deleted"] = {
    customers: 0,
    invoices: 0,
    payments: 0,
    ledgerEntries: 0,
    ledgerTransactions: 0,
    balances: 0,
    importBatches: 0,
    stagingRows: 0,
    tallyVouchers: 0,
    saleItems: 0,
    reminders: 0,
    inventoryMovements: 0,
    productSerials: 0,
  };

  // 1. Reminders — FK to Sale, Customer
  const { count: delReminders } = await prisma.reminder.deleteMany({});
  deleted.reminders = delReminders;

  // 2. ProductSerial linked to SaleItem — FK to Product, SaleItem
  const { count: delSerials } = await prisma.productSerial.deleteMany({
    where: { saleItemId: { not: null } },
  });
  deleted.productSerials = delSerials;

  // 3. InventoryMovement — FK to Sale, Product
  const { count: delInventory } = await prisma.inventoryMovement.deleteMany({});
  deleted.inventoryMovements = delInventory;

  // 4. SaleItem — FK to Sale, Product
  const { count: delSaleItems } = await prisma.saleItem.deleteMany({});
  deleted.saleItems = delSaleItems;

  // 5. CreditLedger — FK to Customer, Sale, Payment
  const { count: delCreditLedger } = await prisma.creditLedger.deleteMany({});
  deleted.ledgerEntries = delCreditLedger;
  deleted.balances = delCreditLedger;

  // 6. Payment — FK to Customer, Sale, User
  const { count: delPayments } = await prisma.payment.deleteMany({});
  deleted.payments = delPayments;

  // 7. Sale — FK to Customer, User
  const { count: delSales } = await prisma.sale.deleteMany({});
  deleted.invoices = delSales;

  // 8. CustomerLedgerTransaction — FK to Customer, TallyImportBatch
  const { count: delLedgerTxns } = await prisma.customerLedgerTransaction.deleteMany({});
  deleted.ledgerTransactions = delLedgerTxns;

  // 9. TallyVoucher — FK to TallyImportBatch, Customer
  const { count: delVouchers } = await prisma.tallyVoucher.deleteMany({});
  deleted.tallyVouchers = delVouchers;

  // 10. CustomerImportRow — FK to CustomerImportBatch, Customer
  const { count: delStagingRows } = await prisma.customerImportRow.deleteMany({});
  deleted.stagingRows = delStagingRows;

  // 11. TallyImportBatch — FK to User
  const { count: delTallyImportBatches } = await prisma.tallyImportBatch.deleteMany({});
  deleted.importBatches += delTallyImportBatches;

  // 12. CustomerImportBatch — FK to User
  const { count: delCustImportBatches } = await prisma.customerImportBatch.deleteMany({});
  deleted.importBatches += delCustImportBatches;

  // 13. AuditLog — optional cleanup of customer-related logs only
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { entityType: "Customer" },
        { entityType: "Sale" },
        { entityType: "Payment" },
        { entityType: "CreditLedger" },
        { entityType: "CustomerLedgerTransaction" },
        { entityType: "TallyVoucher" },
        { entityType: "CustomerImportBatch" },
        { entityType: "TallyImportBatch" },
        { entityType: "CustomerImportRow" },
      ],
    },
  });

  // 14. Customer — now all dependents are gone
  const { count: delCustomers } = await prisma.customer.deleteMany({});
  deleted.customers = delCustomers;

  // 15. Notification — clean up customer/business related notifications
  // Keep system/user notifications; delete notifications referencing business entities
  await prisma.notification.deleteMany({
    where: {
      relatedEntityType: {
        in: ["Customer", "Sale", "Payment", "Import", "Tally"],
      },
    },
  });

  return deleted;
}

// ─── Verify after deletion ────────────────────────────────────────────────────

async function verifyAfterDelete(): Promise<DeleteAllExecuteResult["verification"]> {
  const [customersRemaining, financialRecordsCount, adminUsers, importRecords] = await Promise.all([
    prisma.customer.count(),
    // Count all financial records that should be zero
    prisma.sale.count().then(c => c),
    prisma.user.count({ where: { isActive: true } }),
    prisma.customerImportBatch.count().then(c => c + (prisma.tallyImportBatch.count() as unknown as number)),
  ]);

  const invoiceCount = await prisma.sale.count();
  const paymentCount = await prisma.payment.count();
  const ledgerCount = await prisma.creditLedger.count();
  const ledgerTxCount = await prisma.customerLedgerTransaction.count();
  const saleItemCount = await prisma.saleItem.count();
  const reminderCount = await prisma.reminder.count();
  const invMovementCount = await prisma.inventoryMovement.count();
  const tallyVoucherCount = await prisma.tallyVoucher.count();
  const stagingRowCount = await prisma.customerImportRow.count();
  const tallyBatchCount = await prisma.tallyImportBatch.count();
  const custBatchCount = await prisma.customerImportBatch.count();

  const financialOrphans = invoiceCount + paymentCount + ledgerCount + ledgerTxCount + saleItemCount + reminderCount + invMovementCount + tallyVoucherCount;
  const importRecordsRemaining = tallyBatchCount + custBatchCount + stagingRowCount;

  return {
    customersRemaining,
    financialRecordsRemaining: financialOrphans,
    orphanRecordsRemaining: financialOrphans,
    adminUsersRemaining: adminUsers,
    importRecordsRemaining,
  };
}

// ─── Backup ────────────────────────────────────────────────────────────────────

export async function collectBackupData(): Promise<DeleteAllBackupData> {
  const [customers, invoices, saleItems, payments, ledgerEntries, ledgerTransactions, tallyVouchers, importBatches, stagingRows] = await Promise.all([
    prisma.customer.findMany({ take: 10000 }),
    prisma.sale.findMany({ take: 10000 }),
    prisma.saleItem.findMany({ take: 10000 }),
    prisma.payment.findMany({ take: 10000 }),
    prisma.creditLedger.findMany({ take: 10000 }),
    prisma.customerLedgerTransaction.findMany({ take: 10000 }),
    prisma.tallyVoucher.findMany({ take: 10000 }),
    prisma.customerImportBatch.findMany({ take: 10000 }),
    prisma.customerImportRow.findMany({ take: 10000 }),
  ]);

  return {
    customers,
    invoices,
    saleItems,
    payments,
    ledgerEntries,
    ledgerTransactions,
    balances: ledgerEntries,
    tallyVouchers,
    importBatches,
    stagingRows,
  };
}

// ─── Execute ───────────────────────────────────────────────────────────────────

export async function executeDeleteAllBusinessData(): Promise<DeleteAllExecuteResult> {
  try {
    const deleted = await deleteInOrder();
    const verification = await verifyAfterDelete();

    // Reset business counters safely
    await prisma.invoiceCounter.update({
      where: { id: "singleton" },
      data: { current: 0 },
    });

    return {
      success: true,
      action: "DELETE_ALL_BUSINESS_DATA",
      deleted,
      verification,
    };
  } catch (error) {
    console.error("[delete-all-business-data] Execution failed:", error);
    throw error;
  }
}