'use client';

import { useState, useRef, useEffect } from 'react';
import { MoreVertical, Pencil, Ban } from 'lucide-react';

interface TransactionRowMenuProps {
  voucherType: 'SALE' | 'PAYMENT';
  onEdit: () => void;
  onVoid: () => void;
}

/**
 * Collision-aware three-dot action menu for individual ledger rows.
 * Shows "Edit Sale / Void Sale" for SALE rows.
 * Shows "Edit Payment / Void Payment" for PAYMENT rows.
 */
export default function TransactionRowMenu({ voucherType, onEdit, onVoid }: TransactionRowMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});

  useEffect(() => {
    if (open && triggerRef.current && dropdownRef.current) {
      const triggerRect = triggerRef.current.getBoundingClientRect();
      const dropdownRect = dropdownRef.current.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const style: React.CSSProperties = {};

      // Horizontal positioning
      const leftAligned = triggerRect.right - dropdownRect.width;
      style.left = `${Math.max(8, Math.min(leftAligned, vw - dropdownRect.width - 8))}px`;
      style.right = 'auto';

      // Vertical positioning
      const bottomSpace = vh - triggerRect.bottom;
      if (bottomSpace >= dropdownRect.height) {
        style.top = `${triggerRect.bottom + 4}px`;
        style.bottom = 'auto';
      } else {
        style.bottom = `${vh - triggerRect.top + 4}px`;
        style.top = 'auto';
      }

      setDropdownStyle(style);
    }
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target as Node) &&
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const label = voucherType === 'SALE' ? 'Sale' : 'Payment';

  return (
    <div className="relative inline-flex shrink-0">
      <button
        ref={triggerRef}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="h-7 w-7 flex items-center justify-center rounded-md text-slate-700 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white hover:bg-slate-100 transition-all opacity-100 visible focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
        aria-label={`Actions for ${label}`}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <MoreVertical className="h-3.5 w-3.5" aria-hidden="true" />
      </button>

      {open && (
        <div
          ref={dropdownRef}
          className="fixed z-50 w-44 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden py-1"
          style={dropdownStyle}
          role="menu"
          aria-label={`${label} actions`}
        >
          <button
            onClick={() => { setOpen(false); onEdit(); }}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-700 transition-colors text-left focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 focus-visible:outline-none"
            role="menuitem"
          >
            <Pencil className="h-3.5 w-3.5 text-blue-400 shrink-0" aria-hidden="true" />
            Edit {label}
          </button>
          <div className="my-0.5 border-t border-slate-100" role="separator" />
          <button
            onClick={() => { setOpen(false); onVoid(); }}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-amber-700 hover:bg-amber-50 transition-colors text-left focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-500 focus-visible:outline-none"
            role="menuitem"
          >
            <Ban className="h-3.5 w-3.5 text-amber-500 shrink-0" aria-hidden="true" />
            Void {label}
          </button>
        </div>
      )}
    </div>
  );
}
