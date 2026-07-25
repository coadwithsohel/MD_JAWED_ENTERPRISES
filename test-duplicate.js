const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('--- DUPLICATE TEST ---');
  
  // Get counts before
  const salesCountBefore = await prisma.sale.count();
  const paymentsCountBefore = await prisma.payment.count();
  console.log('Sale count before:', salesCountBefore);
  console.log('Payment count before:', paymentsCountBefore);

  // Find a sale to edit (if any exist)
  const sale = await prisma.sale.findFirst();
  if (sale) {
    console.log('Editing Sale ID:', sale.id);
    // Simulate what the PATCH route does: update the record
    await prisma.sale.update({
      where: { id: sale.id },
      data: { notes: 'Edit test ' + Date.now() }
    });
  }

  // Find a payment to edit
  const payment = await prisma.payment.findFirst();
  if (payment) {
    console.log('Editing Payment ID:', payment.id);
    await prisma.payment.update({
      where: { id: payment.id },
      data: { notes: 'Edit test ' + Date.now() }
    });
  }

  // Get counts after
  const salesCountAfter = await prisma.sale.count();
  const paymentsCountAfter = await prisma.payment.count();
  console.log('Sale count after:', salesCountAfter);
  console.log('Payment count after:', paymentsCountAfter);

  if (salesCountBefore === salesCountAfter && paymentsCountBefore === paymentsCountAfter) {
    console.log('RESULT: record counts remain unchanged.');
  } else {
    console.log('RESULT: duplicates were created!');
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
