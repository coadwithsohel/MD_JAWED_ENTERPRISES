import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { formatINR } from "@/lib/money";
import Link from "next/link";
import { ArrowLeft, Clock, Search } from "lucide-react";
import { startOfDayIST } from "@/lib/accounting";

export default async function BulkEntryHistoryPage({
  searchParams,
}: {
  searchParams: { page?: string };
}) {
  const page = parseInt(searchParams.page || "1");
  const limit = 20;
  const skip = (page - 1) * limit;

  const batches = await prisma.bulkEntryBatch.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    skip,
    include: { createdBy: { select: { fullName: true, role: true } } },
  });
  
  const totalCount = await prisma.bulkEntryBatch.count();

  const totalPages = Math.ceil(totalCount / limit);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <Link 
          href="/dashboard/bulk-entry" 
          className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-full transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Batch History</h1>
          <p className="text-sm text-slate-500">View past bulk payment entries</p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        {batches.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <Clock className="w-12 h-12 mx-auto text-slate-300 mb-4" />
            <h3 className="text-lg font-medium text-slate-900 mb-1">No batches found</h3>
            <p>You haven't posted any bulk entries yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-3 font-medium text-slate-500">Batch Ref</th>
                  <th className="px-6 py-3 font-medium text-slate-500">Entry Date</th>
                  <th className="px-6 py-3 font-medium text-slate-500">Type</th>
                  <th className="px-6 py-3 font-medium text-slate-500 text-right">Rows</th>
                  <th className="px-6 py-3 font-medium text-slate-500 text-right">Total Amount</th>
                  <th className="px-6 py-3 font-medium text-slate-500">Mode</th>
                  <th className="px-6 py-3 font-medium text-slate-500">Created By</th>
                  <th className="px-6 py-3 font-medium text-slate-500">Created At</th>
                  <th className="px-6 py-3 font-medium text-slate-500">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {batches.map(batch => (
                  <tr key={batch.id} className="hover:bg-slate-50">
                    <td className="px-6 py-4 font-medium text-slate-900 font-mono">{batch.batchReference}</td>
                    <td className="px-6 py-4">{new Date(batch.entryDate).toLocaleDateString("en-IN")}</td>
                    <td className="px-6 py-4 font-medium text-slate-700">
                      {batch.batchType === "PAYMENT" ? "Payment" : "Manual Adjustment"}
                    </td>
                    <td className="px-6 py-4 text-right font-medium">{batch.rowCount}</td>
                    <td className="px-6 py-4 text-right font-medium text-emerald-600">{formatINR(Number(batch.totalAmount))}</td>
                    <td className="px-6 py-4 text-slate-500">{batch.defaultPaymentMode || "-"}</td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-slate-900">{batch.createdBy.fullName}</div>
                      <div className="text-xs text-slate-500">{batch.createdBy.role}</div>
                    </td>
                    <td className="px-6 py-4 text-slate-500">{batch.createdAt.toLocaleString("en-IN")}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${batch.status === 'POSTED' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-700'}`}>
                        {batch.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between bg-slate-50">
            <span className="text-sm text-slate-500">
              Showing {skip + 1} to {Math.min(skip + limit, totalCount)} of {totalCount} batches
            </span>
            <div className="flex gap-2">
              {page > 1 && (
                <Link href={`/dashboard/bulk-entry/history?page=${page - 1}`} className="px-3 py-1 bg-white border border-slate-300 rounded text-sm hover:bg-slate-50">
                  Previous
                </Link>
              )}
              {page < totalPages && (
                <Link href={`/dashboard/bulk-entry/history?page=${page + 1}`} className="px-3 py-1 bg-white border border-slate-300 rounded text-sm hover:bg-slate-50">
                  Next
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
