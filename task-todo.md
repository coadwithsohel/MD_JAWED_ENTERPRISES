# Overdue Logic Fix - Todo List

## Analysis Phase
- [x] Read existing overdue.ts logic
- [x] Read accounting.ts (shared helpers)
- [x] Read schema.prisma (data model)
- [x] Read dashboard page.tsx (overdue usage)
- [x] Read overdue-customers page (frontend)
- [x] Read tally import route (bill date mapping)
- [x] Read API routes (overdue, count)

## Implementation Phase
- [ ] Fix `src/lib/accounting.ts` - Add `getOverdueDate(billDate)` shared helper with addDays(15)
- [ ] Fix `src/lib/overdue.ts` - Rewrite `getOverdueSalesAggregated()` to use billDate + 15 days, not dueDate or defaultCreditDays
- [ ] Fix `src/lib/overdue.ts` - Fix `daysBetween` to use date-only comparisons, not time-based
- [ ] Fix `src/lib/overdue.ts` - Use `startOfToday > overdueDate` (complete-15-days rule)
- [ ] Fix FIFO allocation in `accounting.ts` to match loan-style allocation rules
- [ ] Fix `src/lib/overdue.ts` - Zero-safe frontend updates in response
- [ ] Create `scripts/audit-15-day-overdue.ts` - Audit script
- [ ] Create tests for 6 required test cases
- [ ] Add refresh after import/payment endpoints

## Verification Phase
- [ ] `npx prisma validate`
- [ ] `npx prisma generate`
- [ ] `npm run lint`
- [ ] `npx tsc --noEmit`
- [ ] `npm run build`