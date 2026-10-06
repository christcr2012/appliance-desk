# Design — Batch F: Integrated verification, recovery, owner handoff & launch ledger

Status: **APPROVED DESIGN — implement from this document.** Originally approved 2026-10-02; **rewritten 2026-10-05 by
Claude Opus 5.5 against `main` 47bd833**, with the drift check done (section 0). Changes are marked
**(changed 2026-10-05)**; the old text is in `docs/archive/designs-2026-10-02/BATCH-F.md`. **Starts after E2 merges**;
re-check rows A6–A8 against E2's entry in `docs/designs/CHANGES-SINCE-DESIGN.md` before starting.

Scope and acceptance: `docs/PLAN.md` → Batch F and its launch gates. This batch is mostly *proof*: few features, a lot
of evidence. Nothing here authorizes launch; Chris does.

**For the implementing model (Sonnet 5.5 or Sol 5.6):** follow it literally; no new tables; stop where it is silent.

---

## 0. Verify before starting

| # | Fact | How to check |
|---|---|---|
| A1 | B2, D, E, E2 merged; STATUS says F is next; the conditional Google PR is merged or explicitly deferred in STATUS. | `docs/STATUS.md` |
| A2 | `exportDatabaseBackup` (`src/domains/backup/index.ts`) reads every table in `BACKUP_TABLES` with independent `findMany` calls in parallel (no single snapshot), writes one private JSON to Vercel Blob, prunes by date, refuses outside production. `BACKUP_MODEL_POLICY` (`manifest.ts`) leaves out `Session`, `Account`, `Verification` **and `WebhookEvent`**. There is no restore script. | read both files; `ls scripts` |
| A3 | Private photos are the only file bytes outside the database (changed 2026-10-05: D's `DocumentArtifact` stores its HTML in the database, so no artifact bytes live in Blob). | `src/lib/photo-storage.ts`; D's `src/domains/documents/artifacts.ts` |
| A4 | Real-Postgres test pattern (`tests/*-integration.test.ts`, `CI=true`), saved browser sessions (`e2e/global-setup.ts`), `__setStripeClientForTests` (`src/lib/stripe.ts`). E added a fake hook for the email/SMS senders — check its name; if E did not, add `__setEmailSenderForTests` / `__setSmsSenderForTests` next to the senders here. | grep |
| A5 | `scripts/verify-schema-health.ts`, `scripts/test-migration-upgrade.ts`, `scripts/check-migrations.mjs` exist and run in CI. | ls; `.github/workflows/ci.yml` |
| A6 | E's `tests/perf/*` and `docs/PERF-BASELINE.md` exist. | ls |
| A7 | E2's screens and selectors are what the walkthrough and owner-guide screenshots will use (read E2's CHANGES-SINCE-DESIGN entry). | file |
| A8 | Browser groups in `e2e/shards.json`; a new spec must join a group (CI enforces). | file |

## 1. Decisions

**F1. Consistent backups and a drilled restore.** (P6 H3/H4.) The export runs in one
`prisma.$transaction(async tx => …, { isolationLevel: "RepeatableRead" })`, reading tables **sequentially** inside it
(one snapshot), and writes `{ formatVersion: 2, exportedAt, migrationId, appVersion, tables }` (`migrationId` = latest
applied row in `_prisma_migrations`; `appVersion` = `VERCEL_GIT_COMMIT_SHA` or `"unknown"`). (changed 2026-10-05:)
`WebhookEvent` joins `BACKUP_MODEL_POLICY` so a Stripe event replayed after a restore is still recognised; credentials
(`Session`, `Account`, `Verification`) stay out — after a restore every user resets their password (documented).
Provider-state tables (`ProviderOperation`, `SubscriptionEndIntent`, `MessageDelivery`, `ProviderEvent`,
`CustomerNotice`) are restored. Restore = `scripts/restore-backup.ts <file> --into <DATABASE_URL>`: refuses any host
that is not `localhost`/`127.0.0.1` or a Neon branch whose name starts with `restore-`; applies migrations up to
`migrationId`; loads tables in dependency order (the order is code in `scripts/lib/table-order.ts`, derived from the
schema's relations and checked by a test); runs `verify-schema-health`.

**F2. Media recovery = a daily inventory plus a second copy in the same store.** (P6 H5.) `scripts/media-inventory.ts`
lists every private object referenced by `Photo` with size and sha256 and writes the manifest next to the backup; the
backup cron copies new or changed objects into `recovery/<yyyy-mm>/…` in the same private store; the restore drill
re-reads a sample and checks the hashes. A second storage provider is a spending decision (IN-15), not made here.

**F3. The integrated scenarios are real tests, one file each, and they are the launch evidence.** Real Postgres under
`tests/scenarios/`; browser under `e2e/scenarios/` only where the scenario is about using the screens. Each file starts
with a comment naming its PLAN scenario and ends with explicit assertions on money totals, custody and audit rows. No
scenario is "manually verified". (changed 2026-10-05:) two scenarios are added for work that did not exist in
2026-10-02's plan: 11 (fixed term → month-to-month → customer ends online → pickup) and 12 (late pickup with the
company-delay waiver).

