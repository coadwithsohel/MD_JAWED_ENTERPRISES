import test from "node:test";
import assert from "node:assert/strict";
import { parseTallyCsv, validateVouchers } from "../src/lib/tally-xml-parser";

test("parseTallyCsv normalizes customer, date, and amounts", () => {
  const csv = [
    "customerName,voucherDate,voucherType,voucherNumber,debit,credit,narration",
    "Ahamad Khan,2026-07-20,Sales,INV-1001,5000,0,Mobile sale",
    "Ahamad Khan,2026-07-21,Receipt,RCPT-2001,0,2000,Partial payment",
  ].join("\n");

  const vouchers = parseTallyCsv(csv, "sample.csv");
  assert.equal(vouchers.length, 2);
  assert.equal(vouchers[0].voucherType, "SALES");
  assert.equal(vouchers[0].debit, 5000);
  assert.equal(vouchers[1].voucherType, "RECEIPT");
  assert.equal(vouchers[1].credit, 2000);
});

test("validateVouchers counts totals and voucher categories", () => {
  const result = validateVouchers([
    {
      customerName: "A",
      voucherDate: "2026-07-20",
      voucherType: "SALES",
      debit: 1000,
      credit: 0,
    },
    {
      customerName: "A",
      voucherDate: "2026-07-21",
      voucherType: "RECEIPT",
      debit: 0,
      credit: 200,
    },
    {
      customerName: "A",
      voucherDate: "2026-07-22",
      voucherType: "DEBIT_NOTE",
      debit: 300,
      credit: 0,
    },
    {
      customerName: "A",
      voucherDate: "2026-07-23",
      voucherType: "CREDIT_NOTE",
      debit: 0,
      credit: 100,
    },
  ]);

  assert.equal(result.summary.sales, 1);
  assert.equal(result.summary.receipts, 1);
  assert.equal(result.summary.debitNotes, 1);
  assert.equal(result.summary.creditNotes, 1);
  assert.equal(result.summary.totalDebit, 1300);
  assert.equal(result.summary.totalCredit, 300);
});
