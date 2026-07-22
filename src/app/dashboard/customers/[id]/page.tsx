'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Phone,
  MapPin,
  FileText,
  CreditCard,
  Download,
  Printer,
  Share2,
  RefreshCw,
  Search,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  TrendingUp,
  TrendingDown,
  ReceiptText,
  Wallet,
  AlertCircle,
  CircleDollarSign,
  BadgeIndianRupee,
  X,
  ChevronDown,
  ChevronUp,
  MoreVertical,
  CalendarDays,
  Building2,
  User,
  Activity,
  CheckCircle,
  UserX,
  UserCheck,
  Trash2,
} from 'lucide-react';
import CreditAccountSection from '@/components/customers/CreditAccountSection';
import ChangeCreditLimitDialog from '@/components/customers/ChangeCreditLimitDialog';
import DeactivateDialog from '@/components/customers/DeactivateDialog';
import RestoreDialog from '@/components/customers/RestoreDialog';
import PermanentDeleteDialog from '@/components/customers/PermanentDeleteDialog';
import { toPaise, fromPaise } from '@/lib/money';

// ─── Types ────────────────────────────────────────────────────────────────────

type VoucherType =
  | 'OPENING_BALANCE'
  | 'SALE'
  | 'PAYMENT'
  | 'CREDIT_NOTE'
  | 'DEBIT_NOTE'
  | 'REFUND'
  | 'ADJUSTMENT';

interface LedgerEntry {
  id: string;
  date: string;
  particulars: string;
  voucherType: VoucherType;
  voucherNumber: string;
  debit: string;
  credit: string;
  runningBalance: string;
  balanceLabel: 'Dr' | 'Cr' | 'Settled';
  sourceId: string;
  status: string;
}

interface LedgerSummary {
  openingBalance: string;
  openingBalanceLabel: string;
  totalDebit: string;
  totalCredit: string;
  closingBalance: string;
  closingBalanceLabel: string;
  currentBalance: string;
  currentBalanceLabel: string;
  isOverdue: boolean;
}

interface CustomerInfo {
  id: string;
  customerCode: string;
  fullName: string;
  mobile: string;
  alternateMobile?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  pinCode?: string;
  creditLimit: string;
  currentBalance?: string;
  isActive: boolean;
  creditLimitUpdatedAt?: string | null;
  creditLimitUpdatedBy?: string | null;
  deletedAt?: string | null;
}

interface LedgerResponse {
  customer: CustomerInfo;
  summary: LedgerSummary;
  entries: LedgerEntry[];
  pagination: { page: number; limit: number; total: number; pages: number; hasMore: boolean };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'Asia/Kolkata',
    });
  } catch {
    return iso;
  }
}

function fmtShortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      timeZone: 'Asia/Kolkata',
    });
  } catch {
    return iso;
  }
}

const VOUCHER_LABELS: Record<VoucherType, string> = {
  OPENING_BALANCE: 'Opening Bal.',
  SALE: 'Sale Invoice',
  PAYMENT: 'Payment',
  CREDIT_NOTE: 'Credit Note',
  DEBIT_NOTE: 'Debit Note',
  REFUND: 'Refund',
  ADJUSTMENT: 'Adjustment',
};

const VOUCHER_ICON: Record<VoucherType, React.ElementType> = {
  OPENING_BALANCE: Activity,
  SALE: ReceiptText,
  PAYMENT: Wallet,
  CREDIT_NOTE: TrendingDown,
  DEBIT_NOTE: TrendingUp,
  REFUND: RefreshCw,
  ADJUSTMENT: SlidersHorizontal,
};

const VOUCHER_COLORS: Record<VoucherType, string> = {
  OPENING_BALANCE: 'bg-slate-100 text-slate-600',
  SALE: 'bg-blue-50 text-blue-700',
  PAYMENT: 'bg-emerald-50 text-emerald-700',
  CREDIT_NOTE: 'bg-teal-50 text-teal-700',
  DEBIT_NOTE: 'bg-rose-50 text-rose-700',
  REFUND: 'bg-violet-50 text-violet-700',
  ADJUSTMENT: 'bg-amber-50 text-amber-700',
};

const STATUS_STYLES: Record<string, string> = {
  Paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Partial: 'bg-amber-50 text-amber-700 border-amber-200',
  Unpaid: 'bg-rose-50 text-rose-700 border-rose-200',
  Overdue: 'bg-red-50 text-red-700 border-red-200',
  Completed: 'bg-slate-50 text-slate-600 border-slate-200',
  Posted: 'bg-slate-50 text-slate-600 border-slate-200',
  Reversed: 'bg-violet-50 text-violet-700 border-violet-200',
};