**F4. Capacity is measured against fixed fixtures and recorded; tuning only where a measurement says so.** Adds the
large-account (one property manager, 50 properties, 200 appliances) and large-invoice (5,000 invoices) fixtures and a
regression guard: > 20 % slower than `docs/PERF-BASELINE.md` fails unless `PERF_BASELINE_OVERRIDE_REASON` is set and
printed.

**F5. Runbooks are short, numbered, and drilled where a step can be scripted** (`scripts/drill-*.ts`, run by tests).

**F6. The owner guide is rewritten per screen from the finished product, with one screenshot per screen.**
`e2e/owner-guide-screenshots.spec.ts` writes to `docs/owner-guide/screenshots/`; it is placed in the lightest browser
group and skips itself unless `OWNER_GUIDE_SHOTS=1` (changed 2026-10-05: no new group or workflow matrix change);
the screenshots are produced by a local run and committed.

**F7. One launch ledger, partly generated.** `scripts/launch-ledger.ts` reads the audit registers (`docs/audits/*`,
B01–B36, the review reconciliation) and `docs/reviews/dispositions/*.json` (one per batch; backfilled here for B, B2,
C, R, D, E, E2 from their PR descriptions and acceptance ledgers) and prints Gates 1–8. An item with no evidence prints
**OPEN**; human/owner gates print "OWNER DECISION — not a test".

## 2. Schema changes
None. (`WebhookEvent` joining the backup is a manifest change, not a schema change.)

## 3. Work units (PR stack: [F1–F2] → [F3] → [F4–F5] → [F6] → [F7–F9])

### WU-F1 — Consistent export, restore script, drill (F1)
Files: `src/domains/backup/index.ts`, `src/domains/backup/manifest.ts` (`WebhookEvent: "webhookEvent"`),
`scripts/restore-backup.ts`, `scripts/lib/table-order.ts`, `tests/backup-export.test.ts` (metadata present; a row
inserted by another connection mid-export is absent — inject a hook between table reads),
`tests/backup-table-order.test.ts` (every model with a relation appears after the models it references),
`tests/backup-restore-integration.test.ts` (export from the seeded CI database → create `appliance_desk_restore` in the
test → restore → every table's count matches except the three credential tables → schema health passes),
`docs/runbooks/RESTORE.md`. CI: the database job creates the second database (`createdb` via `psql`) before the tests.

### WU-F2 — Media inventory and second copy (F2)
Files: `scripts/media-inventory.ts`, `src/app/api/cron/backup/route.ts` (inventory + copy after export; wrapped in E's
`runAutomation` as ruleKey `media-copy`), `tests/media-inventory.test.ts` (every referenced object listed; an
unreferenced object reported, never deleted), `docs/runbooks/RESTORE.md` (media section).

### WU-F3 — Scenario tests (F3)
One file each; names fixed:
`tests/scenarios/01-lead-to-recurring-billing.test.ts`, `02-provider-failure-retry.test.ts`,
`03-maintenance-to-inspection.test.ts`, `04-manual-payment-overpayment-refund-statement.test.ts`,
`05-term-end-renew-terminate-autorenew.test.ts` (with the "Automatic renewals" switch ON inside the test only),
`06-staff-lifecycle-inflight.test.ts`, `07-message-send-failure-reconcile.test.ts`, `08-privacy-request-retention.test.ts`,
`09-restore-and-media-recovery.test.ts` (reuses F1/F2), `11-month-to-month-continuation-and-online-end.test.ts`,
`12-late-pickup-company-waiver.test.ts`, and `e2e/scenarios/10-owner-workflow.spec.ts` (browser, on E2's screens: change a
price, publish site copy, schedule a delivery, record a check payment, decide a deposit refund — no code or database
help).
Each: fixtures through domain functions; Stripe/Resend/Twilio faked at the client boundary; assertions on
invoice/receipt/credit totals, custody episodes, audit row counts, `ProviderOperation`/`SubscriptionEndIntent`/
`MessageDelivery`/`CustomerNotice` states. Scenario 05 also asserts B2's ordering rule (an opt-out racing the extension
ends with the old end date in the fake Stripe).

### WU-F4 — Capacity fixtures and regression guard (F4)
Files: `tests/perf/fixtures.ts` (extend), `tests/perf/large-account.test.ts`, `tests/perf/large-invoices.test.ts`,
`tests/perf/regression-guard.test.ts`, `docs/PERF-BASELINE.md` (numbers + commit sha).

