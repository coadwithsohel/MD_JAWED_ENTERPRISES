import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";

const schema = z
  .object({
    confirmation: z.string().trim().optional().nullable(),
    mode: z.enum(["preview", "execute"]).default("preview"),
  })
  .superRefine((data, ctx) => {
    if (
      data.mode === "execute" &&
      data.confirmation !== "RESTORE ALL CUSTOMERS"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Confirmation text must be exactly "RESTORE ALL CUSTOMERS"',
        path: ["confirmation"],
      });
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

    const { mode } = parsed.data;

    const customers = await prisma.customer.findMany({
      where: { isActive: false, deletedAt: null },
      select: { id: true, fullName: true },
    });

    if (mode === "preview") {
      return NextResponse.json({
        ok: true,
        mode: "preview",
        inactiveCustomerCount: customers.length,
        message: "Preview only. No customer records were changed.",
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.customer.updateMany({
        where: { isActive: false, deletedAt: null },
        data: {
          isActive: true,
          deletedAt: null,
          deletedBy: null,
          deleteReason: null,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: auth.userId,
          action: "CUSTOMER_BULK_RESTORED",
          entityType: "Customer",
          entityId: "bulk",
          oldData: { restoredCount: updated.count },
          newData: { restoredCount: updated.count, mode: "execute" },
        },
      });

      return updated.count;
    });

    return NextResponse.json({
      ok: true,
      mode: "execute",
      restoredCount: result,
      message: "All inactive customers were restored.",
    });
  } catch (error) {
    console.error("[POST /api/admin/customers/restore-all]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
