import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function verify() {
  console.log("=== RUNTIME VERIFICATION ===");
  const batches = await prisma.bulkEntryBatch.findMany({
    select: { id: true, batchType: true },
    take: 1
  });
  console.log("Found batches:", batches);
  console.log("=== DONE ===");
}
verify().finally(() => prisma.$disconnect());
