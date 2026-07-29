import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function run() {
  console.log("Testing batch creation...");
  const idempotencyKey = `test-${Date.now()}`;
  
  // Create payment batch
  const batch1 = await prisma.bulkEntryBatch.create({
    data: {
      batchReference: `TEST-PAY-${Date.now()}`,
      batchType: "PAYMENT",
      entryDate: new Date(),
      defaultPaymentMode: "CASH",
      notes: "Test Payment",
      rowCount: 1,
      totalAmount: 100,
      status: "POSTED",
      idempotencyKey: idempotencyKey + "-1",
      createdById: (await prisma.user.findFirst())!.id,
    }
  });
  console.log("Payment batch created:", batch1.batchType);

  // Create manual adjustment batch
  const batch2 = await prisma.bulkEntryBatch.create({
    data: {
      batchReference: `TEST-ADJ-${Date.now()}`,
      batchType: "MANUAL_ADJUSTMENT",
      entryDate: new Date(),
      notes: "Test Adj",
      rowCount: 1,
      totalAmount: 200,
      status: "POSTED",
      idempotencyKey: idempotencyKey + "-2",
      createdById: (await prisma.user.findFirst())!.id,
    }
  });
  console.log("Manual Adj batch created:", batch2.batchType);

  // Test duplicate (idempotency key)
  try {
    await prisma.bulkEntryBatch.create({
      data: {
        batchReference: `TEST-DUP-${Date.now()}`,
        batchType: "MANUAL_ADJUSTMENT",
        entryDate: new Date(),
        rowCount: 1,
        totalAmount: 200,
        status: "POSTED",
        idempotencyKey: idempotencyKey + "-2", // duplicate
        createdById: (await prisma.user.findFirst())!.id,
      }
    });
    console.error("Duplicate allowed! Error!");
  } catch(e: any) {
    if (e.code === 'P2002') {
      console.log("Duplicate blocked successfully by idempotencyKey.");
    } else {
      console.error("Unexpected error:", e);
    }
  }

  // Cleanup
  await prisma.bulkEntryBatch.delete({ where: { id: batch1.id } });
  await prisma.bulkEntryBatch.delete({ where: { id: batch2.id } });
  console.log("Tests done and cleaned up.");
}

run().catch(console.error).finally(() => prisma.$disconnect());
