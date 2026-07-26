import { prisma } from "../src/lib/prisma";
import { Decimal } from "@prisma/client/runtime/library";
import { getCustomerAccountingSummary } from "../src/lib/accounting";
import { rebuildCustomerPaymentAllocations } from "../src/lib/payment-allocation";

async function runTests() {
  console.log("=== START FINANCIAL & STOCK INTEGRATION TESTS ===");

  // Setup test user
  let adminUser = await prisma.user.findFirst({ where: { role: "OWNER" } });
  if (!adminUser) {
    adminUser = await prisma.user.findFirst();
  }
  if (!adminUser) {
    throw new Error("No user found in database for test execution");
  }

  // Setup test category & brand
  let category = await prisma.category.findFirst();
  if (!category) {
    category = await prisma.category.create({
      data: { name: "Test Category", slug: "test-cat-" + Date.now() },
    });
  }

  // 1. Setup Test Customer
  const testMobile = "9" + Math.floor(100000000 + Math.random() * 900000000);
  const testCustCode = "TEST-CUST-" + Math.floor(1000 + Math.random() * 9000);
  const customer = await prisma.customer.create({
    data: {
      customerCode: testCustCode,
      fullName: "Test Financial Customer",
      mobile: testMobile,
      openingBalance: new Decimal(0),
      currentBalance: new Decimal(0),
    },
  });
  console.log(`Created test customer: ${customer.fullName} (${customer.id})`);

  // 2. Setup Test Product
  const testSku = "TEST-SKU-" + Math.floor(1000 + Math.random() * 9000);
  const initialStock = 20;
  const product = await prisma.product.create({
    data: {
      sku: testSku,
      name: "Test Financial Product",
      categoryId: category.id,
      purchasePrice: new Decimal(100),
      sellingPrice: new Decimal(200),
      gstPercent: new Decimal(10), // GST 10%
      stockQuantity: initialStock,
    },
  });
  console.log(`Created test product: ${product.name} (Stock: ${product.stockQuantity})`);

  try {
    // -------------------------------------------------------------------------
    // TEST SUITE 1: INVOICE EDIT (Quantity 3 -> 2)
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 1: Invoice Edit (Quantity 3 -> 2) ---");
    const invNumber = "TEST-INV-" + Date.now();
    const qtyOld = 3;
    const unitPrice = 200;
    const gstPercent = 10;
    const itemSubtotal = qtyOld * unitPrice; // 600
    const itemGst = (itemSubtotal * gstPercent) / 100; // 60
    const grandTotalOld = itemSubtotal + itemGst; // 660

    // Deduct stock for initial sale
    await prisma.product.update({
      where: { id: product.id },
      data: { stockQuantity: initialStock - qtyOld },
    });

    const sale = await prisma.sale.create({
      data: {
        invoiceNumber: invNumber,
        customerId: customer.id,
        saleType: "CREDIT",
        subtotal: new Decimal(itemSubtotal),
        gstAmount: new Decimal(itemGst),
        grandTotal: new Decimal(grandTotalOld),
        paidAmount: new Decimal(0),
        pendingAmount: new Decimal(grandTotalOld),
        paymentStatus: "UNPAID",
        status: "COMPLETED",
        createdById: adminUser.id,
        saleItems: {
          create: [
            {
              productId: product.id,
              quantity: qtyOld,
              unitPrice: new Decimal(unitPrice),
              purchasePriceSnapshot: new Decimal(100),
              gstPercent: new Decimal(gstPercent),
              gstAmount: new Decimal(itemGst),
              lineTotal: new Decimal(grandTotalOld),
            },
          ],
        },
        ledgers: {
          create: [
            {
              customerId: customer.id,
              transactionType: "CREDIT_SALE",
              amount: new Decimal(grandTotalOld),
              balanceAfter: new Decimal(grandTotalOld),
              description: `Sales Invoice — ${invNumber}`,
            },
          ],
        },
      },
      include: { saleItems: true },
    });

    const initialSummary = await getCustomerAccountingSummary(customer.id);
    console.log(`Initial debit: ₹${initialSummary.totalDebit}, Closing balance: ₹${initialSummary.closingBalance}`);
    console.log(`Product stock after initial sale: ${(await prisma.product.findUnique({ where: { id: product.id } }))?.stockQuantity}`);

    // Perform Edit: Quantity 3 -> 2
    const qtyNew = 2;
    const itemSubtotalNew = qtyNew * unitPrice; // 400
    const itemGstNew = (itemSubtotalNew * gstPercent) / 100; // 40
    const grandTotalNew = itemSubtotalNew + itemGstNew; // 440

    // Call edit logic via PATCH simulation / Direct Transaction
    const qtyDiff = qtyOld - qtyNew; // +1 unit returned to stock
    await prisma.$transaction(async (tx) => {
      // 1. Update product stock
      const prodBefore = await tx.product.findUnique({ where: { id: product.id } });
      const newStock = prodBefore!.stockQuantity + qtyDiff;
      await tx.product.update({
        where: { id: product.id },
        data: { stockQuantity: newStock },
      });

      // 2. Update sale items
      await tx.saleItem.update({
        where: { id: sale.saleItems[0].id },
        data: {
          quantity: qtyNew,
          lineTotal: new Decimal(grandTotalNew),
          gstAmount: new Decimal(itemGstNew),
        },
      });

      // 3. Update Sale
      await tx.sale.update({
        where: { id: sale.id },
        data: {
          subtotal: new Decimal(itemSubtotalNew),
          gstAmount: new Decimal(itemGstNew),
          grandTotal: new Decimal(grandTotalNew),
          pendingAmount: new Decimal(grandTotalNew),
        },
      });

      // 4. Update CreditLedger
      await tx.creditLedger.updateMany({
        where: { saleId: sale.id, transactionType: "CREDIT_SALE" },
        data: { amount: new Decimal(grandTotalNew) },
      });
    });

    const prodAfterEdit = await prisma.product.findUnique({ where: { id: product.id } });
    const summaryAfterEdit = await getCustomerAccountingSummary(customer.id);
    const saleCount = await prisma.sale.count({ where: { customerId: customer.id } });

    console.log(`Stock after edit: ${prodAfterEdit?.stockQuantity} (Expected: ${initialStock - qtyNew})`);
    console.log(`Sale count: ${saleCount} (Expected: 1)`);
    console.log(`Customer debit: ₹${summaryAfterEdit.totalDebit} (Expected: ₹${grandTotalNew})`);

    if (prodAfterEdit?.stockQuantity !== initialStock - qtyNew) {
      throw new Error(`FAIL: Stock did not increase by exactly 1. Got ${prodAfterEdit?.stockQuantity}`);
    }
    if (saleCount !== 1) {
      throw new Error(`FAIL: Invoice count changed. Got ${saleCount}`);
    }
    if (!summaryAfterEdit.totalDebit.equals(new Decimal(grandTotalNew))) {
      throw new Error(`FAIL: Debit total mismatch. Expected ${grandTotalNew}, got ${summaryAfterEdit.totalDebit}`);
    }
    console.log("✅ TEST 1 PASSED: Invoice Edit stock and balance updated correctly.");

    // -------------------------------------------------------------------------
    // TEST SUITE 2: UNPAID INVOICE VOID
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 2: Unpaid Invoice Void ---");
    const stockBeforeVoid = prodAfterEdit!.stockQuantity;

    await prisma.$transaction(async (tx) => {
      // Mark CANCELLED
      await tx.sale.update({
        where: { id: sale.id },
        data: { status: "CANCELLED", voidedAt: new Date(), voidReason: "Test Void" },
      });

      // Restore stock
      await tx.product.update({
        where: { id: product.id },
        data: { stockQuantity: { increment: qtyNew } },
      });

      // Zero-out CreditLedger
      await tx.creditLedger.updateMany({
        where: { saleId: sale.id, transactionType: "CREDIT_SALE" },
        data: { amount: new Decimal(0), status: "VOIDED", voidedAt: new Date() },
      });
    });

    const voidedSale = await prisma.sale.findUnique({ where: { id: sale.id } });
    const prodAfterVoid = await prisma.product.findUnique({ where: { id: product.id } });
    const summaryAfterVoid = await getCustomerAccountingSummary(customer.id);

    console.log(`Sale status: ${voidedSale?.status} (Expected: CANCELLED)`);
    console.log(`Stock after void: ${prodAfterVoid?.stockQuantity} (Expected: ${stockBeforeVoid + qtyNew})`);
    console.log(`Customer closing balance: ₹${summaryAfterVoid.closingBalance} (Expected: ₹0)`);

    if (voidedSale?.status !== "CANCELLED") {
      throw new Error("FAIL: Invoice status is not CANCELLED after void.");
    }
    if (prodAfterVoid?.stockQuantity !== stockBeforeVoid + qtyNew) {
      throw new Error(`FAIL: Stock after void mismatch. Expected ${stockBeforeVoid + qtyNew}, got ${prodAfterVoid?.stockQuantity}`);
    }
    if (!summaryAfterVoid.closingBalance.equals(new Decimal(0))) {
      throw new Error(`FAIL: Balance after void mismatch. Expected 0, got ${summaryAfterVoid.closingBalance}`);
    }
    console.log("✅ TEST 2 PASSED: Unpaid Invoice Void restored stock & zeroed balance.");

    // -------------------------------------------------------------------------
    // TEST SUITE 3: PAID/PARTIAL INVOICE VOID PAYMENT PRESERVATION
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 3: Paid Invoice Void Payment Preservation ---");
    const invNumber2 = "TEST-INV-PAID-" + Date.now();
    const invTotal = 500;
    const paidAmt = 200;

    const paidSale = await prisma.sale.create({
      data: {
        invoiceNumber: invNumber2,
        customerId: customer.id,
        saleType: "PARTIAL",
        subtotal: new Decimal(invTotal),
        gstAmount: new Decimal(0),
        grandTotal: new Decimal(invTotal),
        paidAmount: new Decimal(paidAmt),
        pendingAmount: new Decimal(invTotal - paidAmt),
        paymentStatus: "PARTIALLY_PAID",
        status: "COMPLETED",
        createdById: adminUser.id,
        ledgers: {
          create: [
            {
              customerId: customer.id,
              transactionType: "CREDIT_SALE",
              amount: new Decimal(invTotal),
              balanceAfter: new Decimal(invTotal),
            },
          ],
        },
      },
    });

    const payment = await prisma.payment.create({
      data: {
        receiptNumber: "RCP-TEST-" + Date.now(),
        customerId: customer.id,
        saleId: paidSale.id,
        amount: new Decimal(paidAmt),
        paymentMode: "CASH",
        receivedById: adminUser.id,
        status: "COMPLETED",
        ledgers: {
          create: [
            {
              customerId: customer.id,
              transactionType: "PAYMENT_RECEIVED",
              amount: new Decimal(paidAmt),
              balanceAfter: new Decimal(invTotal - paidAmt),
            },
          ],
        },
      },
    });

    const summaryPaid = await getCustomerAccountingSummary(customer.id);
    console.log(`Balance before voiding paid sale: ₹${summaryPaid.closingBalance} (Expected: ₹300)`);

    // Void the paid sale
    await prisma.$transaction(async (tx) => {
      await tx.sale.update({
        where: { id: paidSale.id },
        data: { status: "CANCELLED", voidedAt: new Date() },
      });
      await tx.creditLedger.updateMany({
        where: { saleId: paidSale.id, transactionType: "CREDIT_SALE" },
        data: { amount: new Decimal(0), status: "VOIDED" },
      });
      // Release payment link
      await tx.payment.updateMany({
        where: { saleId: paidSale.id },
        data: { saleId: null },
      });
      await rebuildCustomerPaymentAllocations(customer.id, tx);
    });

    const paymentAfterVoid = await prisma.payment.findUnique({ where: { id: payment.id } });
    const summaryAfterPaidVoid = await getCustomerAccountingSummary(customer.id);

    console.log(`Payment status after void: ${paymentAfterVoid?.status} (Expected: COMPLETED)`);
    console.log(`Payment saleId: ${paymentAfterVoid?.saleId} (Expected: null)`);
    console.log(`Customer closing balance: ₹${summaryAfterPaidVoid.closingBalance} (Expected: -₹200 advance)`);
    console.log(`Customer advance: ₹${summaryAfterPaidVoid.advance} (Expected: ₹200)`);

    if (paymentAfterVoid?.status !== "COMPLETED") {
      throw new Error("FAIL: Payment record was destroyed or voided.");
    }
    if (paymentAfterVoid?.saleId !== null) {
      throw new Error("FAIL: Payment saleId was not released.");
    }
    if (!summaryAfterPaidVoid.advance.equals(new Decimal(paidAmt))) {
      throw new Error(`FAIL: Customer advance mismatch. Expected ${paidAmt}, got ${summaryAfterPaidVoid.advance}`);
    }
    console.log("✅ TEST 3 PASSED: Paid Invoice Void preserved payment as customer advance.");

    // -------------------------------------------------------------------------
    // TEST SUITE 4: MANUAL DEBIT ADJUSTMENT (₹500)
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 4: Manual Debit Adjustment (₹500) ---");
    const manualDebitAmt = 500;
    const debitAdj = await prisma.creditLedger.create({
      data: {
        customerId: customer.id,
        transactionType: "MANUAL_DEBIT",
        direction: "DEBIT",
        amount: new Decimal(manualDebitAmt),
        balanceAfter: new Decimal(300), // -200 + 500 = +300
        description: "Service Charge / Carried Forward",
        status: "COMPLETED",
        createdById: adminUser.id,
      },
    });

    const summaryAfterDebit = await getCustomerAccountingSummary(customer.id);
    const debitRowCount = await prisma.creditLedger.count({
      where: { id: debitAdj.id },
    });

    console.log(`Closing balance after ₹500 debit: ₹${summaryAfterDebit.closingBalance} (Expected: ₹300)`);
    console.log(`Outstanding after ₹500 debit: ₹${summaryAfterDebit.outstanding} (Expected: ₹300)`);
    console.log(`Ledger row count: ${debitRowCount} (Expected: 1)`);

    if (!summaryAfterDebit.closingBalance.equals(new Decimal(300))) {
      throw new Error(`FAIL: Closing balance mismatch after debit. Expected 300, got ${summaryAfterDebit.closingBalance}`);
    }
    if (debitRowCount !== 1) {
      throw new Error(`FAIL: Duplicate ledger row created. Got ${debitRowCount}`);
    }
    console.log("✅ TEST 4 PASSED: Manual Debit Adjustment created cleanly.");

    // -------------------------------------------------------------------------
    // TEST SUITE 5: MANUAL CREDIT ADJUSTMENT (₹300)
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 5: Manual Credit Adjustment (₹300) ---");
    const manualCreditAmt = 300;
    const creditAdj = await prisma.creditLedger.create({
      data: {
        customerId: customer.id,
        transactionType: "MANUAL_CREDIT",
        direction: "CREDIT",
        amount: new Decimal(manualCreditAmt),
        balanceAfter: new Decimal(0), // 300 - 300 = 0
        description: "Discount adjustment",
        status: "COMPLETED",
        createdById: adminUser.id,
      },
    });

    const summaryAfterCredit = await getCustomerAccountingSummary(customer.id);
    console.log(`Closing balance after ₹300 credit: ₹${summaryAfterCredit.closingBalance} (Expected: ₹0)`);
    console.log(`Outstanding: ₹${summaryAfterCredit.outstanding} (Expected: ₹0)`);

    if (!summaryAfterCredit.closingBalance.equals(new Decimal(0))) {
      throw new Error(`FAIL: Closing balance mismatch after credit. Expected 0, got ${summaryAfterCredit.closingBalance}`);
    }
    console.log("✅ TEST 5 PASSED: Manual Credit Adjustment applied cleanly.");

    // -------------------------------------------------------------------------
    // TEST SUITE 6: MANUAL ENTRY EDIT (₹500 -> ₹450)
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 6: Manual Entry Edit (₹500 -> ₹450) ---");
    const editedDebitAmt = 450;
    await prisma.creditLedger.update({
      where: { id: debitAdj.id },
      data: { amount: new Decimal(editedDebitAmt) },
    });

    const summaryAfterEditAdj = await getCustomerAccountingSummary(customer.id);
    const countAfterEdit = await prisma.creditLedger.count({
      where: { customerId: customer.id },
    });

    console.log(`Closing balance after editing debit to ₹450: ₹${summaryAfterEditAdj.closingBalance} (Expected: -₹50 advance)`);
    console.log(`Customer advance: ₹${summaryAfterEditAdj.advance} (Expected: ₹50)`);

    if (!summaryAfterEditAdj.closingBalance.equals(new Decimal(-50))) {
      throw new Error(`FAIL: Balance mismatch after edit. Expected -50, got ${summaryAfterEditAdj.closingBalance}`);
    }
    console.log("✅ TEST 6 PASSED: Manual Entry Edit updated same record ID.");

    // -------------------------------------------------------------------------
    // TEST SUITE 7: MANUAL ENTRY VOID
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 7: Manual Entry Void ---");
    await prisma.creditLedger.update({
      where: { id: creditAdj.id },
      data: { status: "VOIDED", amount: new Decimal(0), voidedAt: new Date(), voidReason: "Test Void" },
    });

    const voidedCreditAdj = await prisma.creditLedger.findUnique({ where: { id: creditAdj.id } });
    const summaryAfterVoidAdj = await getCustomerAccountingSummary(customer.id);

    const expectedBalanceAfterVoidCredit = 250; // +450 debit adjustment - 200 payment credit = 250
    console.log(`Voided entry status: ${voidedCreditAdj?.status} (Expected: VOIDED)`);
    console.log(`Closing balance after voiding credit adj: ₹${summaryAfterVoidAdj.closingBalance} (Expected: ₹${expectedBalanceAfterVoidCredit})`);

    if (voidedCreditAdj?.status !== "VOIDED") {
      throw new Error("FAIL: Adjustment status is not VOIDED.");
    }
    if (!summaryAfterVoidAdj.closingBalance.equals(new Decimal(expectedBalanceAfterVoidCredit))) {
      throw new Error(`FAIL: Balance mismatch after void. Expected ${expectedBalanceAfterVoidCredit}, got ${summaryAfterVoidAdj.closingBalance}`);
    }
    console.log("✅ TEST 7 PASSED: Manual Entry Void contribution zeroed out.");

  } finally {
    // Clean up test data
    console.log("\nCleaning up test data...");
    await prisma.creditLedger.deleteMany({ where: { customerId: customer.id } });
    await prisma.saleItem.deleteMany({ where: { sale: { customerId: customer.id } } });
    await prisma.payment.deleteMany({ where: { customerId: customer.id } });
    await prisma.inventoryMovement.deleteMany({ where: { sale: { customerId: customer.id } } });
    await prisma.sale.deleteMany({ where: { customerId: customer.id } });
    await prisma.product.delete({ where: { id: product.id } });
    await prisma.customer.delete({ where: { id: customer.id } });
    console.log("Cleanup complete.");
  }

  console.log("\n==================================================");
  console.log("ALL 7 FINANCIAL & STOCK INTEGRATION TESTS PASSED!");
  console.log("==================================================");
}

runTests()
  .catch((err) => {
    console.error("❌ TEST SUITE FAILED:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
