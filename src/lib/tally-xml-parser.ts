/**
 * Tally XML Parser
 *
 * Parses Tally Accounting XML export files into normalized voucher objects
 * ready for preview and import.
 *
 * Supports:
 * - Sales vouchers
 * - Receipt vouchers
 * - Debit Notes
 * - Credit Notes
 * - Payment / Refund
 * - Journal / Adjustment
 * - Opening Balance (when explicitly present)
 */

export type TallyVoucherType =
  | "SALES"
  | "RECEIPT"
  | "DEBIT_NOTE"
  | "CREDIT_NOTE"
  | "PAYMENT"
  | "JOURNAL"
  | "OPENING_BALANCE";

export interface TallyVoucherInput {
  tallyGuid?: string;
  tallyRemoteId?: string;
  tallyMasterId?: string;
  voucherKey?: string;
  customerName: string;
  mobile?: string;
  voucherDate: string; // ISO date string YYYY-MM-DD
  dueDate?: string;
  paymentDate?: string;
  voucherType: TallyVoucherType;
  voucherNumber?: string;
  againstVoucherNumber?: string;
  paymentStatus?: string;
  debit: number;
  credit: number;
  narration?: string;
  reference?: string;
  sourceFileName?: string;
  matchedCustomerId?: string;
  matchedCustomerName?: string;
}

interface VoucherEntry {
  isPartyLedger: boolean;
  ledgerName: string;
  amount: number;
  isDeemedPositive: boolean;
  billAllocations?: Array<{
    name: string;
    billType: string;
    amount: number;
  }>;
}

/**
 * Extract text content from an XML element
 */
function getElementText(xml: string, tagName: string): string {
  const match = xml.match(
    new RegExp(`<${tagName}[^>]*>([^<]*)</${tagName}>`, "i"),
  );
  return match ? match[1].trim() : "";
}

/**
 * Extract all elements matching a tag pattern recursively
 */
function extractAllElements(xml: string, tagName: string): string[] {
  const results: string[] = [];
  const regex = new RegExp(`<${tagName}[^>]*>.*?</${tagName}>`, "gs");
  let match;
  while ((match = regex.exec(xml)) !== null) {
    results.push(match[0]);
  }
  return results;
}

/**
 * Parse a single LEDGERENTRY block and return normalized values.
 * Handles ISDEEMEDPOSITIVE flag correctly.
 */
function parseLedgerEntry(entryXml: string): {
  isPartyLedger: boolean;
  ledgerName: string;
  amount: number;
  isDeemedPositive: boolean;
} {
  const ledgerName = getElementText(entryXml, "LEDGERNAME");
  const amountRaw = getElementText(entryXml, "AMOUNT");
  const isDeemedPositive =
    getElementText(entryXml, "ISDEEMEDPOSITIVE").toUpperCase() === "YES";
  const isPartyLedger =
    getElementText(entryXml, "ISPARTYLEDGER").toUpperCase() === "YES";

  // Parse amount - Tally amounts are typically positive for debits in the party ledger
  // ISDEEMEDPOSITIVE changes the sign convention
  let amount = parseFloat(amountRaw.replace(/,/g, ""));
  if (isNaN(amount)) amount = 0;

  // When ISDEEMEDPOSITIVE=Yes, the amount sign in Tally XML is inverted.
  // We normalize so that positive = debit to the party, negative = credit to the party.
  if (isDeemedPositive) {
    amount = -amount;
  }

  return { isPartyLedger, ledgerName, amount, isDeemedPositive };
}

/**
 * Parse a single VOUCHER block from Tally XML into a normalized TallyVoucherInput.
 */
