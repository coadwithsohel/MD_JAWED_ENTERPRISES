import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

// ─── Neon Pooler Configuration ──────────────────────────────────────────
// With pgbouncer=true, prepared statements must be disabled because
// PgBouncer transaction mode does not support PREPARE/DEALLOCATE.
// Setting prepare: false prevents connection pool exhaustion from
// stale prepared statements accumulating across pool connections.
export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

// Graceful shutdown — drain the pool on server restart
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});