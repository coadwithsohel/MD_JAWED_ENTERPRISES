import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  // Create or update owner user
  const hash = await argon2.hash('admin123');
  const user = await prisma.user.upsert({
    where: { mobile: '9999999999' },
    update: { passwordHash: hash, role: 'OWNER', isActive: true },
    create: {
      fullName: 'MD Javed',
      mobile: '9999999999',
      passwordHash: hash,
      role: 'OWNER',
      isActive: true,
    },
  });
  console.log('✅ User:', user.mobile, '| password: admin123 | role:', user.role);

  // Shop settings
  const existing = await prisma.shopSettings.findFirst();
  if (!existing) {
    await prisma.shopSettings.create({
      data: {
        businessName: 'MD Javed Enterprises',
        tagline: 'Mobiles • Electronics • Appliances',
        ownerName: 'Md Javed',
        invoicePrefix: 'INV',
        defaultCreditDays: 15,
        termsAndConditions: 'All goods once sold will not be taken back or exchanged.',
      },
    });
    console.log('✅ Shop settings created');
  } else {
    console.log('✅ Shop settings already exist');
  }

  // Invoice counter
  await prisma.invoiceCounter.upsert({
    where: { id: 'singleton' },
    update: {},
    create: { id: 'singleton', current: 0, prefix: 'INV' },
  });
  console.log('✅ InvoiceCounter ready');

  // Customer counter
  await prisma.customerCounter.upsert({
    where: { id: 'singleton' },
    update: {},
    create: { id: 'singleton', current: 0, prefix: 'MJE-CUST' },
  });
  console.log('✅ CustomerCounter ready');

  // Seed some categories if none exist
  const catCount = await prisma.category.count();
  if (catCount === 0) {
    const cats = ['Mobile Phones', 'Mobile Accessories', 'Home Appliances', 'Electronics', 'Tablets', 'Headphones'];
    for (const name of cats) {
      const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      await prisma.category.upsert({ where: { slug }, update: {}, create: { name, slug } });
    }
    console.log('✅ Categories seeded');
  }

  // Seed brands if none exist
  const brandCount = await prisma.brand.count();
  if (brandCount === 0) {
    const brands = ['Samsung', 'Apple', 'Xiaomi', 'Realme', 'OnePlus', 'Vivo', 'Oppo', 'Nokia', 'Sony', 'LG'];
    for (const name of brands) {
      await prisma.brand.upsert({ where: { name }, update: {}, create: { name } });
    }
    console.log('✅ Brands seeded');
  }

  console.log('\n🎉 Seed complete! Login at http://localhost:3000/login');
  console.log('   Mobile: 9999999999');
  console.log('   Password: admin123');
}

main()
  .catch((e) => { console.error('❌ Seed failed:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
