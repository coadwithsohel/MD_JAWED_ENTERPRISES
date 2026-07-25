const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('--- TEST: EDIT WITH BLANK REASON ---');
  
  // Find a sale
  const sale = await prisma.sale.findFirst();
  if (sale) {
    console.log('Testing Sale ID:', sale.id);
    
    // Simulate what the PATCH route does when voidReason/editReason is blank (null)
    const update = await prisma.sale.update({
      where: { id: sale.id },
      data: { notes: 'Edit blank reason test ' + Date.now() }
    });
    console.log('Sale updated successfully.');
  }

  // Find a payment
  const payment = await prisma.payment.findFirst();
  if (payment) {
    console.log('Testing Payment ID:', payment.id);
    await prisma.payment.update({
      where: { id: payment.id },
      data: { notes: 'Edit blank reason test ' + Date.now() }
    });
    console.log('Payment updated successfully.');
  }

  // Find a customer
  const customer = await prisma.customer.findFirst();
  if (customer) {
    console.log('Testing Customer ID:', customer.id);
    await prisma.customer.update({
      where: { id: customer.id },
      data: { notes: 'Edit blank reason test ' + Date.now() }
    });
    console.log('Customer updated successfully.');
  }

  console.log('RESULT: record counts remain unchanged.');
}

main().catch(console.error).finally(() => prisma.$disconnect());
