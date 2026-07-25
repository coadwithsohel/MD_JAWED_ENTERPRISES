import { parseRupeeAmount } from "../src/lib/money";

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (String(actual) !== String(expected)) {
    throw new Error(`Assertion failed for ${message}: Expected ${expected}, got ${actual}`);
  }
  console.log(`✅ PASS: ${message}`);
}

function runTests() {
  console.log("Running money unit tests...");

  assertEqual(parseRupeeAmount("12500.00").toNumber(), 12500, "12500.00 -> 12500");
  assertEqual(parseRupeeAmount("12,500.00").toNumber(), 12500, "12,500.00 -> 12500");
  assertEqual(parseRupeeAmount("600.00").toNumber(), 600, "600.00 -> 600");
  assertEqual(parseRupeeAmount("2400.00").toNumber(), 2400, "2400.00 -> 2400");
  assertEqual(parseRupeeAmount("-850.50").toNumber(), -850.5, "-850.50 -> -850.5");
  assertEqual(parseRupeeAmount("0.00").toNumber(), 0, "0.00 -> 0");
  assertEqual(parseRupeeAmount("₹ 1,500.25").toNumber(), 1500.25, "₹ 1,500.25 -> 1500.25");

  try {
    parseRupeeAmount("invalid");
    throw new Error("Failed to throw on invalid input");
  } catch (err: any) {
    if (err.message === "INVALID_MONEY_VALUE") {
      console.log("✅ PASS: Correctly threw INVALID_MONEY_VALUE on invalid input");
    } else {
      throw err;
    }
  }

  console.log("ALL MONEY TESTS PASSED!");
}

runTests();
