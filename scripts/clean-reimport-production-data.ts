/**
 * High-Performance Clean Re-Import Script for MD JAWED ENTERPRISES
 * Path: scripts/clean-reimport-production-data.ts
 *
 * Uses batch operations (createMany) for ultra-fast execution over cloud DB.
 */
import { PrismaClient, Prisma } from "@prisma/client";
import fs from "fs";
import path from "path";
import { parseCsv } from "../src/features/import-export/csv-parser";
import { normalizeMobile } from "../src/features/import-export/amount-parser";
import { parseRupeeAmount } from "../src/lib/money";

// Simple env loader
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
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
}

loadEnvFile(path.join(__dirname, "../.env.local"));
loadEnvFile(path.join(__dirname, "../.env"));

const prisma = new PrismaClient();
const BATCH_DIR = "C:\\Users\\DELL\\Downloads\\MD_JAWED_CLEAN_SPLIT_10_BATCHES";

let idCounter = 0;
function generateId(prefix: string): string {
  idCounter++;
  return `cmr_${prefix}_${Date.now()}_${idCounter}`;
}

async function main() {
  const isExecute = process.argv.includes("--execute");

  console.log("==================================================");
  console.log("HIGH-PERFORMANCE CLEAN RE-IMPORT OF 10 SOURCE BATCHES");
  console.log(`Mode: ${isExecute ? "EXECUTE (Applying changes)" : "DRY-RUN (Verification only)"}`);
  console.log("==================================================");

  if (!fs.existsSync(BATCH_DIR)) {
    throw new Error(`Batch directory not found at ${BATCH_DIR}`);
  }

  const adminUser = await prisma.user.findFirst({ where: { role: "OWNER" } }) || await prisma.user.findFirst();
  if (!adminUser) {
    throw new Error("No user found to associate with imported records.");
  }
  const userId = adminUser.id;

  if (isExecute) {
    console.log("\n--- STEP 1: CLEANING IMPORTED BUSINESS DATA ---");
    await prisma.creditLedger.deleteMany({});
    await prisma.customerLedgerTransaction.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.saleItem.deleteMany({});
    await prisma.sale.deleteMany({});
    await prisma.tallyVoucher.deleteMany({});
    await prisma.tallyImportBatch.deleteMany({});
    await prisma.customerImportRow.deleteMany({});
    await prisma.customerImportBatch.deleteMany({});
    await prisma.customer.deleteMany({});

    await prisma.customerCounter.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", current: 0, prefix: "MJE-CUST" },
      update: { current: 0 },
    });
    await prisma.invoiceCounter.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", current: 0, prefix: "INV" },
      update: { current: 0 },
    });
    console.log("✓ Database cleaned successfully.");
  }

  const customerImportBatchesToCreate: Prisma.CustomerImportBatchCreateManyInput[] = [];
  const tallyImportBatchesToCreate: Prisma.TallyImportBatchCreateManyInput[] = [];
  const customersToCreate: Prisma.CustomerCreateManyInput[] = [];
  const creditLedgersToCreate: Prisma.CreditLedgerCreateManyInput[] = [];
  const tallyVouchersToCreate: Prisma.TallyVoucherCreateManyInput[] = [];
  const salesToCreate: Prisma.SaleCreateManyInput[] = [];
  const paymentsToCreate: Prisma.PaymentCreateManyInput[] = [];

  const customerMobileMap = new Map<string, { id: string; fullName: string; openingBalance: Prisma.Decimal }>();
  const customerNameMap = new Map<string, { id: string; fullName: string; openingBalance: Prisma.Decimal }>();
  const usedInvoiceNumbers = new Set<string>();

  let totalCustomers = 0;
  let totalTransactions = 0;
  let totalSales = 0;
  let totalReceipts = 0;
  let totalOpeningBalance = new Prisma.Decimal(0);
  let totalDebitAmount = new Prisma.Decimal(0);
  let totalCreditAmount = new Prisma.Decimal(0);

  const seenSourceKeys = new Set<string>();
  let customerCodeSeq = 0;

  console.log("\n--- STEP 2: PARSING BATCHES 1 TO 10 ---");

  for (let batchNum = 1; batchNum <= 10; batchNum++) {
    const padStr = String(batchNum).padStart(2, "0");
    const custFileName = `BATCH_${padStr}_CUSTOMERS.csv`;
    const txFileName = `BATCH_${padStr}_TRANSACTIONS.csv`;

    const custFilePath = path.join(BATCH_DIR, custFileName);
    const txFilePath = path.join(BATCH_DIR, txFileName);

    const custBatchId = generateId("cb");
    const tallyBatchId = generateId("tb");

    customerImportBatchesToCreate.push({
      id: custBatchId,
      originalFileName: custFileName,
      importedById: userId,
      status: "COMPLETED",
    });

    tallyImportBatchesToCreate.push({
      id: tallyBatchId,
      originalFileName: txFileName,
      importedById: userId,
      status: "COMPLETED",
    });

    // A. Customers
    const custCsvContent = fs.readFileSync(custFilePath, "utf8");
    const parsedCust = parseCsv(custCsvContent, ["Name"]);

    for (let rIdx = 0; rIdx < parsedCust.rows.length; rIdx++) {
      const row = parsedCust.rows[rIdx];
      const name = (row["Name"] || "").trim();
      const mobile = (row["Mobile"] || "").trim();
      const altMobile = (row["Alternate Mobile"] || "").trim() || null;
      const email = (row["Email"] || "").trim() || null;
      const city = (row["City"] || "").trim() || null;
      const state = (row["State"] || "").trim() || null;
      const address = (row["Address"] || "").trim() || null;
      const creditLimitRaw = row["Credit Limit"] || "0";
      const obRaw = row["Opening Balance"] || "0";

      if (!name) continue;

      const normMobile = mobile ? normalizeMobile(mobile) : null;
      const obDecimal = parseRupeeAmount(obRaw);
      const creditLimitDecimal = parseRupeeAmount(creditLimitRaw);

      let customerId = "";
      let existing = (normMobile ? customerMobileMap.get(normMobile) : null) || customerNameMap.get(name.toLowerCase());

      if (existing) {
        customerId = existing.id;
      } else {
        customerCodeSeq++;
        customerId = generateId("c");
        const code = `MJE-CUST-${String(customerCodeSeq).padStart(6, "0")}`;

        customersToCreate.push({
          id: customerId,
          customerCode: code,
          fullName: name,
          mobile: mobile || `999${String(customerCodeSeq).padStart(7, "0")}`,
          normalizedMobile: normMobile,
          alternateMobile: altMobile,
          email,
          city,
          state,
          address,
          creditLimit: creditLimitDecimal,
          openingBalance: obDecimal,
          currentBalance: obDecimal,
          isActive: true,
        });

        totalCustomers++;
        totalOpeningBalance = totalOpeningBalance.add(obDecimal);

        if (!obDecimal.equals(0)) {
          creditLedgersToCreate.push({
            id: generateId("cl"),
            customerId,
            transactionType: "OPENING_BALANCE",
            amount: obDecimal.abs(),
            balanceAfter: obDecimal,
            description: `Opening Balance (${obDecimal.gte(0) ? "Debit" : "Credit"})`,
          });
        }
      }

      const custObj = { id: customerId, fullName: name, openingBalance: obDecimal };
      if (normMobile) customerMobileMap.set(normMobile, custObj);
      customerNameMap.set(name.toLowerCase(), custObj);
    }

    // B. Transactions
    const txCsvContent = fs.readFileSync(txFilePath, "utf8");
    const parsedTx = parseCsv(txCsvContent, ["Customer Name", "Date", "Voucher Type"]);

    for (let rIdx = 0; rIdx < parsedTx.rows.length; rIdx++) {
      const row = parsedTx.rows[rIdx];
      const customerName = (row["Customer Name"] || "").trim();
      const mobile = (row["Mobile"] || "").trim();
      const dateStr = (row["Date"] || "").trim();
      const dueDateStr = (row["Due Date"] || "").trim() || null;
      const paymentDateStr = (row["Payment Date"] || "").trim() || null;
      const vTypeRaw = (row["Voucher Type"] || "").trim();
      const vNum = (row["Voucher Number"] || "").trim() || null;
      const againstVNum = (row["Against Voucher Number"] || "").trim() || null;
      const debitRaw = row["Debit"] || "0";
      const creditRaw = row["Credit"] || "0";
      const narration = (row["Narration"] || row["Particulars"] || "").trim() || null;
      const sourceEntryKey = (row["Source Entry Key"] || row["Source VCH Key"] || "").trim() || null;
      const sourceGuid = (row["Source GUID"] || "").trim() || null;
      const sourceRemoteId = (row["Source Remote ID"] || "").trim() || null;
      const sourceMasterId = (row["Source Master ID"] || "").trim() || null;

      if (!customerName || !vTypeRaw || !dateStr) continue;

      const key = sourceEntryKey || sourceGuid || `${dateStr}:${vTypeRaw}:${vNum}:${customerName}:${debitRaw}:${creditRaw}`;
      if (seenSourceKeys.has(key)) continue;
      seenSourceKeys.add(key);

      const debit = parseRupeeAmount(debitRaw);
      const credit = parseRupeeAmount(creditRaw);
      const vDate = new Date(dateStr);
      const pDate = paymentDateStr ? new Date(paymentDateStr) : vDate;
      const dDate = dueDateStr ? new Date(dueDateStr) : null;

      const normType = vTypeRaw.toUpperCase();
      const isSale = normType === "SALES" || normType === "SALE" || normType === "DEBIT_NOTE";
      const isReceipt = normType === "RECEIPT" || normType === "PAYMENT" || normType === "CREDIT_NOTE";

      const normMobile = mobile ? normalizeMobile(mobile) : null;
      let matchedCust = (normMobile ? customerMobileMap.get(normMobile) : null) || customerNameMap.get(customerName.toLowerCase());

      if (!matchedCust) {
        customerCodeSeq++;
        const custId = generateId("c");
        const code = `MJE-CUST-${String(customerCodeSeq).padStart(6, "0")}`;
        customersToCreate.push({
          id: custId,
          customerCode: code,
          fullName: customerName,
          mobile: mobile || `999${String(customerCodeSeq).padStart(7, "0")}`,
          normalizedMobile: normMobile,
          openingBalance: new Prisma.Decimal(0),
          currentBalance: new Prisma.Decimal(0),
          isActive: true,
        });
        totalCustomers++;
        matchedCust = { id: custId, fullName: customerName, openingBalance: new Prisma.Decimal(0) };
        if (normMobile) customerMobileMap.set(normMobile, matchedCust);
        customerNameMap.set(customerName.toLowerCase(), matchedCust);
      }

      totalTransactions++;
      const voucherId = generateId("tv");

      tallyVouchersToCreate.push({
        id: voucherId,
        importBatchId: tallyBatchId,
        tallyGuid: sourceGuid,
        tallyRemoteId: sourceRemoteId,
        tallyMasterId: sourceMasterId,
        voucherKey: key,
        sourceFileName: txFileName,
        customerName,
        mobile,
        customerId: matchedCust.id,
        matchedCustomerId: matchedCust.id,
        matchedCustomerName: matchedCust.fullName,
        voucherDate: vDate,
        dueDate: dDate,
        paymentDate: pDate,
        voucherType: isSale ? "SALES" : "RECEIPT",
        voucherNumber: vNum,
        againstVoucherNumber: againstVNum,
        debit,
        credit,
        narration,
        importStatus: "IMPORTED",
      });

      let saleId: string | undefined = undefined;
      let paymentId: string | undefined = undefined;

      if (isSale) {
        totalSales++;
        totalDebitAmount = totalDebitAmount.add(debit);
        saleId = generateId("s");

        let invNum = vNum ? `INV-${vNum}` : `INV-${voucherId.slice(-8).toUpperCase()}`;
        if (usedInvoiceNumbers.has(invNum)) {
          invNum = `INV-${vNum || 'SALES'}-${voucherId.slice(-6).toUpperCase()}`;
        }
        usedInvoiceNumbers.add(invNum);

        salesToCreate.push({
          id: saleId,
          invoiceNumber: invNum,
          customerId: matchedCust.id,
          saleType: "CREDIT",
          subtotal: debit,
          discountAmount: new Prisma.Decimal(0),
          gstAmount: new Prisma.Decimal(0),
          grandTotal: debit,
          paidAmount: new Prisma.Decimal(0),
          pendingAmount: debit,
          dueDate: dDate,
          paymentStatus: "UNPAID",
          status: "COMPLETED",
          notes: narration,
          createdById: userId,
          createdAt: vDate,
        });
      } else if (isReceipt) {
        totalReceipts++;
        totalCreditAmount = totalCreditAmount.add(credit);
        paymentId = generateId("p");
        const recNum = vNum ? `REC-${vNum}-${voucherId.slice(-6).toUpperCase()}` : `REC-${voucherId.slice(-8).toUpperCase()}`;

        paymentsToCreate.push({
          id: paymentId,
          receiptNumber: recNum,
          customerId: matchedCust.id,
          amount: credit,
          paymentMode: "OTHER",
          status: "COMPLETED",
          receivedById: userId,
          paymentDate: pDate,
          createdAt: pDate,
          notes: narration || (againstVNum ? `Against ${againstVNum}` : undefined),
        });
      }

      creditLedgersToCreate.push({
        id: generateId("cl"),
        customerId: matchedCust.id,
        saleId,
        paymentId,
        transactionType: isSale ? "CREDIT_SALE" : "PAYMENT_RECEIVED",
        amount: isSale ? debit : credit,
        balanceAfter: new Prisma.Decimal(0),
        description: narration || `${vTypeRaw} #${vNum || ""}`,
        createdAt: isSale ? vDate : pDate,
      });
    }
  }

  console.log(`Parsed ${totalCustomers} customers, ${totalTransactions} vouchers (${totalSales} sales, ${totalReceipts} receipts).`);

  if (isExecute) {
    console.log("\n--- STEP 3: EXECUTING BATCH INSERTIONS ---");

    console.log(`Inserting ${customerImportBatchesToCreate.length} CustomerImportBatch records...`);
    await prisma.customerImportBatch.createMany({ data: customerImportBatchesToCreate });

    console.log(`Inserting ${tallyImportBatchesToCreate.length} TallyImportBatch records...`);
    await prisma.tallyImportBatch.createMany({ data: tallyImportBatchesToCreate });

    console.log(`Inserting ${customersToCreate.length} Customer records...`);
    await prisma.customer.createMany({ data: customersToCreate });

    console.log(`Inserting ${tallyVouchersToCreate.length} TallyVoucher records...`);
    await prisma.tallyVoucher.createMany({ data: tallyVouchersToCreate });

    console.log(`Inserting ${salesToCreate.length} Sale records...`);
    await prisma.sale.createMany({ data: salesToCreate });

    console.log(`Inserting ${paymentsToCreate.length} Payment records...`);
    await prisma.payment.createMany({ data: paymentsToCreate });

    console.log(`Inserting ${creditLedgersToCreate.length} CreditLedger records...`);
    await prisma.creditLedger.createMany({ data: creditLedgersToCreate });

    console.log("\n--- STEP 4: RECALCULATING DERIVED BALANCES & RUNNING LEDGERS ---");

    const customers = await prisma.customer.findMany({ select: { id: true, openingBalance: true } });
    for (const c of customers) {
      const ob = c.openingBalance ?? new Prisma.Decimal(0);
      const salesSum = await prisma.creditLedger.aggregate({
        where: { customerId: c.id, transactionType: "CREDIT_SALE" },
        _sum: { amount: true },
      });
      const receiptsSum = await prisma.creditLedger.aggregate({
        where: { customerId: c.id, transactionType: "PAYMENT_RECEIVED" },
        _sum: { amount: true },
      });

      const totalD = salesSum._sum.amount ?? new Prisma.Decimal(0);
      const totalC = receiptsSum._sum.amount ?? new Prisma.Decimal(0);
      const curBal = ob.add(totalD).sub(totalC);

      await prisma.customer.update({
        where: { id: c.id },
        data: { currentBalance: curBal },
      });
    }
    console.log("✓ Customer balances updated.");
  }

  console.log("\n==================================================");
  console.log("BENCHMARK VERIFICATION RESULTS");
  console.log("==================================================");

  let finalCust = totalCustomers;
  let finalTx = totalTransactions;
  let finalSales = totalSales;
  let finalReceipts = totalReceipts;
  let finalOB = totalOpeningBalance;
  let finalD = totalDebitAmount;
  let finalC = totalCreditAmount;

  if (isExecute) {
    finalCust = await prisma.customer.count();
    finalSales = await prisma.sale.count();
    finalReceipts = await prisma.payment.count();
    finalTx = await prisma.tallyVoucher.count();

    const obAgg = await prisma.customer.aggregate({ _sum: { openingBalance: true } });
    finalOB = obAgg._sum.openingBalance ?? new Prisma.Decimal(0);

    const debitAgg = await prisma.sale.aggregate({ where: { status: "COMPLETED" }, _sum: { grandTotal: true } });
    finalD = debitAgg._sum.grandTotal ?? new Prisma.Decimal(0);

    const creditAgg = await prisma.payment.aggregate({ where: { status: "COMPLETED" }, _sum: { amount: true } });
    finalC = creditAgg._sum.amount ?? new Prisma.Decimal(0);
  }

  console.log(`Customers Count: ${finalCust} (Expected: 541)`);
  console.log(`Transactions Count: ${finalTx} (Expected: 4220)`);
  console.log(`Sales Count: ${finalSales} (Expected: 516)`);
  console.log(`Receipts Count: ${finalReceipts} (Expected: 3704)`);
  console.log(`Opening Balance Total: ₹${Number(finalOB).toLocaleString("en-IN")} (Expected: ₹9,28,290)`);
  console.log(`Total Debit/Sales: ₹${Number(finalD).toLocaleString("en-IN")} (Expected: ₹39,53,125)`);
  console.log(`Total Credit/Receipts: ₹${Number(finalC).toLocaleString("en-IN")} (Expected: ₹44,69,004)`);

  if (!isExecute) {
    console.log("\n⚠️ DRY-RUN COMPLETE. Run with --execute to apply changes.");
  } else {
    console.log("\n✅ RE-IMPORT EXECUTED SUCCESSFULLY.");
  }
}

main()
  .catch((err) => {
    console.error("Re-import failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
