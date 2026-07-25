import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";

// Simple env loader if dotenv module isn't installed
function loadEnvFile(filePath: string) {
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

loadEnvFile(path.join(__dirname, "../.env.local"));
loadEnvFile(path.join(__dirname, "../.env"));

const prisma = new PrismaClient();

function analyzeDbUrl(urlStr: string | undefined, label: string) {
  if (!urlStr) {
    return `${label}: NOT SET`;
  }
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname;
    const dbName = parsed.pathname.replace(/^\//, "");
    const schema = parsed.searchParams.get("schema") || "public";
    const ssl = parsed.searchParams.get("sslmode") || (urlStr.includes("sslmode=") ? "enabled" : "default");
    const isPooled = host.includes("pooler") || parsed.searchParams.has("pgbouncer") || host.includes("-pooler.");
    
    return {
      label,
      hostname: host,
      dbName,
      schema,
      isPooled,
      ssl,
    };
  } catch (err) {
    return `${label}: INVALID URL`;
  }
}

async function main() {
  console.log("=== DB CONNECTION ANALYSIS ===");
  console.log("DATABASE_URL:", JSON.stringify(analyzeDbUrl(process.env.DATABASE_URL, "DATABASE_URL")));
  console.log("DIRECT_URL:", JSON.stringify(analyzeDbUrl(process.env.DIRECT_URL, "DIRECT_URL")));

  console.log("\n=== DATABASE RECORD COUNTS ===");
  try {
    const userCount = await prisma.user.count();
    const customerCount = await prisma.customer.count();
    const tallyVoucherCount = await prisma.tallyVoucher.count();
    const invoiceCount = await prisma.sale.count();
    const paymentCount = await prisma.payment.count();
    const ledgerEntryCount = await prisma.creditLedger.count();
    const ledgerTransactionCount = await prisma.customerLedgerTransaction.count();
    const customerImportBatchCount = await prisma.customerImportBatch.count();
    const tallyImportBatchCount = await prisma.tallyImportBatch.count();

    console.log(`Users: ${userCount}`);
    console.log(`Customers: ${customerCount}`);
    console.log(`TallyVouchers: ${tallyVoucherCount}`);
    console.log(`Invoices (Sale): ${invoiceCount}`);
    console.log(`Payments: ${paymentCount}`);
    console.log(`CreditLedger Entries: ${ledgerEntryCount}`);
    console.log(`CustomerLedgerTransactions: ${ledgerTransactionCount}`);
    console.log(`CustomerImportBatches: ${customerImportBatchCount}`);
    console.log(`TallyImportBatches: ${tallyImportBatchCount}`);
  } catch (error) {
    console.error("Error querying database:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
