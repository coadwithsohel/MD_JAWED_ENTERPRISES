#!/usr/bin/env tsx
/**
 * VERIFY PRODUCTION DATABASE IDENTITY
 *
 * Prints safe proof of which database we're connected to.
 * Does NOT modify any data.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("=".repeat(72));
  console.log("  PRODUCTION DATABASE IDENTITY VERIFICATION");
  console.log("=".repeat(72));

  // 1. Database host info via raw SQL
  const [dbInfo] = await prisma.$queryRaw<Array<{ version: string; current_database: string; inet_server_addr: string | null; inet_server_port: number | null }>>`
    SELECT version(), current_database(), inet_server_addr(), inet_server_port()
  `;
  console.log(`\n  Database Host:     ${dbInfo.version?.split(",")[0] ?? "unknown"}`);
  console.log(`  Database Name:     ${dbInfo.current_database}`);
  console.log(`  Server Address:    ${dbInfo.inet_server_addr ?? "N/A (pooled)"}`);
  console.log(`  Server Port:       ${dbInfo.inet_server_port ?? "N/A"}`);

  // 2. Extract host from version string
  const hostMatch = dbInfo.version?.match(/on\s+(\S+)/);
  if (hostMatch) {
    console.log(`  Server Hostname:   ${hostMatch[1]}`);
  }

  // 3. Record counts (safe, read-only)
  const customerCount = await prisma.customer.count();
  const voucherCount = await prisma.tallyVoucher.count();
  const saleCount = await prisma.sale.count();
  const paymentCount = await prisma.payment.count();
  const ledgerCount = await prisma.creditLedger.count();
  const batchCount = await prisma.tallyImportBatch.count();
  const userCount = await prisma.user.count();

  console.log(`\n  ─── Record Counts ───`);
  console.log(`  Customers:           ${customerCount}`);
  console.log(`  TallyVouchers:       ${voucherCount}`);
  console.log(`  Sales (Invoices):    ${saleCount}`);
  console.log(`  Payments:            ${paymentCount}`);
  console.log(`  CreditLedger:        ${ledgerCount}`);
  console.log(`  Import Batches:      ${batchCount}`);
  console.log(`  Users:               ${userCount}`);

  // 4. Check if Neon-specific
  const isNeon = dbInfo.version?.toLowerCase().includes("neon") ?? false;
  console.log(`\n  Neon Database:      ${isNeon ? "YES ✓" : "NO"}`);

  // 5. Check for Vercel deployment markers
  const vercelEnv = process.env.VERCEL_ENV ?? "not-set";
  const vercelUrl = process.env.VERCEL_URL ?? "not-set";
  console.log(`  VERCEL_ENV:          ${vercelEnv}`);
  console.log(`  VERCEL_URL:          ${vercelUrl}`);

  // 6. Check if this matches the deployed app's expected host
  const expectedNeonHost = "ep-small-pond-au1q0rzk";
  const actualHost = dbInfo.version ?? "";
  const matchesExpected = actualHost.includes(expectedNeonHost);
  console.log(`\n  Expected Neon Host:  ${expectedNeonHost}`);
  console.log(`  Matches Expected:    ${matchesExpected ? "YES ✓" : "NO ⚠️"}`);

  console.log("\n" + "=".repeat(72));
  console.log(matchesExpected
    ? "  ✓ CONFIRMED: Connected to PRODUCTION Neon database"
    : "  ⚠️  WARNING: Database host does not match expected production host"
  );
  console.log("  Mode: READ-ONLY — No changes were made");
  console.log("=".repeat(72));

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("❌ Verification failed:", e.message);
  process.exit(1);
});