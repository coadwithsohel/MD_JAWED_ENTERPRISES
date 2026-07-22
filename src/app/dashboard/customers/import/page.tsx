'use client';

import { useState, useCallback, useRef } from 'react';
import { Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, Loader2, ArrowRight, Download } from 'lucide-react';
import Link from 'next/link';

type Step = 'upload' | 'preview' | 'importing' | 'done';

interface PreviewRow {
  rowNumber: number;
  fullName: string;
  mobile: string;
  alternateMobile?: string;
  email?: string;
  city?: string;
  state?: string;
  address?: string;
  creditLimit?: string;
  openingBalance?: string;
  status: 'valid' | 'error';
  error?: string;
}

interface ImportResult {
  created: number;
  skipped: number;
  failed: number;
  errors: { row: number; error: string }[];
}

function parseCSVRow(row: string): string[] {
  const cells: string[] = [];
  let inQuotes = false;
  let current = '';
  for (const ch of row) {
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === ',' && !inQuotes) { cells.push(current.trim()); current = ''; }
    else { current += ch; }
  }
  cells.push(current.trim());
  return cells;
}

function parseExcelFile(text: string): PreviewRow[] {
  const lines = text.split('\n').filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCSVRow(lines[0]).map((h) => h.toLowerCase().replace(/[\s_\-]/g, ''));
  const fieldMap: Record<string, string> = {
    name: 'fullName', fullname: 'fullName', customername: 'fullName',
    mobile: 'mobile', phone: 'mobile', contact: 'mobile', mobileno: 'mobile',
    alternatemobile: 'alternateMobile', altmobile: 'alternateMobile',
    email: 'email', emailaddress: 'email',
    city: 'city', town: 'city',
    state: 'state',
    address: 'address', fulladdress: 'address',
    creditlimit: 'creditLimit', limit: 'creditLimit',
    openingbalance: 'openingBalance', balance: 'openingBalance', dues: 'openingBalance',
  };

  const colMap = headers.map((h) => fieldMap[h] ?? null);

  return lines.slice(1).map((line, idx) => {
    const cells = parseCSVRow(line);
    const obj: Record<string, string> = {};
    colMap.forEach((field, i) => { if (field && cells[i]) obj[field] = cells[i]; });

    const errors: string[] = [];
    if (!obj.fullName?.trim()) errors.push('Name is required');
    if (!obj.mobile?.trim()) errors.push('Mobile is required');
    else if (!/^[6-9]\d{9}$/.test(obj.mobile.replace(/[\s\+\-]/g, '').replace(/^91/, ''))) errors.push('Invalid mobile number');

    return {
      rowNumber: idx + 2,
      fullName: obj.fullName?.trim() ?? '',
      mobile: obj.mobile?.replace(/[\s\+\-]/g, '').replace(/^91/, '') ?? '',
      alternateMobile: obj.alternateMobile?.trim(),
      email: obj.email?.trim(),
      city: obj.city?.trim(),
      state: obj.state?.trim(),
      address: obj.address?.trim(),
      creditLimit: obj.creditLimit?.replace(/[^0-9.]/g, ''),
      openingBalance: obj.openingBalance?.replace(/[^0-9.-]/g, ''),
      status: errors.length ? 'error' : 'valid',
      error: errors.join('; '),
    };
  });
}

