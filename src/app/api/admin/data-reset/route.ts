import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import {
  previewDeleteAllBusinessData,
  executeDeleteAllBusinessData,
  collectBackupData,
} from "@/lib/delete-all-business-data";

// ─── Validation Schema ────────────────────────────────────────────────────────

const schema = z
  .object({
    action: z.literal("DELETE_ALL_BUSINESS_DATA"),
    confirmation: z.string().trim(),
    reason: z.string().trim().min(1, "Reason is required").max(500),
    acknowledged: z.boolean(),
    mode: z.enum(["preview", "execute"]).default("preview"),
    downloadBackup: z.boolean().optional().default(false),
  })
  .superRefine((data, ctx) => {
    if (data.mode === "execute") {
      if (data.confirmation !== "DELETE ALL BUSINESS DATA") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'Confirmation text must be exactly "DELETE ALL BUSINESS DATA"',
          path: ["confirmation"],
        });
      }
      if (!data.acknowledged) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "You must acknowledge that this action is irreversible",
          path: ["acknowledged"],
        });
      }
    }
  });

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Only OWNER can delete all business data
  const { auth, error } = await requireRole(req, ["OWNER"]);
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

    // ── PREVIEW ────────────────────────────────────────────────────────────────
    if (mode === "preview") {
      const preview = await previewDeleteAllBusinessData();
      return NextResponse.json({
        success: true,
        mode: "preview",
        data: preview,
      });
    }

    // ── DOWNLOAD BACKUP ────────────────────────────────────────────────────────
    if (parsed.data.downloadBackup) {
      const backupData = await collectBackupData();
      return NextResponse.json({
        success: true,
        mode: "backup",
        data: backupData,
      });
    }

    // ── EXECUTE ────────────────────────────────────────────────────────────────
    const result = await executeDeleteAllBusinessData();

    // Log the action
    await prisma.auditLog.create({
      data: {
        userId: auth.userId,
        action: "DELETE_ALL_BUSINESS_DATA",
        entityType: "System",
        newData: {
          reason: parsed.data.reason,
          deleted: result.deleted,
          verification: result.verification,
        },
      },
    });

    return NextResponse.json({
      success: true,
      mode: "execute",
      data: result,
    });
  } catch (err) {
    console.error("[POST /api/admin/data-reset]", err);
    const message =
      err instanceof Error ? err.message : "Unknown error during data reset";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─── Backup download endpoint ──────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { auth, error } = await requireRole(req, ["OWNER"]);
  if (error) return error;

  try {
    const backupData = await collectBackupData();

    // Format as JSON for download
    const jsonStr = JSON.stringify(backupData, null, 2);
    const filename = `business-backup-${new Date().toISOString().slice(0, 10)}.json`;

    return new NextResponse(jsonStr, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error("[GET /api/admin/data-reset]", err);
    return NextResponse.json(
      { error: "Failed to generate backup" },
      { status: 500 },
    );
  }
}