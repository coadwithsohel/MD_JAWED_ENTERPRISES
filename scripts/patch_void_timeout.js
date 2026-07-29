const fs = require('fs');

const routePath = 'src/app/api/invoices/[id]/void/route.ts';
let code = fs.readFileSync(routePath, 'utf8');

// replace the transaction options
code = code.replace(
  /const result = await prisma\.\$transaction\(async \(tx\) => \{/,
  'const result = await prisma.$transaction(async (tx) => {'
);

// wait, it's better to just replace the end of it
code = code.replace(
  /\s*return voidedSale;\n\s*\}\);\n/,
  '\n      return voidedSale;\n    }, {\n      maxWait: 5000,\n      timeout: 30000,\n    });\n'
);

fs.writeFileSync(routePath, code);
console.log('Added timeout to void transaction');
