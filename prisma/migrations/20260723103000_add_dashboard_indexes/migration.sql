-- Add composite indexes for dashboard queries
-- These indexes improve the performance of the dashboard queries
-- by allowing the database to filter and sort without scanning all rows.

-- Dashboard: today's revenue query (Sale.status = 'COMPLETED' AND Sale.createdAt BETWEEN)
CREATE INDEX IF NOT EXISTS "Sale_status_createdAt_idx" ON "Sale" ("status", "createdAt");

-- Dashboard: pending credit query (Sale.status IN ('COMPLETED','PARTIALLY_RETURNED') AND Sale.saleType IN ('CREDIT','PARTIAL') AND Sale.pendingAmount > 0)
CREATE INDEX IF NOT EXISTS "Sale_status_saleType_pendingAmount_idx" ON "Sale" ("status", "saleType", "pendingAmount");

-- Dashboard: recent sales query (Sale.status = 'COMPLETED' ORDER BY createdAt DESC LIMIT 8)
-- The Sale_status_createdAt_idx above already covers this.

-- Dashboard: overdue query (Sale.pendingAmount > 0 AND customer.isActive = true AND customer.deletedAt IS NULL)
-- The existing Sale_status_saleType_pendingAmount_idx covers the Sale side.
-- Customer already has indexes on isActive and deletedAt individually.

-- Dashboard: low stock query (Product.stockQuantity <= 5 AND Product.isActive = true)
CREATE INDEX IF NOT EXISTS "Product_stockQuantity_isActive_idx" ON "Product" ("stockQuantity", "isActive");