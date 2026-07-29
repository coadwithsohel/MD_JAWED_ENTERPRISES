require('dotenv').config();
const jwt = require('jsonwebtoken');
const http = require('http');

const secret = process.env.AUTH_SECRET;
const token = jwt.sign({
  userId: 'cmrw6v9fe0000szr9zhxj1999',
  role: 'OWNER',
  mobile: '7020231921'
}, secret, { expiresIn: '7d' });

const cookie = `mdjaved_session=${token}`;

const data = JSON.stringify({
  fullName: "BUG TEST CUSTOMER 3",
  mobile: "9999988886",
  creditLimit: 0,
  openingBalance: 0
});

const req = http.request({
  hostname: 'localhost',
  port: 3000,
  path: '/api/customers',
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
    console.log('CREATE STATUS:', res.statusCode);
    console.log('CREATE BODY:', body);
  });
});
req.write(data);
req.end();
