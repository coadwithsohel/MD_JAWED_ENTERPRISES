"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle, Search, AlertTriangle, RefreshCw } from "lucide-react";
import Link from "next/link";

function fmt(n: number | string | undefined | null) {
  if (!n) return "₹0";
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(Number(n));
}

export default function CostDataReviewPage() {
  const router = useRouter();
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [filterMonth, setFilterMonth] = useState("all");
  const [filterYear, setFilterYear] = useState(new Date().getFullYear().toString());
  const [filterStatus, setFilterStatus] = useState("missing");
  const [filterSource, setFilterSource] = useState("all");
  
  const [selectedIds, setSelectedIds] = useState<{saleItemIds: string[], saleIds: string[]}>({saleItemIds: [], saleIds: []});
  
  const [previewData, setPreviewData] = useState<any[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [commitLoading, setCommitLoading] = useState(false);

  const fetchList = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/reports/cost-data?month=${filterMonth}&year=${filterYear}&status=${filterStatus}&source=${filterSource}`);
      const json = await res.json();
      setData(json);
      setSelectedIds({saleItemIds: [], saleIds: []});
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchList();
  }, [filterMonth, filterYear, filterStatus, filterSource]);

  const handlePreview = async () => {
    if (selectedIds.saleItemIds.length === 0 && selectedIds.saleIds.length === 0) return;
    setPreviewLoading(true);
    try {
      const res = await fetch(`/api/reports/cost-data/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selectedIds)
      });
      const json = await res.json();
      setPreviewData(json.preview || []);
    } catch (e) {
      console.error(e);
    } finally {
      setPreviewLoading(false);
    }
  };

  const [commitError, setCommitError] = useState<string | null>(null);

  const handleCommit = async () => {
    if (!previewData || previewData.length === 0) return;
    setCommitLoading(true);
    setCommitError(null);
    try {
      const res = await fetch(`/api/reports/cost-data/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates: previewData })
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setPreviewData(null);
        fetchList();
      } else {
        setCommitError(json.message || "An unknown error occurred during commit.");
      }
    } catch (e: any) {
      console.error(e);
      setCommitError(e.message || "Network error. Please try again.");
    } finally {
      setCommitLoading(false);
    }
  };

  const toggleSelect = (type: "SALE_ITEM" | "SALE_ALLOCATION", id: string) => {
    setSelectedIds(prev => {
      const field = type === "SALE_ITEM" ? "saleItemIds" : "saleIds";
      const list = prev[field];
      if (list.includes(id)) {
        return { ...prev, [field]: list.filter(x => x !== id) };
      } else {
        return { ...prev, [field]: [...list, id] };
      }
    });
  };
  
  const updatePreviewField = (index: number, field: string, value: any) => {
    if (!previewData) return;
    const newData = [...previewData];
    newData[index] = { ...newData[index], [field]: value };
    setPreviewData(newData);
  };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <div className="flex items-center gap-4 mb-8">
        <Link href="/dashboard/reports/profit-loss" className="p-2 hover:bg-slate-100 rounded-full transition-colors">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Cost Data Completion</h1>
          <p className="text-slate-500 text-sm">Review and backfill missing product costs safely.</p>
        </div>
      </div>

      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 mb-6 flex flex-wrap gap-4 items-center">
        <select value={filterYear} onChange={e => setFilterYear(e.target.value)} className="border-slate-200 rounded-lg text-sm">
          <option value="2026">2026</option>
          <option value="2025">2025</option>
        </select>
        <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)} className="border-slate-200 rounded-lg text-sm">
          <option value="all">All Months</option>
          {Array.from({length: 12}).map((_, i) => (
            <option key={i+1} value={i+1}>{new Date(0, i).toLocaleString('default', { month: 'long' })}</option>
          ))}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="border-slate-200 rounded-lg text-sm">
          <option value="missing">Missing Cost</option>
          <option value="partial">Partial Cost</option>
          <option value="complete">Complete</option>
          <option value="all">All Invoices</option>
        </select>
        <select value={filterSource} onChange={e => setFilterSource(e.target.value)} className="border-slate-200 rounded-lg text-sm">
          <option value="all">All Sources</option>
          <option value="pos">POS Only (Itemized)</option>
          <option value="imported">Imported/Ledger Only (No Items)</option>
        </select>
        <div className="ml-auto">
          <button 
            disabled={selectedIds.saleItemIds.length === 0 && selectedIds.saleIds.length === 0}
            onClick={handlePreview}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            Preview Resolution ({selectedIds.saleItemIds.length + selectedIds.saleIds.length})
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400">Loading...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider border-b">
                  <th className="p-4 w-10"></th>
                  <th className="p-4 font-semibold">Date</th>
                  <th className="p-4 font-semibold">Invoice</th>
                  <th className="p-4 font-semibold">Particulars</th>
                  <th className="p-4 font-semibold text-right">Selling Amt</th>
                  <th className="p-4 font-semibold text-right">Cost Status</th>
                </tr>
              </thead>
              <tbody className="text-sm divide-y divide-slate-100">
                {data.length === 0 ? (
                  <tr><td colSpan={6} className="p-8 text-center text-slate-500">No invoices match filters.</td></tr>
                ) : data.map((sale: any) => {
                  const isImported = sale.saleItems.length === 0;
                  const accDate = new Date(sale.saleDate || sale.createdAt).toLocaleDateString('en-IN');
                  
                  if (isImported) {
                    const isSelected = selectedIds.saleIds.includes(sale.id);
                    return (
                      <tr key={sale.id} className="hover:bg-slate-50">
                        <td className="p-4">
                          <input type="checkbox" checked={isSelected} onChange={() => toggleSelect("SALE_ALLOCATION", sale.id)} className="rounded border-slate-300" />
                        </td>
                        <td className="p-4 text-slate-500">{accDate}</td>
                        <td className="p-4 font-medium text-slate-700">{sale.invoiceNumber}</td>
                        <td className="p-4 text-slate-600">Manual Ledger Entry (Total: {fmt(sale.grandTotal)})</td>
                        <td className="p-4 text-right">{fmt(sale.grandTotal)}</td>
                        <td className="p-4 text-right">
                           {sale.computedCostStatus === 'missing' ? (
                             <span className="inline-flex items-center gap-1 text-amber-600 bg-amber-50 px-2 py-1 rounded text-xs font-medium"><AlertTriangle className="w-3 h-3"/> Missing</span>
                           ) : (
                             <span className="inline-flex items-center gap-1 text-emerald-600 bg-emerald-50 px-2 py-1 rounded text-xs font-medium"><CheckCircle className="w-3 h-3"/> Complete</span>
                           )}
                        </td>
                      </tr>
                    );
                  }

                  return sale.saleItems.map((item: any) => {
                    const isSelected = selectedIds.saleItemIds.includes(item.id);
                    const hasCost = item.purchasePriceSnapshot && Number(item.purchasePriceSnapshot) > 0;
                    if (filterStatus === 'missing' && hasCost) return null;
                    return (
                      <tr key={item.id} className="hover:bg-slate-50 border-t border-slate-50 border-dashed first:border-0">
                        <td className="p-4">
                          <input type="checkbox" checked={isSelected} onChange={() => toggleSelect("SALE_ITEM", item.id)} className="rounded border-slate-300" />
                        </td>
                        <td className="p-4 text-slate-500">{accDate}</td>
                        <td className="p-4 font-medium text-slate-700">{sale.invoiceNumber}</td>
                        <td className="p-4 text-slate-600">{item.product?.name || 'Unknown'} (x{item.quantity})</td>
                        <td className="p-4 text-right">{fmt(item.lineTotal)}</td>
                        <td className="p-4 text-right">
                           {!hasCost ? (
                             <span className="inline-flex items-center gap-1 text-amber-600 bg-amber-50 px-2 py-1 rounded text-xs font-medium"><AlertTriangle className="w-3 h-3"/> Missing</span>
                           ) : (
                             <span className="inline-flex items-center gap-1 text-emerald-600 bg-emerald-50 px-2 py-1 rounded text-xs font-medium"><CheckCircle className="w-3 h-3"/> Complete</span>
                           )}
                        </td>
                      </tr>
                    )
                  });
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Preview Modal */}
      {previewData && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h2 className="text-xl font-bold text-slate-800">Preview Cost Resolution</h2>
              <button onClick={() => setPreviewData(null)} className="text-slate-400 hover:text-slate-600">Close</button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1">
              {previewLoading ? (
                <div className="text-center p-8">Loading resolution...</div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="text-xs uppercase tracking-wider text-slate-500 border-b">
                      <th className="pb-3 font-semibold">Invoice</th>
                      <th className="pb-3 font-semibold">Item</th>
                      <th className="pb-3 font-semibold text-right">Qty</th>
                      <th className="pb-3 font-semibold text-right">Selling</th>
                      <th className="pb-3 font-semibold text-right">Proposed Cost (Total)</th>
                      <th className="pb-3 font-semibold text-right">Source</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm divide-y divide-slate-100">
                    {previewData.map((row, i) => (
                      <tr key={i} className="hover:bg-slate-50">
                        <td className="py-4 font-medium text-slate-700">{row.invoiceNumber}</td>
                        <td className="py-4 text-slate-600">{row.productName}</td>
                        <td className="py-4 text-right">{row.quantity}</td>
                        <td className="py-4 text-right">{fmt(row.sellingAmount)}</td>
                        <td className="py-4 text-right">
                          {row.type === 'SALE_ALLOCATION' ? (
                            <input 
                              type="number" 
                              value={row.proposedTotalCost || ''}
                              onChange={e => updatePreviewField(i, 'proposedTotalCost', Number(e.target.value))}
                              className="w-24 text-right border-slate-300 rounded text-sm p-1"
                              placeholder="Enter total cost"
                            />
                          ) : (
                            <span className="font-semibold text-amber-700">{fmt(row.proposedTotalCost)}</span>
                          )}
                        </td>
                        <td className="py-4 text-right">
                          <span className={`inline-flex px-2 py-1 rounded text-xs font-medium ${row.isEstimated ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                            {row.source}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            
            <div className="p-6 border-t border-slate-100 bg-slate-50 flex flex-col gap-3">
              {commitError && (
                <div className="bg-red-50 text-red-700 p-3 rounded-lg flex items-center gap-2 text-sm">
                  <AlertTriangle className="w-4 h-4" />
                  {commitError}
                </div>
              )}
              <div className="flex justify-end gap-3">
                <button onClick={() => { setPreviewData(null); setCommitError(null); }} className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-200 rounded-lg transition-colors">
                  Cancel
                </button>
                <button 
                  onClick={handleCommit} 
                  disabled={commitLoading}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2 rounded-lg font-medium transition-colors flex items-center gap-2"
                >
                  {commitLoading && <RefreshCw className="h-4 w-4 animate-spin" />}
                  Confirm & Backfill Cost
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