export default function ImportPage() {
  const [step, setStep] = useState<Step>('upload');
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((file: File) => {
    if (!file) return;
    setFileName(file.name);
    setError('');
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = parseExcelFile(text);
      if (parsed.length === 0) { setError('No valid rows found. Make sure the file has headers and data.'); return; }
      setRows(parsed);
      setStep('preview');
    };
    reader.onerror = () => setError('Failed to read file');
    reader.readAsText(file, 'utf-8');
  }, []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleImport = async () => {
    const validRows = rows.filter((r) => r.status === 'valid');
    if (!validRows.length) { setError('No valid rows to import'); return; }
    setStep('importing');

    let created = 0, skipped = 0, failed = 0;
    const errors: { row: number; error: string }[] = [];

    for (const row of validRows) {
      try {
        const res = await fetch('/api/customers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fullName: row.fullName,
            mobile: row.mobile,
            alternateMobile: row.alternateMobile || null,
            email: row.email || null,
            city: row.city || null,
            state: row.state || null,
            address: row.address || null,
            creditLimit: Number(row.creditLimit ?? 0),
            openingBalance: Number(row.openingBalance ?? 0),
          }),
        });
        const data = await res.json();
        if (res.status === 409) { skipped++; }
        else if (res.ok) { created++; }
        else { failed++; errors.push({ row: row.rowNumber, error: data.error || 'Unknown error' }); }
      } catch { failed++; errors.push({ row: row.rowNumber, error: 'Network error' }); }
    }

    setResult({ created, skipped, failed, errors });
    setStep('done');
  };

  const handleDownloadTemplate = () => {
    const csv = 'Name,Mobile,Alternate Mobile,Email,City,State,Address,Credit Limit,Opening Balance\nAhmad Khan,9876543210,,ahmad@example.com,Mumbai,Maharashtra,,5000,1200';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'customers-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const validCount = rows.filter((r) => r.status === 'valid').length;
  const errorCount = rows.filter((r) => r.status === 'error').length;

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Import Customers</h1>
          <p className="text-sm text-slate-500">Upload a CSV file to bulk-import customer data</p>
        </div>
        <Link href="/dashboard/customers" className="text-sm text-blue-600 hover:underline">← Back to Customers</Link>
      </div>

      {/* Steps */}
      <div className="flex items-center gap-2">
        {[
          { id: 'upload', label: '1. Upload' },
          { id: 'preview', label: '2. Preview' },
          { id: 'importing', label: '3. Import' },
          { id: 'done', label: '4. Done' },
        ].map((s, i, arr) => (
          <div key={s.id} className="flex items-center">
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${step === s.id ? 'bg-blue-600 text-white' : ['preview', 'importing', 'done'].slice(arr.indexOf(arr.find((a) => a.id === step) ?? arr[0])).includes(s.id) || step === 'done' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-400'}`}>
              {s.label}
            </div>
            {i < arr.length - 1 && <ArrowRight className="h-3 w-3 text-slate-300 mx-1" />}
          </div>
        ))}
      </div>

      {step === 'upload' && (
        <div className="space-y-4">
          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed border-slate-200 rounded-2xl p-16 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition-colors"
          >
            <FileSpreadsheet className="h-14 w-14 text-slate-300 mx-auto mb-4" />
            <p className="text-lg font-semibold text-slate-700">Drop your CSV file here</p>
            <p className="text-sm text-slate-400 mt-1">or click to browse</p>
            <p className="text-xs text-slate-400 mt-3">Supports .csv format · UTF-8 encoded</p>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }} />
          </div>
          {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>}
          <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl p-4">
            <div>
              <p className="text-sm font-medium text-slate-700">Need a template?</p>
              <p className="text-xs text-slate-500">Download our CSV template with the correct column format</p>
            </div>
            <button onClick={handleDownloadTemplate} className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg text-sm font-medium transition-colors">
              <Download className="h-4 w-4" /> Template
            </button>
          </div>
        </div>
      )}

      {step === 'preview' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 bg-green-50 border border-green-200 px-3 py-1.5 rounded-lg">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span className="text-sm font-medium text-green-700">{validCount} valid</span>
              </div>
              {errorCount > 0 && (
                <div className="flex items-center gap-2 bg-red-50 border border-red-200 px-3 py-1.5 rounded-lg">
                  <AlertTriangle className="h-4 w-4 text-red-600" />
                  <span className="text-sm font-medium text-red-700">{errorCount} errors</span>
                </div>
              )}
              <span className="text-sm text-slate-500">{fileName}</span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => { setStep('upload'); setRows([]); }} className="px-3 py-1.5 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg">Back</button>
              <button onClick={handleImport} disabled={validCount === 0} className="px-4 py-1.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 flex items-center gap-2">
                <Upload className="h-4 w-4" /> Import {validCount} Customers
              </button>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 sticky top-0">
                  <tr>
                    {['Row', 'Name', 'Mobile', 'City', 'Credit Limit', 'Opening Balance', 'Status'].map((h) => (
                      <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row) => (
                    <tr key={row.rowNumber} className={row.status === 'error' ? 'bg-red-50' : ''}>
                      <td className="px-4 py-2.5 text-xs text-slate-400">{row.rowNumber}</td>
                      <td className="px-4 py-2.5 font-medium text-slate-900">{row.fullName || <span className="text-red-400 italic">missing</span>}</td>
                      <td className="px-4 py-2.5 font-mono text-slate-600">{row.mobile || <span className="text-red-400 italic">missing</span>}</td>
                      <td className="px-4 py-2.5 text-slate-500">{row.city || '—'}</td>
                      <td className="px-4 py-2.5 text-slate-500">₹{row.creditLimit || '0'}</td>
                      <td className="px-4 py-2.5 text-slate-500">₹{row.openingBalance || '0'}</td>
                      <td className="px-4 py-2.5">
                        {row.status === 'valid' ? (
                          <span className="flex items-center gap-1 text-xs text-green-700"><CheckCircle2 className="h-3 w-3" /> Valid</span>
                        ) : (
                          <span className="flex items-center gap-1 text-xs text-red-600"><AlertTriangle className="h-3 w-3" /> {row.error}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {step === 'importing' && (
        <div className="flex flex-col items-center justify-center py-24 bg-white rounded-2xl border border-slate-200">
          <Loader2 className="h-12 w-12 text-blue-500 animate-spin mb-4" />
          <h2 className="text-xl font-bold text-slate-900">Importing...</h2>
          <p className="text-slate-500 mt-2 text-sm">Creating {validCount} customers — please wait</p>
        </div>
      )}

      {step === 'done' && result && (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-6">
          <div className="h-16 w-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 className="h-8 w-8 text-green-600" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Import Complete!</h2>
            <p className="text-slate-500 mt-1">{fileName}</p>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-green-50 border border-green-100 rounded-xl p-4">
              <p className="text-3xl font-black text-green-600">{result.created}</p>
              <p className="text-sm text-green-700 mt-1">Created</p>
            </div>
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
              <p className="text-3xl font-black text-amber-600">{result.skipped}</p>
              <p className="text-sm text-amber-700 mt-1">Skipped (duplicate)</p>
            </div>
            <div className="bg-red-50 border border-red-100 rounded-xl p-4">
              <p className="text-3xl font-black text-red-600">{result.failed}</p>
              <p className="text-sm text-red-700 mt-1">Failed</p>
            </div>
          </div>
          {result.errors.length > 0 && (
            <div className="text-left bg-red-50 border border-red-100 rounded-xl p-4 max-h-40 overflow-y-auto">
              <p className="text-sm font-semibold text-red-700 mb-2">Errors:</p>
              {result.errors.map((e) => <p key={e.row} className="text-xs text-red-600">Row {e.row}: {e.error}</p>)}
            </div>
          )}
          <div className="flex justify-center gap-4">
            <button onClick={() => { setStep('upload'); setRows([]); setResult(null); setFileName(''); }} className="px-4 py-2 text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl">Import More</button>
            <Link href="/dashboard/customers" className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl">View Customers</Link>
          </div>
        </div>
      )}
    </div>
  );
}