function getFinancialYear() {
  const now = new Date();
  const month = now.getMonth(); // 0-indexed
  const year = now.getFullYear();
  const fyStart = month >= 3 ? year : year - 1;
  return {
    from: `${fyStart}-04-01`,
    to: `${fyStart + 1}-03-31`,
  };
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function weekStartISO() {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString().slice(0, 10);
}

function monthStartISO() {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SummaryCard({
  icon: Icon,
  label,
  amount,
  badge,
  sub,
  colorClass,
  iconBg,
}: {
  icon: React.ElementType;
  label: string;
  amount: string;
  badge?: string;
  sub?: string;
  colorClass: string;
  iconBg: string;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col gap-2 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</span>
        <span className={`h-8 w-8 rounded-lg ${iconBg} flex items-center justify-center shrink-0`}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
      </div>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className={`text-xl font-bold tabular-nums tracking-tight ${colorClass}`}>{amount}</span>
        {badge && (
          <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${colorClass === 'text-rose-700' ? 'bg-rose-50 text-rose-600 border border-rose-200' : colorClass === 'text-emerald-700' ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' : 'bg-slate-100 text-slate-600'}`}>{badge}</span>
        )}
      </div>
      {sub && <p className="text-xs text-slate-400 leading-tight">{sub}</p>}
    </div>
  );
}

function SkeletonRow() {
  return (
    <tr className="animate-pulse">
      <td className="px-4 py-3"><div className="h-4 bg-slate-100 rounded w-20" /></td>
      <td className="px-4 py-3"><div className="h-4 bg-slate-100 rounded w-48" /></td>
      <td className="px-4 py-3"><div className="h-5 bg-slate-100 rounded-full w-24" /></td>
      <td className="px-4 py-3"><div className="h-4 bg-slate-100 rounded w-20" /></td>
      <td className="px-4 py-3 text-right"><div className="h-4 bg-slate-100 rounded w-20 ml-auto" /></td>
      <td className="px-4 py-3 text-right"><div className="h-4 bg-slate-100 rounded w-20 ml-auto" /></td>
      <td className="px-4 py-3 text-right"><div className="h-4 bg-slate-100 rounded w-24 ml-auto" /></td>
      <td className="px-4 py-3"><div className="h-5 bg-slate-100 rounded-full w-16" /></td>
      <td className="px-4 py-3"><div className="h-4 bg-slate-100 rounded w-8" /></td>
    </tr>
  );
}

function LedgerSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header skeleton */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 animate-pulse">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-3 flex-1">
            <div className="h-3 bg-slate-100 rounded w-24" />
            <div className="h-7 bg-slate-100 rounded w-56" />
            <div className="h-4 bg-slate-100 rounded w-36" />
          </div>
          <div className="h-10 w-36 bg-slate-100 rounded-lg" />
        </div>
        <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-14 bg-slate-100 rounded-lg" />)}
        </div>
      </div>
      {/* Table skeleton */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <div className="h-5 bg-slate-100 rounded w-32 animate-pulse" />
        </div>
        <table className="w-full">
          <tbody>
            {[1, 2, 3, 4, 5].map((i) => <SkeletonRow key={i} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EmptyState({ onCreateInvoice, onRecordPayment }: { onCreateInvoice: () => void; onRecordPayment: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="h-16 w-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
        <BadgeIndianRupee className="h-8 w-8 text-slate-400" aria-hidden="true" />
      </div>
      <h3 className="text-base font-semibold text-slate-900 mb-1">No transactions found</h3>
      <p className="text-sm text-slate-500 max-w-sm mb-6">
        This customer has no ledger entries for the selected period. Create an invoice or record a payment to get started.
      </p>
      <div className="flex flex-wrap gap-3 justify-center">
        <button
          onClick={onCreateInvoice}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors"
        >
          <FileText className="h-4 w-4" aria-hidden="true" />
          Create Invoice
        </button>
        <button
          onClick={onRecordPayment}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white border border-slate-200 text-slate-700 text-sm font-semibold hover:bg-slate-50 transition-colors shadow-sm"
        >
          <Wallet className="h-4 w-4" aria-hidden="true" />
          Record Payment
        </button>
      </div>
    </div>
  );
}

function ErrorState({ message, onRetry, onBack }: { message: string; onRetry: () => void; onBack: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="h-14 w-14 rounded-2xl bg-rose-50 flex items-center justify-center mb-4 border border-rose-200">
        <AlertCircle className="h-7 w-7 text-rose-500" aria-hidden="true" />
      </div>
      <h3 className="text-base font-semibold text-slate-900 mb-1">Unable to load ledger</h3>
      <p className="text-sm text-slate-500 max-w-xs mb-6">{message}</p>
      <div className="flex gap-3">
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Retry
        </button>
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white border border-slate-200 text-slate-700 text-sm font-semibold hover:bg-slate-50 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </button>
      </div>
    </div>
  );
}

// ─── Mobile Transaction Card ──────────────────────────────────────────────────

function MobileTransactionCard({ entry, onNavigate }: { entry: LedgerEntry; onNavigate: (e: LedgerEntry) => void }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = VOUCHER_ICON[entry.voucherType];
  const vColor = VOUCHER_COLORS[entry.voucherType];
  const hasDebit = !!entry.debit;
  const hasCredit = !!entry.credit;
  const statusStyle = STATUS_STYLES[entry.status] ?? STATUS_STYLES.Posted;
  const isClickable = ['SALE', 'PAYMENT'].includes(entry.voucherType) && entry.sourceId !== entry.id;

  return (
    <div className="bg-white border-b border-slate-100 last:border-b-0">
      <div className="px-4 py-3">
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${vColor}`}>
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          </div>
          {/* Main */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900 truncate">{entry.particulars}</p>
                <p className="text-xs text-slate-400 mt-0.5">{fmtShortDate(entry.date)}</p>
              </div>
              <div className="text-right shrink-0">
                {hasDebit && (
                  <p className="text-sm font-semibold text-rose-700 tabular-nums">{entry.debit} <span className="text-xs font-bold">Dr</span></p>
                )}
                {hasCredit && (
                  <p className="text-sm font-semibold text-emerald-700 tabular-nums">{entry.credit} <span className="text-xs font-bold">Cr</span></p>
                )}
                <p className={`text-xs font-medium tabular-nums mt-0.5 ${entry.balanceLabel === 'Cr' ? 'text-emerald-600' : entry.balanceLabel === 'Settled' ? 'text-slate-400' : 'text-slate-700'}`}>
                  {entry.runningBalance} <span className="font-bold">{entry.balanceLabel}</span>
                </p>
              </div>
            </div>
            {/* Expand toggle */}
            <button
              onClick={() => setExpanded((v) => !v)}
              className="mt-2 flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 transition-colors min-h-[28px]"
              aria-expanded={expanded}
              aria-label={expanded ? 'Collapse details' : 'Expand details'}
            >
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {expanded ? 'Hide details' : 'Show details'}
            </button>
          </div>
        </div>

        {/* Expanded details */}
        {expanded && (
          <div className="mt-3 ml-11 space-y-2 border-t border-slate-50 pt-3">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <p className="text-slate-400">Voucher Type</p>
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium mt-0.5 ${vColor}`}>
                  <Icon className="h-3 w-3" aria-hidden="true" />
                  {VOUCHER_LABELS[entry.voucherType]}
                </span>
              </div>
              {entry.voucherNumber && (
                <div>
                  <p className="text-slate-400">Voucher No.</p>
                  <p className="font-medium text-slate-800 font-mono mt-0.5">{entry.voucherNumber}</p>
                </div>
              )}
              <div>
                <p className="text-slate-400">Status</p>
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-xs font-medium border mt-0.5 ${statusStyle}`}>
                  {entry.status}
                </span>
              </div>
              <div>
                <p className="text-slate-400">Date</p>
                <p className="font-medium text-slate-800 mt-0.5">{fmtDate(entry.date)}</p>
              </div>
            </div>
            {isClickable && (
              <button
                onClick={() => onNavigate(entry)}
                className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium mt-1 min-h-[36px]"
              >
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
                View {entry.voucherType === 'SALE' ? 'Invoice' : 'Payment'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Inline Action Menu (collision-aware) ─────────────────────────────────────

function InlineActionMenu({
  showActions,
  setShowActions,
  actionsRef,
  handlePrint,
  userInfo,
  setDialog,
  cust,
}: {
  showActions: boolean;
  setShowActions: React.Dispatch<React.SetStateAction<boolean>>;
  actionsRef: React.RefObject<HTMLDivElement | null>;
  handlePrint: () => void;
  userInfo: { role: string } | null;
  setDialog: (d: 'credit' | 'deactivate' | 'restore' | 'permDelete' | null) => void;
  cust: CustomerInfo;
}) {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});

  useEffect(() => {
    if (showActions && dropdownRef.current && actionsRef.current) {
      const triggerRect = actionsRef.current.getBoundingClientRect();
      const dropdownRect = dropdownRef.current.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const style: React.CSSProperties = {};

      // Horizontal: prefer right-aligned, flip if off-screen
      const rightSpace = vw - triggerRect.right;
      const leftSpace = triggerRect.left;
      if (rightSpace >= dropdownRect.width || rightSpace >= leftSpace) {
        const leftPos = Math.max(
          8,
          Math.min(triggerRect.right - dropdownRect.width, vw - dropdownRect.width - 8)
        );
        style.left = `${leftPos}px`;
        style.right = 'auto';
      } else {
        const leftPos = Math.max(
          8,
          Math.min(triggerRect.left, vw - dropdownRect.width - 8)
        );
        style.left = `${leftPos}px`;
        style.right = 'auto';
      }

      // Vertical
      const bottomSpace = vh - triggerRect.bottom;
      const topSpace = triggerRect.top;
      if (bottomSpace >= dropdownRect.height || bottomSpace >= topSpace) {
        style.top = `${triggerRect.bottom + 4}px`;
        style.bottom = 'auto';
      } else {
        style.bottom = `${vh - triggerRect.top + 4}px`;
        style.top = 'auto';
      }

      setDropdownStyle(style);
    }
  }, [showActions, actionsRef]);

  return (
    <div className="relative inline-flex shrink-0" ref={actionsRef}>
      <button
        onClick={() => setShowActions((v) => !v)}
        className="h-9 w-9 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:text-slate-800 hover:border-slate-300 hover:bg-slate-50 transition-all focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
        aria-label="More actions"
        aria-haspopup="true"
        aria-expanded={showActions}
      >
        <MoreVertical className="h-4 w-4" aria-hidden="true" />
      </button>
      {showActions && (
        <div
          ref={dropdownRef}
          className="fixed z-50 w-56 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden py-1"
          style={dropdownStyle}
          role="menu"
          aria-label="More actions menu"
        >
          <button
            onClick={() => { handlePrint(); setShowActions(false); }}
            className="w-full flex items-center gap-2.5 px-4 py-3 sm:py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors text-left focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 focus-visible:outline-none"
            role="menuitem"
          >
            <Printer className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
            Print Ledger
          </button>
          <button
            onClick={() => { handlePrint(); setShowActions(false); }}
            className="w-full flex items-center gap-2.5 px-4 py-3 sm:py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors text-left focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 focus-visible:outline-none"
            role="menuitem"
          >
            <Download className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
            Download PDF
          </button>
          <button
            onClick={() => { setShowActions(false); }}
            className="w-full flex items-center gap-2.5 px-4 py-3 sm:py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors text-left focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 focus-visible:outline-none"
            role="menuitem"
          >
            <Share2 className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
            Share Statement
          </button>
          {(userInfo?.role === 'OWNER' || userInfo?.role === 'MANAGER') && (
            <>
              <div className="my-1 border-t border-slate-100" role="separator" />
              <button
                onClick={() => { setDialog('credit'); setShowActions(false); }}
                className="w-full flex items-center gap-2.5 px-4 py-3 sm:py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors text-left focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500 focus-visible:outline-none"
                role="menuitem"
              >
                <CreditCard className="h-4 w-4 text-emerald-500 shrink-0" aria-hidden="true" />
                Change Credit Limit
              </button>
              {cust.isActive ? (
                <button
                  onClick={() => { setDialog('deactivate'); setShowActions(false); }}
                  className="w-full flex items-center gap-2.5 px-4 py-3 sm:py-2.5 text-sm text-amber-700 hover:bg-amber-50 transition-colors text-left focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-500 focus-visible:outline-none"
                  role="menuitem"
                >
                  <UserX className="h-4 w-4 text-amber-500 shrink-0" aria-hidden="true" />
                  Deactivate Customer
                </button>
              ) : (
                <button
                  onClick={() => { setDialog('restore'); setShowActions(false); }}
                  className="w-full flex items-center gap-2.5 px-4 py-3 sm:py-2.5 text-sm text-emerald-700 hover:bg-emerald-50 transition-colors text-left focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500 focus-visible:outline-none"
                  role="menuitem"
                >
                  <UserCheck className="h-4 w-4 text-emerald-500 shrink-0" aria-hidden="true" />
                  Reactivate Customer
                </button>
              )}
            </>
          )}
          {userInfo?.role === 'OWNER' && !cust.isActive && (
            <>
              <div className="my-1 border-t border-slate-100" role="separator" />
              <button
                onClick={() => { setDialog('permDelete'); setShowActions(false); }}
                className="w-full flex items-center gap-2.5 px-4 py-3 sm:py-2.5 text-sm text-rose-700 hover:bg-rose-50 transition-colors text-left focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-rose-500 focus-visible:outline-none"
                role="menuitem"
              >
                <Trash2 className="h-4 w-4 text-rose-400 shrink-0" aria-hidden="true" />
                Delete Permanently
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CustomerLedgerPage() {
  const { id: customerId } = useParams<{ id: string }>();
  const router = useRouter();

  const [data, setData] = useState<LedgerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);

  // Filters
  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [voucherType, setVoucherType] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Action menu
  const [showActions, setShowActions] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);

  // Dialog state
  const [dialog, setDialog] = useState<'credit' | 'deactivate' | 'restore' | 'permDelete' | null>(null);

  // User info for role-based visibility
  const [userInfo, setUserInfo] = useState<{ role: string } | null>(null);

  // Toasts
  const [toasts, setToasts] = useState<Array<{ id: number; message: string; type: 'success' | 'error' }>>([]);
  const toastIdRef = useRef(0);

  function showToast(message: string, type: 'success' | 'error' = 'success') {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }

  // Fetch user info for role
  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => { if (d.user) setUserInfo({ role: d.user.role }); })
      .catch(() => {});
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) {
        setShowActions(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const fetchLedger = useCallback(async () => {
    if (!customerId) return;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (fromDate) params.set('from', fromDate);
      if (toDate)   params.set('to', toDate);
      if (voucherType) params.set('type', voucherType);
      const res = await fetch(`/api/customers/${customerId}/ledger?${params}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load ledger');
    } finally {
      setLoading(false);
    }
  }, [customerId, page, fromDate, toDate, voucherType]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadLedger() {
      if (!customerId) return;
      try {
        await Promise.resolve();
        setLoading(true);
        setError('');

        const params = new URLSearchParams({ page: String(page), limit: '50' });
        if (fromDate) params.set('from', fromDate);
        if (toDate)   params.set('to', toDate);
        if (voucherType) params.set('type', voucherType);
        const res = await fetch(`/api/customers/${customerId}/ledger?${params}`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error ?? `HTTP ${res.status}`);
        }
        const json = await res.json();

        if (!controller.signal.aborted) {
          setData(json);
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          setError(e instanceof Error ? e.message : 'Failed to load ledger');
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void loadLedger();

    return () => {
      controller.abort();
    };
  }, [customerId, page, fromDate, toDate, voucherType]);

  // Filter client-side by search (particulars / voucher number)
  const displayedEntries = data?.entries.filter((e) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      e.particulars.toLowerCase().includes(q) ||
      e.voucherNumber.toLowerCase().includes(q) ||
      e.voucherType.toLowerCase().includes(q)
    );
  }) ?? [];

  function setQuickDate(preset: 'today' | 'week' | 'month' | 'fy' | 'all') {
    const today = todayISO();
    if (preset === 'today') { setFromDate(today); setToDate(today); }
    else if (preset === 'week') { setFromDate(weekStartISO()); setToDate(today); }
    else if (preset === 'month') { setFromDate(monthStartISO()); setToDate(today); }
    else if (preset === 'fy') { const fy = getFinancialYear(); setFromDate(fy.from); setToDate(fy.to); }
    else { setFromDate(''); setToDate(''); }
    setPage(1);
  }

  function handleNavigate(entry: LedgerEntry) {
    if (entry.voucherType === 'SALE') {
      router.push(`/dashboard/invoices/${entry.sourceId}`);
    }
  }

  function handlePrint() {
    window.print();
  }

  const customer = data?.customer;
  const summary = data?.summary;
  const addressParts = [customer?.address, customer?.city, customer?.state, customer?.pinCode].filter(Boolean);
  const fullAddress = addressParts.join(', ');
  const cust = data?.customer as CustomerInfo;
  const summ = data?.summary as LedgerSummary;
  const pag = data?.pagination as LedgerResponse['pagination'];
  const custAddress = [cust?.address, cust?.city, cust?.state, cust?.pinCode].filter(Boolean).join(', ');

  // ─── Toasts ───────────────────────────────────────────────────────────────
  const toastList = toasts;

  return (
    <>
      {/* Toast notifications */}
      <div className="fixed bottom-4 right-4 z-[100] space-y-2 w-full max-w-sm">
        {toastList.map((t) => (
          <div
            key={t.id}
            className={`flex items-start gap-3 px-4 py-3 rounded-xl shadow-lg text-sm font-medium border transition-all ${
              t.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-rose-50 border-rose-200 text-rose-800'
            }`}
            role="status"
            aria-live="polite"
          >
            {t.type === 'success'
              ? <CheckCircle className="h-4 w-4 shrink-0 mt-0.5 text-emerald-500" />
              : <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-rose-500" />
            }
            <span className="flex-1">{t.message}</span>
            <button
              onClick={() => setToasts((p) => p.filter((x) => x.id !== t.id))}
              className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
              aria-label="Dismiss notification"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>

      {/* ─── Dialogs ──────────────────────────────────────────────────────── */}
      {dialog === 'credit' && cust && (
        <ChangeCreditLimitDialog
          customerId={cust.id}
          customerName={cust.fullName}
          customerCode={cust.customerCode}
          currentCreditLimit={cust.creditLimit ?? '0'}
          currentOutstandingRaw={Math.max(0, toPaise(cust.currentBalance ?? summ?.closingBalance?.replace(/[₹,\s]/g, '') ?? '0'))}
          onSuccess={() => {
            setDialog(null);
            showToast('Credit limit updated successfully.');
            fetchLedger();
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog === 'deactivate' && cust && (
        <DeactivateDialog
          customerId={cust.id}
          customerName={cust.fullName}
          customerCode={cust.customerCode}
          mobile={cust.mobile}
          stats={{
            invoiceCount: 0,
            paymentCount: 0,
            outstandingPaise: toPaise(cust.currentBalance ?? '0'),
          }}
          onSuccess={() => {
            setDialog(null);
            showToast('Customer deactivated. Financial history has been preserved.');
            fetchLedger();
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog === 'restore' && cust && (
        <RestoreDialog
          customerId={cust.id}
          customerName={cust.fullName}
          customerCode={cust.customerCode}
          onSuccess={() => {
            setDialog(null);
            showToast('Customer restored successfully.');
            fetchLedger();
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog === 'permDelete' && cust && (
        <PermanentDeleteDialog
          customerId={cust.id}
          customerName={cust.fullName}
          customerCode={cust.customerCode}
          safetyCounts={{
            invoiceCount: 0,
            paymentCount: 0,
            ledgerCount: 0,
            reminderCount: 0,
            hasOutstanding: toPaise(cust.currentBalance ?? '0') !== 0,
            outstandingLabel: fromPaise(Math.abs(toPaise(cust.currentBalance ?? '0'))),
          }}
          onSuccess={() => {
            setDialog(null);
            showToast('Customer permanently deleted.');
            router.push('/dashboard/customers');
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {/* ─── Print styles (injected in head via style tag) ─────────────────── */}
      <style>{`
        @media print {
          .ledger-no-print { display: none !important; }
          .ledger-print-show { display: block !important; }
          aside, nav, header, .sidebar { display: none !important; }
          main { padding: 0 !important; }
          body { background: white !important; font-size: 12px; }
          .ledger-table th, .ledger-table td { padding: 6px 8px !important; font-size: 11px !important; }
          .ledger-page { box-shadow: none !important; border: none !important; }
          @page { margin: 15mm; }
        }
        .font-tabular { font-variant-numeric: tabular-nums; }
      `}</style>

      {/* ─── Print-only header ────────────────────────────────────────────── */}
      <div className="ledger-print-show hidden print:block mb-6 border-b-2 border-slate-900 pb-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-lg font-bold text-slate-900">MD JAVED ENTERPRISES</h1>
            <p className="text-xs text-slate-500">Mobiles &amp; Electronics</p>
          </div>
          <div className="text-right text-xs text-slate-500">
            <p>Ledger Statement</p>
            {(fromDate || toDate) && <p>{fromDate && fmtDate(fromDate + 'T00:00:00')} – {toDate && fmtDate(toDate + 'T00:00:00')}</p>}
            <p>Generated: {fmtDate(new Date().toISOString())}</p>
          </div>
        </div>
        {customer && (
          <div className="mt-4 grid grid-cols-2 gap-4 text-xs">
            <div>
              <p className="font-semibold text-slate-900">{customer.fullName}</p>
              <p className="text-slate-500">{customer.mobile}</p>
              {fullAddress && <p className="text-slate-500">{fullAddress}</p>}
            </div>
            <div className="text-right">
              <p className="text-slate-500">Customer Code: <span className="font-semibold text-slate-900">{customer.customerCode}</span></p>
              {summary && (
                <p className="text-slate-500">Closing Balance: <span className="font-semibold text-slate-900">{summary.closingBalance} {summary.closingBalanceLabel}</span></p>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-5">

        {/* ─── Breadcrumb ───────────────────────────────────────────────────── */}
        <nav className="ledger-no-print flex items-center gap-1.5 text-xs text-slate-400" aria-label="Breadcrumb">
          <Link href="/dashboard/customers" className="hover:text-slate-700 transition-colors flex items-center gap-1">
            <User className="h-3 w-3" aria-hidden="true" />
            Customers
          </Link>
          <ChevronRight className="h-3 w-3" aria-hidden="true" />
          <span className="text-slate-600 font-medium truncate max-w-[160px]">
            {customer?.fullName ?? '…'}
          </span>
          <ChevronRight className="h-3 w-3" aria-hidden="true" />
          <span className="text-slate-500">Ledger</span>
        </nav>

        {/* ─── Loading ──────────────────────────────────────────────────────── */}
        {loading && !data && <LedgerSkeleton />}

        {/* ─── Error ────────────────────────────────────────────────────────── */}
        {!loading && error && !data && (
          <div className="bg-white border border-slate-200 rounded-xl p-6 ledger-page">
            <ErrorState message={error} onRetry={fetchLedger} onBack={() => router.push('/dashboard/customers')} />
          </div>
        )}

        {/* ─── Main content ─────────────────────────────────────────────────── */}
        {data && (
          <>
            {/* ─── Customer Header Card ──────────────────────────────────── */}
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm ledger-page overflow-hidden">
              {/* Top strip */}
              <div className="px-5 py-4 border-b border-slate-100">
                <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                  {/* Back + identity */}
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <Link
                      href="/dashboard/customers"
                      className="ledger-no-print shrink-0 h-9 w-9 rounded-lg border border-slate-200 flex items-center justify-center text-slate-500 hover:text-slate-800 hover:border-slate-300 hover:bg-slate-50 transition-all mt-0.5"
                      aria-label="Back to customers"
                    >
                      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                    </Link>
                    <div className="min-w-0">
                      {/* Code + status */}
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-xs font-mono font-semibold text-blue-600 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded">
                          {cust.customerCode}
                        </span>
                        {!cust.isActive && (
                          <span className="text-xs bg-slate-100 text-slate-500 border border-slate-200 px-2 py-0.5 rounded">
                            Inactive
                          </span>
                        )}
                        {cust.isActive && (
                          <span className="text-xs bg-emerald-50 text-emerald-600 border border-emerald-200 px-2 py-0.5 rounded">
                            Active
                          </span>
                        )}
                      </div>
                      <h1 className="text-lg font-bold text-slate-900 leading-tight truncate">{cust.fullName}</h1>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-xs text-slate-500">
                        <span className="flex items-center gap-1">
                          <Phone className="h-3 w-3" aria-hidden="true" />
                          {cust.mobile}
                          {cust.alternateMobile && (
                            <span className="text-slate-400">/ {cust.alternateMobile}</span>
                          )}
                        </span>
                        {custAddress && (
                          <span className="flex items-center gap-1 truncate max-w-[240px]">
                            <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                            <span className="truncate">{custAddress}</span>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Balance + actions */}
                  <div className="flex flex-col items-start sm:items-end gap-3 shrink-0">
                    {/* Current balance */}
                    <div className="text-left sm:text-right">
                      <p className="text-xs text-slate-400 mb-0.5 uppercase tracking-wide">Current Balance</p>
                      <div className="flex items-baseline gap-2">
                        <span
                          className={`text-2xl font-bold tabular-nums ${
                            summ.closingBalanceLabel === 'Cr'
                              ? 'text-emerald-700'
                              : summ.closingBalanceLabel === 'Settled'
                                ? 'text-slate-400'
                                : 'text-rose-700'
                          }`}
                          aria-label={`Current balance: ${summ.closingBalance} ${summ.closingBalanceLabel}`}
                        >
                          {summ.closingBalanceLabel === 'Settled' ? '₹0.00' : summ.closingBalance}
                        </span>
                        <span
                          className={`text-sm font-bold px-2 py-0.5 rounded ${
                            summ.closingBalanceLabel === 'Cr'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : summ.closingBalanceLabel === 'Settled'
                                ? 'bg-slate-100 text-slate-500 border border-slate-200'
                                : 'bg-rose-50 text-rose-700 border border-rose-200'
                          }`}
                        >
                          {summ.closingBalanceLabel}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {summ.closingBalanceLabel === 'Cr'
                          ? 'Customer has advance balance'
                          : summ.closingBalanceLabel === 'Settled'
                            ? 'Account fully settled'
                            : 'Customer owes us this amount'}
                      </p>
                    </div>

                    {/* Primary actions */}
                    <div className="ledger-no-print flex items-center gap-2 flex-wrap">
                      {cust.isActive ? (
                        <>
                          <Link
                            href={`/dashboard/sales?customerId=${cust.id}`}
                            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors shadow-sm min-h-[36px]"
                          >
                            <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                            <span className="hidden sm:inline">Create </span>Invoice
                          </Link>
                          <Link
                            href={`/dashboard/credit?customerId=${cust.id}`}
                            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors shadow-sm min-h-[36px]"
                          >
                            <CreditCard className="h-3.5 w-3.5" aria-hidden="true" />
                            <span className="hidden sm:inline">Record </span>Payment
                          </Link>
                        </>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-amber-100 text-amber-700 border border-amber-200 min-h-[36px]">
                          <UserX className="h-3.5 w-3.5" aria-hidden="true" />
                          Customer Inactive
                        </span>
                      )}

                      {/* More actions */}
                      <InlineActionMenu
                        showActions={showActions}
                        setShowActions={setShowActions}
                        actionsRef={actionsRef}
                        handlePrint={handlePrint}
                        userInfo={userInfo}
                        setDialog={setDialog}
                        cust={cust}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* ─── Credit Account Section ──────────────────────────────────── */}
              <div className="p-4">
                <CreditAccountSection
                  creditLimitRaw={cust.creditLimit ?? '0'}
                  currentBalanceRaw={cust.currentBalance ?? summ.closingBalance.replace(/[₹,\s]/g, '') ?? '0'}
                  creditLimitUpdatedAt={cust.creditLimitUpdatedAt}
                  creditLimitUpdatedBy={cust.creditLimitUpdatedBy}
                />
              </div>

              {/* ─── Summary cards ──────────────────────────────────────── */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 p-4">
                <SummaryCard
                  icon={Building2}
                  label="Opening Balance"
                  amount={summ.openingBalance}
                  badge={summ.openingBalanceLabel !== 'Settled' ? summ.openingBalanceLabel : undefined}
                  sub="At account creation"
                  colorClass={summ.openingBalanceLabel === 'Cr' ? 'text-emerald-700' : summ.openingBalanceLabel === 'Settled' ? 'text-slate-500' : 'text-rose-700'}
                  iconBg="bg-slate-100 text-slate-500"
                />
                <SummaryCard
                  icon={TrendingUp}
                  label="Total Debit"
                  amount={summ.totalDebit}
                  sub="Sales &amp; charges"
                  colorClass="text-rose-700"
                  iconBg="bg-rose-50 text-rose-500"
                />
                <SummaryCard
                  icon={TrendingDown}
                  label="Total Credit"
                  amount={summ.totalCredit}
                  sub="Payments received"
                  colorClass="text-emerald-700"
                  iconBg="bg-emerald-50 text-emerald-500"
                />
                <SummaryCard
                  icon={CircleDollarSign}
                  label="Closing Balance"
                  amount={summ.closingBalance}
                  badge={summ.closingBalanceLabel !== 'Settled' ? summ.closingBalanceLabel : undefined}
                  sub={summ.closingBalanceLabel === 'Cr' ? 'Advance available' : summ.closingBalanceLabel === 'Settled' ? 'Account settled' : 'Customer owes us'}
                  colorClass={summ.closingBalanceLabel === 'Cr' ? 'text-emerald-700' : summ.closingBalanceLabel === 'Settled' ? 'text-slate-400' : 'text-rose-700'}
                  iconBg={summ.closingBalanceLabel === 'Cr' ? 'bg-emerald-50 text-emerald-500' : summ.closingBalanceLabel === 'Settled' ? 'bg-slate-100 text-slate-400' : 'bg-rose-50 text-rose-500'}
                />
                <SummaryCard
                  icon={AlertCircle}
                  label="Outstanding"
                  amount={summ.isOverdue ? summ.closingBalance : '₹0.00'}
                  sub={summ.isOverdue ? 'Amount due' : 'All clear'}
                  colorClass={summ.isOverdue ? 'text-amber-700' : 'text-slate-400'}
                  iconBg={summ.isOverdue ? 'bg-amber-50 text-amber-500' : 'bg-slate-100 text-slate-400'}
                />
              </div>
            </div>

            {/* ─── Filter Toolbar ───────────────────────────────────────────── */}
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm ledger-no-print overflow-hidden">
              {/* Main filter row */}
              <div className="flex flex-wrap items-center gap-2 p-3">
                {/* Search */}
                <div className="relative flex-1 min-w-[180px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search particulars, voucher no…"
                    className="w-full pl-8 pr-8 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-400 bg-slate-50 placeholder-slate-400"
                    aria-label="Search transactions"
                  />
                  {search && (
                    <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" aria-label="Clear search">
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  )}
                </div>

                {/* Voucher type */}
                <select
                  value={voucherType}
                  onChange={(e) => { setVoucherType(e.target.value); setPage(1); }}
                  className="px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50 text-slate-700 min-h-[38px]"
                  aria-label="Filter by voucher type"
                >
                  <option value="">All Types</option>
                  <option value="OPENING_BALANCE">Opening Balance</option>
                  <option value="SALE">Sale Invoice</option>
                  <option value="PAYMENT">Payment</option>
                  <option value="CREDIT_NOTE">Credit Note</option>
                  <option value="DEBIT_NOTE">Debit Note</option>
                  <option value="REFUND">Refund</option>
                  <option value="ADJUSTMENT">Adjustment</option>
                </select>

                {/* From date */}
                <div className="flex items-center gap-1">
                  <label className="text-xs text-slate-400 font-medium shrink-0" htmlFor="ledger-from">From</label>
                  <input
                    id="ledger-from"
                    type="date"
                    value={fromDate}
                    onChange={(e) => { setFromDate(e.target.value); setPage(1); }}
                    className="px-2 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50"
                    aria-label="From date"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <label className="text-xs text-slate-400 font-medium shrink-0" htmlFor="ledger-to">To</label>
                  <input
                    id="ledger-to"
                    type="date"
                    value={toDate}
                    onChange={(e) => { setToDate(e.target.value); setPage(1); }}
                    className="px-2 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50"
                    aria-label="To date"
                  />
                </div>

                {/* Reset */}
                {(fromDate || toDate || voucherType || search) && (
                  <button
                    onClick={() => { setSearch(''); setFromDate(''); setToDate(''); setVoucherType(''); setPage(1); }}
                    className="px-3 py-2 text-xs text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-1.5 min-h-[38px]"
                    aria-label="Reset all filters"
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                    Reset
                  </button>
                )}

                {/* Toggle advanced */}
                <button
                  onClick={() => setShowFilters((v) => !v)}
                  className="ml-auto px-3 py-2 text-xs text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-1.5 min-h-[38px]"
                  aria-expanded={showFilters}
                  aria-label="Toggle quick date filters"
                >
                  <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                  Quick Dates
                  {showFilters ? <ChevronUp className="h-3 w-3" aria-hidden="true" /> : <ChevronDown className="h-3 w-3" aria-hidden="true" />}
                </button>
              </div>

              {/* Quick date filters (collapsible) */}
              {showFilters && (
                <div className="flex flex-wrap gap-2 px-3 pb-3 border-t border-slate-100 pt-3">
                  {[
                    { label: 'Today', preset: 'today' as const },
                    { label: 'This Week', preset: 'week' as const },
                    { label: 'This Month', preset: 'month' as const },
                    { label: 'Financial Year', preset: 'fy' as const },
                    { label: 'All Time', preset: 'all' as const },
                  ].map((q) => (
                    <button
                      key={q.preset}
                      onClick={() => setQuickDate(q.preset)}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 transition-colors min-h-[32px]"
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* ─── Ledger Table / Cards ──────────────────────────────────────── */}
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm ledger-page overflow-hidden">
              {/* Table header info */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-slate-800">Ledger Entries</h2>
                  <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full tabular-nums">
                    {displayedEntries.length} {displayedEntries.length === 1 ? 'entry' : 'entries'}
                  </span>
                </div>
                {loading && (
                  <RefreshCw className="h-4 w-4 text-slate-400 animate-spin" aria-label="Loading" />
                )}
              </div>

              {/* Empty state */}
              {!loading && displayedEntries.length === 0 && (
                <EmptyState
                  onCreateInvoice={() => router.push(`/dashboard/sales?customerId=${customerId}`)}
                  onRecordPayment={() => router.push(`/dashboard/credit?customerId=${customerId}`)}
                />
              )}

              {/* ─── Desktop table ────────────────────────────────────────── */}
              {displayedEntries.length > 0 && (
                <>
                  {/* Desktop */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full ledger-table text-sm" role="grid" aria-label="Customer ledger transactions">
                      <thead>
                        <tr className="border-b border-slate-100 bg-slate-50">
                          <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">Date</th>
                          <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Particulars</th>
                          <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">Voucher Type</th>
                          <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">Voucher No.</th>
                          <th scope="col" className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">Debit</th>
                          <th scope="col" className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">Credit</th>
                          <th scope="col" className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">Balance</th>
                          <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                          <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide sr-only">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {displayedEntries.map((entry, idx) => {
                          const Icon = VOUCHER_ICON[entry.voucherType];
                          const vColor = VOUCHER_COLORS[entry.voucherType];
                          const statusStyle = STATUS_STYLES[entry.status] ?? STATUS_STYLES.Posted;
                          const isClickable = ['SALE', 'PAYMENT'].includes(entry.voucherType) && entry.id !== 'opening-balance';
                          const isEven = idx % 2 === 0;

                          return (
                            <tr
                              key={entry.id}
                              className={`group transition-colors ${isEven ? 'bg-white' : 'bg-slate-50/40'} hover:bg-blue-50/40`}
                            >
                              <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap tabular-nums">
                                {fmtDate(entry.date)}
                              </td>
                              <td className="px-4 py-3 max-w-[240px]">
                                <p className="text-sm text-slate-800 font-medium truncate" title={entry.particulars}>
                                  {entry.particulars}
                                </p>
                              </td>
                              <td className="px-4 py-3">
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium ${vColor}`}>
                                  <Icon className="h-3 w-3" aria-hidden="true" />
                                  {VOUCHER_LABELS[entry.voucherType]}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-xs font-mono text-slate-600 whitespace-nowrap">
                                {entry.voucherNumber || <span className="text-slate-300">—</span>}
                              </td>
                              <td className="px-4 py-3 text-right">
                                {entry.debit ? (
                                  <span className="text-sm font-semibold text-rose-700 tabular-nums">{entry.debit}</span>
                                ) : (
                                  <span className="text-slate-300 text-sm">—</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right">
                                {entry.credit ? (
                                  <span className="text-sm font-semibold text-emerald-700 tabular-nums">{entry.credit}</span>
                                ) : (
                                  <span className="text-slate-300 text-sm">—</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right whitespace-nowrap">
                                <span
                                  className={`text-sm font-bold tabular-nums ${
                                    entry.balanceLabel === 'Cr'
                                      ? 'text-emerald-700'
                                      : entry.balanceLabel === 'Settled'
                                        ? 'text-slate-400'
                                        : 'text-slate-800'
                                  }`}
                                >
                                  {entry.balanceLabel === 'Settled' ? '₹0.00' : entry.runningBalance}
                                </span>
                                {' '}
                                <span
                                  className={`text-xs font-bold px-1 py-0.5 rounded ${
                                    entry.balanceLabel === 'Cr'
                                      ? 'text-emerald-600 bg-emerald-50'
                                      : entry.balanceLabel === 'Settled'
                                        ? 'text-slate-400 bg-slate-100'
                                        : 'text-rose-600 bg-rose-50'
                                  }`}
                                >
                                  {entry.balanceLabel}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${statusStyle}`}>
                                  {entry.status}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                {isClickable && (
                                  <button
                                    onClick={() => handleNavigate(entry)}
                                    className="text-slate-300 hover:text-blue-500 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded"
                                    aria-label={`View ${entry.voucherType === 'SALE' ? 'invoice' : 'payment'} ${entry.voucherNumber}`}
                                  >
                                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      {/* Totals row */}
                      <tfoot>
                        <tr className="bg-slate-50 border-t-2 border-slate-200">
                          <td colSpan={4} className="px-4 py-3 text-xs font-bold text-slate-700 uppercase tracking-wide">
                            Totals
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className="text-sm font-bold text-rose-700 tabular-nums">{summ.totalDebit}</span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className="text-sm font-bold text-emerald-700 tabular-nums">{summ.totalCredit}</span>
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <span className={`text-sm font-bold tabular-nums ${summ.closingBalanceLabel === 'Cr' ? 'text-emerald-700' : summ.closingBalanceLabel === 'Settled' ? 'text-slate-400' : 'text-slate-900'}`}>
                              {summ.closingBalanceLabel === 'Settled' ? '₹0.00' : summ.closingBalance}
                            </span>
                            {' '}
                            <span className={`text-xs font-bold px-1 py-0.5 rounded ${summ.closingBalanceLabel === 'Cr' ? 'text-emerald-600 bg-emerald-50' : summ.closingBalanceLabel === 'Settled' ? 'text-slate-400 bg-slate-100' : 'text-rose-600 bg-rose-50'}`}>
                              {summ.closingBalanceLabel}
                            </span>
                          </td>
                          <td colSpan={2} />
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  {/* ─── Mobile cards ────────────────────────────────── */}
                  <div className="md:hidden divide-y divide-slate-100">
                    {displayedEntries.map((entry) => (
                      <MobileTransactionCard key={entry.id} entry={entry} onNavigate={handleNavigate} />
                    ))}
                    {/* Mobile totals */}
                    <div className="px-4 py-4 bg-slate-50 space-y-2">
                      <h3 className="text-xs font-bold text-slate-600 uppercase tracking-wide">Summary</h3>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <p className="text-xs text-slate-400">Total Debit</p>
                          <p className="font-bold text-rose-700 tabular-nums">{summ.totalDebit} <span className="text-xs">Dr</span></p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-400">Total Credit</p>
                          <p className="font-bold text-emerald-700 tabular-nums">{summ.totalCredit} <span className="text-xs">Cr</span></p>
                        </div>
                        <div className="col-span-2">
                          <p className="text-xs text-slate-400">Closing Balance</p>
                          <p className={`font-bold tabular-nums text-lg ${summ.closingBalanceLabel === 'Cr' ? 'text-emerald-700' : summ.closingBalanceLabel === 'Settled' ? 'text-slate-400' : 'text-rose-700'}`}>
                            {summ.closingBalanceLabel === 'Settled' ? '₹0.00' : summ.closingBalance}
                            {' '}<span className="text-sm font-bold">{summ.closingBalanceLabel}</span>
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* ─── Pagination ──────────────────────────────────────────── */}
              {pag && pag.pages > 1 && (
                <div className="ledger-no-print flex items-center justify-between px-4 py-3 border-t border-slate-100 bg-slate-50">
                  <p className="text-xs text-slate-500 tabular-nums">
                    Page {pag.page} of {pag.pages} &nbsp;·&nbsp; {pag.total} entries
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={pag.page <= 1 || loading}
                      className="h-8 w-8 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      aria-label="Previous page"
                    >
                      <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <span className="text-xs text-slate-600 tabular-nums font-medium">{pag.page} / {pag.pages}</span>
                    <button
                      onClick={() => setPage((p) => Math.min(pag.pages, p + 1))}
                      disabled={!pag.hasMore || loading}
                      className="h-8 w-8 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      aria-label="Next page"
                    >
                      <ChevronRight className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* ─── Error banner (during pagination) ────────────────────────── */}
            {error && data && (
              <div className="ledger-no-print bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 flex items-center gap-3 text-sm text-rose-700">
                <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                {error}
                <button onClick={fetchLedger} className="ml-auto underline hover:no-underline shrink-0">Retry</button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
