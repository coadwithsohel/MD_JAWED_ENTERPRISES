/**
 * POST /api/tally/import
 *
 * Commits validated Tally vouchers into ALL permanent accounting models:
 * 1. Sale (for SALES vouchers) — THE model read by overdue API
 * 2. Payment (for RECEIPT vouchers) — linked to Sale via againstVoucherNumber
 * 3. CreditLedger — read by customer ledger/detail API
 * 4. CustomerLedgerTransaction — read by customer ledger/detail API
 * 5. Customer.currentBalance — updated
 * 6. TallyVoucher — marked as IMPORTED
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, clearAuthCookie } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { auth, error } = await requireAuth(req);
  if (error) return error;

  try {
    const body = await req.json().catch(() => ({}));
    const batchId = body.batchId || req.nextUrl.searchParams.get("batchId") || "";

    if (!batchId) {
      return NextResponse.json({ error: "batchId is required" }, { status: 400 });
    }

    // Verify user
    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { id: true, isActive: true },
    });
    if (!user || !user.isActive) {
      const res = NextResponse.json(
        { error: "SESSION_USER_NOT_FOUND", details: "Your session is no longer valid. Please sign in again." },
        { status: 401 },
      );
      clearAuthCookie(res);
      return res;
    }

    // Load batch with valid staged vouchers
    const batch = await prisma.tallyImportBatch.findUnique({
      where: { id: batchId },
      include: {
        vouchers: {
          where: {
            importStatus: { in: ["VALID", "PARSED", "MATCHED"] },
            customerId: { not: null },
            isDuplicate: false,
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!batch) {
      return NextResponse.json({ error: "Import batch not found" }, { status: 404 });
    }

    if (batch.status === "COMPLETED" || batch.status === "IMPORTING") {
      return NextResponse.json({ error: "Batch has already been processed" }, { status: 409 });
    }

    // Mark as importing
    await prisma.tallyImportBatch.update({
      where: { id: batchId },
      data: { status: "IMPORTING" },
    });

    const stagedVouchers = batch.vouchers;
    let importedRows = 0;
    let skippedInvalid = 0;
    let skippedUnmatched = 0;
    let failedRows = 0;

    const CHUNK_SIZE = 50;

    for (let i = 0; i < stagedVouchers.length; i += CHUNK_SIZE) {
      const chunk = stagedVouchers.slice(i, i + CHUNK_SIZE);

      for (const voucher of chunk) {
        try {
          if (!voucher.customerId) {
            await prisma.tallyVoucher.update({
              where: { id: voucher.id },
              data: { importStatus: "SKIPPED", errorMessage: "No matched customer" },
            });
            skippedUnmatched++;
            continue;
          }

          const v = voucher as Record<string, unknown>;
          const isDebit = Number(v.debit) > 0;
          const amount = isDebit ? Number(v.debit) : Number(v.credit);
          const vType = v.voucherType as string;

          if (amount <= 0) {
            await prisma.tallyVoucher.update({
              where: { id: voucher.id },
              data: { importStatus: "SKIPPED", errorMessage: "Zero amount" },
            });
            skippedInvalid++;
            continue;
          }

          // Get customer balance
          const customer = await prisma.customer.findUnique({
            where: { id: voucher.customerId },
            select: { currentBalance: true },
          });
          if (!customer) {
            await prisma.tallyVoucher.update({
              where: { id: voucher.id },
              data: { importStatus: "FAILED", errorMessage: "Customer not found" },
            });
            failedRows++;
            continue;
          }

          let saleId: string | undefined;
          let paidAmount = 0;
          const voucherDate = v.voucherDate as Date;
          const dueDate = v.dueDate as Date | null;
          const paymentDate = v.paymentDate as Date | null;
          const voucherNumber = (v.voucherNumber as string) || "";
          const againstVoucherNumber = (v.againstVoucherNumber as string) || "";
          const narration = (v.narration as string) || "";

          // ─── CREATE PERMANENT SALE RECORD ────────────────────────────────
          // This is what the overdue API queries
          if (vType === "SALES") {
            const saleInvoiceNumber = voucherNumber || `IMP-${v.id as string}`;
            let existingSale = await prisma.sale.findUnique({
              where: { invoiceNumber: saleInvoiceNumber },
            });

            if (!existingSale) {
              existingSale = await prisma.sale.create({
                data: {
                  invoiceNumber: saleInvoiceNumber,
                  customerId: voucher.customerId,
                  saleType: "CREDIT",
                  subtotal: amount,
                  discountAmount: 0,
                  gstAmount: 0,
                  grandTotal: amount,
                  paidAmount: 0,
                  pendingAmount: amount,
                  dueDate: dueDate,
                  paymentStatus: "UNPAID",
                  status: "COMPLETED",
                  notes: narration || `Imported ${vType}`,
                  createdById: auth.userId,
                  createdAt: voucherDate,
                },
              });
            }

            saleId = existingSale.id;
            paidAmount = Number(existingSale.paidAmount);
          }

          // ─── CREATE PERMANENT PAYMENT RECORD ─────────────────────────────
          // Also updates the linked Sale's paidAmount/pendingAmount
          if (vType === "RECEIPT") {
            const receiptNumber = voucherNumber || `REC-IMP-${v.id as string}`;

            // Find the sale by againstVoucherNumber
            let linkedSaleId: string | undefined;
            if (againstVoucherNumber) {
              const linkedSale = await prisma.sale.findUnique({
                where: { invoiceNumber: againstVoucherNumber },
              });
              if (linkedSale) {
                linkedSaleId = linkedSale.id;
                saleId = linkedSale.id;
              }
            }

            const existingPayment = await prisma.payment.findUnique({
              where: { receiptNumber },
            });

            if (!existingPayment) {
              await prisma.payment.create({
                data: {
                  receiptNumber,
                  customerId: voucher.customerId,
                  saleId: linkedSaleId || undefined,
                  amount,
                  paymentMode: "OTHER",
                  status: "COMPLETED",
                  receivedById: auth.userId,
                  paymentDate: paymentDate || voucherDate,
                  createdAt: paymentDate || voucherDate,
                  notes: narration || `Imported receipt against ${againstVoucherNumber || "unknown"}`,
                },
              });

              // Update the linked Sale's paid/pending amounts
              if (linkedSaleId) {
                const linkedSale = await prisma.sale.findUnique({
                  where: { id: linkedSaleId },
                });
                if (linkedSale) {
                  const newPaid = Number(linkedSale.paidAmount) + amount;
                  const newPending = Math.max(0, Number(linkedSale.grandTotal) - newPaid);
                  await prisma.sale.update({
                    where: { id: linkedSaleId },
                    data: {
                      paidAmount: newPaid,
                      pendingAmount: newPending,
                      paymentStatus: newPending <= 0 ? "PAID" : newPending < Number(linkedSale.grandTotal) ? "PARTIALLY_PAID" : "UNPAID",
                    },
                  });
                }
              }
            }
          }

          // ─── UPDATE CUSTOMER BALANCE ─────────────────────────────────────
          const currentPaise = Math.round(Number(customer.currentBalance) * 100);
          const amountPaise = Math.round(amount * 100);
          const newBalancePaise = isDebit
            ? currentPaise + amountPaise
            : currentPaise - amountPaise;
          const newBalance = newBalancePaise / 100;

          // ─── CREATE PERMANENT LEDGER ENTRY (CreditLedger) ────────────────
          const ledgerType = isDebit ? "CREDIT_SALE" : "PAYMENT_RECEIVED";
          const ledgerEntry = await prisma.creditLedger.create({
            data: {
              customerId: voucher.customerId,
              transactionType: ledgerType as "CREDIT_SALE" | "PAYMENT_RECEIVED",
              amount,
              balanceAfter: newBalance,
              description: `${vType} — ${voucherNumber || narration}`.trim().slice(0, 200),
              createdAt: voucherDate,
              saleId: saleId || undefined,
            },
          });

          // NOTE: CustomerLedgerTransaction is NOT created here to avoid duplicates.
          // The ledger query now derives rows from CreditLedger + Sale + Payment only.
          // CustomerLedgerTransaction was causing every transaction to appear twice
          // in the customer ledger (once via CreditLedger, once via CustomerLedgerTransaction).
          // If source tracking is needed, use TallyVoucher fields (tallyGuid, voucherKey, etc.)
          // or the CreditLedger record's description field.
          // ─── SOURCE METADATA: stored on TallyVoucher for provenance ──────
          // Existing TallyVoucher already has: tallyGuid, tallyRemoteId,
          // voucherKey, tallyMasterId, sourceFileName.
          // ─── UPDATE CUSTOMER CURRENT BALANCE ─────────────────────────────
          await prisma.customer.update({
            where: { id: voucher.customerId },
            data: { currentBalance: newBalance },
          });

          // ─── MARK VOUCHER AS IMPORTED ────────────────────────────────────
          await prisma.tallyVoucher.update({
            where: { id: voucher.id },
            data: {
              importStatus: "IMPORTED",
              customerId: voucher.customerId,
              ledgerEntryId: ledgerEntry.id,
            },
          });

          importedRows++;
        } catch (err) {
          await prisma.tallyVoucher.update({
            where: { id: voucher.id },
            data: {
              importStatus: "FAILED",
              errorMessage: err instanceof Error ? err.message : "Unknown error",
            },
          });
          failedRows++;
        }
      }
    }

    // Update batch
    const status = failedRows > 0 ? "PARTIALLY_COMPLETED" : "COMPLETED";
    await prisma.tallyImportBatch.update({
      where: { id: batchId },
      data: {
        status,
        totalVouchers: stagedVouchers.length,
        salesCount: stagedVouchers.filter((v) => v.voucherType === "SALES").length,
        receiptCount: stagedVouchers.filter((v) => v.voucherType === "RECEIPT").length,
        duplicateCount: 0,
        skippedCount: skippedInvalid + skippedUnmatched,
        errorCount: failedRows,
        debitTotal: stagedVouchers.reduce((s, v) => s + Number(v.debit), 0),
        creditTotal: stagedVouchers.reduce((s, v) => s + Number(v.credit), 0),
        completedAt: new Date(),
      },
    });

    // Audit log
    try {
      await prisma.auditLog.create({
        data: {
          userId: auth.userId,
          action: "IMPORT",
          entityType: "TallyImportBatch",
          entityId: batchId,
          newData: { importedRows, skippedInvalid, skippedUnmatched, failedRows },
        },
      });
    } catch { /* non-critical */ }

    return NextResponse.json({
      success: true,
      importBatchId: batchId,
      imported: importedRows,
      duplicates: 0,
      skipped: skippedInvalid + skippedUnmatched,
      errors: failedRows,
    });
  } catch (err) {
    console.error("[POST /api/tally/import]", err);
    return NextResponse.json(
      { error: "Server error during import" },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  const { error } = await requireAuth(req);
  if (error) return error;

  try {
    const batches = await prisma.tallyImportBatch.findMany({
      select: { id: true, originalFileName: true, createdAt: true, status: true },
      orderBy: [{ createdAt: "desc" }],
    });
    return NextResponse.json({ ok: true, batches });
  } catch (err) {
    console.error("[GET /api/tally/import]", err);
    return NextResponse.json({ error: "Unable to load import batches" }, { status: 500 });
  }
}