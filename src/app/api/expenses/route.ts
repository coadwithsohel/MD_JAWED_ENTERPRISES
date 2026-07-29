import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getExpenses, createExpense } from "@/lib/expenses";
import { ExpenseCategory } from "@prisma/client";

export async function GET(req: NextRequest) {
  const { auth, error } = await requireAuth(req);
  if (error) return error;

  try {
    const url = new URL(req.url);
    const month = parseInt(url.searchParams.get("month") || "0", 10);
    const year = parseInt(url.searchParams.get("year") || "0", 10);
    if (!month || !year) return NextResponse.json({ error: "Month and year required" }, { status: 400 });

    const expenses = await getExpenses(month, year);
    return NextResponse.json({ expenses });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { auth, error } = await requireAuth(req);
  if (error) return error;
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    if (!body.category || !body.amount || !body.expenseDate) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const expense = await createExpense({
      category: body.category as ExpenseCategory,
      amount: Number(body.amount),
      expenseDate: new Date(body.expenseDate),
      description: body.description,
      referenceNumber: body.referenceNumber,
      createdById: auth.userId
    });
    return NextResponse.json({ expense });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

