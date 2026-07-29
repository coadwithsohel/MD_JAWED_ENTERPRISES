const fs = require('fs');

const routePath = 'src/app/api/customers/route.ts';
let code = fs.readFileSync(routePath, 'utf8');

// replace the catch block
code = code.replace(
  /return NextResponse\.json\(\{ error: "Server error" \}, \{ status: 500 \}\);/,
  'return NextResponse.json({ error: "Server error", detail: err.message, stack: err.stack }, { status: 500 });'
);

fs.writeFileSync(routePath, code);
console.log('Patched route.ts');
