# Design — Batch F: Integrated verification, recovery, owner handoff & launch ledger

Status: **APPROVED DESIGN — implement from this document** (written
2026-10-02 against `main` f272f51; B–E land first). Scope/acceptance:
`docs/PLAN.md` → Batch F and its launch gates. This batch is mostly *proof*:
it adds few features and a lot of evidence. Nothing here authorizes launch;
the owner does.

## 0. Verify before starting

| # | Assumption | Check |
|---|---|---|
| A1 | B–E **and E2 (visual redesign)** merged; STATUS says F is NEXT; the conditional Google PR is either merged or explicitly deferred in STATUS. | `docs/STATUS.md` |
| A2 | `exportDatabaseBackup` in `src/domains/backup/index.ts` reads each table with an independent `findMany` (not one snapshot), writes one JSON to the private Blob store, prunes by date; there is **no restore script**. | file + `ls scripts/`. (P6 H3/H4) |
| A3 | Private photos and D's `DocumentArtifact` bytes live only in the Vercel Blob private store; backups contain rows/URLs, not bytes. | `src/lib/photo-storage.ts`, `src/domains/documents/artifacts.ts`. (P6 H5) |
| A4 | The real-Postgres integration pattern (`CI=true` + local throwaway DB) and the browser session reuse pattern are in place. | `tests/webhook-atomicity-integration.test.ts`, `e2e/global-setup.ts`. |
| A5 | `docs/OWNER-GUIDE.md` describes features as of Batch A and has not been rewritten per batch. | read its headings. |
| A7 | **Re-verify this whole design against E2 before starting.** E2 restyles every screen and adds the phone navigation (bottom tab bar), so every screen name, selector, route, screenshot and walkthrough step in this design must be checked against the redesigned UI, and the owner-guide screenshots are taken after E2. Record differences in `docs/designs/CHANGES-SINCE-DESIGN.md`. | read E2's entry there; open each screen. |
| A6 | Perf fixtures and `docs/PERF-BASELINE.md` exist from Batch E. | ls. |

## 1. Decisions

