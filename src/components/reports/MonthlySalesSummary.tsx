"use client";

import { useState, useEffect } from "react";
import { 
  TrendingUp, TrendingDown, DollarSign, FileText, 
  CreditCard, Banknote, Calendar, Loader2, ChevronLeft, ChevronRight 
} from "lucide-react";

interface DailySale {
  date: string;
  invoiceCount: number;
  cashSales: number;
  creditSales: number;
  totalSales: number;
}

interface MonthlySalesData {
  month: number;
  year: number;
  totalSales: number;
  invoiceCount: number;
  cashSales: number;
  creditSales: number;
  averageInvoiceValue: number;
  growthPercent: number | null;
  dailyBreakdown: DailySale[];
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

export default function MonthlySalesSummary() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [data, setData] = useState<MonthlySalesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/reports/monthly-sales?month=${month}&year=${year}`);
        const json = await res.json();
        if (!res.ok) {
          throw new Error(json.error || "Failed to load monthly sales");
        }
        if (active) setData(json);
      } catch (err: any) {
        if (active) setError(err.message);
      } finally {
        if (active) setLoading(false);
      }
    };
    fetchData();
    return () => { active = false; };
  }, [month, year]);

  const handlePrevMonth = () => {
    if (month === 1) {
      setMonth(12);
      setYear(y => y - 1);
    } else {
      setMonth(m => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (month === 12) {
      setMonth(1);
      setYear(y => y + 1);
    } else {
      setMonth(m => m + 1);
    }
  };

  const fmt = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mb-6">
      {/* Header & Selector */}
      <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col sm:flex-row items-center justify-between gap-4">
        <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
          <Calendar className="h-5 w-5 text-blue-600" />
          Monthly Sales Summary
        </h2>
        
        <div className="flex items-center bg-white border border-slate-200 rounded-lg shadow-sm">
          <button 
            onClick={handlePrevMonth}
            className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-50 transition-colors rounded-l-lg border-r border-slate-200"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          
          <select 
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="appearance-none bg-transparent py-2 pl-4 pr-2 font-medium text-slate-700 text-sm outline-none cursor-pointer hover:bg-slate-50"
          >
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="appearance-none bg-transparent py-2 pl-2 pr-4 font-medium text-slate-700 text-sm outline-none cursor-pointer hover:bg-slate-50"
          >
            {Array.from({ length: 10 }, (_, i) => now.getFullYear() - 5 + i).map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          
          <button 
            onClick={handleNextMonth}
            disabled={year === now.getFullYear() && month === now.getMonth() + 1}
            className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-50 transition-colors rounded-r-lg border-l border-slate-200 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>

      {loading && (
        <div className="p-12 flex flex-col items-center justify-center text-slate-400">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500 mb-2" />
          <p>Loading summary...</p>
        </div>
      )}

      {error && (
        <div className="p-8 text-center text-red-600 bg-red-50">
          <p className="font-semibold">Error loading data</p>
          <p className="text-sm mt-1">{error}</p>
        </div>
      )}

      {data && !loading && !error && (
        <div className="p-4 lg:p-6 space-y-6">
          
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
              <p className="text-sm font-medium text-slate-500 mb-1">Total Sales</p>
              <p className="text-2xl font-bold text-slate-900">{fmt(data.totalSales)}</p>
              <div className="flex items-center gap-1 mt-2">
                {data.growthPercent === null ? (
                  <span className="text-xs font-medium text-slate-500">No previous data</span>
                ) : data.growthPercent === 100 && data.totalSales > 0 ? (
                  <span className="text-xs font-medium text-green-600 flex items-center bg-green-100 px-1.5 py-0.5 rounded">
                    New <TrendingUp className="h-3 w-3 ml-1" />
                  </span>
                ) : (
                  <span className={`text-xs font-medium flex items-center px-1.5 py-0.5 rounded ${data.growthPercent >= 0 ? "text-green-600 bg-green-100" : "text-red-600 bg-red-100"}`}>
                    {data.growthPercent >= 0 ? "+" : ""}{data.growthPercent}%
                    {data.growthPercent >= 0 ? <TrendingUp className="h-3 w-3 ml-1" /> : <TrendingDown className="h-3 w-3 ml-1" />}
                  </span>
                )}
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
              <p className="text-sm font-medium text-slate-500 mb-1">Invoices</p>
              <p className="text-2xl font-bold text-slate-900">{data.invoiceCount}</p>
              <p className="text-xs text-slate-500 mt-2">
                Avg: {fmt(data.averageInvoiceValue)}
              </p>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
              <p className="text-sm font-medium text-slate-500 mb-1 flex items-center gap-1">
                <Banknote className="h-4 w-4 text-green-600" /> Cash Sales
              </p>
              <p className="text-2xl font-bold text-slate-900">{fmt(data.cashSales)}</p>
              <p className="text-xs text-slate-500 mt-2">
                {data.totalSales > 0 ? Math.round((data.cashSales / data.totalSales) * 100) : 0}% of total
              </p>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
              <p className="text-sm font-medium text-slate-500 mb-1 flex items-center gap-1">
                <CreditCard className="h-4 w-4 text-orange-600" /> Credit Sales
              </p>
              <p className="text-2xl font-bold text-slate-900">{fmt(data.creditSales)}</p>
              <p className="text-xs text-slate-500 mt-2">
                {data.totalSales > 0 ? Math.round((data.creditSales / data.totalSales) * 100) : 0}% of total
              </p>
            </div>
          </div>

          {/* Table */}
          {data.dailyBreakdown.length > 0 ? (
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[600px]">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500 font-semibold">
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3 text-right">Invoices</th>
                      <th className="px-4 py-3 text-right text-green-700">Cash Sales</th>
                      <th className="px-4 py-3 text-right text-orange-700">Credit Sales</th>
                      <th className="px-4 py-3 text-right text-blue-700">Total Sales</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.dailyBreakdown.map((row) => (
                      <tr key={row.date} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3 text-sm font-medium text-slate-900">
                          {new Date(row.date).toLocaleDateString("en-IN", { month: "short", day: "numeric", year: "numeric" })}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600 text-right">{row.invoiceCount}</td>
                        <td className="px-4 py-3 text-sm font-medium text-green-600 text-right">{fmt(row.cashSales)}</td>
                        <td className="px-4 py-3 text-sm font-medium text-orange-600 text-right">{fmt(row.creditSales)}</td>
                        <td className="px-4 py-3 text-sm font-bold text-blue-600 text-right">{fmt(row.totalSales)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-50 border-t border-slate-200">
                    <tr>
                      <td className="px-4 py-3 text-sm font-bold text-slate-900">Total</td>
                      <td className="px-4 py-3 text-sm font-bold text-slate-900 text-right">{data.invoiceCount}</td>
                      <td className="px-4 py-3 text-sm font-bold text-green-700 text-right">{fmt(data.cashSales)}</td>
                      <td className="px-4 py-3 text-sm font-bold text-orange-700 text-right">{fmt(data.creditSales)}</td>
                      <td className="px-4 py-3 text-sm font-bold text-blue-700 text-right">{fmt(data.totalSales)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          ) : (
            <div className="border border-slate-200 rounded-xl p-8 text-center text-slate-400">
              <FileText className="h-10 w-10 mx-auto mb-2 opacity-30" />
              <p>No sales recorded in {MONTHS[month - 1]} {year}</p>
            </div>
          )}

        </div>
      )}
    </div>
  );
}
