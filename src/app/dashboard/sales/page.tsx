'use client';

import { useState, useEffect, useRef } from 'react';
import { Search, ShoppingCart, User, Minus, Plus, Trash2, Loader2, X, CheckCircle2, Printer } from 'lucide-react';
import Link from 'next/link';

interface Product {
  id: string; name: string; sku: string; brand?: { name: string } | null;
  sellingPrice: string; stockQuantity: number; gstPercent: string;
  category: { name: string };
}
interface Customer {
  id: string; fullName: string; mobile: string; customerCode: string;
  currentBalance: string; creditLimit: string;
}
interface CartItem { product: Product; quantity: number; }

export default function POSPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState('');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerResults, setCustomerResults] = useState<Customer[]>([]);
  const [searchingCustomer, setSearchingCustomer] = useState(false);
  const [saleType, setSaleType] = useState<'CASH' | 'CREDIT' | 'PARTIAL'>('CASH');
  const [partialAmount, setPartialAmount] = useState('');
  const [success, setSuccess] = useState<{ invoiceId: string; invoiceNumber: string } | null>(null);
  const [error, setError] = useState('');
  const [processingCheckout, setProcessingCheckout] = useState(false);
  const customerRef = useRef<HTMLDivElement>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const fetchProducts = async () => {
    try {
      const res = await fetch('/api/products?active=true&limit=200');
      const data = await res.json();
      setProducts(data.products ?? []);
    } catch {}
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchProducts(); }, []);
  useEffect(() => {
    const q = search.toLowerCase();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFilteredProducts(q ? products.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (p.brand?.name?.toLowerCase() ?? '').includes(q)) : products);
  }, [search, products]);

  const handleCustomerSearch = (val: string) => {
    setCustomerSearch(val);
    clearTimeout(searchTimeout.current);
    if (!val.trim()) { setCustomerResults([]); return; }
    searchTimeout.current = setTimeout(async () => {
      setSearchingCustomer(true);
      try {
        const res = await fetch(`/api/customers?search=${encodeURIComponent(val)}&limit=6`);
        const data = await res.json();
        setCustomerResults(data.customers ?? []);
      } catch {}
      finally { setSearchingCustomer(false); }
    }, 300);
  };

  const addToCart = (product: Product) => {
    if (product.stockQuantity <= 0) return;
    setCart((prev) => {
      const existing = prev.find((i) => i.product.id === product.id);
      if (existing) {
        if (existing.quantity >= product.stockQuantity) return prev;
        return prev.map((i) => i.product.id === product.id ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [...prev, { product, quantity: 1 }];
    });
  };

  const updateQty = (productId: string, delta: number) => {
    setCart((prev) =>
      prev.map((i) => i.product.id === productId
        ? { ...i, quantity: Math.min(i.product.stockQuantity, Math.max(1, i.quantity + delta)) }
        : i)
    );
  };

  const removeFromCart = (productId: string) => setCart((prev) => prev.filter((i) => i.product.id !== productId));

  const subtotal = cart.reduce((sum, i) => sum + parseFloat(i.product.sellingPrice) * i.quantity, 0);
  const totalGst = cart.reduce((sum, i) => sum + parseFloat(i.product.sellingPrice) * i.quantity * parseFloat(i.product.gstPercent) / 100, 0);
  const grandTotal = subtotal + totalGst;

  const handleCheckout = async () => {
    if (cart.length === 0) return;
    if ((saleType === 'CREDIT' || saleType === 'PARTIAL') && !customer) {
      setError('Please select a customer for credit/partial sales'); return;
    }
    if (processingCheckout) return;
    setProcessingCheckout(true);
    setError('');
    try {
      const res = await fetch('/api/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: customer?.id ?? null,
          saleType,
          paidAmount: saleType === 'PARTIAL' ? Number(partialAmount) : undefined,
          items: cart.map((i) => ({ productId: i.product.id, quantity: i.quantity })),
          discountAmount: 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Checkout failed'); return; }
      setSuccess({ invoiceId: data.sale.id, invoiceNumber: data.sale.invoiceNumber });
      setCart([]);
      setCustomer(null);
      setPartialAmount('');
      await fetchProducts();
    } catch { setError('Network error. Please try again.'); }
    finally { setProcessingCheckout(false); }
  };

  const fmt = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(n);

  if (success) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8 max-w-md w-full text-center">
          <div className="h-16 w-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="h-8 w-8 text-green-600" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-1">Sale Complete!</h2>
          <p className="text-slate-500 mb-1">Invoice: <span className="font-mono font-semibold text-slate-900">{success.invoiceNumber}</span></p>
          <div className="flex flex-col gap-3 mt-6">
            <Link href={`/dashboard/invoices/${success.invoiceId}?print=1`} className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl transition-colors">
              <Printer className="h-4 w-4" /> Print Invoice
            </Link>
            <Link href={`/dashboard/invoices/${success.invoiceId}`} className="flex items-center justify-center gap-2 border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold py-3 rounded-xl transition-colors">
              View Invoice
            </Link>
            <button onClick={() => setSuccess(null)} className="text-blue-600 hover:underline text-sm font-medium">New Sale</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-5rem)] flex gap-5 overflow-hidden">
      {/* Products */}
      <div className="flex-1 flex flex-col bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-200">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products..." className="block w-full pl-10 pr-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-600 outline-none bg-slate-50" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
            {filteredProducts.map((p) => (
              <button key={p.id} onClick={() => addToCart(p)} disabled={p.stockQuantity <= 0} className="border border-slate-200 rounded-xl p-4 hover:border-blue-400 hover:shadow-md transition-all active:scale-95 text-center disabled:opacity-50 disabled:cursor-not-allowed group">
                <div className="h-10 w-10 bg-blue-50 rounded-xl flex items-center justify-center mx-auto mb-2 group-hover:bg-blue-100 transition-colors">
                  <ShoppingCart className="h-5 w-5 text-blue-500" />
                </div>
                <p className="text-xs font-semibold text-slate-900 line-clamp-2 leading-snug">{p.name}</p>
                {p.brand && <p className="text-xs text-slate-400 mt-0.5">{p.brand.name}</p>}
                <p className="mt-2 text-sm font-bold text-blue-600">₹{parseFloat(p.sellingPrice).toLocaleString('en-IN')}</p>
                <p className={`text-xs mt-0.5 ${p.stockQuantity <= 5 ? 'text-red-500 font-medium' : 'text-slate-400'}`}>{p.stockQuantity} left</p>
              </button>
            ))}
            {filteredProducts.length === 0 && (
              <div className="col-span-full py-16 text-center text-slate-400">
                <ShoppingCart className="h-10 w-10 mx-auto mb-2 opacity-20" />
                <p className="text-sm">No products found</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Cart */}
      <div className="w-96 flex flex-col bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex-shrink-0">
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2"><ShoppingCart className="h-4 w-4 text-blue-600" /> Current Sale</h2>
          {cart.length > 0 && <span className="bg-blue-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">{cart.length}</span>}
        </div>

        {/* Customer */}
        <div className="p-4 border-b border-slate-200" ref={customerRef}>
          {customer ? (
            <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-blue-500" />
                <div>
                  <p className="text-sm font-semibold text-blue-900">{customer.fullName}</p>
                  <p className="text-xs text-blue-600">{customer.customerCode} · {customer.mobile}</p>
                  {parseFloat(customer.currentBalance) > 0 && <p className="text-xs text-orange-600 font-medium">Due: ₹{parseFloat(customer.currentBalance).toLocaleString('en-IN')}</p>}
                </div>
              </div>
              <button onClick={() => setCustomer(null)} className="text-blue-400 hover:text-blue-600"><X className="h-4 w-4" /></button>
            </div>
          ) : (
            <div className="relative">
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input type="text" value={customerSearch} onChange={(e) => handleCustomerSearch(e.target.value)} placeholder="Search customer (optional for cash)..." className="block w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-600 outline-none bg-slate-50" />
                {searchingCustomer && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-blue-500" />}
              </div>
              {customerResults.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white rounded-lg shadow-lg border border-slate-200 overflow-hidden">
                  {customerResults.map((c) => (
                    <button key={c.id} onClick={() => { setCustomer(c); setCustomerSearch(''); setCustomerResults([]); }} className="w-full px-3 py-2.5 text-left hover:bg-blue-50 border-b border-slate-100 last:border-0">
                      <div className="text-sm font-medium text-slate-900">{c.fullName} <span className="text-slate-400 font-mono text-xs ml-1">{c.customerCode}</span></div>
                      <div className="text-xs text-slate-500">{c.mobile}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Cart Items */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-300">
              <ShoppingCart className="h-12 w-12 mb-2" /><p className="text-sm">Cart is empty</p>
            </div>
          ) : cart.map((item) => (
            <div key={item.product.id} className="bg-slate-50 rounded-xl p-3">
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1 pr-2">
                  <h4 className="text-sm font-semibold text-slate-900 leading-snug">{item.product.name}</h4>
                  <p className="text-xs text-slate-400">{item.product.sku}</p>
                </div>
                <button onClick={() => removeFromCart(item.product.id)} className="text-red-400 hover:text-red-600 p-1"><Trash2 className="h-4 w-4" /></button>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button onClick={() => updateQty(item.product.id, -1)} className="h-7 w-7 rounded-lg bg-white border border-slate-200 flex items-center justify-center hover:bg-slate-100"><Minus className="h-3 w-3" /></button>
                  <span className="text-sm font-bold w-6 text-center">{item.quantity}</span>
                  <button onClick={() => updateQty(item.product.id, 1)} disabled={item.quantity >= item.product.stockQuantity} className="h-7 w-7 rounded-lg bg-white border border-slate-200 flex items-center justify-center hover:bg-slate-100 disabled:opacity-50"><Plus className="h-3 w-3" /></button>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-400">₹{parseFloat(item.product.sellingPrice).toLocaleString('en-IN')} × {item.quantity}</p>
                  <p className="text-sm font-bold text-slate-900">{fmt(parseFloat(item.product.sellingPrice) * item.quantity)}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Sale Type + Totals + Checkout */}
        <div className="p-4 border-t border-slate-200 bg-slate-50 space-y-3">
          {/* Sale Type */}
          <div className="flex gap-1 bg-white border border-slate-200 rounded-lg p-1">
            {(['CASH', 'CREDIT', 'PARTIAL'] as const).map((t) => (
              <button key={t} onClick={() => setSaleType(t)} className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors ${saleType === t ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{t}</button>
            ))}
          </div>

          {saleType === 'PARTIAL' && (
            <div>
              <label className="text-xs text-slate-600 font-medium mb-1 block">Amount Paid Now (₹)</label>
              <input type="number" min="0" max={grandTotal} value={partialAmount} onChange={(e) => setPartialAmount(e.target.value)} placeholder={`Max: ₹${grandTotal.toFixed(2)}`} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
          )}

          <div className="space-y-1">
            <div className="flex justify-between text-sm text-slate-500"><span>Subtotal</span><span>{fmt(subtotal)}</span></div>
            <div className="flex justify-between text-sm text-slate-500"><span>GST</span><span>{fmt(totalGst)}</span></div>
            <div className="flex justify-between pt-2 border-t border-slate-200">
              <span className="text-base font-bold text-slate-900">Grand Total</span>
              <span className="text-xl font-bold text-blue-600">{fmt(grandTotal)}</span>
            </div>
          </div>

          {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

          <button onClick={handleCheckout} disabled={cart.length === 0 || processingCheckout} className="w-full flex items-center justify-center gap-2 px-4 py-3 border border-transparent rounded-xl text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm">
            {processingCheckout ? <><Loader2 className="h-4 w-4 animate-spin" /> Processing...</> : `Checkout — ${fmt(grandTotal)}`}
          </button>
        </div>
      </div>
    </div>
  );
}
