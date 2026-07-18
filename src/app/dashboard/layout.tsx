import Sidebar from '@/components/layout/Sidebar';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Dashboard' };

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="px-6 py-6 lg:px-8 lg:py-8 max-w-screen-2xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
