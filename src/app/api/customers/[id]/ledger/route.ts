import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

// ─── Types ────────────────────────────────────────────────────────────────────

type VoucherType =
  | "OPENING_BALANCE"
  | "SALE"
  | "PAYMENT"
  | "CREDIT_NOTE"
  | "DEBIT_NOTE"
  | "REFUND"
  | "ADJUSTMENT";

interface LedgerEntry {
  id: string;
  date: string; // ISO string
  particulars: string;
  voucherType: VoucherType;
  voucherNumber: string;
  debit: string; // serialised as string for JSON safety
  credit: string;
  runningBalance: string;
  balanceLabel: string; // "Dr" | "Cr" | "Settled"
  sourceId: string;
  status: string;
}

// ─── Safe integer-paise arithmetic ───────────────────────────────────────────

/** Convert a Decimal / string / number to integer paise (×100). */
function toPaise(value: unknown): number {
  if (value == null) return 0;
  const f = parseFloat(String(value));
  if (!isFinite(f)) return 0;
  return Math.round(f * 100);
}

/** Format integer paise back to "₹1,23,456.00" style string. */
function fromPaise(paise: number): string {
  const rupees = Math.abs(paise) / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rupees);
}

function balanceLabel(paise: number): "Dr" | "Cr" | "Settled" {
  if (paise > 0) return "Dr";
  if (paise < 0) return "Cr";
  return "Settled";
}

// Map CreditLedger transactionType → our VoucherType
function mapLedgerType(t: string): VoucherType {
  switch (t) {
    case "OPENING_BALANCE":
      return "OPENING_BALANCE";
    case "CREDIT_SALE":
      return "SALE";
    case "PAYMENT_RECEIVED":
      return "PAYMENT";
    case "PAYMENT_REVERSAL":
      return "DEBIT_NOTE";
    case "SALE_CANCELLED":
      return "CREDIT_NOTE";
    case "RETURN_CREDIT":
      return "CREDIT_NOTE";
    case "ADJUSTMENT":
      return "ADJUSTMENT";
    default:
      return "ADJUSTMENT";
  }
}

