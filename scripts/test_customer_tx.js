const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const crypto = require('crypto');

async function generateCustomerCode(tx) {
  // simplified
  return 'TEST-' + crypto.randomBytes(4).toString('hex');
}

async function testCustomerCreate() {
  const data = {
    fullName: 'BUG TEST CUSTOMER 4',
    mobile: '9999988885',
    alternateMobile: null,
    email: null,
    address: null,
    city: null,
    state: null,
    pinCode: null,
    notes: null,
    creditLimit: 0,
    openingBalance: 0,
  };
  const normalizedMobile = data.mobile;
  const auth = { userId: 'cmrw6v9fe0000szr9zhxj1999' };

  try {
    const customer = await prisma.$transaction(async (tx) => {
      const customerCode = await generateCustomerCode(tx);

      const newCustomer = await tx.customer.create({
        data: {
          customerCode,
          fullName: data.fullName,
          mobile: data.mobile,
          normalizedMobile,
          alternateMobile: data.alternateMobile || null,
          email: data.email || null,
          address: data.address || null,
          city: data.city || null,
          state: data.state || null,
          pinCode: data.pinCode || null,
          notes: data.notes || null,
          creditLimit: data.creditLimit,
          openingBalance: data.openingBalance,
          currentBalance: data.openingBalance,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: auth.userId,
          action: "CREATE",
          entityType: "Customer",
          entityId: newCustomer.id,
          newData: {
            customerCode,
            fullName: data.fullName,
            mobile: data.mobile,
          },
        },
      });

      return newCustomer;
    });
    console.log('Success:', customer.id);
  } catch (e) {
    console.error('Error in transaction:', e);
  }
}

testCustomerCreate().finally(() => prisma.$disconnect());
