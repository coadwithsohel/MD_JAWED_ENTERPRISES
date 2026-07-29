"use client";

import { useState, useEffect } from "react";
import { Loader2, TrendingUp, TrendingDown, Calendar, Minus, Equal, AlertTriangle, ListFilter } from "lucide-react";
import Link from "next/link";

export default function ProfitLossPage() {
  const now = new Date();
  const [period, setPeriod] = useState<"monthly" | "yearly">("monthly");
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const fetchPL = async () => {
      setLoading(true);
      setError(false);
      try {
        const url = period === "yearly" 
          ? `/api/reports/profit-loss?period=yearly&year=${year}`
          : `/api/reports/profit-loss?period=monthly&month=${month}&year=${year}`;
        const res = await fetch(url);
        const json = await res.json();
        if (res.ok && !json.error) {
          setData(json);
        } else {
          setError(true);
        }
      } catch (err) {
        console.error("P&L Fetch Error:", err);
        setError(true);
      } finally {
        setLoading(false);
      }
    };
    fetchPL();
  }, [period, month, year]);

  const fmt = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(n);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-10">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Profit & Loss</h1>
          <p className="text-sm text-slate-500">Financial performance report</p>
        </div>
        
        <div className="flex gap-2 items-center bg-white border rounded-lg p-1 shadow-sm">
          <button 
            onClick={() => setPeriod("monthly")}
            className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${period === "monthly" ? "bg-blue-50 text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
          >
            Monthly
          </button>
          <button 
            onClick={() => setPeriod("yearly")}
            className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${period === "yearly" ? "bg-blue-50 text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
          >
            Yearly
          </button>
        </div>

        <div className="flex gap-2">
          {period === "monthly" && (
            <select value={month} onChange={e => setMonth(Number(e.target.value))} className="border p-2 rounded-lg bg-white shadow-sm">
              {Array.from({length: 12}, (_, i) => <option key={i+1} value={i+1}>{new Date(2000, i).toLocaleString('default', {month: 'long'})}</option>)}
            </select>
          )}
          <select value={year} onChange={e => setYear(Number(e.target.value))} className="border p-2 rounded-lg bg-white shadow-sm">
            {Array.from({length: 5}, (_, i) => year - 2 + i).map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-12 text-center text-slate-500">
          <Loader2 className="animate-spin h-8 w-8 mx-auto mb-4" />
          <p>Loading report...</p>
        </div>
      ) : error ? (
        <div className="bg-red-50 text-red-600 rounded-2xl shadow-sm border border-red-200 p-12 text-center">
          <AlertTriangle className="h-8 w-8 mx-auto mb-4" />
          <p className="font-semibold text-lg">Unable to load Profit & Loss report.</p>
          <p className="text-sm mt-2 opacity-80">Check the server logs for more details.</p>
        </div>
      ) : data ? (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            
            {data.costDataCompleteness?.coveragePercentAmount < 100 && (
              <div className="bg-amber-50 text-amber-800 p-4 border-b border-amber-200 flex flex-col md:flex-row gap-4 items-start md:items-center justify-between text-sm">
                <div className="flex gap-3 items-center">
                  <AlertTriangle className="h-5 w-5 shrink-0" />
                  <p>
                    <strong>Estimated profit: cost data is missing for some Sales.</strong><br/>
                    Cost coverage: {data.costDataCompleteness.coveragePercentAmount}% | Sales without cost data: {fmt(data.costDataCompleteness.salesWithoutCost)} | Invoices lacking complete cost: {(data.costDataCompleteness.missingCostInvoices || 0) + (data.costDataCompleteness.partialCostInvoices || 0)}
                  </p>
                </div>
                <Link href="/dashboard/reports/cost-data-review" className="shrink-0 bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded font-medium shadow-sm transition-colors text-xs uppercase tracking-wider">
                  Complete Missing Cost Data
                </Link>
              </div>
            )}

            {/* Revenue */}
            <div className="p-6 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-800 mb-4 uppercase tracking-wider text-xs">Income</h2>
              
              <div className="space-y-3 mb-4">
                <div className="flex justify-between items-center text-slate-600 text-sm">
                  <span>Cash Sales</span>
                  <span>{fmt(data.cashSales || 0)}</span>
                </div>
                <div className="flex justify-between items-center text-slate-600 text-sm">
                  <span>Credit Sales</span>
                  <span>{fmt(data.creditSales || 0)}</span>
                </div>
                {data.salesReturns > 0 && (
                  <div className="flex justify-between items-center text-red-500 text-sm">
                    <span>Less: Sales Returns</span>
                    <span>-{fmt(data.salesReturns)}</span>
                  </div>
                )}
              </div>

              <div className="flex justify-between items-center text-lg pt-4 border-t border-slate-100">
                <span className="text-slate-900 font-semibold">{period === 'yearly' ? 'Yearly Net Sales' : 'Net Sales'}</span>
                <span className="font-bold">{fmt(data.netSales || 0)}</span>
              </div>
            </div>

            {/* Direct Costs */}
            <div className="p-6 border-b border-slate-100 bg-slate-50/50">
               <h2 className="text-lg font-bold text-slate-800 mb-4 uppercase tracking-wider text-xs">Direct Cost</h2>
               <div className="flex justify-between items-center text-red-600">
                <span className="flex items-center gap-2"><Minus className="h-4 w-4" /> Cost of Goods Sold</span>
                <span className="font-semibold">{fmt(data.costOfGoodsSold || 0)}</span>
              </div>
            </div>

            {/* Gross Profit */}
            <div className="px-6 py-5 bg-blue-50 border-b border-blue-100">
              <div className="flex justify-between items-center text-xl font-bold text-blue-900">
                <span className="flex items-center gap-2"><Equal className="h-5 w-5" /> {data.costDataCompleteness?.coveragePercentAmount === 100 ? "Exact Gross Profit" : "Estimated Gross Profit"}</span>
                <span>{fmt(data.grossProfit || 0)}</span>
              </div>
            </div>

            {/* Expenses */}
            <div className="p-6 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-800 mb-4 uppercase tracking-wider text-xs">Indirect Expenses</h2>
              
              {(!data.expensesByCategory || data.expensesByCategory.length === 0) ? (
                <div className="text-center py-6 text-slate-400 italic">
                  No expenses recorded
                </div>
              ) : (
                <div className="space-y-3">
                  {data.expensesByCategory.map((exp: any, i: number) => (
                    <div key={i} className="flex justify-between items-center text-slate-600 text-sm">
                      <span className="capitalize">{exp.category.toLowerCase()}</span>
                      <span>{fmt(exp.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
              
              <div className="flex justify-between items-center text-red-600 font-bold mt-6 pt-4 border-t border-slate-100">
                <span className="flex items-center gap-2"><Minus className="h-4 w-4" /> Total Expenses</span>
                <span>{fmt(data.totalExpenses || 0)}</span>
              </div>
            </div>

            {/* Net Profit */}
            <div className={`px-6 py-6 ${data.netProfit >= 0 ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
              <div className="flex justify-between items-center text-2xl font-bold mb-2">
                <span className="flex items-center gap-2">
                  <Equal className="h-6 w-6" /> {data.netProfit >= 0 ? "Net Profit" : "Net Loss"}
                </span>
                <span>{fmt(data.netProfit || 0)}</span>
              </div>
              <div className="text-right text-sm opacity-90 flex justify-between items-center">
                <span>Invoices: {data.invoiceCount} | Expenses: {data.expenseCount ?? data.expensesByCategory?.length ?? 0}</span>
                <span>Profit Margin: {data.profitMargin ? data.profitMargin.toFixed(1) : 0}%</span>
              </div>
            </div>

          </div>

          {period === "yearly" && data.monthlyBreakdown && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="p-6 border-b border-slate-100 bg-slate-50">
                <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                  <ListFilter className="h-5 w-5 text-slate-500" />
                  Month-wise Breakdown
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider border-b">
                      <th className="p-4 font-semibold">Month</th>
                      <th className="p-4 font-semibold text-right">Sales</th>
                      <th className="p-4 font-semibold text-right text-red-600">COGS</th>
                      <th className="p-4 font-semibold text-right text-amber-600">Missing Cost Sales</th>
                      <th className="p-4 font-semibold text-right text-amber-600">Coverage %</th>
                      <th className="p-4 font-semibold text-right text-blue-600">Gross Profit</th>
                      <th className="p-4 font-semibold text-right text-red-600">Expenses</th>
                      <th className="p-4 font-semibold text-right text-emerald-600">Net Profit</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm divide-y divide-slate-100">
                    {data.monthlyBreakdown.map((row: any) => (
                      <tr key={row.month} className="hover:bg-slate-50 transition-colors">
                        <td className="p-4 font-medium text-slate-700">{months[row.month - 1]}</td>
                        <td className="p-4 text-right text-slate-700">{fmt(row.netSales)}</td>
                        <td className="p-4 text-right text-slate-600">{fmt(row.costOfGoodsSold)}</td>
                        <td className="p-4 text-right text-amber-600">{fmt(row.missingCostSales || 0)}</td>
                        <td className="p-4 text-right text-amber-600">{row.coveragePercent ? row.coveragePercent.toFixed(1) : 0}%</td>
                        <td className="p-4 text-right text-blue-700 font-medium">{fmt(row.grossProfit)}</td>
                        <td className="p-4 text-right text-slate-600">{fmt(row.totalExpenses)}</td>
                        <td className={`p-4 text-right font-bold ${row.netProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {fmt(row.netProfit)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>
      ) : null}
    </div>
  );
}