function parseVoucher(
  voucherXml: string,
  sourceFileName: string,
): TallyVoucherInput | null {
  const voucherTypeName = getElementText(voucherXml, "VOUCHERTYPENAME")
    .toUpperCase()
    .trim();
  const voucherNumber = getElementText(voucherXml, "VOUCHERNUMBER");
  const dateStr = getElementText(voucherXml, "DATE");
  const effectiveDateStr = getElementText(voucherXml, "EFFECTIVEDATE");
  const narration = getElementText(voucherXml, "NARRATION");
  const guid = getElementText(voucherXml, "GUID");
  const remoteId = getElementText(voucherXml, "REMOTEID");
  const masterId = getElementText(voucherXml, "MASTERID");
  const voucherKey = getElementText(voucherXml, "VCHKEY");

  // Parse ledger entries
  const ledgerEntriesXml = extractAllElements(voucherXml, "LEDGERENTRIES.LIST");
  const allLedgerEntries: VoucherEntry[] = [];

  for (const entryXml of ledgerEntriesXml) {
    const parsed = parseLedgerEntry(entryXml);
    allLedgerEntries.push(parsed);
  }

  // Also check ALLLEDGERENTRIES.LIST
  const allLedgerEntriesXml = extractAllElements(
    voucherXml,
    "ALLLEDGERENTRIES.LIST",
  );
  for (const entryXml of allLedgerEntriesXml) {
    const parsed = parseLedgerEntry(entryXml);
    // Avoid duplicates
    if (
      !allLedgerEntries.some(
        (e) => e.ledgerName === parsed.ledgerName && e.amount === parsed.amount,
      )
    ) {
      allLedgerEntries.push(parsed);
    }
  }

  // Find the party ledger entry (customer)
  const partyEntry = allLedgerEntries.find((e) => e.isPartyLedger);

  // Get customer name from PARTYNAME or PARTYLEDGERNAME or from the party ledger entry
  let customerName = getElementText(voucherXml, "PARTYNAME");
  if (!customerName)
    customerName = getElementText(voucherXml, "PARTYLEDGERNAME");
  if (!customerName && partyEntry) customerName = partyEntry.ledgerName;
  if (!customerName) return null; // Skip vouchers without a customer reference

  if (!dateStr) return null;

  // Normalize date to YYYY-MM-DD
  const voucherDate = normalizeDate(dateStr || effectiveDateStr);
  if (!voucherDate) return null;

  // Parse the party ledger amount
  const partyAmount = partyEntry ? partyEntry.amount : 0;

  // Determine voucher type and debit/credit
  const result = classifyVoucher(voucherTypeName, partyAmount);

  if (!result) return null;

  return {
    tallyGuid: guid || undefined,
    tallyRemoteId: remoteId || undefined,
    tallyMasterId: masterId || undefined,
    voucherKey: voucherKey || undefined,
    customerName,
    voucherDate,
    voucherType: result.voucherType,
    voucherNumber: voucherNumber || undefined,
    debit: result.debit,
    credit: result.credit,
    narration: narration || undefined,
    reference: voucherNumber || undefined,
    sourceFileName,
  };
}

/**
 * Normalize a Tally date string to YYYY-MM-DD
 */
export function normalizeTallyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

export function normalizeDate(dateStr: string): string | null {
  if (!dateStr) return null;

  // Try YYYYMMDD format (common in Tally)
  const yyyymmdd = dateStr.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (yyyymmdd) {
    return `${yyyymmdd[1]}-${yyyymmdd[2]}-${yyyymmdd[3]}`;
  }

  // Try DD-MM-YYYY or DD/MM/YYYY
  const dmy = dateStr.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  }

  // Try ISO format
  const iso = Date.parse(dateStr);
  if (!Number.isNaN(iso)) {
    const date = new Date(iso);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  }

  return null;
}

/**
 * Classify the voucher type and determine debit/credit for the customer party.
 *
 * Business rules:
 * - Sales → customer is debited (owes money)
 * - Receipt → customer is credited (paid money)
 * - Debit Note → customer is debited
 * - Credit Note → customer is credited
 * - Payment (customer refund) → depends on amount sign
 * - Journal → depends on amount sign
 */
