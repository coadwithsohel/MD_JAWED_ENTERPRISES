const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const customers = await prisma.customer.findMany({
    where: { customerCode: { startsWith: 'MJE-CUST-' } },
    select: { customerCode: true }
  });
  
  let maxNum = 0;
  for (const c of customers) {
    const numStr = c.customerCode.replace('MJE-CUST-', '');
    const num = parseInt(numStr, 10);
    if (!isNaN(num) && num > maxNum) {
      maxNum = num;
    }
  }
  console.log('Max MJE-CUST number:', maxNum);
  
  if (maxNum > 0) {
    await prisma.customerCounter.upsert({
       where: { id: 'singleton' },
       create: { id: 'singleton', current: maxNum, prefix: 'MJE-CUST' },
       update: { current: maxNum }
    });
    console.log('Updated counter to', maxNum);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