### WU-F5 — Runbooks (F5)
`docs/runbooks/`: `RESTORE.md`, `PROVIDER-OUTAGE.md` (from E: what the automations page shows, what to do, never re-run
a pass by hand without checking its `AutomationRun`), `UNKNOWN-STRIPE-STATE.md` (reconciliation workbench → wait for the
nightly pass → check the Stripe dashboard → only then a recorded local correction; the billing-end rows from B2 are
never edited by hand), `MESSAGE-DELIVERY.md` (incl. B2's UNCERTAIN/MISSED notice handling), `ACCOUNT-RECOVERY.md`
(password reset revokes sessions; staff deactivation; owner lockout path), `STORAGE.md`, plus D's
`PRIVACY-REQUESTS.md` reviewed. Each ≤ 2 pages, numbered steps, a "Drill" section and a last-drilled date.

### WU-F6 — Owner guide rewrite and screenshots (F6, O31)
Files: `docs/OWNER-GUIDE.md` (per screen; plain English; "what you can change without code"; "what a failed save or
automation looks like and what to do"), `docs/owner-guide/screenshots/*`, `e2e/owner-guide-screenshots.spec.ts`
(lightest group; skips unless `OWNER_GUIDE_SHOTS=1`).

### WU-F7 — Review-thread discharge and dispositions (Gate 5)
Files: `docs/reviews/dispositions/{batch-b,batch-b2,batch-c,batch-r,batch-d,batch-e,batch-e2,batch-f}.json` — each entry
`{ findingId, status: "fixed" | "already-fixed" | "superseded" | "open", evidence: string, pr: number }`;
`docs/reviews/2026-10-01-review-reconciliation.md` updated so every remaining thread has a disposition; GitHub threads
resolved only after exact-head evidence (PLAYBOOK rule).

### WU-F8 — Launch ledger generator and the ledger (F7)
Files: `scripts/launch-ledger.ts`, `docs/LAUNCH-LEDGER.md` (generated, committed), `tests/launch-ledger.test.ts` (an item
without evidence renders OPEN; owner gates render as decisions). The ledger ends with the "Human / owner gates that stay
explicit" list from `docs/PLAN.md`, the open `docs/GO-LIVE-CHECKLIST.md` lines, and a blank
"Owner authorization: ____" line only Chris fills in.

### WU-F9 — Rollback plan, STATUS, PR
`docs/runbooks/ROLLBACK.md`: revert the UI commit on failure; additive tables stay; never a destructive rollback; which
Vercel deployment to promote. `docs/STATUS.md`: a "Deployed vs pending" table for Chris. PR with Gate 1–8 status copied
from the ledger.

## 4. Stop-and-ask
1. Any section 0 row is false.
2. A second storage provider or any paid resource for recovery (IN-15).
3. A scenario that cannot pass without changing business behaviour — report the failing test as a finding; do not bend it.
4. Anything that reads as "launch now".

## 5. Acceptance mapping
| PLAN F line | Evidence |
|---|---|
| All integrated scenarios pass with evidence | WU-F3 files (12) |
| Capacity numbers recorded | WU-F4 + `docs/PERF-BASELINE.md` |
| Isolated restore and media recovery proven | WU-F1/F2 tests |
| Every gate checked with evidence or listed as an owner decision | WU-F8 ledger |
| No unresolved Critical/High hidden | WU-F7 dispositions + ledger |
| Rollback plan | `docs/runbooks/ROLLBACK.md` |

## Amendments

**2026-10-06 — F is split (Chris approved, IN-41).** F-part-1 = WU-F1, WU-F2, WU-F4, WU-F5 (backup/restore, media
copy, capacity, runbooks) runs now. F-part-2 = WU-F3, WU-F6 … WU-F9 (scenarios, owner guide and screenshots, review
discharge, launch ledger, rollback/STATUS) runs after Batches G, T and V merge, and must include their features in the
scenarios and ledger. Order and PR boundaries (F1-a … F1-c, F2-a … F2-d): `docs/MASTER-ROADMAP.md` section 7.


**2026-10-06 — F-part-1 drift check against main `e640b75`.** A1–A3 and A5–A8 still match the implemented code. A4's Stripe test hook exists; the email/SMS sender injection hooks do not. That is the contingency already described by A4 and is deferred to F-part-2/WU-F3, where provider-failure scenarios actually need it; F1-a does not touch provider sending. E2's final route/accessibility changes are recorded in CHANGES-SINCE-DESIGN and do not affect F1-a's database-only work. The mandatory post-Batch-D recovery amendment remains in force: F1-a restores D's database control-plane rows as ordinary backed-up tables; F1-b owns private-media deletion/tombstone recovery semantics. No decision-level drift was found, so F-part-1 may proceed.

(Dated entries only.)
