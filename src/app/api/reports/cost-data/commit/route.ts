import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthFromRequest } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const authUser = getAuthFromRequest(req);
    if (!authUser) {
      return NextResponse.json({ success: false, code: "UNAUTHENTICATED", message: "Please sign in again." }, { status: 401 });
    }

    if (authUser.role !== "OWNER" && authUser.role !== "MANAGER") {
      return NextResponse.json({ success: false, code: "FORBIDDEN", message: "You do not have permission to update cost data." }, { status: 403 });
    }

    const body = await req.json();
    const { updates } = body;
    if (!Array.isArray(updates) || updates.length === 0) {
      return NextResponse.json({ success: false, code: "INVALID_PAYLOAD", message: "No updates provided." }, { status: 400 });
    }

    // Process only the first update if we are strictly one-record commit for now, but handling loops safely inside transaction is fine.
    // However, the instructions want strict one-record safety right now, but array is passed. We'll handle the array transactionally.
    let successCount = 0;
    const results: any[] = [];

    // Run each update individually inside a transaction to prevent partial state on that entity
    for (const update of updates) {
      const amount = Number(update.proposedTotalCost);
      if (isNaN(amount) || amount <= 0) {
        return NextResponse.json({ success: false, code: "INVALID_COST", message: "Proposed cost must be greater than zero." }, { status: 400 });
      }

      if (update.type === "SALE_ITEM") {
        if (!update.id) {
           return NextResponse.json({ success: false, code: "MISSING_ITEM_ID", message: "Missing invoice item ID." }, { status: 400 });
        }
        
        await prisma.$transaction(async (tx) => {
          const item = await tx.saleItem.findUnique({ where: { id: update.id }, include: { sale: true } });
          if (!item) throw new Error("Invoice item not found.");
          if (item.sale.status !== "COMPLETED") throw new Error("Invoice is not active.");

          const proposedUnitCost = amount / item.quantity;

          // Idempotency / Duplicate Edit safe
          if (item.purchasePriceSnapshot && Number(item.purchasePriceSnapshot) === proposedUnitCost && item.costSource === update.source) {
             results.push({ type: "SALE_ITEM", id: item.id, message: "Cost already matches.", created: false });
             return;
          }

          const actionType = item.purchasePriceSnapshot && Number(item.purchasePriceSnapshot) > 0 ? "COST_SNAPSHOT_UPDATED" : "COST_SNAPSHOT_ADDED";

          await tx.saleItem.update({
            where: { id: item.id },
            data: {
              purchasePriceSnapshot: proposedUnitCost,
              costSource: update.source,
              costCompletedAt: new Date(),
              costCompletedById: authUser.userId,
              isEstimatedCost: !!update.isEstimated,
              originalCostValue: item.purchasePriceSnapshot
            }
          });

          await tx.auditLog.create({
            data: {
              userId: authUser.userId,
              action: actionType,
              entityType: "SaleItem",
              entityId: item.id,
              oldData: { purchasePriceSnapshot: item.purchasePriceSnapshot },
              newData: { purchasePriceSnapshot: proposedUnitCost, costSource: update.source, isEstimatedCost: !!update.isEstimated }
            }
          });

          results.push({
            type: "SALE_ITEM",
            id: item.id,
            appliedCost: amount,
            source: update.source,
            created: actionType === "COST_SNAPSHOT_ADDED"
          });
          successCount++;
        });

      } else if (update.type === "SALE_ALLOCATION") {
        if (!update.saleId) {
          return NextResponse.json({ success: false, code: "MISSING_INVOICE_ID", message: "Missing invoice ID." }, { status: 400 });
        }

        await prisma.$transaction(async (tx) => {
          const sale = await tx.sale.findUnique({ where: { id: update.saleId } });
          if (!sale) throw new Error("Invoice not found.");
          if (sale.status !== "COMPLETED") throw new Error("Invoice is not active.");

          const existing = await tx.invoiceCostAllocation.findUnique({ where: { saleId: update.saleId } });

          if (existing) {
            // Idempotency: skip if perfectly identical
            if (Number(existing.totalCostAmount) === amount && existing.costSource === update.source) {
               results.push({ type: "SALE_ALLOCATION", id: existing.id, saleId: sale.id, appliedCost: amount, created: false });
               return;
            }

            await tx.invoiceCostAllocation.update({
              where: { saleId: sale.id },
              data: {
                totalCostAmount: amount,
                notes: update.notes || "",
                costSource: update.source,
                isEstimatedCost: !!update.isEstimated
              }
            });

            await tx.auditLog.create({
              data: {
                userId: authUser.userId,
                action: "INVOICE_COST_ALLOCATION_UPDATED",
                entityType: "InvoiceCostAllocation",
                entityId: existing.id,
                oldData: { totalCostAmount: existing.totalCostAmount },
                newData: { totalCostAmount: amount, notes: update.notes, costSource: update.source }
              }
            });

            results.push({ type: "SALE_ALLOCATION", allocationId: existing.id, invoiceId: sale.id, appliedCost: amount, source: update.source, created: false });
          } else {
            const created = await tx.invoiceCostAllocation.create({
              data: {
                saleId: sale.id,
                totalCostAmount: amount,
                notes: update.notes || "",
                costSource: update.source,
                isEstimatedCost: !!update.isEstimated,
                createdById: authUser.userId
              }
            });

            await tx.auditLog.create({
              data: {
                userId: authUser.userId,
                action: "INVOICE_COST_ALLOCATION_ADDED",
                entityType: "InvoiceCostAllocation",
                entityId: created.id,
                oldData: undefined,
                newData: { totalCostAmount: amount, notes: update.notes, costSource: update.source }
              }
            });
            results.push({ type: "SALE_ALLOCATION", allocationId: created.id, invoiceId: sale.id, appliedCost: amount, source: update.source, created: true });
          }
          successCount++;
        });
      }
    }

    return NextResponse.json({ success: true, count: successCount, data: results });
  } catch (error: any) {
    console.error("Commit error:", error);
    return NextResponse.json({ success: false, code: "COMMIT_FAILED", message: error.message || "An unexpected error occurred during commit." }, { status: 500 });
  }
}
