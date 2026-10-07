# T-5b1 — official-rate metadata and source registry

Base branch: main · Risk area: tax metadata persistence · Migration: `20261007193000_t5b_official_rate_metadata` · Budget estimate: ~320 production lines / 7 files
Design: `docs/designs/BATCH-T.md` sections 13.2–13.3 (schema/persistence only) and 13.5 (reasons only — this card is the build spec)

## Read only these (in this order)
1. `prisma/schema.prisma` — `grep -n "model TaxRateVersion\|model TaxJurisdiction\|model BusinessSettings\|enum TaxRateSource" prisma/schema.prisma`
2. `src/domains/tax/rate-changes.ts` — exports `subscriptionTaxUpdateKey`, `syncSubscriptionTaxRatesForAgreement`, `applyTaxRateChanges`
3. `src/domains/tax/address-recheck.ts` — exports only; do not change behavior in this PR
4. `src/domains/tax/colorado-gis.ts` — source seam and automatic-source gate
5. `src/domains/backup/manifest.ts` — `BACKUP_MODEL_POLICY` entries for new business-data tables
6. `scripts/verify-schema-health.ts` — generated scalar/table verification contract
7. `docs/DATABASE.md` — Batch T table documentation style
8. `tests/helpers/tax-ready.ts` — tax fixture conventions
9. `docs/designs/BATCH-T.md` — only headings 13.2, 13.3 and 13.5

## Before you start (verify; if false, stop and report)
- #291, #295, #296 and #297 are merged to `main`; T-5/WU-T6 must exist before T-5b starts.
- `TaxRateVersion` still has `rateMilliPercent`, `effectiveFrom`, `source`, `stripeTaxRateId`.
- `BusinessSettings` is still singleton-backed and has no fields named `autoApplyOfficialRateChanges` or `autoRateChangeMaxMilliPercent`.
- No model named `TaxRateObservation` or `OfficialSourceWatch` exists.
- The migration name above is unused.
- Do not activate any official-source row in this PR.

## Build

### Schema
In `prisma/schema.prisma` add exactly:

- `TaxRateVersion.autoApplied Boolean @default(false)`
- `TaxRateVersion.autoAppliedUndoneAt DateTime?`
- `BusinessSettings.autoApplyOfficialRateChanges Boolean @default(true)`
- `BusinessSettings.autoRateChangeMaxMilliPercent Int @default(1000)`

Add:

```prisma
model TaxRateObservation {
  id               String          @id @default(cuid())
  jurisdictionId   String
  jurisdiction     TaxJurisdiction @relation(fields: [jurisdictionId], references: [id])
  asOf             DateTime
  rateMilliPercent Int
  observedAt       DateTime        @default(now())

  @@index([jurisdictionId, asOf])
  @@index([observedAt])
}
```

Add `TaxJurisdiction.rateObservations TaxRateObservation[]`.

Add:

```prisma
model OfficialSourceWatch {
  id                  String   @id @default(cuid())
  label               String
  url                 String   @unique
  active              Boolean  @default(true)
  lastHash            String?
  lastText            String?
  lastExcerpt         String?
  lastCheckedAt       DateTime?
  lastChangedAt       DateTime?
  lastError           String?
  consecutiveFailures Int      @default(0)
  reviewedAt          DateTime?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
}
```

Migration `20261007193000_t5b_official_rate_metadata` is additive only. It must:
- add the fields/models/indexes above;
- leave existing rate versions/settings untouched except Prisma defaults;
- seed the six rows below with `active = false` and no hash/text/check timestamps:

| label | url |
|---|---|
| Colorado — Sales Tax Rate Changes | `https://tax.colorado.gov/sales-tax-rate-changes` |
| Colorado — DR 1002 | `https://tax.colorado.gov/DR1002` |
| Colorado — Retail Delivery Fee | `https://tax.colorado.gov/retail-delivery-fee` |
| Colorado — SUTS Participating Jurisdictions | `https://tax.colorado.gov/SUTS-Jurisdictions` |
| Colorado — Sales Tax Changes | `https://tax.colorado.gov/sales-tax-changes` |
| City of Greeley — Sales Tax | `https://greeleyco.gov/business/business-operations/sales-tax/` |

