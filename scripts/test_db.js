const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Test Customer Create
  try {
    const customer = await prisma.customer.create({
      data: {
        customerCode: 'TEST-001',
        fullName: 'BUG TEST CUSTOMER',
        mobile: '9999988888',
        normalizedMobile: '9999988888',
        creditLimit: 0,
        openingBalance: 0,
        currentBalance: 0,
      }
    });
    console.log('Customer created directly:', customer.id);
  } catch (e) {
    console.error('Customer create error:', e.message);
  }

  // Find an admin user
  const user = await prisma.user.findFirst();
  console.log('User role:', user.role);
}

main().catch(console.error).finally(() => prisma.$disconnect());
