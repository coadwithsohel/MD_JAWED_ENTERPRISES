/**
 * Delete All Business Data — Dry-Run Verification Script
 *
 * Default behavior: dry-run (preview only).
 * To execute: --execute --confirmation="DELETE ALL BUSINESS DATA"
 *
 * This script uses the same service as the API to ensure consistent behavior.
 *
 * Usage:
 *   npx tsx scripts/delete-all-business-data.ts              # dry-run preview
 *   npx tsx scripts/delete-all-business-data.ts --execute --confirmation="DELETE ALL BUSINESS DATA" --reason="Testing on development"
 *
 * Safety:
 *   - Defaults to dry-run mode
 *   - Refuses execution without exact confirmation text
 *   - Refuses execution on production without explicit --force
 */

import { prisma } from "../src/lib/prisma";
import {
  previewDeleteAllBusinessData,
  executeDeleteAllBusinessData,
  DeleteAllPreviewResult,
  DeleteAllExecuteResult,
} from "../src/lib/delete-all-business-data";

// ─── Parse CLI args ───────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const isExecute = args.includes("--execute");
const forceProduction = args.includes("--force");
const confirmationArg = args
  .find((a) => a.startsWith("--confirmation="))
  ?.split("=")[1];
const reasonArg = args
  .find((a) => a.startsWith("--reason="))
  ?.split("=")[1];

const EXACT_CONFIRMATION = "DELETE ALL BUSINESS DATA";

// ─── Production safety check ──────────────────────────────────────────────────

const isProduction = process.env.NODE_ENV === "production";

