import { prisma } from "@/lib/prisma";
import { Decimal } from "@prisma/client/runtime/library";

/**
 * Rebuild payment allocation for a customer.
 * Used when an invoice is edited, voided, or payment is recorded/modified.
 *
 * Rules:
 * 1. Payments linked directly to a sale (payment.saleId != null) allocate to that sale first.
 * 2. Unlinked active payments (payment.saleId == null, status == COMPLETED) apply FIFO to remaining active unpaid/partially paid sales.
 * 3. Update Sale.paidAmount, Sale.pendingAmount, and Sale.paymentStatus accordingly.
 */
export async function rebuildCustomerPaymentAllocations(
  customerId: string,
  tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]
): Promise<void> {
  const db = tx ?? prisma;

  // 1. Fetch active (non-cancelled) sales for customer ordered by saleDate/createdAt ASC
  const sales = await db.sale.findMany({
    where: {
      customerId,
      status: { not: "CANCELLED" },
    },
    orderBy: [{ saleDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      grandTotal: true,
      paidAmount: true,
      pendingAmount: true,
      paymentStatus: true,
    },
  });

  // 2. Fetch active (completed) payments for customer ordered by paymentDate ASC
  const payments = await db.payment.findMany({
    where: {
      customerId,
      status: "COMPLETED",
      voidedAt: null,
    },
    orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      saleId: true,
      amount: true,
    },
  });

  // Track allocation per sale
  const saleAllocations = new Map<string, Decimal>();
  for (const s of sales) {
    saleAllocations.set(s.id, new Decimal(0));
  }

  // Phase A: Direct allocations (payment linked to specific saleId)
  const unlinkedPaymentPool: Array<{ id: string; unallocatedAmount: Decimal }> = [];

  for (const p of payments) {
    const amt = p.amount ?? new Decimal(0);
    if (p.saleId && saleAllocations.has(p.saleId)) {
      const currentAlloc = saleAllocations.get(p.saleId)!;
      const sale = sales.find((s) => s.id === p.saleId)!;
      const maxNeeded = Decimal.max(sale.grandTotal.sub(currentAlloc), new Decimal(0));
      const allocated = Decimal.min(amt, maxNeeded);
      saleAllocations.set(p.saleId, currentAlloc.add(allocated));

      const leftover = amt.sub(allocated);
      if (leftover.gt(0)) {
        unlinkedPaymentPool.push({ id: p.id, unallocatedAmount: leftover });
      }
    } else {
      unlinkedPaymentPool.push({ id: p.id, unallocatedAmount: amt });
    }
  }

  // Phase B: FIFO allocation of unlinked payments to unpaid/partially-paid sales
  for (const p of unlinkedPaymentPool) {
    let unallocated = p.unallocatedAmount;
    if (unallocated.lte(0)) continue;

    for (const s of sales) {
      if (unallocated.lte(0)) break;
      const currentAlloc = saleAllocations.get(s.id)!;
      const needed = s.grandTotal.sub(currentAlloc);
      if (needed.gt(0)) {
        const fill = Decimal.min(unallocated, needed);
        saleAllocations.set(s.id, currentAlloc.add(fill));
        unallocated = unallocated.sub(fill);
      }
    }
  }

  // Phase C: Update each sale record if values changed
  for (const s of sales) {
    const paid = saleAllocations.get(s.id) ?? new Decimal(0);
    const pending = Decimal.max(s.grandTotal.sub(paid), new Decimal(0));

    let status: "PAID" | "PARTIALLY_PAID" | "UNPAID" = "UNPAID";
    if (pending.lte(0)) {
      status = "PAID";
    } else if (paid.gt(0)) {
      status = "PARTIALLY_PAID";
    }

    if (
      !s.paidAmount.equals(paid) ||
      !s.pendingAmount.equals(pending) ||
      s.paymentStatus !== status
    ) {
      await db.sale.update({
        where: { id: s.id },
        data: {
          paidAmount: paid,
          pendingAmount: pending,
          paymentStatus: status,
        },
      });
    }
  }
}