function classifyVoucher(
  typeName: string,
  partyAmount: number,
): {
  voucherType: TallyVoucherInput["voucherType"];
  debit: number;
  credit: number;
} | null {
  const upperType = typeName.toUpperCase();

  // Sales
  if (upperType.includes("SALES") || upperType === "SALE") {
    const amount = Math.abs(partyAmount);
    if (amount <= 0) return null;
    return { voucherType: "SALES", debit: amount, credit: 0 };
  }

  // Receipt
  if (upperType === "RECEIPT" || upperType.includes("RECEIPT")) {
    const amount = Math.abs(partyAmount);
    if (amount <= 0) return null;
    return { voucherType: "RECEIPT", debit: 0, credit: amount };
  }

  // Debit Note
  if (
    upperType === "DEBIT NOTE" ||
    upperType === "DEBIT_NOTE" ||
    upperType.includes("DEBIT")
  ) {
    const amount = Math.abs(partyAmount);
    if (amount <= 0) return null;
    return { voucherType: "DEBIT_NOTE", debit: amount, credit: 0 };
  }

  // Credit Note
  if (
    upperType === "CREDIT NOTE" ||
    upperType === "CREDIT_NOTE" ||
    upperType.includes("CREDIT")
  ) {
    const amount = Math.abs(partyAmount);
    if (amount <= 0) return null;
    return { voucherType: "CREDIT_NOTE", debit: 0, credit: amount };
  }

  // Payment (customer refund/outgoing)
  if (upperType === "PAYMENT") {
    // For Payment vouchers, the party ledger amount determines the direction
    // Positive party amount = customer receives money (debit to customer?)
    // Negative party amount = customer gives money (credit to customer?)
    // Typically, a payment voucher paying TO a customer would be a debit
    if (partyAmount > 0) {
      return {
        voucherType: "PAYMENT",
        debit: Math.abs(partyAmount),
        credit: 0,
      };
    } else if (partyAmount < 0) {
      return {
        voucherType: "PAYMENT",
        debit: 0,
        credit: Math.abs(partyAmount),
      };
    }
    return null;
  }

  // Journal / Adjustment
  if (
    upperType === "JOURNAL" ||
    upperType.includes("JOURNAL") ||
    upperType === "ADJUSTMENT"
  ) {
    // For journal entries, use the party amount sign
    if (partyAmount > 0) {
      return {
        voucherType: "JOURNAL",
        debit: Math.abs(partyAmount),
        credit: 0,
      };
    } else if (partyAmount < 0) {
      return {
        voucherType: "JOURNAL",
        debit: 0,
        credit: Math.abs(partyAmount),
      };
    }
    return null;
  }

  // Opening Balance
  if (upperType === "OPENING BALANCE" || upperType === "OPENING_BALANCE") {
    if (partyAmount > 0) {
      return {
        voucherType: "OPENING_BALANCE",
        debit: Math.abs(partyAmount),
        credit: 0,
      };
    } else if (partyAmount < 0) {
      return {
        voucherType: "OPENING_BALANCE",
        debit: 0,
        credit: Math.abs(partyAmount),
      };
    }
    return null;
  }

  // Default: try to classify by amount sign
  if (partyAmount > 0) {
    return { voucherType: "JOURNAL", debit: Math.abs(partyAmount), credit: 0 };
  } else if (partyAmount < 0) {
    return { voucherType: "JOURNAL", debit: 0, credit: Math.abs(partyAmount) };
  }

  return null;
}

/**
 * Parse a complete Tally XML export string into an array of TallyVoucherInput objects.
 *
 * @param xmlContent - The complete Tally XML string
 * @param sourceFileName - Optional source filename for tracking
 * @returns Array of parsed vouchers
 */
export function parseTallyXml(
  xmlContent: string,
  sourceFileName: string = "tally-export.xml",
): TallyVoucherInput[] {
  const vouchers: TallyVoucherInput[] = [];

  // Extract all ENVELOPE blocks (standard Tally XML structure)
  const envelopes = extractAllElements(xmlContent, "ENVELOPE");

  // If no envelopes, try to extract VOUCHER blocks directly
  if (envelopes.length === 0) {
    const directVouchers = extractAllElements(xmlContent, "VOUCHER");
    for (const vXml of directVouchers) {
      const voucher = parseVoucher(vXml, sourceFileName);
      if (voucher) vouchers.push(voucher);
    }
    return vouchers;
  }

  // Parse each envelope
  for (const envelope of envelopes) {
    const voucherBlocks = extractAllElements(envelope, "VOUCHER");
    for (const vXml of voucherBlocks) {
      const voucher = parseVoucher(vXml, sourceFileName);
      if (voucher) vouchers.push(voucher);
    }
  }

  return vouchers;
}

/**
 * Parse a CSV row into cells, handling quoted fields.
 */