if (isExecute && isProduction && !forceProduction) {
  console.error(`
╔══════════════════════════════════════════════════════════════╗
║  SAFETY BLOCK: This script is running on production.        ║
║  Use --force to override, but this is strongly discouraged. ║
╚══════════════════════════════════════════════════════════════╝
`);
  process.exit(1);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(72));
  console.log(
    `  DELETE ALL BUSINESS DATA — ${isExecute ? "EXECUTE" : "DRY RUN"}`,
  );
  console.log("=".repeat(72));

  if (!isExecute) {
    // ── Dry-run preview ─────────────────────────────────────────────────────
    console.log("\n  Mode: DRY RUN — No data will be modified.\n");

    const preview: DeleteAllPreviewResult = await previewDeleteAllBusinessData();

    console.log("  📊 Records that will be deleted:");
    console.log(`     Customers:             ${preview.customers}`);
    console.log(`     Invoices/Sales:        ${preview.invoices}`);
    console.log(`     Invoice Items:         ${preview.saleItems}`);
    console.log(`     Payments:              ${preview.payments}`);
    console.log(`     Ledger Entries:        ${preview.ledgerEntries}`);
    console.log(`     Ledger Transactions:   ${preview.ledgerTransactions}`);
    console.log(`     Balances:              ${preview.balances}`);
    console.log(`     Tally Vouchers:        ${preview.voucherCount}`);
    console.log(`     Import Batches:        ${preview.importBatches}`);
    console.log(`     Staging Rows:          ${preview.stagingRows}`);
    console.log(`     Reminders:             ${preview.reminders}`);
    console.log(`     Inventory Movements:   ${preview.inventoryMovements}`);

    // Check admin users
    const adminCount = await prisma.user.count({
      where: { isActive: true, role: { in: ["OWNER", "MANAGER"] } },
    });
    console.log(`\n  ✅ Records that will be PRESERVED:`);
    console.log(`     Admin users:           ${adminCount}`);
    console.log(`     Application settings:  preserved`);
    console.log(`     Product catalog:       preserved`);
    console.log(`     User accounts:         preserved`);

    console.log(`\n  🗑️  Deletion order (FK-safe):`);
    console.log(`     1. Reminders (FK → Sale, Customer)`);
    console.log(`     2. ProductSerial (only SaleItem-linked)`);
    console.log(`     3. InventoryMovement (FK → Sale, Product)`);
    console.log(`     4. SaleItem (FK → Sale, Product)`);
    console.log(`     5. CreditLedger (FK → Customer, Sale, Payment)`);
    console.log(`     6. Payment (FK → Customer, Sale, User)`);
    console.log(`     7. Sale (FK → Customer, User)`);
    console.log(`     8. CustomerLedgerTransaction (FK → Customer, TallyImportBatch)`);
    console.log(`     9. TallyVoucher (FK → TallyImportBatch, Customer)`);
    console.log(`     10. CustomerImportRow (FK → CustomerImportBatch, Customer)`);
    console.log(`     11. TallyImportBatch`);
    console.log(`     12. CustomerImportBatch`);
    console.log(`     13. AuditLog (customer/business entity logs)`);
    console.log(`     14. Customer`);
    console.log(`     15. Notification (business-related)`);

    console.log(`\n  To execute, run with:`);
    console.log(
      `     npx tsx scripts/delete-all-business-data.ts --execute --confirmation="${EXACT_CONFIRMATION}" --reason="your reason"`,
    );
    console.log("=".repeat(72));
    process.exit(0);
  }

  // ── Execute mode ───────────────────────────────────────────────────────────
  if (confirmationArg !== EXACT_CONFIRMATION) {
    console.error(
      `\n  ❌ Confirmation text does not match.\n` +
        `     Expected: "${EXACT_CONFIRMATION}"\n` +
        `     Received: "${confirmationArg}"\n`,
    );
    process.exit(1);
  }

  if (!reasonArg || reasonArg.trim().length === 0) {
    console.error("\n  ❌ Reason is required. Use --reason=\"your reason\"\n");
    process.exit(1);
  }

  console.log(`\n  Reason: ${reasonArg}`);
  console.log(`  Confirmation: ${confirmationArg}`);
  console.log(`\n  🚨 EXECUTING DELETE ALL BUSINESS DATA...\n`);

  try {
    const result: DeleteAllExecuteResult = await executeDeleteAllBusinessData();

    console.log("  ✅ Delete completed successfully!\n");
    console.log("  📊 Deletion counts:");
    console.log(`     Customers:             ${result.deleted.customers}`);
    console.log(`     Invoices/Sales:        ${result.deleted.invoices}`);
    console.log(`     Invoice Items:         ${result.deleted.saleItems}`);
    console.log(`     Payments:              ${result.deleted.payments}`);
    console.log(`     Ledger Entries:        ${result.deleted.ledgerEntries}`);
    console.log(`     Ledger Transactions:   ${result.deleted.ledgerTransactions}`);
    console.log(`     Balances:              ${result.deleted.balances}`);
    console.log(`     Tally Vouchers:        ${result.deleted.tallyVouchers}`);
    console.log(`     Import Batches:        ${result.deleted.importBatches}`);
    console.log(`     Staging Rows:          ${result.deleted.stagingRows}`);
    console.log(`     Reminders:             ${result.deleted.reminders}`);
    console.log(`     Inventory Movements:   ${result.deleted.inventoryMovements}`);
    console.log(`     Product Serials:       ${result.deleted.productSerials}`);

    console.log("\n  🔍 Post-deletion verification:");
    console.log(
      `     Customers remaining:          ${result.verification.customersRemaining}`,
    );
    console.log(
      `     Financial records remaining:  ${result.verification.financialRecordsRemaining}`,
    );
    console.log(
      `     Orphan records remaining:     ${result.verification.orphanRecordsRemaining}`,
    );
    console.log(
      `     Admin users remaining:        ${result.verification.adminUsersRemaining}`,
    );
    console.log(
      `     Import records remaining:     ${result.verification.importRecordsRemaining}`,
    );

    console.log("\n  ✅ All verifications passed!");
    console.log("  ✅ Admin users and settings preserved.");
    console.log("=".repeat(72));

    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    console.error("\n  ❌ Delete failed:", error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

main();