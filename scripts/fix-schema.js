const fs = require('fs');

let schema = fs.readFileSync('prisma/schema.prisma', 'utf8');

// Fix InvoiceCostAllocation relation in Sale
schema = schema.replace(
  /InvoiceCostAllocation\s+InvoiceCostAllocation\?/g,
  'costAllocation InvoiceCostAllocation?'
);

// Fix BulkEntryBatch relations
schema = schema.replace(
  /User\s+User\s+@relation\(fields: \[createdById\], references: \[id\]\)/g,
  'createdBy User @relation(fields: [createdById], references: [id])'
);
schema = schema.replace(
  /CreditLedger\s+CreditLedger\[\]/g,
  'ledgers CreditLedger[]'
);
schema = schema.replace(
  /Payment\s+Payment\[\]/g,
  'payments Payment[]'
);

// For BulkEntryBatch inside Payment and CreditLedger models, it might be named bulkBatch
schema = schema.replace(
  /BulkEntryBatch\s+BulkEntryBatch\?/g,
  'bulkBatch BulkEntryBatch?'
);

// Fix Expense relations
// It has User @relation(fields: [createdById]) - already covered by regex above

fs.writeFileSync('prisma/schema.prisma', schema);
console.log('Schema fixed!');
