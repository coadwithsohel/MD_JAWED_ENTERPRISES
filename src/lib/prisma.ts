import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  (new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  }).$extends({
    query: {
      $allModels: {
        async $allOperations({ operation, model, args, query }) {
          const isRead = ["findUnique", "findFirst", "findMany", "count", "aggregate", "groupBy"].includes(operation);
          if (!isRead) return query(args);
          
          let attempt = 0;
          const maxRetries = 2;
          while (attempt <= maxRetries) {
            try {
              return await query(args);
            } catch (error: any) {
              const isConnectionError =
                error?.code === "P2010" ||
                error?.code === "P2024" ||
                error?.code === "P2028" ||
                error?.message?.includes("57P01") ||
                error?.message?.includes("terminating connection due to administrator command") ||
                error?.message?.includes("Connection pool is full");

              if (!isConnectionError || attempt >= maxRetries) {
                throw error;
              }
              attempt++;
              const delay = Math.pow(2, attempt - 1) * 500;
              console.warn(`[db-retry] Database read error (attempt ${attempt}/${maxRetries}) on ${model || 'unknown'}.${operation}. Retrying in ${delay}ms...`);
              await new Promise((resolve) => setTimeout(resolve, delay));
            }
          }
        }
      }
    }
  }) as unknown as PrismaClient);

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

// Graceful shutdown — drain the pool on server restart
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});