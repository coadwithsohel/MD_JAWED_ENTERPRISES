import { prisma } from "./src/lib/prisma";

async function runChecks() {
  console.log("Running DB health checks...");
  for (let i = 1; i <= 3; i++) {
    console.log(`\n--- Iteration ${i} ---`);
    try {
      const start = Date.now();
      
      // SELECT 1 equivalent
      const sel1 = await prisma.$queryRaw`SELECT 1 as result`;
      console.log("SELECT 1:", sel1);
      
      const custCount = await prisma.customer.count();
      console.log("Customers:", custCount);
      
      const invCount = await prisma.sale.count();
      console.log("Invoices:", invCount);
      
      const payCount = await prisma.payment.count();
      console.log("Payments:", payCount);
      
      console.log(`Iteration ${i} took ${Date.now() - start}ms`);
    } catch (err: any) {
      console.error(`Error in iteration ${i}:`, err?.message || err);
    }
  }
}

runChecks()
  .then(async () => {
    await prisma.$disconnect();
    console.log("Health checks complete.");
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
