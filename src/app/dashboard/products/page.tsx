'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search, Plus, Loader2, X, Package } from 'lucide-react';

interface Product {
  id: string; sku: string; name: string; description?: string;
  category: { id: string; name: string }; brand?: { id: string; name: string } | null;
  purchasePrice: string; sellingPrice: string; gstPercent: string;
  stockQuantity: number; lowStockThreshold: number; isActive: boolean;
}
interface Category { id: string; name: string; }
interface Brand { id: string; name: string; }

const initialForm = {
  sku: '', name: '', categoryId: '', brandId: '', purchasePrice: '',
  sellingPrice: '', gstPercent: '0', hsnCode: '', stockQuantity: '', lowStockThreshold: '5', description: '', barcode: '',
};

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [addingCat, setAddingCat] = useState(false);

  useEffect(() => { const t = setTimeout(() => setDebouncedSearch(search), 300); return () => clearTimeout(t); }, [search]);
  useEffect(() => { setPage(1); }, [debouncedSearch]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (debouncedSearch) params.set('search', debouncedSearch);
      const [pRes, cRes, bRes] = await Promise.all([
        fetch(`/api/products?${params}`),
        fetch('/api/categories'),
        fetch('/api/brands'),
      ]);
      const [pData, cData, bData] = await Promise.all([pRes.json(), cRes.json(), bRes.json()]);
      setProducts(pData.products ?? []);
      setTotal(pData.total ?? 0);
      setCategories(cData.categories ?? []);
      setBrands(bData.brands ?? []);
    } catch { setProducts([]); }
    finally { setLoading(false); }
  }, [page, debouncedSearch]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleAddCategory = async () => {
    if (!newCategory.trim()) return;
    setAddingCat(true);
    try {
      const res = await fetch('/api/categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newCategory }) });
      const data = await res.json();
      if (res.ok) { setCategories([...categories, data.category]); setForm({ ...form, categoryId: data.category.id }); setNewCategory(''); }
    } finally { setAddingCat(false); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setSaving(true);
    try {
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          purchasePrice: Number(form.purchasePrice), sellingPrice: Number(form.sellingPrice),
          gstPercent: Number(form.gstPercent), stockQuantity: Number(form.stockQuantity),
          lowStockThreshold: Number(form.lowStockThreshold),
          brandId: form.brandId || null, barcode: form.barcode || null, hsnCode: form.hsnCode || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setFormError(data.error || 'Failed to create product'); return; }
      setShowModal(false); setForm(initialForm); fetchAll();
    } catch { setFormError('Network error'); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Products</h1>
          <p className="text-sm text-slate-500">{total} products total</p>
        </div>
        <button onClick={() => { setShowModal(true); setFormError(''); }} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors shadow-sm">
          <Plus className="h-4 w-4" /> Add Product
        </button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, SKU, barcode..." className="block w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white" />
        {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"><X className="h-4 w-4" /></button>}
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 text-blue-500 animate-spin" /></div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  {['SKU', 'Product Name', 'Category', 'Brand', 'Purchase', 'Selling', 'GST', 'Stock', 'Status'].map((h) => (
                    <th key={h} className="px-5 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100">
                {products.length === 0 ? (
                  <tr><td colSpan={9} className="py-16 text-center">
                    <Package className="h-10 w-10 text-slate-200 mx-auto mb-2" />
                    <p className="text-slate-400 text-sm">{debouncedSearch ? 'No products found' : 'No products yet — add your first product'}</p>
                  </td></tr>
                ) : products.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3 font-mono text-xs text-slate-600 whitespace-nowrap">{p.sku}</td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      <p className="text-sm font-medium text-slate-900">{p.name}</p>
                      {p.description && <p className="text-xs text-slate-400 truncate max-w-[200px]">{p.description}</p>}
                    </td>
                    <td className="px-5 py-3 text-sm text-slate-500 whitespace-nowrap">{p.category.name}</td>
                    <td className="px-5 py-3 text-sm text-slate-500 whitespace-nowrap">{p.brand?.name || '—'}</td>
                    <td className="px-5 py-3 text-sm text-slate-600 whitespace-nowrap">₹{parseFloat(p.purchasePrice).toLocaleString('en-IN')}</td>
                    <td className="px-5 py-3 text-sm font-semibold text-slate-900 whitespace-nowrap">₹{parseFloat(p.sellingPrice).toLocaleString('en-IN')}</td>
                    <td className="px-5 py-3 text-sm text-slate-500 whitespace-nowrap">{p.gstPercent}%</td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      <span className={`text-sm font-semibold ${p.stockQuantity <= p.lowStockThreshold ? 'text-red-600' : 'text-slate-900'}`}>{p.stockQuantity}</span>
                      {p.stockQuantity <= p.lowStockThreshold && <span className="ml-1 text-xs text-red-400">Low</span>}
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${p.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>{p.isActive ? 'Active' : 'Inactive'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-slate-200 sticky top-0 bg-white rounded-t-2xl">
              <h2 className="text-lg font-bold text-slate-900">Add New Product</h2>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {formError && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{formError}</div>}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {[
                  { label: 'Product Name *', key: 'name', required: true, placeholder: 'e.g. Samsung Galaxy A54' },
                  { label: 'SKU *', key: 'sku', required: true, placeholder: 'e.g. SAM-A54-128' },
                  { label: 'Barcode', key: 'barcode', placeholder: 'EAN / UPC' },
                  { label: 'HSN Code', key: 'hsnCode', placeholder: '8517' },
                ].map((f) => (
                  <div key={f.key} className={f.key === 'name' ? 'sm:col-span-2' : ''}>
                    <label className="block text-sm font-medium text-slate-700 mb-1">{f.label}</label>
                    <input required={f.required} value={(form as any)[f.key] ?? ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} placeholder={f.placeholder} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                  </div>
                ))}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Category *</label>
                  <select required value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                    <option value="">Select category</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <div className="flex gap-2 mt-1">
                    <input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="Add new category..." className="flex-1 px-2 py-1 border border-slate-200 rounded text-xs outline-none" />
                    <button type="button" onClick={handleAddCategory} disabled={addingCat || !newCategory.trim()} className="px-2 py-1 bg-blue-50 text-blue-600 rounded text-xs hover:bg-blue-100 disabled:opacity-50">Add</button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Brand</label>
                  <select value={form.brandId} onChange={(e) => setForm({ ...form, brandId: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                    <option value="">Select brand</option>
                    {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                {[
                  { label: 'Purchase Price (₹) *', key: 'purchasePrice', type: 'number', required: true },
                  { label: 'Selling Price (₹) *', key: 'sellingPrice', type: 'number', required: true },
                  { label: 'GST %', key: 'gstPercent', type: 'number' },
                  { label: 'Stock Quantity *', key: 'stockQuantity', type: 'number', required: true },
                  { label: 'Low Stock Alert', key: 'lowStockThreshold', type: 'number' },
                ].map((f) => (
                  <div key={f.key}>
                    <label className="block text-sm font-medium text-slate-700 mb-1">{f.label}</label>
                    <input required={f.required} type={f.type} min="0" value={(form as any)[f.key] ?? ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                  </div>
                ))}
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                  <input value={form.description ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg">Cancel</button>
                <button type="submit" disabled={saving} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-60 flex items-center gap-2">
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {saving ? 'Saving...' : 'Add Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
