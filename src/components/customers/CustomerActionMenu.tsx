'use client';

import { useEffect, useRef, useState } from 'react';
import {
  MoreVertical,
  BookOpen,
  Edit2,
  CreditCard,
  UserX,
  UserCheck,
  Trash2,
} from 'lucide-react';

export interface CustomerActionMenuProps {
  customerId: string;
  customerName: string;
  isActive: boolean;
  isAdmin: boolean; // OWNER role
  canManage: boolean; // OWNER or MANAGER role
  onViewLedger: () => void;
  onEditCustomer: () => void;
  onChangeCreditLimit: () => void;
  onDeactivate: () => void;
  onReactivate: () => void;
  onDeletePermanently: () => void;
}

export default function CustomerActionMenu({
  isActive,
  isAdmin,
  canManage,
  onViewLedger,
  onEditCustomer,
  onChangeCreditLimit,
  onDeactivate,
  onReactivate,
  onDeletePermanently,
}: CustomerActionMenuProps) {
  const [open, setOpen] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const ref = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handler);
      return () => document.removeEventListener('mousedown', handler);
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    if (open) {
      document.addEventListener('keydown', handler);
      return () => document.removeEventListener('keydown', handler);
    }
  }, [open]);

  // Collision-aware positioning
  useEffect(() => {
    if (open && dropdownRef.current && ref.current) {
      const triggerRect = ref.current.getBoundingClientRect();
      const dropdownRect = dropdownRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const style: React.CSSProperties = {};

      // Horizontal: prefer right-aligned, flip if off-screen
      const rightSpace = viewportWidth - triggerRect.right;
      const leftSpace = triggerRect.left;
      if (rightSpace >= dropdownRect.width || rightSpace >= leftSpace) {
        style.right = 0;
        style.left = 'auto';
      } else {
        style.left = 0;
        style.right = 'auto';
      }

      // Vertical: prefer below, flip if off-screen bottom
      const bottomSpace = viewportHeight - triggerRect.bottom;
      const topSpace = triggerRect.top;
      if (bottomSpace >= dropdownRect.height || bottomSpace >= topSpace) {
        style.top = '100%';
        style.bottom = 'auto';
        style.marginTop = '4px';
      } else {
        style.bottom = '100%';
        style.top = 'auto';
        style.marginBottom = '4px';
      }

      setDropdownStyle(style);
    }
  }, [open]);

  function action(fn: () => void) {
    fn();
    setOpen(false);
  }

  return (
    <div className="relative inline-flex shrink-0" ref={ref}>
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); }}
        className="h-9 w-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        aria-label="Customer actions"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreVertical className="h-4 w-4" aria-hidden="true" />
      </button>

      {open && (
        <div
          ref={dropdownRef}
          className="absolute z-50 w-56 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden py-1"
          style={dropdownStyle}
          role="menu"
          aria-label="Customer actions menu"
        >
          {/* View Ledger — always visible */}
          <button
            onClick={() => action(onViewLedger)}
            className="w-full flex items-center gap-3 px-4 py-3 sm:py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors text-left group focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 focus-visible:outline-none"
            role="menuitem"
          >
            <BookOpen className="h-4 w-4 text-slate-400 group-hover:text-blue-500 transition-colors shrink-0" aria-hidden="true" />
            View Ledger
          </button>

          {/* Edit — always visible (any role can edit basic info) */}
          <button
            onClick={() => action(onEditCustomer)}
            className="w-full flex items-center gap-3 px-4 py-3 sm:py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors text-left group focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 focus-visible:outline-none"
            role="menuitem"
          >
            <Edit2 className="h-4 w-4 text-slate-400 group-hover:text-blue-500 transition-colors shrink-0" aria-hidden="true" />
            Edit Customer
          </button>

          {/* Change Credit Limit — MANAGER or OWNER */}
          {canManage && (
            <button
              onClick={() => action(onChangeCreditLimit)}
              className="w-full flex items-center gap-3 px-4 py-3 sm:py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors text-left group focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500 focus-visible:outline-none"
              role="menuitem"
            >
              <CreditCard className="h-4 w-4 text-slate-400 group-hover:text-emerald-500 transition-colors shrink-0" aria-hidden="true" />
              Change Credit Limit
            </button>
          )}

          <div className="my-1 border-t border-slate-100" role="separator" />

          {/* Deactivate / Reactivate — MANAGER or OWNER */}
          {canManage && (
            <>
              {isActive ? (
                <button
                  onClick={() => action(onDeactivate)}
                  className="w-full flex items-center gap-3 px-4 py-3 sm:py-2.5 text-sm text-amber-700 hover:bg-amber-50 transition-colors text-left group focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-500 focus-visible:outline-none"
                  role="menuitem"
                >
                  <UserX className="h-4 w-4 text-amber-500 group-hover:text-amber-600 transition-colors shrink-0" aria-hidden="true" />
                  Deactivate Customer
                </button>
              ) : (
                <button
                  onClick={() => action(onReactivate)}
                  className="w-full flex items-center gap-3 px-4 py-3 sm:py-2.5 text-sm text-emerald-700 hover:bg-emerald-50 transition-colors text-left group focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500 focus-visible:outline-none"
                  role="menuitem"
                >
                  <UserCheck className="h-4 w-4 text-emerald-500 group-hover:text-emerald-600 transition-colors shrink-0" aria-hidden="true" />
                  Reactivate Customer
                </button>
              )}
            </>
          )}

          {/* Delete Permanently — OWNER only, shown only when inactive */}
          {isAdmin && !isActive && (
            <>
              <div className="my-1 border-t border-slate-100" role="separator" />
              <button
                onClick={() => action(onDeletePermanently)}
                className="w-full flex items-center gap-3 px-4 py-3 sm:py-2.5 text-sm text-rose-700 hover:bg-rose-50 transition-colors text-left group focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-rose-500 focus-visible:outline-none"
                role="menuitem"
              >
                <Trash2 className="h-4 w-4 text-rose-400 group-hover:text-rose-600 transition-colors shrink-0" aria-hidden="true" />
                Delete Permanently
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}