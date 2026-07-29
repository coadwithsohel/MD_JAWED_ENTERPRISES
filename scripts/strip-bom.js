const fs = require('fs');
let text = fs.readFileSync('prisma/schema.prisma', 'utf8');
if (text.charCodeAt(0) === 0xFEFF) {
  text = text.slice(1);
}
fs.writeFileSync('prisma/schema.prisma', text, 'utf8');
