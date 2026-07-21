import test from "node:test";
import assert from "node:assert/strict";
import { parseTallyCsv, validateVouchers } from "../src/lib/tally-xml-parser";
import { parseSignedAmount } from "../src/lib/money";

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

test("parseTallyCsv supports transaction import headers", () => {
  const csv = [
    "Customer Name,Mobile,Date,Voucher Type,Voucher Number,Particulars,Debit,Credit,Source Entry Key,Source GUID,Source Remote ID,Source VCH Key,Source Master ID,Narration,Source File",
    "Ahamad Khan,9999999999,2026-07-20,Sales,INV-1001,Mobile sale,5000,0,ENT-1,GUID-1,REM-1,VCH-1,MASTER-1,Mobile sale,transaction_import_final.csv",
  ].join("\n");

  const vouchers = parseTallyCsv(csv, "transaction_import_final.csv");
  assert.equal(vouchers.length, 1);
  assert.equal(vouchers[0].customerName, "Ahamad Khan");
  assert.equal(vouchers[0].voucherType, "SALES");
  assert.equal(vouchers[0].debit, 5000);
  assert.equal(vouchers[0].tallyGuid, "GUID-1");
});

test("parseTallyCsv supports transaction date headers", () => {
  const csv = [
    "Customer Name,Transaction Date,Voucher Type,Debit,Credit",
    "Ahamad Khan,2026-07-22,Sales,1200,0",
  ].join("\n");

  const vouchers = parseTallyCsv(csv, "transaction_date.csv");
  assert.equal(vouchers.length, 1);
  assert.equal(vouchers[0].voucherDate, "2026-07-22");
});

test("parseTallyCsv handles UTF-8 BOM and whitespace-padded headers", () => {
  const csv = [
    "\uFEFF Customer Name , Mobile , Date , Voucher Type , Voucher Number , Particulars , Debit , Credit , Source Entry Key , Source GUID , Source Remote ID , Source VCH Key , Source Master ID , Narration , Source File ",
    "Ahamad Khan,9999999999,2026-07-20,Sales,INV-1001,Mobile sale,5000,0,ENT-1,GUID-1,REM-1,VCH-1,MASTER-1,Mobile sale,transaction_import_final.csv",
  ].join("\n");

  const vouchers = parseTallyCsv(csv, "transaction_import_final.csv");
  assert.equal(vouchers.length, 1);
  assert.equal(vouchers[0].customerName, "Ahamad Khan");
  assert.equal(vouchers[0].voucherType, "SALES");
  assert.equal(vouchers[0].debit, 5000);
});

test("parseSignedAmount preserves negative values", () => {
  assert.equal(parseSignedAmount("-500"), -500);
  assert.equal(parseSignedAmount("1000"), 1000);
  assert.equal(parseSignedAmount("0"), 0);
  assert.equal(parseSignedAmount("₹1,200.50"), 1200.5);
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
