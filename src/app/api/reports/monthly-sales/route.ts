import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getMonthlySales } from '@/lib/monthly-sales';

export async function GET(req: NextRequest) {
  const { error } = await requireAuth(req);
  if (error) return error;

  try {
    const url = new URL(req.url);
    const monthStr = url.searchParams.get('month');
    const yearStr = url.searchParams.get('year');

    if (!monthStr || !yearStr) {
      return NextResponse.json({ error: 'Month and year are required' }, { status: 400 });
    }

    const month = parseInt(monthStr, 10);
    const year = parseInt(yearStr, 10);

    if (isNaN(month) || month < 1 || month > 12) {
      return NextResponse.json({ error: 'Invalid month. Must be between 1 and 12.' }, { status: 400 });
    }
    
    if (isNaN(year) || year < 2000 || year > 2100) {
      return NextResponse.json({ error: 'Invalid year.' }, { status: 400 });
    }

    const data = await getMonthlySales(month, year);
    return NextResponse.json(data);
  } catch (err) {
    console.error('[GET /api/reports/monthly-sales]', err);
    return NextResponse.json({ error: 'Server error while fetching monthly sales' }, { status: 500 });
  }
}
