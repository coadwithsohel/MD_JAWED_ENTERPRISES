import { NextRequest, NextResponse } from "next/server";
import { requireAuth, clearAuthCookie } from "@/lib/auth";
import { commitCustomerImport } from "@/features/import-export/customer-import";
import { ImportError } from "@/features/import-export/errors";

export async function POST(req: NextRequest) {
  const { auth, error } = await requireAuth(req);
  if (error) return error;

  try {
    const body = await req.json();
    const { batchId } = body;

    if (!batchId || typeof batchId !== "string") {
      return NextResponse.json(
        { success: false, error: { code: "MISSING_BATCH_ID", message: "batchId is required." } },
        { status: 400 },
      );
    }

    const result = await commitCustomerImport(batchId, auth.userId);

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (err) {
    if (err instanceof ImportError) {
      if (err.code === "SESSION_USER_NOT_FOUND") {
        const res = NextResponse.json(
          { success: false, error: { code: err.code, message: err.message } },
          { status: 401 },
        );
        clearAuthCookie(res);
        return res;
      }
      return NextResponse.json(
        { success: false, error: { code: err.code, message: err.message } },
        { status: err.statusCode },
      );
    }
    console.error("[import/customers/commit]", err);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } },
      { status: 500 },
    );
  }
}