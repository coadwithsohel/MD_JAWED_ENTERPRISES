import { NextRequest, NextResponse } from "next/server";
import { editExpense } from "@/lib/expenses";
import { requireAuth } from "@/lib/auth";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authRes = await requireAuth(req);
    if (authRes.error) return authRes.error;

    const data = await req.json();
    const id = (await params).id;
    
    const updated = await editExpense(id, {
      amount: data.amount,
      category: data.category,
      expenseDate: data.expenseDate ? new Date(data.expenseDate) : undefined,
      description: data.description
    });

    return NextResponse.json(updated);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