The implementation PR must verify each URL still resolves before changing any seed to `active = true`. If one does not resolve, keep it inactive and record the result in `docs/STATUS.md`; do not guess a replacement.

### Functions
Create `src/domains/tax/official-rate-metadata.ts`.

Export:

```ts
export type TaxRateObservationInput = {
  jurisdictionId: string;
  asOf: Date;
  rateMilliPercent: number;
  observedAt?: Date;
};

export async function recordTaxRateObservationInTx(
  tx: Prisma.TransactionClient,
  input: TaxRateObservationInput,
): Promise<{ id: string }>;

export async function hasTwoDayRateConfirmationInTx(
  tx: Prisma.TransactionClient,
  input: {
    jurisdictionId: string;
    asOf: Date;
    rateMilliPercent: number;
    now: Date;
  },
): Promise<boolean>;

export async function pruneTaxRateObservationsInTx(
  tx: Prisma.TransactionClient,
  now: Date,
): Promise<number>;

export async function listActiveOfficialSourceWatches(): Promise<
  Array<{
    id: string;
    label: string;
    url: string;
    lastHash: string | null;
    lastText: string | null;
    lastCheckedAt: Date | null;
    consecutiveFailures: number;
  }>
>;
```

Rules:
- Validate `rateMilliPercent >= 0`; invalid input throws before a write.
- `recordTaxRateObservationInTx` is idempotent for the same jurisdiction + `asOf` + rate + Colorado calendar day of `observedAt`; repeated address lookups on one day must not manufacture the two-day proof.
- `hasTwoDayRateConfirmationInTx` returns true only when the same jurisdiction/`asOf`/rate has observations on at least two distinct `America/Denver` calendar dates at or before `now`.
- `pruneTaxRateObservationsInTx` deletes observations whose `observedAt` Colorado date is more than one year before `now`; use existing business-date helpers, not fixed 24-hour arithmetic.
- Source-watch listing is read-only and returns only `active = true`, ordered by label then id.

Add `TaxRateObservation` and `OfficialSourceWatch` to `BACKUP_MODEL_POLICY` as included business data. Keep schema-health coverage complete and document both models plus the new settings/rate-version columns in `docs/DATABASE.md`.

No network fetch, auto-apply, Today item, email or Owner screen in this PR.

## Tests
- `tests/tax-official-rate-metadata-integration.test.ts`:
  - "defaults official-rate auto apply on with a 1000 milli-percent guardrail"
  - "records repeated same-day observations idempotently"
  - "requires the same rate on two distinct Colorado dates for confirmation"
  - "does not confirm two different candidate rates"
  - "prunes observations older than one Colorado year boundary"
  - "seeds the six official sources inactive with unique URLs"
- Backup/schema coverage must continue to enumerate every Prisma model; the two new models are explicitly included, not left to an `if needed` follow-up.

## Commands
- `npm run typecheck 2>&1 | tail -40`
- `npm run lint 2>&1 | tail -40`
- `npx vitest run tests/tax-official-rate-metadata-integration.test.ts 2>&1 | tail -80`
- run the repository migration drill / backup-manifest / schema-health checks that cover `BACKUP_MODEL_POLICY` and `scripts/verify-schema-health.ts`

## Stop and ask if
- WU-T6 is not merged.
- Any requested migration change would alter or backfill an existing tax amount.
- A seed URL cannot be verified and someone proposes guessing a replacement.
- The two-day proof would require storing customer addresses or other PII in `TaxRateObservation`.

## Done when
- [ ] additive migration applies cleanly on the real-Postgres test database
- [ ] two distinct Colorado observation days are required and proven by test
- [ ] rows older than one year are pruned by test
- [ ] all six source rows exist inactive and no network call occurs from this PR
- [ ] both new business-data models are explicitly backed up, schema-health checked, and documented in `docs/DATABASE.md`
- [ ] `docs/STATUS.md` records T-5b1 and URL verification results; review threads dispositioned
