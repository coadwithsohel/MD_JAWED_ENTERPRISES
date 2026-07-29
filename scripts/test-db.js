const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findFirst();
  const userId = user ? user.id : null;

  const testCustomer = await prisma.customer.findFirst({
    where: { currentBalance: { gt: 0 }, isActive: true }
  });

  if (testCustomer) {
    console.log("Test Customer:", testCustomer.fullName, testCustomer.currentBalance);
    
    // Partial backdated payment
    const backdated = new Date();
    backdated.setDate(backdated.getDate() - 2);
    backdated.setHours(0,0,0,0);
    
    const paymentAmt = 50;
    
    await prisma.$transaction(async (tx) => {
      const p = await tx.payment.create({
        data: {
          receiptNumber: "T-" + Date.now(),
          customerId: testCustomer.id,
          amount: paymentAmt,
          paymentMode: 'CASH',
          paymentDate: backdated,
          receivedById: userId
        }
      });
      await tx.customer.update({
        where: { id: testCustomer.id },
        data: { currentBalance: Number(testCustomer.currentBalance) - paymentAmt }
      });
      await tx.creditLedger.create({
        data: {
          customerId: testCustomer.id,
          paymentId: p.id,
          transactionType: 'PAYMENT_RECEIVED',
          amount: paymentAmt,
          balanceAfter: Number(testCustomer.currentBalance) - paymentAmt,
          accountingDate: backdated
        }
      });
    });

    console.log("Recorded 50 payment backdated to", backdated);
    
    // Zero balance test
    const zeroCust = await prisma.customer.findFirst({ where: { currentBalance: { gt: 0 }, isActive: true } });
    if (zeroCust) {
      await prisma.$transaction(async (tx) => {
        const p = await tx.payment.create({
          data: {
            receiptNumber: "Z-" + Date.now(),
            customerId: zeroCust.id,
            amount: zeroCust.currentBalance,
            paymentMode: 'CASH',
            paymentDate: new Date(),
            receivedById: userId
          }
        });
        await tx.customer.update({
          where: { id: zeroCust.id },
          data: { currentBalance: 0 }
        });
        await tx.creditLedger.create({
          data: {
            customerId: zeroCust.id,
            paymentId: p.id,
            transactionType: 'PAYMENT_RECEIVED',
            amount: zeroCust.currentBalance,
            balanceAfter: 0,
            accountingDate: new Date()
          }
        });
      });
      console.log("Cleared balance for", zeroCust.fullName);
    }
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
