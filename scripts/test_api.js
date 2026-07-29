const http = require('http');

const data = JSON.stringify({
  fullName: "BUG TEST CUSTOMER",
  mobile: "9999988888",
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
    'Content-Length': data.length
    // NO COOKIE - we want to see if it's a 401 or something else
  }
}, (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    console.log('STATUS:', res.statusCode);
    console.log('BODY:', body);
  });
});

req.on('error', (e) => console.error(e));
req.write(data);
req.end();
