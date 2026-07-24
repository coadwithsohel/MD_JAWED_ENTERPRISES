import Sidebar from '@/components/layout/Sidebar';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Dashboard' };

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <Sidebar />
      <main className="lg:ml-64 min-h-screen">
        <div className="px-6 py-6 lg:px-8 lg:py-8 max-w-screen-2xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
