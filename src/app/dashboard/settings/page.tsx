'use client';

import { useState, useEffect } from 'react';
import { Loader2, Save, CheckCircle2 } from 'lucide-react';

interface Settings {
  businessName: string; tagline: string; ownerName: string; supportPhone: string;
  whatsappNumber: string; supportEmail: string; primaryAddress: string; city: string;
  state: string; pinCode: string; gstNumber: string; invoicePrefix: string;
  defaultCreditDays: number; termsAndConditions: string; currency: string;
}

const defaultSettings: Settings = {
  businessName: 'MD Javed Enterprises', tagline: 'Mobiles • Electronics • Appliances',
  ownerName: '', supportPhone: '', whatsappNumber: '', supportEmail: '',
  primaryAddress: '', city: '', state: '', pinCode: '', gstNumber: '',
  invoicePrefix: 'INV', defaultCreditDays: 15, termsAndConditions: '', currency: 'INR',
};

export default function SettingsPage() {
  const [form, setForm] = useState<Settings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/settings').then((r) => r.json()).then((d) => {
      if (d.settings) {
        const s = d.settings;
        // Coerce null → '' for every string field so controlled inputs never get null
        setForm({
          businessName: s.businessName ?? defaultSettings.businessName,
          tagline: s.tagline ?? '',
          ownerName: s.ownerName ?? '',
          supportPhone: s.supportPhone ?? '',
          whatsappNumber: s.whatsappNumber ?? '',
          supportEmail: s.supportEmail ?? '',
          primaryAddress: s.primaryAddress ?? '',
          city: s.city ?? '',
          state: s.state ?? '',
          pinCode: s.pinCode ?? '',
          gstNumber: s.gstNumber ?? '',
          invoicePrefix: s.invoicePrefix ?? 'INV',
          defaultCreditDays: s.defaultCreditDays ?? 15,
          termsAndConditions: s.termsAndConditions ?? '',
          currency: s.currency ?? 'INR',
        });
      }
    }).finally(() => setLoading(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const res = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to save'); return; }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch { setError('Network error'); }
    finally { setSaving(false); }
  };

  const f = <K extends keyof Settings>(key: K) => ({
    value: (form[key] ?? '') as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [key]: e.target.value }),
  });

  const Input = ({ label, k, type = 'text', placeholder = '' }: { label: string; k: keyof Settings; type?: string; placeholder?: string }) => (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      <input type={type} {...f(k)} placeholder={placeholder} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
    </div>
  );

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-blue-500" /></div>;

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Settings</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Business Info */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-4">
          <h2 className="text-base font-semibold text-slate-900 pb-2 border-b border-slate-100">Business Information</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2"><Input label="Business Name" k="businessName" placeholder="MD Javed Enterprises" /></div>
            <div className="sm:col-span-2"><Input label="Tagline" k="tagline" placeholder="Mobiles • Electronics • Appliances" /></div>
            <Input label="Owner Name" k="ownerName" placeholder="Md Javed" />
            <Input label="GST Number" k="gstNumber" placeholder="27ABCDE1234F1Z5" />
          </div>
        </div>

        {/* Contact */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-4">
          <h2 className="text-base font-semibold text-slate-900 pb-2 border-b border-slate-100">Contact Information</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="Support Phone" k="supportPhone" type="tel" placeholder="9999999999" />
            <Input label="WhatsApp Number" k="whatsappNumber" type="tel" placeholder="9999999999" />
            <div className="sm:col-span-2"><Input label="Support Email" k="supportEmail" type="email" placeholder="support@example.com" /></div>
          </div>
        </div>

        {/* Address */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-4">
          <h2 className="text-base font-semibold text-slate-900 pb-2 border-b border-slate-100">Address</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2"><Input label="Street Address" k="primaryAddress" placeholder="Shop No. 5, Main Road" /></div>
            <Input label="City" k="city" placeholder="Nagpur" />
            <Input label="State" k="state" placeholder="Maharashtra" />
            <Input label="PIN Code" k="pinCode" placeholder="440001" />
          </div>
        </div>

        {/* Invoice Settings */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-4">
          <h2 className="text-base font-semibold text-slate-900 pb-2 border-b border-slate-100">Invoice Settings</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="Invoice Prefix" k="invoicePrefix" placeholder="INV" />
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Default Credit Days</label>
              <input type="number" min="1" max="365" value={form.defaultCreditDays} onChange={(e) => setForm({ ...form, defaultCreditDays: Number(e.target.value) })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Terms & Conditions</label>
              <textarea value={form.termsAndConditions} onChange={(e) => setForm({ ...form, termsAndConditions: e.target.value })} rows={3} placeholder="All goods once sold will not be taken back..." className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none" />
            </div>
          </div>
        </div>

        {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>}

        <div className="flex justify-end">
          <button type="submit" disabled={saving} className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors disabled:opacity-60">
            {saved ? <><CheckCircle2 className="h-4 w-4 text-green-300" /> Saved!</> : saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving...</> : <><Save className="h-4 w-4" /> Save Settings</>}
          </button>
        </div>
      </form>
    </div>
  );
}
