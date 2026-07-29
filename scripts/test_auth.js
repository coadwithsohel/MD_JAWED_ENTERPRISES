const http = require('http');

const loginData = JSON.stringify({
  mobile: '9999999999',
  password: 'password123'
});

const req = http.request({
  hostname: 'localhost',
  port: 3000,
  path: '/api/auth/login',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': loginData.length
  }
}, (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    console.log('LOGIN STATUS:', res.statusCode);
    const cookie = res.headers['set-cookie'] ? res.headers['set-cookie'][0] : null;
    if (cookie) {
      testCreate(cookie);
    } else {
      console.log('NO COOKIE:', body);
    }
  });
});
req.write(loginData);
req.end();

function testCreate(cookie) {
  const data = JSON.stringify({
    fullName: "BUG TEST CUSTOMER 2",
    mobile: "9999988887",
    creditLimit: 0,
    openingBalance: 0
  });

  const req2 = http.request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/customers',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data.length,
      'Cookie': cookie
    }
  }, (res2) => {
    let body2 = '';
    res2.on('data', chunk => body2 += chunk);
    res2.on('end', () => {
      console.log('CREATE STATUS:', res2.statusCode);
      console.log('CREATE BODY:', body2);
    });
  });
  req2.write(data);
  req2.end();
}
