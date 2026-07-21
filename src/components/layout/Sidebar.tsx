"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Package,
  ShoppingCart,
  FileText,
  CreditCard,
  AlertTriangle,
  Upload,
  Settings,
  LogOut,
  Menu,
  X,
} from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  exact?: boolean;
  badge?: number;
  variant?: "warning";
}

function useOverdueCount() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    fetch("/api/overdue/count")
      .then((r) => r.json())
      .then((d) => setCount(d.count ?? 0))
      .catch(() => {});
  }, []);

  return count;
}

function NavList({
  items,
  pathname,
  onNavigate,
}: {
  items: NavItem[];
  pathname: string;
  onNavigate: () => void;
}) {
  return (
    <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-0.5">
      {items.map((item) => {
        const Icon = item.icon;
        const active = item.exact
          ? pathname === item.href
          : pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={[
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all group",
              active
                ? item.variant === "warning"
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/20"
                  : "bg-blue-600/20 text-blue-400 border border-blue-600/20"
                : item.variant === "warning"
                  ? "text-amber-400 hover:bg-amber-900/20 hover:text-amber-300"
                  : "text-slate-400 hover:bg-slate-800 hover:text-white",
            ].join(" ")}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="flex-1 leading-none">{item.label}</span>
            {item.badge != null && item.badge > 0 && (
              <span className="bg-amber-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-4.5 text-center leading-none">
                {item.badge > 99 ? "99+" : item.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const overdueCount = useOverdueCount();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [logoutConfirm, setLogoutConfirm] = useState(false);

  const navItems: NavItem[] = [
    {
      href: "/dashboard",
      label: "Dashboard",
      icon: LayoutDashboard,
      exact: true,
    },
    { href: "/dashboard/customers", label: "Customers", icon: Users },
    { href: "/dashboard/products", label: "Products", icon: Package },
    { href: "/dashboard/sales", label: "Point of Sale", icon: ShoppingCart },
    { href: "/dashboard/invoices", label: "Sales History", icon: FileText },
    { href: "/dashboard/credit", label: "Credit Mgmt", icon: CreditCard },
    {
      href: "/dashboard/overdue-customers",
      label: "Overdue Customers",
      icon: AlertTriangle,
      badge: overdueCount,
      variant: "warning",
    },
    {
      href: "/dashboard/customers/import",
      label: "Customer Import",
      icon: Upload,
    },
    {
      href: "/dashboard/customers/import-transactions",
      label: "Transaction Import",
      icon: Upload,
    },
    { href: "/dashboard/settings", label: "Settings", icon: Settings },
  ];

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  };

  return (
    <>
      {/* Mobile hamburger button */}
      <button
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed top-4 left-4 z-50 h-10 w-10 bg-slate-900 text-white rounded-xl flex items-center justify-center shadow-lg"
        aria-label="Open navigation"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar — desktop: always visible, mobile: drawer */}
      <aside
        className={[
          "fixed lg:relative inset-y-0 left-0 z-50 flex flex-col w-64 bg-slate-900 text-slate-300 border-r border-slate-800 transition-transform duration-300",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        ].join(" ")}
        aria-label="Main navigation"
      >
        {/* Logo */}
        <div className="flex items-center justify-between p-5 border-b border-slate-800">
          <div>
            <h2 className="text-lg font-bold text-white tracking-wide leading-none">
              MD JAVED
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Mobiles &amp; Electronics
            </p>
          </div>
          <button
            onClick={() => setMobileOpen(false)}
            className="lg:hidden text-slate-500 hover:text-white"
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <NavList
          items={navItems}
          pathname={pathname}
          onNavigate={() => setMobileOpen(false)}
        />

        {/* Logout */}
        <div className="p-3 border-t border-slate-800">
          {logoutConfirm ? (
            <div className="bg-red-900/30 border border-red-800/40 rounded-lg p-3 text-sm">
              <p className="text-red-300 mb-2 font-medium">Sign out?</p>
              <div className="flex gap-2">
                <button
                  onClick={handleLogout}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white text-xs font-medium py-1.5 rounded-lg transition-colors"
                >
                  Sign Out
                </button>
                <button
                  onClick={() => setLogoutConfirm(false)}
                  className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-medium py-1.5 rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setLogoutConfirm(true)}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-slate-400 hover:text-white hover:bg-red-900/30 rounded-lg transition-colors text-sm font-medium"
            >
              <LogOut className="h-4 w-4" />
              Logout
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
