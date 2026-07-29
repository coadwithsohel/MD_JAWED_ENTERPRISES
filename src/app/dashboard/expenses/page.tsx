"use client";

import { useState, useEffect } from "react";
import { Loader2, Trash2, Plus, Receipt } from "lucide-react";
import Link from "next/link";

const CATEGORIES = [
  "SHOP_RENT", "STAFF_SALARY", "ELECTRICITY_BILL", "INTERNET", "TRANSPORT", "REPAIR", "OTHER_EXPENSES"
];

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  
  // Form State
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [amount, setAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(now.toISOString().split("T")[0]);
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");

  const fetchExpenses = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/expenses?month=${month}&year=${year}`);
      const json = await res.json();
      if (res.ok) {
        setExpenses(json.expenses || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchExpenses();
  }, [month, year]);

  const handleSave = async () => {
    if (!amount || !expenseDate) return;
    setSaving(true);
    try {
      const res = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, amount, expenseDate, description, referenceNumber: reference })
      });
      if (res.ok) {
        setShowModal(false);
        setAmount("");
        setDescription("");
        setReference("");
        fetchExpenses();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this expense?")) return;
    await fetch(`/api/expenses/${id}`, { method: "DELETE" });
    fetchExpenses();
  };

  const fmt = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(n);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Expenses</h1>
          <p className="text-sm text-slate-500">Manage shop and operational expenses</p>
        </div>
        <button onClick={() => setShowModal(true)} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold flex items-center gap-2 hover:bg-blue-700">
          <Plus className="h-5 w-5" /> Add Expense
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex gap-4">
          <select value={month} onChange={e => setMonth(Number(e.target.value))} className="border p-2 rounded">
            {Array.from({length: 12}, (_, i) => <option key={i+1} value={i+1}>{new Date(2000, i).toLocaleString('default', {month: 'long'})}</option>)}
          </select>
          <select value={year} onChange={e => setYear(Number(e.target.value))} className="border p-2 rounded">
            {Array.from({length: 5}, (_, i) => year - 2 + i).map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        {loading ? (
          <div className="p-10 text-center text-slate-500"><Loader2 className="animate-spin h-6 w-6 mx-auto" /></div>
        ) : (
          <table className="w-full text-left">
            <thead className="bg-slate-50 border-b border-slate-200 text-sm text-slate-500">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {expenses.map(e => (
                <tr key={e.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-sm">{new Date(e.expenseDate).toLocaleDateString("en-IN")}</td>
                  <td className="px-4 py-3 text-sm font-medium">{e.category.replace("_", " ")}</td>
                  <td className="px-4 py-3 text-sm text-slate-500">{e.description}</td>
                  <td className="px-4 py-3 text-sm font-bold text-right text-red-600">{fmt(Number(e.amount))}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => handleDelete(e.id)} className="text-red-500 p-1 hover:bg-red-50 rounded"><Trash2 className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))}
              {expenses.length === 0 && (
                <tr><td colSpan={5} className="p-8 text-center text-slate-400">No expenses found</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6">
            <h2 className="text-xl font-bold mb-4">Add Expense</h2>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">Category</label>
                <select value={category} onChange={e => setCategory(e.target.value)} className="w-full border p-2 rounded mt-1">
                  {CATEGORIES.map(c => <option key={c} value={c}>{c.replace("_", " ")}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">Amount</label>
                <input type="number" value={amount} onChange={e => setAmount(e.target.value)} className="w-full border p-2 rounded mt-1" />
              </div>
              <div>
                <label className="text-sm font-medium">Date</label>
                <input type="date" value={expenseDate} onChange={e => setExpenseDate(e.target.value)} className="w-full border p-2 rounded mt-1" />
              </div>
              <div>
                <label className="text-sm font-medium">Description</label>
                <input type="text" value={description} onChange={e => setDescription(e.target.value)} className="w-full border p-2 rounded mt-1" />
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowModal(false)} className="px-4 py-2 text-slate-500">Cancel</button>
                <button onClick={handleSave} disabled={saving} className="bg-blue-600 text-white px-4 py-2 rounded">
                  {saving ? "Saving..." : "Save Expense"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
