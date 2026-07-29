import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { Decimal } from "@prisma/client/runtime/library";

const CreateAdjustmentSchema = z.object({
  customerId: z.string().min(1, "Customer ID is required"),
  entryType: z.enum(["DEBIT", "CREDIT"]),
  amount: z.number().positive("Amount must be greater than zero"),
  transactionDate: z.string().min(1, "Transaction date is required"),
  referenceNumber: z.string().trim().optional().nullable(),
  particulars: z.string().trim().min(1, "Particulars / description is required"),
  notes: z.string().trim().optional().nullable(),
  reason: z.string().trim().optional().nullable(),
  idempotencyKey: z.string().trim().optional().nullable(),
});

import { processCanonicalAdjustment } from "@/lib/adjustments";

export async function POST(req: NextRequest) {
  const { auth, error } = await requireRole(req, ["OWNER", "MANAGER"]);
  if (error) return error;

  try {
    const body = await req.json();
    const parsed = CreateAdjustmentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 422 }
      );
    }

    const {
      customerId,
      entryType,
      amount,
      transactionDate,
      referenceNumber,
      particulars,
      notes,
      reason,
      idempotencyKey: rawIdempotencyKey,
    } = parsed.data;

    const headerKey = req.headers.get("x-idempotency-key");
    const idempotencyKey = rawIdempotencyKey || headerKey || null;

    // Verify customer exists
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, fullName: true },
    });
    if (!customer) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    // Server-side duplicate protection via idempotency key
    if (idempotencyKey) {
      const existing = await prisma.creditLedger.findUnique({
        where: { idempotencyKey },
      });
      if (existing) {
        return NextResponse.json({
          adjustment: existing,
          message: "Transaction already processed",
          duplicate: true,
        });
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const txnDate = new Date(transactionDate);
      const amountDec = new Decimal(amount);

      return await processCanonicalAdjustment(tx, {
        customerId,
        entryType,
        amount: amountDec,
        transactionDate: txnDate,
        referenceNumber: referenceNumber || null,
        particulars,
        notes: notes || null,
        reason: reason || null,
        idempotencyKey: idempotencyKey || null,
        createdById: auth.userId,
      });
    });

    return NextResponse.json({
      adjustment: result.adjustment,
      closingBalance: result.newBalance,
      message: `${entryType === "DEBIT" ? "Debit" : "Credit"} adjustment created successfully`,
    });
  } catch (err) {
    console.error("[POST /api/adjustments]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create manual entry" },
      { status: 500 }
    );
  }
}
