const fs = require('fs');
const jwt = require('jsonwebtoken');
const http = require('http');

const envFile = fs.readFileSync('.env', 'utf8');
const secretLine = envFile.split('\n').find(l => l.startsWith('AUTH_SECRET='));
let secret = secretLine ? secretLine.split('=')[1].trim() : '';
if (secret.startsWith('"') && secret.endsWith('"')) {
  secret = secret.slice(1, -1);
}

const token = jwt.sign({
  userId: 'cmrw6v9fe0000szr9zhxj1999',
  role: 'OWNER',
  mobile: '7020231921'
}, secret, { expiresIn: '7d' });

const cookie = `mdjaved_session=${token}`;

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const sale = await prisma.sale.findFirst({
    where: { status: 'COMPLETED' },
    orderBy: { createdAt: 'desc' }
  });

  if (!sale) {
    console.log('No completed sale found');
    return;
  }

  const data = JSON.stringify({
    voidReason: "Test void",
    updatedAt: sale.updatedAt.toISOString()
  });

  console.log(`Testing Void for sale ${sale.id} ...`);

  const req = http.request({
    hostname: 'localhost',
    port: 3000,
    path: `/api/invoices/${sale.id}/void`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data.length,
      'Cookie': cookie
    }
  }, (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
      console.log('VOID STATUS:', res.statusCode);
      console.log('VOID BODY:', body);
    });
  });
  req.write(data);
  req.end();
}

main();
