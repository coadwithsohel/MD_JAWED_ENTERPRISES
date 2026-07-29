import { NextRequest, NextResponse } from "next/server";
import { getProfitAndLoss } from "@/lib/profit-loss";
import { requireAuth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const authRes = await requireAuth(req);
    if (authRes.error) return authRes.error;

    const { searchParams } = new URL(req.url);
    const period = searchParams.get('period') as 'monthly' | 'yearly' || 'monthly';
    const year = Number(searchParams.get('year'));

    if (!year || isNaN(year)) {
      return NextResponse.json({ error: "Invalid year parameter" }, { status: 400 });
    }

    if (period === 'yearly') {
      const report = await getProfitAndLoss({ period: 'yearly', year });
      return NextResponse.json(report);
    } else {
      const month = Number(searchParams.get('month'));
      if (!month || isNaN(month) || month < 1 || month > 12) {
        return NextResponse.json({ error: "Invalid month parameter" }, { status: 400 });
      }
      const report = await getProfitAndLoss({ period: 'monthly', month, year });
      return NextResponse.json(report);
    }
  } catch (error: any) {
    console.error("P&L API Error:", error);
    return NextResponse.json({ error: error.message || "Failed to generate report" }, { status: 500 });
  }
}
