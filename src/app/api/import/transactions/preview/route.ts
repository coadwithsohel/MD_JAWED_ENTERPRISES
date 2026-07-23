import { NextRequest, NextResponse } from "next/server";
import { requireAuth, clearAuthCookie } from "@/lib/auth";
import { previewTransactionImport } from "@/features/import-export/transaction-import";
import { ImportError } from "@/features/import-export/errors";

export async function POST(req: NextRequest) {
  const { auth, error } = await requireAuth(req);
  if (error) return error;

  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: { code: "MISSING_FILE", message: "No file provided." } },
        { status: 400 },
      );
    }

    const content = await file.text();
    const result = await previewTransactionImport(content, file.name, auth.userId);

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
    console.error("[import/transactions/preview]", err);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } },
      { status: 500 },
    );
  }
}