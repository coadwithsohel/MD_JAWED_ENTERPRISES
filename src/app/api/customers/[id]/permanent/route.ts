import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { getCustomerDeletionEligibility } from "@/lib/customer-delete-safety";

// ─── Validation ───────────────────────────────────────────────────────────────

const PermanentDeleteSchema = z.object({
  confirmation: z.string(),
  reason: z.string().max(500).optional().nullable(),
});

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // 1. Auth — OWNER only
  const { auth, error } = await requireRole(req, ["OWNER"]);
  if (error) return error;

  const { id: customerId } = await params;

  if (!customerId || customerId.length < 4) {
    return NextResponse.json({ error: "Invalid customer ID" }, { status: 400 });
  }

  try {
    // 2. Parse body
    const body = await req.json().catch(() => ({}));
    const parsed = PermanentDeleteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }

    // 3. Confirmation check
    if (parsed.data.confirmation !== "DELETE") {
      return NextResponse.json(
        { error: 'Confirmation text must be exactly "DELETE"' },
        { status: 400 },
      );
    }

    // 4. Fetch customer
    const existing = await prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        fullName: true,
        customerCode: true,
        mobile: true,
        currentBalance: true,
        isActive: true,
        _count: {
          select: {
            sales: true,
            payments: true,
            ledgers: true,
            ledgerTransactions: true,
            reminders: true,
            importRows: true,
            tallyVouchers: true,
          },
        },
      },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Customer not found" },
        { status: 404 },
      );
    }

    // 5. Safety checks — server-side (never trust frontend)
    const eligibility = getCustomerDeletionEligibility(existing);
    if (!eligibility.isEligible) {
      const reasons = eligibility.reasons.map((reason) => {
        switch (reason) {
          case "invoices":
            return `${existing._count.sales} invoice(s)`;
          case "payments":
            return `${existing._count.payments} payment record(s)`;
          case "ledgerEntries":
            return `${existing._count.ledgers} ledger entry/entries`;
          case "ledgerTransactions":
            return `${existing._count.ledgerTransactions} imported ledger transaction(s)`;
          case "otherReferences":
            return "import/reminder references";
          case "nonZeroBalance":
            return "non-zero balance";
          default:
            return reason;
        }
      });

      return NextResponse.json(
        {
          error: "Cannot permanently delete this customer.",
          reason: `This customer has ${reasons.join(", ")}. Deactivate the customer instead to preserve financial history.`,
          suggestion: "deactivate",
        },
        { status: 409 },
      );
    }

    // 6. Permanent delete inside a transaction
    await prisma.$transaction(async (tx) => {
      // Audit first (before delete so we have the entity)
      await tx.auditLog.create({
        data: {
          userId: auth.userId,
          action: "CUSTOMER_PERMANENTLY_DELETED",
          entityType: "Customer",
          entityId: customerId,
          oldData: {
            fullName: existing.fullName,
            customerCode: existing.customerCode,
            mobile: existing.mobile,
          },
          newData: {
            reason: parsed.data.reason ?? undefined,
            deletedBy: auth.userId,
          },
        },
      });

      await tx.customer.delete({ where: { id: customerId } });
    });

    return NextResponse.json({
      message: `Customer ${existing.fullName} has been permanently deleted.`,
    });
  } catch (err) {
    console.error("[DELETE /api/customers/:id/permanent]", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