function mapImportedTransactionType(t: string): VoucherType {
  switch (t.toUpperCase()) {
    case "SALES":
    case "SALE":
      return "SALE";
    case "RECEIPT":
      return "PAYMENT";
    case "DEBIT_NOTE":
      return "DEBIT_NOTE";
    case "CREDIT_NOTE":
      return "CREDIT_NOTE";
    case "JOURNAL":
    case "ADJUSTMENT":
      return "ADJUSTMENT";
    case "OPENING_BALANCE":
      return "OPENING_BALANCE";
    default:
      return "ADJUSTMENT";
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // 1. Auth
  const { error } = await requireAuth(req);
  if (error) return error;

  // 2. Resolve params
  const { id: customerId } = await params;
  if (!customerId || customerId.length < 4) {
    return NextResponse.json({ error: "Invalid customer ID" }, { status: 400 });
  }

  // 3. Query parameters
  const url = req.nextUrl;
  const fromDate = url.searchParams.get("from");
  const toDate = url.searchParams.get("to");
  const vType = url.searchParams.get("type"); // VoucherType filter
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
  const limit = Math.min(
    200,
    Math.max(10, parseInt(url.searchParams.get("limit") ?? "50")),
  );

  // 4. Verify customer exists
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: {
      id: true,
      customerCode: true,
      fullName: true,
      mobile: true,
      alternateMobile: true,
      email: true,
      address: true,
      city: true,
      state: true,
      pinCode: true,
      creditLimit: true,
      openingBalance: true,
      currentBalance: true,
      isActive: true,
      createdAt: true,
    },
  });

  if (!customer) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  // 5. Build date range filter for CreditLedger
  const dateFilter: { gte?: Date; lte?: Date } = {};
  if (fromDate) {
    const d = new Date(fromDate);
    if (!isNaN(d.getTime())) {
      d.setHours(0, 0, 0, 0);
      dateFilter.gte = d;
    }
  }
  if (toDate) {
    const d = new Date(toDate);
    if (!isNaN(d.getTime())) {
      d.setHours(23, 59, 59, 999);
      dateFilter.lte = d;
    }
  }

  // 6. Fetch all NON-opening-balance ledger entries for this customer
  //    Opening balance is stored on Customer.openingBalance and represented
  //    as a synthetic first row. DB OPENING_BALANCE rows are informational
  //    markers only and must NOT be double-counted in totals or running balance.
  const ledgerRecords = await prisma.creditLedger.findMany({
    where: {
      customerId,
      transactionType: { not: "OPENING_BALANCE" },
      ...(Object.keys(dateFilter).length ? { createdAt: dateFilter } : {}),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: {
      sale: {
        select: {
          id: true,
          invoiceNumber: true,
          grandTotal: true,
          paymentStatus: true,
          saleType: true,
          status: true,
          dueDate: true,
        },
      },
      payment: {
        select: {
          id: true,
          receiptNumber: true,
          amount: true,
          paymentMode: true,
          paymentDate: true,
          status: true,
        },
      },
    },
  });

  // 7. Also fetch Sales not yet in CreditLedger (edge case safety)
  const ledgerSaleIds = new Set(
    ledgerRecords.filter((r) => r.saleId).map((r) => r.saleId as string),
  );
  const ledgerPaymentIds = new Set(
    ledgerRecords.filter((r) => r.paymentId).map((r) => r.paymentId as string),
  );

  // Fetch orphaned sales (sales with no CreditLedger entry yet)
  const orphanedSales = await prisma.sale.findMany({
    where: {
      customerId,
      id: { notIn: Array.from(ledgerSaleIds) },
      status: { not: "CANCELLED" },
      saleType: { in: ["CREDIT", "PARTIAL"] },
      ...(Object.keys(dateFilter).length ? { createdAt: dateFilter } : {}),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      invoiceNumber: true,
      grandTotal: true,
      paymentStatus: true,
      saleType: true,
      status: true,
      dueDate: true,
      createdAt: true,
    },
  });

  // Fetch orphaned payments (payments with no CreditLedger entry yet)
  const orphanedPayments = await prisma.payment.findMany({
    where: {
      customerId,
      id: { notIn: Array.from(ledgerPaymentIds) },
      status: "COMPLETED",
      ...(Object.keys(dateFilter).length ? { paymentDate: dateFilter } : {}),
    },
    orderBy: [{ paymentDate: "asc" }, { id: "asc" }],
    select: {
      id: true,
      receiptNumber: true,
      amount: true,
      paymentMode: true,
      paymentDate: true,
      status: true,
    },
  });

  // NOTE: CustomerLedgerTransaction is intentionally NOT queried here.
  // Previously, this table was read and concatenated with CreditLedger + Sale + Payment,
  // causing every transaction to appear twice in the ledger.
  // The import route no longer creates CustomerLedgerTransaction records.
  // All financial data is represented through CreditLedger, Sale, and Payment models.
  const importedTransactions: Array<{
    id: string;
    transactionDate: Date;
    voucherType: string;
    voucherNumber: string | null;
    particulars: string;
    debit: unknown;
    credit: unknown;
    sourceSystem: string | null;
  }> = [];

  // 8. Normalize all records into unified LedgerEntry list (unsorted first)
  const rawEntries: Array<{
    id: string;
    date: Date;
    particulars: string;
    voucherType: VoucherType;
    voucherNumber: string;
    debitPaise: number;
    creditPaise: number;
    sourceId: string;
    status: string;
    sortKey: string; // for stable sort: ISO + id
  }> = [];

  // From CreditLedger records (OPENING_BALANCE rows already excluded above)
  for (const r of ledgerRecords) {
    const vType2 = mapLedgerType(r.transactionType);
    const isDebit = ["SALE", "DEBIT_NOTE"].includes(vType2);
    const amtPaise = toPaise(r.amount);

    let particulars = r.description ?? vType2.replace(/_/g, " ");
    let voucherNumber = "";
    let sourceId = r.id;
    let status = "Completed";

    if (r.sale) {
      voucherNumber = r.sale.invoiceNumber;
      sourceId = r.sale.id;
      status =
        r.sale.paymentStatus === "PAID"
          ? "Paid"
          : r.sale.paymentStatus === "PARTIALLY_PAID"
            ? "Partial"
            : r.sale.paymentStatus === "OVERDUE"
              ? "Overdue"
              : "Unpaid";
      if (vType2 === "SALE") {
        particulars = `Sales Invoice — ${r.sale.invoiceNumber}`;
      } else if (vType2 === "CREDIT_NOTE") {
        particulars = `Sale Cancelled — ${r.sale.invoiceNumber}`;
      }
    }

    if (r.payment) {
      voucherNumber = r.payment.receiptNumber;
      sourceId = r.payment.id;
      status = r.payment.status === "REVERSED" ? "Reversed" : "Completed";
      if (vType2 === "PAYMENT") {
        particulars = `Payment Received — ${r.payment.receiptNumber}`;
      } else if (vType2 === "DEBIT_NOTE") {
        particulars = `Payment Reversed — ${r.payment.receiptNumber}`;
      }
    }

    rawEntries.push({
      id: r.id,
      date: r.createdAt,
      particulars,
      voucherType: vType2,
      voucherNumber,
      debitPaise: isDebit ? amtPaise : 0,
      creditPaise: isDebit ? 0 : amtPaise,
      sourceId,
      status,
      sortKey: r.createdAt.toISOString() + r.id,
    });
  }

  // From orphaned sales
  for (const s of orphanedSales) {
    rawEntries.push({
      id: `sale-${s.id}`,
      date: s.createdAt,
      particulars: `Sales Invoice — ${s.invoiceNumber}`,
      voucherType: "SALE",
      voucherNumber: s.invoiceNumber,
      debitPaise: toPaise(s.grandTotal),
      creditPaise: 0,
      sourceId: s.id,
      status:
        s.paymentStatus === "PAID"
          ? "Paid"
          : s.paymentStatus === "PARTIALLY_PAID"
            ? "Partial"
            : s.paymentStatus === "OVERDUE"
              ? "Overdue"
              : "Unpaid",
      sortKey: s.createdAt.toISOString() + s.id,
    });
  }

  // From orphaned payments
  for (const p of orphanedPayments) {
    rawEntries.push({
      id: `payment-${p.id}`,
      date: p.paymentDate,
      particulars: `Payment Received — ${p.receiptNumber}`,
      voucherType: "PAYMENT",
      voucherNumber: p.receiptNumber,
      debitPaise: 0,
      creditPaise: toPaise(p.amount),
      sourceId: p.id,
      status: p.status === "REVERSED" ? "Reversed" : "Completed",
      sortKey: p.paymentDate.toISOString() + p.id,
    });
  }

  for (const t of importedTransactions) {
    const voucherType = mapImportedTransactionType(t.voucherType);
    rawEntries.push({
      id: `import-${t.id}`,
      date: t.transactionDate,
      particulars: t.particulars || `Imported ${t.voucherType}`,
      voucherType,
      voucherNumber: t.voucherNumber ?? "",
      debitPaise: toPaise(t.debit),
      creditPaise: toPaise(t.credit),
      sourceId: t.id,
      status: "Imported",
      sortKey: t.transactionDate.toISOString() + t.id,
    });
  }

  // 9. Sort: date asc, then id asc (stable)
  rawEntries.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  // 10. Calculate running balance (integer paise)
  //     Option A: opening balance stored separately on Customer.
  //     Start runningBalance with openingBalance.
  //     Do NOT include opening balance in totalDebit or totalCredit.
  //     Do NOT include DB OPENING_BALANCE rows (already excluded above).
  const openingPaise = toPaise(customer.openingBalance);
  let runningPaise = openingPaise;

  // Prepend opening balance as the informational first row (excluded from totals)
  const openingEntry: (typeof rawEntries)[0] = {
    id: "opening-balance",
    date: customer.createdAt,
    particulars: "Opening Balance",
    voucherType: "OPENING_BALANCE",
    voucherNumber: "",
    debitPaise: openingPaise > 0 ? openingPaise : 0,
    creditPaise: openingPaise < 0 ? Math.abs(openingPaise) : 0,
    sourceId: customer.id,
    status: "Posted",
    sortKey: "0000-00-00" + customer.id,
  };

  const allEntries = [openingEntry, ...rawEntries];

  // 11. Calculate totals and running balances
  //     IMPORTANT: Only transaction rows (not opening balance) count toward totals
  let totalDebitPaise = 0;
  let totalCreditPaise = 0;

  const processedEntries: LedgerEntry[] = allEntries.map((entry) => {
    if (entry.id === "opening-balance") {
      // Reset running balance to opening (handles date-filter edge cases)
      runningPaise = openingPaise;
    } else {
      runningPaise = runningPaise + entry.debitPaise - entry.creditPaise;
    }

    // Opening balance entry is informational only — excluded from totals
    if (entry.id !== "opening-balance") {
      totalDebitPaise += entry.debitPaise;
      totalCreditPaise += entry.creditPaise;
    }

    return {
      id: entry.id,
      date: entry.date.toISOString(),
      particulars: entry.particulars,
      voucherType: entry.voucherType,
      voucherNumber: entry.voucherNumber,
      debit: entry.debitPaise > 0 ? fromPaise(entry.debitPaise) : "",
      credit: entry.creditPaise > 0 ? fromPaise(entry.creditPaise) : "",
      runningBalance: fromPaise(Math.abs(runningPaise)),
      balanceLabel: balanceLabel(runningPaise),
      sourceId: entry.sourceId,
      status: entry.status,
    };
  });

  // closingBalance = openingBalance + transactionDebit - transactionCredit
  const closingPaise = openingPaise + totalDebitPaise - totalCreditPaise;

  // 12. Apply voucher type filter (after running balance calculation)
  const filteredEntries = vType
    ? processedEntries.filter((e) => e.voucherType === vType)
    : processedEntries;

  // 13. Paginate
  const totalEntries = filteredEntries.length;
  const totalPages = Math.ceil(totalEntries / limit);
  const paginatedEntries = filteredEntries.slice(
    (page - 1) * limit,
    page * limit,
  );

  // 14. Summary — transactionDebit and transactionCredit reflect actual transactions only
  const summary = {
    openingBalance: fromPaise(Math.abs(openingPaise)),
    openingBalanceLabel: balanceLabel(openingPaise),
    totalDebit: fromPaise(totalDebitPaise),
    totalCredit: fromPaise(totalCreditPaise),
    closingBalance: fromPaise(Math.abs(closingPaise)),
    closingBalanceLabel: balanceLabel(closingPaise),
    currentBalance: fromPaise(Math.abs(toPaise(customer.currentBalance))),
    currentBalanceLabel: balanceLabel(toPaise(customer.currentBalance)),
    isOverdue: closingPaise > 0,
  };

  return NextResponse.json({
    customer: {
      id: customer.id,
      customerCode: customer.customerCode,
      fullName: customer.fullName,
      mobile: customer.mobile,
      alternateMobile: customer.alternateMobile,
      email: customer.email,
      address: customer.address,
      city: customer.city,
      state: customer.state,
      pinCode: customer.pinCode,
      creditLimit: fromPaise(toPaise(customer.creditLimit)),
      isActive: customer.isActive,
    },
    summary,
    entries: paginatedEntries,
    pagination: {
      page,
      limit,
      total: totalEntries,
      pages: totalPages,
      hasMore: page < totalPages,
    },
  });
}
