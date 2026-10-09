# S-1B — Bounded source sweep and lifecycle integration

Status: **APPROVED** · Baseline inspected: `b2a06c2` (2026-10-08, #310).
Batch: S · Prerequisites: S-1A.
Base: latest merged prerequisite, or its top branch when stacking. One migration: `none`.
Sizing estimate: 480 production lines; target ≤15 production files; one risk area. Tests/docs excluded. The estimate is a planning bound, not a measured patch size.

## Read only these

Read AGENTS, STATUS and this card first. Find the named heading/function with `rg -n`, then read ≤150 lines around it. Paths explicitly described as new below do not exist yet.
1. `docs/designs/BATCH-S.md` — D-S1–D-S5 and the owning schema/function headings
2. `src/domains/automation/runs.ts` — runAutomation
3. `src/domains/automation/health.ts` — AUTOMATION_RULES/getAutomationHealth
4. `src/domains/exceptions/index.ts` — role-shaped attention

## Drift check — every implementation, not only batch start

Follow `docs/implementation-contracts/DRIFT-PROTOCOL.md`. Compare the latest main/predecessor against this baseline and each named contract. Capture actual head, relevant changed files, schema/signature/guard/test differences, and the disposition in the PR and `docs/designs/CHANGES-SINCE-DESIGN.md`. A prior card's merge is a new baseline, never evidence this card still matches.

- Verify prerequisite cards are merged/accepted and inspect their final schema and public signatures; preserve the contract below. If a named existing path or semantic assumption changed, record the actual drift in this card before coding.
- Inspect the listed regression tests and adjacent guards. Use the current private-storage, active-actor, business-date and integer-cent helpers; keep live switches off.
- This card authorizes engineering only; owner/legal activation gates remain in OWNER-INPUTS and GO-LIVE-CHECKLIST.

## Build contract

New system-issues/sources.ts: collectSystemIssueInputs(now:Date,input:{limit:number;cursor?:string}):Promise<{issues:SystemIssueInput[];clearFingerprints:string[];nextCursor:string|null}>; sweepSystemIssues(now:Date,limit=100):Promise<{opened:number;resolved:number}>. Resolve only sources whose full scoped query proves cleared; bounded partial page never means no records.
Add expectedEveryHours to AUTOMATION_RULES (24 for scheduled daily passes,168 weekly,744 monthly); derive actual cron rule cadence, paused/unconfigured/never-run are distinct; no stale warning while intentionally paused. runAutomation calls issue writer only after run ledger finalization, avoiding recursive system-sweep failure recording. Snapshot raw error class/code only. Stuck ProviderOperation kind aggregation (24h), UNKNOWN deliveries (48h), source-watch failed count>=3, source changed hash, rate guards and missing configured environment names; inspect actual enum/failed/pending semantics before query. Address lookup unavailable needs persisted streak evidence: add tax lookup health aggregation from existing tax address observations with dates; no global memory counter. Successful evidence clears only corresponding fingerprint.
Run sweep via current billing-reconcile route through runAutomation; private cron token/nonproduction isolation, registry/pause and query budget honored. No new cron. Existing business exceptions remain separate and unduplicated. S issue expiry never cancels billing/notice obligations.

## Required tests

- `tests/system-issue-sweep-integration.test.ts`: "paused rule not stale"; "never ran explicit"; "partial page cannot clear issue"; "success resolves correct fingerprint"; "three dated lookup failures"; "no duplicate business exception".

Use real throwaway PostgreSQL for money, schema, permissions, idempotency and concurrency cases. Fake providers only at the client boundary. Assert persisted totals/states/audit evidence and a second run, not only return values. UI cards add the named browser spec to the least-loaded group in `e2e/shards.json`, recording the selected group in the PR; never skip it silently.

## Finishing commands

Use `set -o pipefail` so piping output cannot hide failures. Each command finishes:

- `timeout 600 npm run typecheck 2>&1 | tail -40`
- `timeout 600 npm run lint 2>&1 | tail -40`
- `timeout 600 npx vitest run tests/system-issue-sweep-integration.test.ts 2>&1 | tail -80`
- Migration owner: `node scripts/check-migrations.mjs`; include populated upgrade and restore coverage; no production seed/reset.

## Stop conditions and completion

Stop only the affected card for changed money ownership, missing approved legal/provider contract, new paid resource, destructive production operation, unsupported schema/permission semantics, or exceeding 800 production lines. Record a specific successor split before pushing over budget; no stubs or silently omitted acceptance. Routine file organization within this contract is the implementer's choice.

Done when every named case and batch acceptance mapped to this card passes, applicable phone/dark/keyboard/axe evidence is recorded, current documentation is updated, all valid review findings have dispositions, and exact-head CI/performance/preview/review gates pass. Merge under AGENTS; no ceremonial extra review cycles.


## October 8 implementation drift / evidence
- Resolved predecessor: S-1A merged as #330 at `19aa141`. S-1B
  begins on that exact reviewed tree, not on the historical `b2a06c2`.
  Latest T RDF work added two genuine billing-reconcile run keys after
  the original automation registry was designed: both were added to
  `AUTOMATION_RULES` with daily cadence. Actual tax-rate-watch runs on
  Colorado Mondays (168 h expected); other registered cron executions
  are daily, including the monthly address pass's daily no-op run.
- **Evidence gap resolved without a new table:** the earlier tax-location
  code intentionally preserved prior verified addresses on GIS outages,
  so it did not persist the external provider's unavailable response.
  The existing private audit ledger now records a *global* Colorado GIS
  source-health result and Colorado business date on each actual lookup.
  No address, customer reference, request URL, response body or raw
  exception is logged. The sweep requires three distinct consecutive
  failed days; an observed successful response clears the signal.
- Source signals include current run state, pause/configuration distinctions,
  provider kind aggregation, >48-hour unknown messages, >=3 failed official
  watch fetches, unreviewed page-hash changes and immutable rejected/applied
  rate-decision audit evidence. Aggregates do not initiate provider retries,
  notices, payments, tax submissions or new scheduled jobs.
- Real-Postgres test evidence is in
  `tests/system-issue-sweep-integration.test.ts`: paused/never-run,
  observed-only cursor page, failed-then-successful run, three dated
  GIS outcomes with recovery, provider reconciliation, unknown delivery
  privacy, applied rate-decision resolution, and business-state noninterference.
  S-1C remains the only owner-action/UI publisher; S-2 remains the only
  external AI authentication/key publisher.
