import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { toPaise } from "@/lib/money";

const schema = z
  .object({
    reason: z.string().trim().max(500).optional().nullable(),
    confirmation: z.string().trim().optional().nullable(),
    understood: z.boolean().optional().default(false),
    mode: z.enum(["preview", "execute"]).default("preview"),
  })
  .superRefine((data, ctx) => {
    if (data.mode === "execute") {
      if (!data.reason || data.reason.trim().length < 5) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Reason is required",
          path: ["reason"],
        });
      }

      if (data.confirmation !== "DEACTIVATE ALL CUSTOMERS") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'Confirmation text must be exactly "DEACTIVATE ALL CUSTOMERS"',
          path: ["confirmation"],
        });
      }

      if (data.understood !== true) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "You must confirm that all active customers will be hidden from normal lists.",
          path: ["understood"],
        });
      }
    }
  });

export async function POST(req: NextRequest) {
  const { auth, error } = await requireRole(req, ["OWNER", "MANAGER"]);
  if (error) return error;

  try {
    const body = await req.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request" },
        { status: 400 },
      );
    }

    const { reason, mode } = parsed.data;

    const customers = await prisma.customer.findMany({
      where: { isActive: true, deletedAt: null },
      select: {
        id: true,
        fullName: true,
        currentBalance: true,
        openingBalance: true,
        _count: {
          select: {
            sales: true,
            payments: true,
            ledgers: true,
          },
        },
      },
    });

    const summary = {
      totalActiveCustomers: customers.length,
      outstandingBalanceCustomers: customers.filter(
        (customer) => toPaise(customer.currentBalance) > 0,
      ).length,
      advanceBalanceCustomers: customers.filter(
        (customer) => toPaise(customer.currentBalance) < 0,
      ).length,
      customersWithInvoices: customers.filter(
        (customer) => customer._count.sales > 0,
      ).length,
      customersWithPayments: customers.filter(
        (customer) => customer._count.payments > 0,
      ).length,
      customersWithLedgerEntries: customers.filter(
        (customer) => customer._count.ledgers > 0,
      ).length,
    };

    if (mode === "preview") {
      return NextResponse.json({
        ok: true,
        mode: "preview",
        summary,
        message: "Preview only. No customer records were changed.",
      });
    }

    const ids = customers.map((customer) => customer.id);
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.customer.updateMany({
        where: { id: { in: ids }, isActive: true, deletedAt: null },
        data: {
          isActive: false,
          deletedAt: null, // Do NOT set deletedAt — that's for soft-delete, not deactivation
          deletedBy: auth.userId,
          deleteReason: reason,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: auth.userId,
          action: "CUSTOMER_BULK_DEACTIVATED",
          entityType: "Customer",
          entityId: "bulk",
          oldData: { reason, mode: "execute" },
          newData: {
            affectedCount: updated.count,
            summary,
          },
        },
      });

      return updated.count;
    });

    return NextResponse.json({
      ok: true,
      mode: "execute",
      deactivatedCount: result,
      summary,
      message: "All eligible active customers were deactivated.",
    });
  } catch (error) {
    console.error("[POST /api/admin/customers/deactivate-all]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
