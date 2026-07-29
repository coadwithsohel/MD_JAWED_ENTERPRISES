import { NextRequest, NextResponse } from "next/server";
import { voidExpense } from "@/lib/expenses";
import { requireAuth } from "@/lib/auth";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authRes = await requireAuth(req);
    if (authRes.error) return authRes.error;

    let reason = "Voided by user";
    try {
      const data = await req.json();
      if (data.reason) reason = data.reason;
    } catch {
      // ignore
    }
    const id = (await params).id;
    
    const voided = await voidExpense(id, reason);
    return NextResponse.json(voided);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
