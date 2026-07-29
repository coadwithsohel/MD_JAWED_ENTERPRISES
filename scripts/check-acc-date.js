const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const entries = await prisma.creditLedger.findMany({ 
    where: { transactionType: { in: ['CREDIT_SALE', 'PAYMENT_RECEIVED'] } },
    take: 5, 
    include: { sale: true, payment: true } 
  });
  for (const entry of entries) {
    console.log(`Type: ${entry.transactionType}, AccDate: ${entry.accountingDate}, SaleDate: ${entry.sale?.saleDate}, PaymentDate: ${entry.payment?.paymentDate}`);
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
