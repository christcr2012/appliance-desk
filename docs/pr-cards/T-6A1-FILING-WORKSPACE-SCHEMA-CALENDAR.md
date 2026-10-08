# T-6a1 — filing workspace schema and Colorado calendar

Base branch: main after T-5b3 merges · Risk area: schema + filing dates · Migration: `20261010120000_batch_t_filing_workspace` · Budget estimate: ~350 production/schema lines / <12 files
Design: `docs/designs/BATCH-T.md` sections 3.5, 11.3–11.4, 11.12–11.13 (reasons only — this card is the build spec)

## Read only these (in this order)
1. `prisma/schema.prisma` — `TaxFilingAccount`, `TaxJurisdiction`, `TaxFilingPeriod`, `PurchaseUseTax`.
2. `src/lib/business-date.ts` — Denver date primitives.
3. `src/domains/backup/manifest.ts` and the current schema-health file named by `scripts/verify-schema-health.ts`.
4. `tests/tax-migration-integration.test.ts` — current Batch T migration conventions.
5. BATCH-T 11.3, 11.4 calendar paragraph, 11.12 schema, 11.13 setup fields only.

## Before you start
- T-5b3 is merged and main is green.
- No newer migration already uses `20261010120000_batch_t_filing_workspace`; if the timestamp conflicts, keep the suffix and choose the next sortable timestamp.
- This PR is additive only; no live provider setting changes.

## Build

### Schema
Add:
```prisma
enum TaxFilingAccountKind { SALES_RETURN USE_TAX_RETURN }
enum TaxAmendmentStatus { OPEN FILED HANDLED_OUTSIDE }
```

Extend `TaxFilingAccount`:
- `kind TaxFilingAccountKind @default(SALES_RETURN)`
- `firstPeriodStart DateTime?`
- `licenseExpiresOn DateTime?`
- `reminderDaysBefore Int[] @default([7, 2])`
- `emailReminders Boolean @default(true)`
- `deductionLabels Json @default("{}")`
- `screenLabels Json @default("{}")`
- `filingNotes String?`
- `excelUploadAvailable Boolean?`
- `bulkXmlAvailable Boolean?`
- `setupCheckedOn DateTime?`
- sales relation named `SalesTaxFilingAccount`; add `useTaxJurisdictions TaxJurisdiction[] @relation("UseTaxFilingAccount")`.

Extend `TaxJurisdiction`:
- keep current `filingAccountId`, naming its relation `SalesTaxFilingAccount`;
- `filingCode String?`
- `filingOrder Int @default(0)`
- `serviceFeeMilliPercent Int @default(0)`
- `useTaxFilingAccountId String?`
- `useTaxFilingAccount TaxFilingAccount? @relation("UseTaxFilingAccount", fields: [useTaxFilingAccountId], references: [id])`.

Extend `TaxFilingPeriod`:
- `legalDueOn DateTime?`
- `dueOnEditedByUserId String?`
- `zeroReturn Boolean @default(false)`
- `paidOn DateTime?`
- `confirmationPhotoId String?`
- `entryProgress Json @default("{}")`
- `amendments TaxFilingAmendment[]`.

Add:
```prisma
model TaxFilingAmendment {
  id                 String             @id @default(cuid())
  periodId           String
  period             TaxFilingPeriod    @relation(fields: [periodId], references: [id])
  sequence           Int
  status             TaxAmendmentStatus @default(OPEN)
  packet             Json
  additionalTaxCents Int
  detectedAt         DateTime           @default(now())
  filedOn            DateTime?
  paidOn             DateTime?
  confirmationNumber String?
  amountPaidCents    Int?
  filedByUserId      String?
  notes              String?
  createdAt          DateTime           @default(now())
  updatedAt          DateTime           @updatedAt
  @@unique([periodId, sequence])
  @@index([status, detectedAt])
}
```

Migration defaults must make existing accounts `SALES_RETURN`, reminders `[7,2]`, email reminders ON, JSON fields empty. Add `TaxFilingAmendment` to backup policy/manifest, schema-health expectations and `docs/DATABASE.md`.

### Pure calendar
Create `src/domains/tax/filing-calendar.ts`:
```ts
export type FilingPeriodRange = { start: Date; end: Date };
export type ReminderStage =
  | "READY"
  | `DUE_IN_${number}`
  | "DUE_TODAY"
  | "DUE_BY_LEGAL"
  | "OVERDUE";

export function periodsFor(
  account: { frequency: "MONTHLY" | "QUARTERLY" | "ANNUAL"; firstPeriodStart: Date | null },
  through: Date,
): FilingPeriodRange[];
export function dueOnFor(periodEnd: Date, dueDayOfFollowingMonth: number): Date;
export function coloradoLegalHolidays(year: number): Date[];
export function legalDueOn(dueOn: Date): Date;
export function reminderStages(
  period: { periodEnd: Date; dueOn: Date; legalDueOn: Date },
  account: { reminderDaysBefore: number[] },
  today: Date,
): ReminderStage[];
```
All calendar boundaries use `America/Denver`. Periods never start before `firstPeriodStart`. Overdue begins only after `legalDueOn`. Re-check the current C.R.S. 24-11-101 holiday list during implementation; do not invent holidays.

## Tests
- `tests/tax-filing-calendar.test.ts`: monthly/quarterly/annual ranges; first-period clipping; due-day calculation; weekends; every Colorado legal holiday 2026–2030; DST edges; reminder stages; no OVERDUE before legal due date.
- `tests/tax-migration-integration.test.ts`: populated upgrade/defaults/new tables/columns.
- backup/schema-health structural tests include the amendment model and new columns.

## Commands
- `npm run typecheck 2>&1 | tail -40`
- `npm run lint 2>&1 | tail -40`
- `npx vitest run tests/tax-filing-calendar.test.ts tests/tax-migration-integration.test.ts 2>&1 | tail -80`

## Stop and ask if
- A required date rule conflicts with current Colorado statute.
- The migration would delete/rename existing data rather than add fields/relations.

## Done when
- [ ] one additive filing-workspace migration is green on populated-upgrade/schema-health/backup checks
- [ ] calendar periods/due dates/reminder stages are Denver-calendar correct
- [ ] no filing email/provider behavior is added
- [ ] `docs/STATUS.md` updated; review threads dispositioned
