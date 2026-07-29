const fs = require('fs');

const routePath = 'src/app/api/invoices/[id]/void/route.ts';
let code = fs.readFileSync(routePath, 'utf8');

// replace the catch block
code = code.replace(
  /return NextResponse\.json\(\s*\{\s*error:\s*"Server error voiding invoice"\s*\}\s*,\s*\{\s*status:\s*500\s*\}\s*\);/,
  'return NextResponse.json({ error: "Server error voiding invoice", detail: err.message, stack: err.stack }, { status: 500 });'
);

fs.writeFileSync(routePath, code);
console.log('Patched void route.ts');