**F1. Consistent backups: the logical export runs inside one `REPEATABLE READ` transaction and carries metadata; restore is a maintained script that is drilled in CI.** (P6 H3/H4.) Export = `{ formatVersion: 2, exportedAt, migrationId (latest applied migration name), appVersion (git sha), tables }`, produced with `prisma.$transaction(async tx => …, { isolationLevel: "RepeatableRead" })`. Restore = `scripts/restore-backup.ts <file> --into <DATABASE_URL>` that refuses any hostname that is not localhost/127.0.0.1 or a Neon branch whose name starts with `restore-`, applies migrations up to `migrationId`, loads tables in dependency order (order list is code, derived from the schema's relations and checked by a test), then runs `verify-schema-health`. Credentials: `Account`/`Session`/`Verification` rows are **not** restored (users must reset passwords after a restore — documented), so no reusable hashes travel in backups. Provider idempotency state (`WebhookEvent`, `ProviderOperation`, `MessageDelivery`, `ProviderEvent`) **is** restored so a replayed Stripe/Resend event after recovery is still deduped.

**F2. Media recovery: a daily inventory plus a second copy.** (P6 H5.) `scripts/media-inventory.ts` lists every private-store object referenced by `Photo` and `DocumentArtifact` with size/sha and writes the manifest next to the backup; the backup cron copies new/changed objects into a second prefix (`recovery/<yyyy-mm>/…`) in the same store with versioning on, and the restore drill verifies a sample of bytes by sha. (A second *provider* is a spending decision — IN-15 — not made here.)

**F3. The ten integrated scenarios are real tests, one file each, under `tests/scenarios/` (real Postgres) and `e2e/scenarios/` (browser where the scenario is about UI), and they are the launch evidence.** Each scenario file starts with a comment naming the PLAN scenario number and ends with explicit assertions on money totals, custody, and audit rows. No scenario is "manually verified".

**F4. Capacity is measured against fixed fixtures and recorded; tuning happens only where the measurement says so.** Baseline from Batch E; this batch adds the large-account (one property manager, 50 properties, 200 appliances) and large-invoice (5,000 invoices) fixtures and the ">20 % regression needs explanation and approval" rule as a test that compares to `docs/PERF-BASELINE.md`.

**F5. Runbooks are short, numbered, and tested where a step can be tested.** Each runbook has a "drill" section; where the drill is scriptable it is a `scripts/drill-*.ts` run in CI's database job.

**F6. The owner guide is rewritten per screen, from the product as it exists, with one screenshot per screen taken by the browser suite** (`e2e/owner-guide-screenshots.spec.ts` writes to `docs/owner-guide/screenshots/`; the spec is in its own shard group and may be skipped on PRs by an env flag — it runs on `main`).

**F7. The launch ledger is one document, `docs/LAUNCH-LEDGER.md`, generated partly by script.** `scripts/launch-ledger.ts` reads the audit registers (`docs/audits/*`, B01–B36, review reconciliation) and the PR dispositions recorded in `docs/reviews/dispositions/*.json` (one JSON per PR, written by each batch from F onward — and backfilled here for B–E from their PR descriptions) and prints Gates 1–8 with each item's status and evidence link. A gate item with no evidence prints as **OPEN**, never as done. The human/owner gates print as "OWNER DECISION — not a test".

## 2. Schema changes
None required. (If a scenario needs a fixture helper table, do not add one; fixtures are built through the domain functions.)

## 3. Work units

### WU-F1 — Consistent export + restore script + drill (F1)
Files: `src/domains/backup/index.ts`, `scripts/restore-backup.ts`, `scripts/lib/table-order.ts` (dependency order), `tests/backup-export.test.ts` (metadata present; single-snapshot: a row inserted mid-export does not appear — test with an injected hook), `tests/backup-restore-integration.test.ts` (export from the seeded CI DB → restore into a second local DB `appliance_desk_restore` created in the test → counts match for every table except the three credential tables → `verify-schema-health` passes against it), `docs/runbooks/RESTORE.md`.
CI: the `database` job gets one step "Restore drill" running the integration test (it is a test, so it already runs with `npm test`; the step is just the second database creation — add `createdb appliance_desk_restore` to the job via `psql`).

### WU-F2 — Media inventory and second copy (F2)
Files: `scripts/media-inventory.ts`, `src/app/api/cron/backup/route.ts` (call inventory + copy after export), `tests/media-inventory.test.ts` (manifest lists every referenced object; an unreferenced object is reported, not deleted), `docs/runbooks/RESTORE.md` (media section).

### WU-F3 — Scenario tests 1–10 (F3)
One file per scenario; names fixed:
`tests/scenarios/01-lead-to-recurring-billing.test.ts`, `02-provider-failure-retry.test.ts`, `03-maintenance-to-inspection.test.ts`, `04-manual-payment-overpayment-refund-statement.test.ts`, `05-term-end-renew-terminate-autorenew.test.ts`, `06-staff-lifecycle-inflight.test.ts`, `07-message-send-failure-reconcile.test.ts`, `08-privacy-request-retention.test.ts`, `09-restore-and-media-recovery.test.ts` (reuses WU-F1/F2), `e2e/scenarios/10-owner-workflow.spec.ts` (browser: Chris's representative day — change a price, publish site copy, schedule a delivery, record a check, decide a deposit refund — with no code/DB assistance).
Each scenario: fixtures via domain functions; Stripe/Resend/Twilio mocked at the client boundary (`__setStripeClientForTests`, and the equivalent for email/SMS — add `__setEmailSenderForTests` if missing); assertions on: invoice/receipt/credit totals, custody timestamps, audit row counts, `ProviderOperation`/`MessageDelivery` states.

### WU-F4 — Capacity fixtures and regression rule (F4)
Files: `tests/perf/fixtures.ts` (extend), `tests/perf/large-account.test.ts`, `tests/perf/large-invoices.test.ts`, `tests/perf/regression-guard.test.ts` (reads `docs/PERF-BASELINE.md`, fails on >20 % unless `PERF_BASELINE_OVERRIDE_REASON` env is set and printed), `docs/PERF-BASELINE.md` (numbers updated with the commit sha).

### WU-F5 — Runbooks (F5)
`docs/runbooks/`: `RESTORE.md` (F1/F2), `PROVIDER-OUTAGE.md` (from E: what the health page shows, what to do, what never to do — never re-run a cron by hand without checking `AutomationRun`), `UNKNOWN-STRIPE-STATE.md` (drift workbench → finish pending ops → manual verification in the Stripe dashboard → only then a local correction, recorded), `MESSAGE-DELIVERY.md`, `ACCOUNT-RECOVERY.md` (password reset revokes sessions; staff deactivation; owner lockout path), `STORAGE.md`. Each ≤ 2 pages, numbered steps, a "Drill" section, last-drilled date.

### WU-F6 — Owner guide rewrite + screenshots (F6, O31)
Files: `docs/OWNER-GUIDE.md` (rewrite per screen; plain English; "what you can change without code"; "what a failed save/automation looks like and what to do"), `docs/owner-guide/screenshots/*`, `e2e/owner-guide-screenshots.spec.ts`, `e2e/shards.json` group `owner-guide` (skipped unless `OWNER_GUIDE_SHOTS=1`, set only on `main` in the workflow).

### WU-F7 — Review-thread discharge and dispositions (F7, Gate 5)
Files: `docs/reviews/dispositions/{batch-b,batch-c,batch-d,batch-e,batch-f}.json` — schema `{ findingId, status: "fixed"|"already-fixed"|"superseded"|"open", evidence: string, pr: number }`; `docs/reviews/2026-10-01-review-reconciliation.md` updated so every remaining thread has a disposition; threads resolved on GitHub only after exact-head evidence (PLAYBOOK rule).

### WU-F8 — Launch ledger generator and the ledger (F7)
Files: `scripts/launch-ledger.ts`, `docs/LAUNCH-LEDGER.md` (generated; committed), `tests/launch-ledger.test.ts` (an item without evidence renders OPEN; owner gates render as decisions). The ledger ends with the "Human / owner gates that stay explicit" list verbatim from `docs/PLAN.md` and a blank "Owner authorization: ____" line that only Chris fills in.

### WU-F9 — Rollback plan, STATUS, PR
`docs/runbooks/ROLLBACK.md`: revert the UI commit on failure; additive tables stay; never a destructive rollback; which Vercel deployment to promote. `docs/STATUS.md`: F → IN REVIEW, then MERGED; "Deployed vs pending" table for Chris. PR per PLAYBOOK with Gate 1–8 status copied from the ledger.

## 4. Stop-and-ask
1. Any Section 0 assumption false.
2. A second storage provider or any paid resource for recovery (IN-15).
3. Any scenario that cannot be made to pass without changing business behavior — report it as a finding with the failing test, do not bend the test.
4. Anything that reads as "launch now" — the ledger ends with the owner's blank line on purpose.

## 5. Acceptance mapping
PLAN F lines ↔ WU-F3 (ten scenarios), WU-F4 (capacity numbers), WU-F1/F2 (restore + media), WU-F8 (gates with evidence or OWNER DECISION), WU-F7 (no hidden Critical/High), WU-F9 (rollback plan).
