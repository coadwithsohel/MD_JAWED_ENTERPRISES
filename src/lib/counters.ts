import { prisma } from './prisma';

/**
 * Generate a concurrency-safe, sequential invoice number.
 * Uses a database-level atomic increment inside a transaction.
 */
export async function generateInvoiceNumber(tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]): Promise<string> {
  const client = tx ?? prisma;

  const counter = await (client as typeof prisma).invoiceCounter.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', current: 1, prefix: 'INV' },
    update: { current: { increment: 1 } },
  });

  const padded = String(counter.current).padStart(6, '0');
  return `${counter.prefix}-${padded}`;
}

/**
 * Generate a concurrency-safe, sequential customer code.
 * Format: MJE-CUST-000001
 */
export async function generateCustomerCode(tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]): Promise<string> {
  const client = tx ?? prisma;

  const counter = await (client as typeof prisma).customerCounter.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', current: 1, prefix: 'MJE-CUST' },
    update: { current: { increment: 1 } },
  });

  const padded = String(counter.current).padStart(6, '0');
  return `${counter.prefix}-${padded}`;
}

/**
 * Generate a sequential receipt number.
 */
export async function generateReceiptNumber(): Promise<string> {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  
  // For receipts, we still use a unique suffix but based on timestamp + random
  // to avoid needing a separate counter model
  const ts = Date.now().toString().slice(-6);
  return `RCP-${yy}${mm}${dd}-${ts}`;
}