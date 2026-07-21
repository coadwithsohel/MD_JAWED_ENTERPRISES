'use client';

import { CreditCard, TrendingUp, TrendingDown, AlertCircle, Clock, User } from 'lucide-react';
import {
  toPaise,
  fromPaise,
  getCreditStatus,
  CREDIT_STATUS_LABELS,
  CREDIT_STATUS_COLORS,
  type CreditStatus,
} from '@/lib/money';

interface Props {
  creditLimitRaw: string | number;      // raw value from API (Decimal as string)
  currentBalanceRaw: string | number;   // positive = Dr (owes us), negative = Cr (advance)
  creditLimitUpdatedAt?: string | null;
  creditLimitUpdatedBy?: string | null;
  updatedByName?: string | null;        // resolved full name (optional)
}

function UsageBar({ pct, status }: { pct: number; status: CreditStatus }) {
  const clampedPct = Math.min(100, Math.max(0, pct));

  const barColor: Record<CreditStatus, string> = {
    no_limit: 'bg-slate-300',
    available: 'bg-emerald-500',
    near_limit: 'bg-amber-500',
    limit_reached: 'bg-orange-600',
    limit_exceeded: 'bg-rose-600',
  };

  return (
    <div
      className="h-2 w-full bg-slate-100 rounded-full overflow-hidden"
      role="progressbar"
      aria-valuenow={clampedPct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Credit usage: ${clampedPct.toFixed(0)}%`}
    >
      <div
        className={`h-full rounded-full transition-all duration-500 ${barColor[status]}`}
        style={{ width: `${clampedPct}%` }}
      />
    </div>
  );
}

export default function CreditAccountSection({
  creditLimitRaw,
  currentBalanceRaw,
  creditLimitUpdatedAt,
  creditLimitUpdatedBy,
  updatedByName,
}: Props) {
  const limitPaise = toPaise(creditLimitRaw);
  const balancePaise = toPaise(currentBalanceRaw);  // positive = customer owes us
  const outstandingPaise = Math.max(0, balancePaise);

  const status = getCreditStatus(limitPaise, outstandingPaise);
  const hasLimit = limitPaise > 0;

  const availablePaise = hasLimit ? limitPaise - outstandingPaise : 0;
  const isExceeded = hasLimit && outstandingPaise > limitPaise;
  const usagePct = hasLimit ? (outstandingPaise / limitPaise) * 100 : 0;

  const exceededByPaise = isExceeded ? outstandingPaise - limitPaise : 0;

  function fmtDate(iso: string) {
    try {
      return new Date(iso).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Kolkata',
      });
    } catch { return iso; }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      {/* Section header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-slate-50">
        <div className="flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-slate-500" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-slate-700">Credit Account</h2>
        </div>
        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold border ${CREDIT_STATUS_COLORS[status]}`}>
          {CREDIT_STATUS_LABELS[status]}
        </span>
      </div>

      <div className="p-5">
        {/* Metrics grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 mb-5">
          {/* Credit Limit */}
          <div className="bg-slate-50 border border-slate-100 rounded-xl p-3">
            <p className="text-xs text-slate-400 mb-1 flex items-center gap-1">
              <CreditCard className="h-3 w-3" aria-hidden="true" />
              Credit Limit
            </p>
            <p className="text-base font-bold tabular-nums text-slate-800">
              {hasLimit ? fromPaise(limitPaise) : '—'}
            </p>
            {!hasLimit && (
              <p className="text-xs text-slate-400 mt-0.5">No limit set</p>
            )}
          </div>

          {/* Outstanding */}
          <div className={`border rounded-xl p-3 ${outstandingPaise > 0 ? 'bg-rose-50 border-rose-100' : 'bg-slate-50 border-slate-100'}`}>
            <p className="text-xs text-slate-400 mb-1 flex items-center gap-1">
              <TrendingUp className="h-3 w-3" aria-hidden="true" />
              Outstanding
            </p>
            <p className={`text-base font-bold tabular-nums ${outstandingPaise > 0 ? 'text-rose-700' : 'text-slate-500'}`}>
              {outstandingPaise > 0 ? fromPaise(outstandingPaise) : '₹0.00'}
            </p>
            {outstandingPaise > 0 && <p className="text-xs text-rose-500 mt-0.5">Dr — Customer owes</p>}
          </div>

          {/* Available Credit / Exceeded */}
          {hasLimit && (
            <div className={`border rounded-xl p-3 ${isExceeded ? 'bg-rose-50 border-rose-100' : 'bg-emerald-50 border-emerald-100'}`}>
              <p className="text-xs text-slate-400 mb-1 flex items-center gap-1">
                <TrendingDown className="h-3 w-3" aria-hidden="true" />
                {isExceeded ? 'Exceeded By' : 'Available Credit'}
              </p>
              <p className={`text-base font-bold tabular-nums ${isExceeded ? 'text-rose-700' : 'text-emerald-700'}`}>
                {isExceeded ? fromPaise(exceededByPaise) : fromPaise(Math.abs(availablePaise))}
              </p>
              {isExceeded && <p className="text-xs text-rose-500 mt-0.5">Limit exceeded</p>}
              {!isExceeded && availablePaise > 0 && <p className="text-xs text-emerald-600 mt-0.5">Can still use</p>}
            </div>
          )}

          {/* Credit Used % */}
          {hasLimit && (
            <div className="bg-slate-50 border border-slate-100 rounded-xl p-3">
              <p className="text-xs text-slate-400 mb-1 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" aria-hidden="true" />
                Credit Used
              </p>
              <p className={`text-base font-bold tabular-nums ${
                isExceeded ? 'text-rose-700' : usagePct >= 80 ? 'text-amber-700' : 'text-slate-700'
              }`}>
                {isExceeded ? `${usagePct.toFixed(0)}%` : `${Math.min(usagePct, 100).toFixed(0)}%`}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">{CREDIT_STATUS_LABELS[status]}</p>
            </div>
          )}
        </div>

        {/* Usage progress bar */}
        {hasLimit && (
          <div className="space-y-1 mb-4">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>₹0</span>
              <span className="font-medium">{fromPaise(limitPaise)} limit</span>
            </div>
            <UsageBar pct={usagePct} status={status} />
            <div className="flex justify-between text-xs">
              <span className={isExceeded ? 'text-rose-600 font-semibold' : 'text-slate-500'}>
                {outstandingPaise > 0 ? `${fromPaise(outstandingPaise)} used` : 'No outstanding'}
              </span>
              {isExceeded && (
                <span className="text-rose-600 font-semibold text-xs">
                  Exceeded by {fromPaise(exceededByPaise)}
                </span>
              )}
              {!isExceeded && availablePaise >= 0 && outstandingPaise > 0 && (
                <span className="text-emerald-600 font-medium text-xs">
                  {fromPaise(availablePaise)} free
                </span>
              )}
            </div>
          </div>
        )}

        {/* Advance balance (negative currentBalance) */}
        {balancePaise < 0 && (
          <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-100 rounded-xl p-3 text-xs text-emerald-700">
            <TrendingDown className="h-4 w-4 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-semibold">Advance Balance: {fromPaise(Math.abs(balancePaise))}</p>
              <p className="text-emerald-600">Customer has credit/advance that can be applied to future invoices.</p>
            </div>
          </div>
        )}

        {/* Last updated */}
        {creditLimitUpdatedAt && (
          <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" aria-hidden="true" />
              Last updated: {fmtDate(creditLimitUpdatedAt)}
            </span>
            {(updatedByName ?? creditLimitUpdatedBy) && (
              <span className="flex items-center gap-1">
                <User className="h-3 w-3" aria-hidden="true" />
                By: {updatedByName ?? creditLimitUpdatedBy}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