export function parseCsvRow(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

/**
 * Normalize a CSV header value.
 * Strips UTF-8 BOM, trims, lowercases, and collapses whitespace.
 */
export function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function parseStrictDate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const yyyymmdd = trimmed.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (yyyymmdd) {
    const year = Number(yyyymmdd[1]);
    const month = Number(yyyymmdd[2]);
    const day = Number(yyyymmdd[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
  }

  const dmy = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    const year = Number(dmy[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
  }

  const iso = Date.parse(trimmed);
  if (!Number.isNaN(iso)) {
    const date = new Date(iso);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  }

  return null;
}

function parseNumericValue(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/[₹,]/g, "").trim();
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function validateTransactionCsvHeaders(headers: string[]): {
  isValid: boolean;
  missing: string[];
} {
  const normalizedHeaders = headers.map(normalizeHeader);
  const requiredGroups = [
    ["customer name", "customername"],
    ["date", "voucherdate", "transaction date", "transactiondate"],
    ["voucher type", "vouchertype", "type"],
    ["debit"],
    ["credit"],
    ["source entry key", "sourceentrykey", "source vch key", "sourcevchkey"],
  ];
  const missing = requiredGroups
    .filter((group) => !group.some((key) => normalizedHeaders.includes(key)))
    .map((group) => group[0]);
  return { isValid: missing.length === 0, missing };
}

export function parseTallyCsv(
  csvContent: string,
  sourceFileName: string = "tally-import.csv",
): TallyVoucherInput[] {
  const lines = csvContent
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = parseCsvRow(lines[0]).map(normalizeHeader);
  const fieldMap: Record<string, string> = {
    "customer name": "customerName",
    customername: "customerName",
    mobile: "mobile",
    date: "voucherDate",
    "voucher date": "voucherDate",
    voucherdate: "voucherDate",
    "effective date": "voucherDate",
    "transaction date": "voucherDate",
    transactiondate: "voucherDate",
    "due date": "dueDate",
    duedate: "dueDate",
    "payment date": "paymentDate",
    paymentdate: "paymentDate",
    "voucher number": "voucherNumber",
    "voucher type": "voucherType",
    vouchertype: "voucherType",
    type: "voucherType",
    "against voucher number": "againstVoucherNumber",
    againstvouchernumber: "againstVoucherNumber",
    particulars: "particulars",
    narration: "narration",
    reference: "reference",
    "payment status": "paymentStatus",
    paymentstatus: "paymentStatus",
    debit: "debit",
    credit: "credit",
    "source entry key": "voucherKey",
    sourceentrykey: "voucherKey",
    "source guid": "tallyGuid",
    sourceguid: "tallyGuid",
    "source remote id": "tallyRemoteId",
    sourceremoteid: "tallyRemoteId",
    "source master id": "tallyMasterId",
    sourcemasterid: "tallyMasterId",
    "source vch key": "voucherKey",
    sourcevchkey: "voucherKey",
    sourcefile: "sourceFileName",
    "source file": "sourceFileName",
  };

  const indexByKey = new Map<string, number>();
  headers.forEach((header, idx) => {
    const canonical = fieldMap[header] || header;
    indexByKey.set(canonical, idx);
  });

  const vouchers: TallyVoucherInput[] = [];
  const seenVoucherKeys = new Set<string>();

  for (const line of lines.slice(1)) {
    const cells = parseCsvRow(line);
    const customerName = (
      cells[indexByKey.get("customerName") ?? -1] || ""
    ).trim();
    const mobile = (cells[indexByKey.get("mobile") ?? -1] || "").trim();
    const voucherDate = (
      cells[indexByKey.get("voucherDate") ?? -1] || ""
    ).trim();
    const voucherTypeRaw = (cells[indexByKey.get("voucherType") ?? -1] || "")
      .trim()
      .toUpperCase();
    const voucherNumber = (
      cells[indexByKey.get("voucherNumber") ?? -1] || ""
    ).trim();
    const narration = (
      cells[indexByKey.get("narration") ?? -1] ||
      cells[indexByKey.get("particulars") ?? -1] ||
      ""
    ).trim();
    const reference = (cells[indexByKey.get("reference") ?? -1] || "").trim();
    const dueDateRaw = (cells[indexByKey.get("dueDate") ?? -1] || "").trim();
    const paymentDateRaw = (cells[indexByKey.get("paymentDate") ?? -1] || "").trim();
    const againstVoucherNumber = (cells[indexByKey.get("againstVoucherNumber") ?? -1] || "").trim();
    const paymentStatus = (cells[indexByKey.get("paymentStatus") ?? -1] || "").trim();
    const debitValue = parseNumericValue(
      cells[indexByKey.get("debit") ?? -1] || "",
    );
    const creditValue = parseNumericValue(
      cells[indexByKey.get("credit") ?? -1] || "",
    );
    const voucherKey = (cells[indexByKey.get("voucherKey") ?? -1] || "").trim();
    const tallyGuid = (cells[indexByKey.get("tallyGuid") ?? -1] || "").trim();
    const tallyRemoteId = (
      cells[indexByKey.get("tallyRemoteId") ?? -1] || ""
    ).trim();
    const tallyMasterId = (
      cells[indexByKey.get("tallyMasterId") ?? -1] || ""
    ).trim();

    if (!customerName || !voucherDate) continue;

    const normalizedDate =
      parseStrictDate(voucherDate) || normalizeDate(voucherDate);
    if (!normalizedDate) continue;

    // Parse due date and payment date
    const dueDate = dueDateRaw ? (parseStrictDate(dueDateRaw) || normalizeDate(dueDateRaw)) : undefined;
    const paymentDate = paymentDateRaw ? (parseStrictDate(paymentDateRaw) || normalizeDate(paymentDateRaw)) : undefined;

    const debit = debitValue ?? 0;
    const credit = creditValue ?? 0;
    const hasDebit = debit > 0;
    const hasCredit = credit > 0;

    if (!hasDebit && !hasCredit) continue;
    if (hasDebit && hasCredit) continue;

    const normalizedType = classifyTypeFromText(voucherTypeRaw, debit, credit);
    if (!normalizedType) continue;

    const sourceKey = voucherKey || tallyGuid;
    if (sourceKey) {
      if (seenVoucherKeys.has(sourceKey)) continue;
      seenVoucherKeys.add(sourceKey);
    }

    vouchers.push({
      customerName,
      mobile: mobile || undefined,
      voucherDate: normalizedDate,
      dueDate: dueDate || undefined,
      paymentDate: paymentDate || undefined,
      voucherType: normalizedType,
      voucherNumber: voucherNumber || undefined,
      againstVoucherNumber: againstVoucherNumber || undefined,
      paymentStatus: paymentStatus || undefined,
      debit,
      credit,
      narration: narration || undefined,
      reference: reference || undefined,
      voucherKey: voucherKey || undefined,
      tallyGuid: tallyGuid || undefined,
      tallyRemoteId: tallyRemoteId || undefined,
      tallyMasterId: tallyMasterId || undefined,
      sourceFileName,
    });
  }

  return vouchers;
}

function classifyTypeFromText(
  rawType: string,
  debit: number,
  credit: number,
): TallyVoucherType | null {
  const upper = rawType.toUpperCase();
  if (upper.includes("SALES") || upper === "SALE") return "SALES";
  if (upper.includes("RECEIPT")) return "RECEIPT";
  if (upper.includes("DEBIT")) return "DEBIT_NOTE";
  if (upper.includes("CREDIT")) return "CREDIT_NOTE";
  if (upper.includes("PAYMENT")) return "PAYMENT";
  if (upper.includes("JOURNAL") || upper.includes("ADJUSTMENT"))
    return "JOURNAL";
  if (upper.includes("OPENING")) return "OPENING_BALANCE";
  if (debit > 0 && credit === 0) return "SALES";
  if (credit > 0 && debit === 0) return "RECEIPT";
  return null;
}

export function validateVouchers(vouchers: TallyVoucherInput[]): {
  valid: TallyVoucherInput[];
  invalid: TallyVoucherInput[];
  summary: {
    total: number;
    sales: number;
    receipts: number;
    debitNotes: number;
    creditNotes: number;
    payments: number;
    journals: number;
    openingBalances: number;
    totalDebit: number;
    totalCredit: number;
  };
} {
  const summary = {
    total: vouchers.length,
    sales: 0,
    receipts: 0,
    debitNotes: 0,
    creditNotes: 0,
    payments: 0,
    journals: 0,
    openingBalances: 0,
    totalDebit: 0,
    totalCredit: 0,
  };

  const valid: TallyVoucherInput[] = [];
  const invalid: TallyVoucherInput[] = [];

  for (const v of vouchers) {
    if (!v.customerName || !v.voucherDate || !v.voucherType) {
      invalid.push(v);
      continue;
    }

    const d = new Date(v.voucherDate);
    if (isNaN(d.getTime())) {
      invalid.push(v);
      continue;
    }

    const hasDebit = Number(v.debit) > 0;
    const hasCredit = Number(v.credit) > 0;
    if (!hasDebit && !hasCredit) {
      invalid.push(v);
      continue;
    }
    if (hasDebit && hasCredit) {
      invalid.push(v);
      continue;
    }

    valid.push(v);

    // Update summary
    switch (v.voucherType) {
      case "SALES":
        summary.sales++;
        break;
      case "RECEIPT":
        summary.receipts++;
        break;
      case "DEBIT_NOTE":
        summary.debitNotes++;
        break;
      case "CREDIT_NOTE":
        summary.creditNotes++;
        break;
      case "PAYMENT":
        summary.payments++;
        break;
      case "JOURNAL":
        summary.journals++;
        break;
      case "OPENING_BALANCE":
        summary.openingBalances++;
        break;
    }
    summary.totalDebit += v.debit;
    summary.totalCredit += v.credit;
  }

  return { valid, invalid, summary };
}