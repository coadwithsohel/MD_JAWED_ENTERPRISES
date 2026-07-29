const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const maxCustomer = await prisma.customer.findFirst({
    orderBy: { customerCode: 'desc' },
  });
  console.log('Max customer:', maxCustomer?.customerCode);

  const counter = await prisma.customerCounter.findUnique({
    where: { id: 'singleton' }
  });
  console.log('Counter:', counter);

  if (maxCustomer) {
    const maxNum = parseInt(maxCustomer.customerCode.split('-').pop(), 10);
    if (!isNaN(maxNum)) {
       await prisma.customerCounter.upsert({
         where: { id: 'singleton' },
         create: { id: 'singleton', current: maxNum, prefix: 'MJE-CUST' },
         update: { current: Math.max(counter ? counter.current : 0, maxNum) }
       });
       console.log('Synced counter to', maxNum);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
