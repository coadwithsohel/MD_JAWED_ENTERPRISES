function parseRupees(value: unknown): number {
  const normalized = String(value ?? "")
    .replace(/₹/g, "")
    .replace(/,/g, "")
    .trim();

  const amount = Number(normalized);

  if (!Number.isFinite(amount)) {
    throw new Error("Invalid amount");
  }

  return amount;
}

function calculatePreview(
  currentBalance: number | string,
  amount: number | string,
  entryType: "PAYMENT" | "MANUAL_DEBIT" | "MANUAL_CREDIT"
) {
  const amountNum = parseRupees(amount);
  const currentBalNum = parseRupees(currentBalance);
  let balanceAfter = currentBalNum;
  if (entryType === "MANUAL_DEBIT") {
    balanceAfter += amountNum;
  } else {
    balanceAfter -= amountNum;
  }
  return balanceAfter;
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (String(actual) !== String(expected)) {
    throw new Error(`Assertion failed for ${message}: Expected ${expected}, got ${actual}`);
  }
  console.log(`✅ PASS: ${message}`);
}

function runTests() {
  console.log("Running Bulk Entry Preview Tests...");

  // Manual Debit: 2000 + 1500 = 3500
  assertEqual(calculatePreview("2000", "1500", "MANUAL_DEBIT"), 3500, "Manual Debit");

  // Manual Credit: 2000 - 500 = 1500
  assertEqual(calculatePreview(2000, 500, "MANUAL_CREDIT"), 1500, "Manual Credit");

  // Manual Credit crossing zero: 500 - 700 = -200 advance
  assertEqual(calculatePreview("500.00", "700.00", "MANUAL_CREDIT"), -200, "Manual Credit crossing zero");

  // Payment: 6100.01 - 100 = 6000.01
  assertEqual(calculatePreview("6100.01", "100.00", "PAYMENT"), 6000.01, "Payment with decimals");

  // Decimal amount: 2000.50 + 100.25 = 2100.75
  assertEqual(calculatePreview("2000.50", "100.25", "MANUAL_DEBIT"), 2100.75, "Decimal amount addition");

  console.log("ALL BULK ENTRY PREVIEW TESTS PASSED!");
}

runTests();
