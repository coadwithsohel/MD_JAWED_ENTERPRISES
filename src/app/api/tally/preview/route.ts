import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

interface TallyVoucherInput {
  tallyGuid?: string;
  tallyRemoteId?: string;
  tallyMasterId?: string;
  voucherKey?: string;
  customerName: string;
  mobile?: string;
  voucherDate: string;
  voucherType:
    | "SALES"
    | "RECEIPT"
    | "DEBIT_NOTE"
    | "CREDIT_NOTE"
    | "OPENING_BALANCE";
  voucherNumber?: string;
  debit?: number;
  credit?: number;
  narration?: string;
  reference?: string;
  sourceFileName?: string;
}

export async function POST(req: NextRequest) {
  const { error } = await requireAuth(req);
  if (error) return error;

  try {
    const body = await req.json().catch(() => ({}));
    const batchId = (body.batchId ||
      req.nextUrl.searchParams.get("batchId") ||
      "") as string;
    let vouchers: TallyVoucherInput[] = Array.isArray(body.vouchers)
      ? body.vouchers
      : [];

    if (!vouchers.length && batchId) {
      const persistedVouchers = await prisma.tallyVoucher.findMany({
        where: { importBatchId: batchId },
        select: {
          customerName: true,
          voucherDate: true,
          voucherType: true,
          voucherNumber: true,
          debit: true,
          credit: true,
          narration: true,
          reference: true,
          tallyGuid: true,
          tallyRemoteId: true,
          tallyMasterId: true,
          voucherKey: true,
        },
        orderBy: [{ createdAt: "asc" }],
      });

      vouchers = persistedVouchers.map((voucher) => ({
        customerName: voucher.customerName || "",
        voucherDate: voucher.voucherDate.toISOString().slice(0, 10),
        voucherType: voucher.voucherType as TallyVoucherInput["voucherType"],
        voucherNumber: voucher.voucherNumber || undefined,
        debit: Number(voucher.debit) || 0,
        credit: Number(voucher.credit) || 0,
        narration: voucher.narration || undefined,
        reference: voucher.reference || undefined,
        tallyGuid: voucher.tallyGuid || undefined,
        tallyRemoteId: voucher.tallyRemoteId || undefined,
        tallyMasterId: voucher.tallyMasterId || undefined,
        voucherKey: voucher.voucherKey || undefined,
      }));
    }

    if (!Array.isArray(vouchers) || vouchers.length === 0) {
      return NextResponse.json(
        { error: "vouchers array is required and must not be empty" },
        { status: 400 },
      );
    }

    const allCustomers = await prisma.customer.findMany({
      select: { id: true, fullName: true, customerCode: true, mobile: true },
    });

    function normalizeName(name: string): string {
      return name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .trim();
    }

    function normalizeMobile(value: string): string {
      return value.replace(/\D/g, "").trim();
    }

    const nameIndex = new Map<string, (typeof allCustomers)[number]>();
    const mobileIndex = new Map<string, (typeof allCustomers)[number]>();
    for (const customer of allCustomers) {
      const key = normalizeName(customer.fullName);
      if (!nameIndex.has(key)) {
        nameIndex.set(key, customer);
      }
      if (customer.mobile) {
        const mobileKey = normalizeMobile(customer.mobile);
        if (!mobileIndex.has(mobileKey)) {
          mobileIndex.set(mobileKey, customer);
        }
      }
    }

    const existingVoucherKeys = new Set<string>();
    const existingGuids = new Set<string>();
    const sourceKeys = vouchers
      .map((voucher) => voucher.voucherKey || voucher.tallyGuid)
      .filter((value): value is string => Boolean(value));
    if (sourceKeys.length > 0) {
      const existing = await prisma.tallyVoucher.findMany({
        where: {
          OR: [
            { voucherKey: { in: sourceKeys } },
            {
              tallyGuid: { in: sourceKeys.filter((value) => value.length > 0) },
            },
          ],
        },
        select: { voucherKey: true, tallyGuid: true },
      });
      for (const entry of existing) {
        if (entry.voucherKey) existingVoucherKeys.add(entry.voucherKey);
        if (entry.tallyGuid) existingGuids.add(entry.tallyGuid);
      }
    }

    const matchedCustomersMap = new Map<
      string,
      {
        customerId: string;
        customerName: string;
        customerCode: string;
        vouchers: number;
      }
    >();
    const unmatchedCustomerNames: string[] = [];
    const duplicateVouchers: Array<{
      customerName: string;
      voucherNumber?: string;
      voucherDate: string;
    }> = [];
    const salesVouchers: Array<{
      customerName: string;
      amount: number;
      voucherNumber?: string;
    }> = [];
    const receiptVouchers: Array<{
      customerName: string;
      amount: number;
      voucherNumber?: string;
    }> = [];
    const customerClosings = new Map<
      string,
      { opening: number; debit: number; credit: number }
    >();
    let totalDebit = 0;
    let totalCredit = 0;
    let duplicateCount = 0;
    let invalidRows = 0;
    const seenVoucherKeys = new Set<string>();

    for (const voucher of vouchers) {
      if (
        !voucher.customerName ||
        !voucher.voucherDate ||
        !voucher.voucherType
      ) {
        invalidRows++;
        continue;
      }

      const parsedDate = new Date(voucher.voucherDate);
      if (Number.isNaN(parsedDate.getTime())) {
        invalidRows++;
        continue;
      }

      const sourceKey = voucher.voucherKey || voucher.tallyGuid;
      if (
        sourceKey &&
        (existingVoucherKeys.has(sourceKey) || existingGuids.has(sourceKey))
      ) {
        duplicateCount++;
        duplicateVouchers.push({
          customerName: voucher.customerName,
          voucherNumber: voucher.voucherNumber,
          voucherDate: voucher.voucherDate,
        });
        continue;
      }
      if (sourceKey && seenVoucherKeys.has(sourceKey)) {
        duplicateCount++;
        duplicateVouchers.push({
          customerName: voucher.customerName,
          voucherNumber: voucher.voucherNumber,
          voucherDate: voucher.voucherDate,
        });
        continue;
      }
      if (sourceKey) {
        seenVoucherKeys.add(sourceKey);
      }

      let matchedCustomer = undefined as
        | (typeof allCustomers)[number]
        | undefined;
      if (voucher.mobile) {
        matchedCustomer = mobileIndex.get(normalizeMobile(voucher.mobile));
      }

      const normalizedInput = normalizeName(voucher.customerName);
      if (!matchedCustomer) {
        matchedCustomer = nameIndex.get(normalizedInput);
      }

      if (!matchedCustomer) {
        for (const [key, customer] of nameIndex) {
          if (key.includes(normalizedInput) || normalizedInput.includes(key)) {
            matchedCustomer = customer;
            break;
          }
        }
      }

      if (matchedCustomer) {
        const existing = matchedCustomersMap.get(matchedCustomer.id);
        if (existing) {
          existing.vouchers += 1;
        } else {
          matchedCustomersMap.set(matchedCustomer.id, {
            customerId: matchedCustomer.id,
            customerName: matchedCustomer.fullName,
            customerCode: matchedCustomer.customerCode,
            vouchers: 1,
          });
        }

        if (!customerClosings.has(matchedCustomer.id)) {
          const dbCustomer = await prisma.customer.findUnique({
            where: { id: matchedCustomer.id },
            select: { openingBalance: true },
          });
          customerClosings.set(matchedCustomer.id, {
            opening: dbCustomer ? Number(dbCustomer.openingBalance) : 0,
            debit: 0,
            credit: 0,
          });
        }

        const closing = customerClosings.get(matchedCustomer.id)!;
        if (
          voucher.voucherType === "SALES" ||
          voucher.voucherType === "DEBIT_NOTE"
        ) {
          closing.debit += voucher.debit || 0;
          totalDebit += voucher.debit || 0;
          if (voucher.voucherType === "SALES") {
            salesVouchers.push({
              customerName: voucher.customerName,
              amount: voucher.debit || 0,
              voucherNumber: voucher.voucherNumber,
            });
          }
        } else if (
          voucher.voucherType === "RECEIPT" ||
          voucher.voucherType === "CREDIT_NOTE"
        ) {
          closing.credit += voucher.credit || 0;
          totalCredit += voucher.credit || 0;
          if (voucher.voucherType === "RECEIPT") {
            receiptVouchers.push({
              customerName: voucher.customerName,
              amount: voucher.credit || 0,
              voucherNumber: voucher.voucherNumber,
            });
          }
        }
      } else {
        unmatchedCustomerNames.push(voucher.customerName);
      }
    }

    const matchedCustomers = Array.from(matchedCustomersMap.values()).sort(
      (a, b) => a.customerName.localeCompare(b.customerName),
    );
    const customerClosingsList = Array.from(customerClosings.entries()).map(
      ([customerId, data]) => {
        const customer = allCustomers.find((entry) => entry.id === customerId);
        return {
          customerId,
          customerName: customer?.fullName || customerId,
          openingBalance: data.opening,
          totalDebit: data.debit,
          totalCredit: data.credit,
          expectedClosing: data.opening + data.debit - data.credit,
        };
      },
    );

    console.info("[tally/preview] previewed", {
      batchId,
      totalVouchers: vouchers.length,
      matchedCustomers: matchedCustomers.length,
      invalidRows,
    });

    return NextResponse.json({
      ok: true,
      batchId,
      totalVouchers: vouchers.length,
      sales: salesVouchers.length,
      receipts: receiptVouchers.length,
      debitNotes: 0,
      creditNotes: 0,
      matchedCustomers,
      unmatchedCustomerNames: [...new Set(unmatchedCustomerNames)].sort(),
      duplicateCount,
      invalidCount: invalidRows,
      duplicateVouchers: duplicateVouchers.slice(0, 50),
      customerClosings: customerClosingsList.sort((a, b) =>
        a.customerName.localeCompare(b.customerName),
      ),
      sampleVouchers: vouchers.slice(0, 20),
      summary: {
        totalVouchers: vouchers.length,
        sales: salesVouchers.length,
        receipts: receiptVouchers.length,
        debitNotes: 0,
        creditNotes: 0,
        matchedCustomers: matchedCustomers.length,
        unmatchedCustomers: [...new Set(unmatchedCustomerNames)].length,
        debitTotal: totalDebit,
        creditTotal: totalCredit,
        duplicateVouchers: duplicateCount,
        invalidRows,
      },
      warnings: invalidRows > 0 ? [`${invalidRows} invalid rows found`] : [],
    });
  } catch (err) {
    console.error("Transaction import failed", {
      stage: "preview",
      message: err instanceof Error ? err.message : "Unknown error",
    });
    return NextResponse.json(
      {
        error: "Server error processing preview",
        details:
          "The preview could not be generated from the uploaded transactions.",
      },
      { status: 500 },
    );
  }
}
