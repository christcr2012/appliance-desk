# T-6a2 — filing periods, reminders, owner alerts and calendar file

Base branch: final reviewed T-6a1 · Risk area: automation + owner notifications · Migration: none · Budget estimate: ~450 production lines / <14 files
Design: `docs/designs/BATCH-T.md` sections 11.4 filing-reminders/calendar-file, 11.6, 11.8, 11.11 reminder items (reasons only — this card is the build spec)

## Read only these (in this order)
1. `src/domains/tax/filing-calendar.ts` from T-6a1.
2. `src/app/api/cron/tax-rate-changes/route.ts` and `tests/tax-rate-cron-route.test.ts`.
3. `src/domains/automation/runs.ts`, `src/domains/automation/health.ts`.
4. `src/domains/messaging/deliver.ts` and one current internal Owner/team email helper.
5. `src/domains/exceptions/index.ts`, `src/domains/exceptions/rules.ts` — Sales-tax Today conventions.
6. BATCH-T 11.4 filing-reminders/calendar-file, 11.6 and 11.11 only.

## Before you start
- T-6a1 migration is merged; `TaxFilingAccount` and `TaxFilingPeriod` have the carded fields.
- Existing `tax-rate-changes` cron remains authenticated and wrapped with `runAutomation`.
- No new Vercel cron will be created.

## Build

### Owner alert helper
Create `src/domains/messaging/owner-alerts.ts`:
```ts
export async function sendOwnerAlert(input: {
  key: string;
  subject: string;
  text: string;
  href: string;
}): Promise<void>;
```
Use the existing durable `MessageDelivery` ledger, EMAIL / TRANSACTIONAL / template `owner-alert`, one delivery per active OWNER login email. `input.key` is the logical alert key; derive the actual ledger key per recipient as `${input.key}:owner:${ownerUserId}` so multiple active owners each receive exactly one durable delivery and retries remain idempotent. Preview/non-production protection stays in the existing transport. Never include customer PII.

### Filing reminder automation
Create `src/domains/tax/filing-reminders.ts`:
```ts
export type FilingReminderRun = {
  periodsCreated: number;
  emailsQueued: number;
  licenseAlerts: number;
  amendmentsDetected: number;
};
export async function runTaxFilingCalendar(now?: Date): Promise<FilingReminderRun>;
```
For active filing accounts:
- create missing periods through the period containing today using `periodsFor`; idempotent on `[filingAccountId, periodStart]`;
- store plain `dueOn` and computed `legalDueOn`;
- do not create periods/reminders before `firstPeriodStart`;
- for OPEN closed periods send each computed stage once using `tax-reminder:<periodId>:<stage>`; OVERDUE repeats every third Denver date with the date in the key;
- email only when `emailReminders` is true;
- license reminders at 60/30/7 days and every third overdue day using deterministic keys;
- amendment detection hook is an exported no-op-safe seam until T-6b2 supplies packet comparison:
```ts
export type FilingAmendmentDetector = (now: Date) => Promise<number>;
export function __setFilingAmendmentDetectorForTests(detector: FilingAmendmentDetector | null): void;
```
Production default returns 0; T-6b2 replaces it with the real detector without changing the scheduler.

Extend `src/app/api/cron/tax-rate-changes/route.ts` with a second independent `runAutomation({ ruleKey: "tax-filing-calendar" })`; return both outcomes. One rule failure must not suppress the other. Register `tax-filing-calendar` in automation health. No new cron.

### Today items
Extend the existing Sales-tax exception feed:
- `TAX_RETURN_DUE`: OPEN period after period end; medium, high from nearest reminder window and overdue; zero-return wording when applicable; OWNER/ADMIN visible only.
- `TAX_LICENSE_RENEWAL`: visible from 60 days before expiry until expiry is replaced.
These are computed, never stored/dismissed. ADMIN gets read-only wording. T-6b2 adds amendment/not-ready items.

### Calendar file
Create `src/domains/tax/calendar-file.ts`:
```ts
export function buildTaxFilingIcs(
  periods: Array<{ accountName: string; dueOn: Date }>,
  licenses: Array<{ accountName: string; expiresOn: Date }>,
): string;
```
Valid ICS; Denver all-day dates; alarms 7 and 1 days before due dates; license renewal events. No secret subscription URL.

## Tests
- ★ `tests/tax-filing-reminders-integration.test.ts`: creates periods once; stages once; no overdue before legal due date; three-day overdue cadence; email switch OFF; preview never sends; **two active OWNER users receive separate recipient-specific idempotent deliveries**; license cadence; failures isolated; ADMIN cannot mutate.
- `tests/tax-rate-cron-route.test.ts`: both rule keys, auth unchanged, one rule failure does not fail the other.
- `tests/exceptions-tax.test.ts`: return appears day after close, severity switches, FILED removes, zero-return wording, license renewal.
- `tests/tax-calendar-file.test.ts`: valid calendar/events/alarms/DST-safe all-day dates.

## Commands
- `npm run typecheck 2>&1 | tail -40`
- `npm run lint 2>&1 | tail -40`
- `npx vitest run tests/tax-filing-reminders-integration.test.ts tests/tax-rate-cron-route.test.ts tests/exceptions-tax.test.ts tests/tax-calendar-file.test.ts 2>&1 | tail -100`

## Stop and ask if
- Owner/team-member email cannot use the current delivery ledger without adding a new provider.
- A reminder requires customer data or a new cron.

## Done when
- [ ] periods/reminders/license alerts are durable and idempotent
- [ ] Today filing/license items are computed and permission-correct
- [ ] calendar download content is deterministic
- [ ] existing tax-rate cron still runs independently
- [ ] `docs/STATUS.md` updated; review threads dispositioned
