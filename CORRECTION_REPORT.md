# MD JAWED ENTERPRISES — Correction Report

## Fixed
- Customer CSV import now preserves negative opening balances.
- Customer API accepts signed opening balances and creates opening-balance ledger entries for both debit and credit openings.
- Transaction final import sends only the created batch ID instead of preview sample rows.
- Transaction import loads every staged voucher from the batch.
- Duplicate detection excludes the current staging batch.
- Staged Tally vouchers are promoted to imported status instead of creating duplicate voucher rows.
- Permanent deletion no longer treats import rows or staged Tally vouchers as financial history.
- Empty-customer deletion detaches nullable import metadata and processes customers in chunks of 50.
- Removed unused customer import-batch removal APIs and the debug API.
- Removed unused imports, props, variables, and dead helper code reported by ESLint.

## Verification
- `npm run lint`: passed with zero errors and zero warnings.
- Prisma validation/generation could not complete in the workspace because the Prisma binary server was unavailable.
- Next production build could not complete because the SWC package download returned HTTP 503.

## Before production deployment
Run locally with internet access:

```bash
npm install
npx prisma validate
npx prisma generate
npm run lint
npm run build
```

Rotate the Neon database password and AUTH_SECRET because environment credentials were included in the original archive.
