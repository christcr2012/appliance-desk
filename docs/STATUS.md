# STATUS — current work, blockers and next action

Updated October 9, 2026 evening (reconciled after two lanes: COM-L3…L6A #352–#363 and W-0C #359 by Sol; W-16A #360, W-16B #362, W-21A #365, W-21B #366 and test isolation #367 by Claude). Batch T and Batch S are engineering-complete. No live payments, customer messages, fee charging or tax filing are activated.

## Metricool marketing integration (owner-requested, 2026-10-09)
MKT-1 public visit tracking is merged in #371; exact-head CI and performance checks passed. Both automated review findings were fixed and regression-tested. Released from live 193b3f7 on 2026-10-09; Vercel production is READY. Actual-domain homepage and launch page serve the configured tracker; login CSP excludes it. Metricool receipt verification remains an open operational check.
Production METRICOOL_TRACKING_HASH controls activation; private routes and data excluded.
The changed privacy disclosure has a new version and retains the owner's existing
review/approval workflow. No approval is recorded automatically.
This independent marketing request does not reorder the COM/W engineering queue.

## Public pricing visibility (owner-requested, 2026-10-09)
MKT-2 merged in #374 and was deployed after exact-head green CI on main dfd0718 to Vercel production READY (dpl_fjKRCAM258aiNSbnByTHGfHnCSZk). Verified live robinsonappliancerentals.com/pricing and /rent/greeley both 307 redirect to /launch; /launch is 200, sitemap/homepage hide pricing. Internal pricing remains intact. The pinned engineering queue is unchanged.

## Next

### Current queue (read this first)

- **Latest in chain:** COM-L11 (#377) merged with exact-head CI. COM-L12 is implemented and enters exact-head CI/merge; next COM-L13A only after COM-L12 merges.
- **Owner resumed 2026-10-09:** Implement COM-L8 to COM-L15 in order; pause after COM-L15 merges, before W-1.
- **Current queue:** COM-L13A → COM-L13B → COM-L14A → COM-L14B → COM-L15 → W-1 → W-18 → W-14 → W-2 → W-15 → W-3 → W-4 → W-5 → W-6 → W-7 → W-8 → W-9
  → W-10 → W-19 → W-17 → W-20 → V → F-part-2. W-11/W-12/W-13 when their outside gates clear (IN-61, IN-62/IN-44, IN-64).
  Authority: `designs/BATCH-W-AMENDMENT-B.md` section 8 and `pr-cards/work-index.json`.
- **Already done out of order (do not redo):** W-16A/B (sets are rental packages of separate machines; "Rent as"; old
  one-record sets split) and W-21A/B (out-of-service credits; a set machine the customer is done with → single price).
  Later cards build on them — see their entries in `designs/CHANGES-SINCE-DESIGN.md` (W-18 converts their screens to
  the ⓘ/dollars kit; W-14 records a set bought together as two machines; W-19/W-20 show their credits).
- **Testing:** real-database tests that write the business-settings row or create filing accounts must be listed in
  `SHARED_SETTINGS_TESTS` (`vitest.config.mts`) — `tests/shared-state-tests-listed.test.ts` enforces it (#367). CI pulls
  Postgres from `public.ecr.aws/docker/library/postgres:17` (Docker Hub's anonymous limit broke CI on 2026-10-09).
- **Owner decisions open:** IN-72 (new: prepay discount after a set becomes single machines — a safe default is built;
  confirm or change), IN-71 (record retention, CPA), IN-61, IN-62, IN-63, IN-64, IN-65, IN-44.

### Recent merges (newest first)

**2026-10-09 — COM-L12 spend and budget evaluation (as if merged; exact-head CI gate):** Pure provider GMT-period totals, separate resource costs/estimates/verified statements, signed credit handling, non-overlapping daily fallback, explicit unknown/incomplete components, and owner ANY/ALL discrepancy tolerances are added. Account-scoped read service enforces OWNER/ADMIN, rejects ambiguous invoice evidence, returns stale cursor details and never treats provider telemetry as paid Expense. Optional policy budget rules are validated, suggested $50/$75/$100 starts OFF; preview evaluator cannot dispatch alerts or disable communications even if configured. No migration, SMS/voice activation, provider payment, side-effecting cron or live budget alert. COM-L13A is next; IN-53 remains outside activation.



**2026-10-09 — COM-L11 read-only telecom sync (recorded as if merged, pending PR gate):**
An account-pinned, GET-only Twilio adapter reads bounded GMT Usage pages, Message and Call charges, US messaging rates and owned-number capabilities using existing production-only account credentials. The matching durable cursor is claimed before a page, but the network request runs outside its DB transaction; validated snapshots, matched/unallocated costs and the next cursor commit together. A failed page preserves prior checkpoints, and source revisions keep old evidence. Account-level total usage is not added to resource costs or called an invoiced/paid expense. Missing prices stay unknown; readiness never approves A2P or turns on customer communications. No new schema, routes, paid lookups, SMS/voice, provider writes or financial posting. Next COM-L12: compare evidence, detect anomalies and show uncertainties under IN-53's separate activation gate.



**2026-10-09 — COM-L10 cost evidence schema (as-if merged; exact-head gate):** Added five account-scoped Postgres records for Twilio sync cursors, usage snapshots, signed component costs, provider rates and private verified statements. Provider raw prices/usage preserve Decimal(24,10) with one cents-rounding boundary, distinct estimate/provider/statement basis and no unknown-as-zero. Cross-account FKs, revision links, claim/window/statement invariants and acyclic backup restore checks are enforced. No provider API calls, telecom send, bill, payments, journal, public pricing or owner activation. COM-L11 is next for read-only retrieval and paging; IN-51/52/53 remain separate.



**2026-10-09 — COM-L9 merged (#375, conditional on exact-head CI):** The private Communications desk now lists missed calls/unknown outcomes, call legs and guarded voicemail playback. Two separately approved switches plus a version-matched owner policy gate the intentional-only recording; ordinary call recording/transcription remain OFF. Signed callbacks import bounded provider audio from pinned Twilio credentials to the existing private Blob store, prove availability only after storage, preserve replay and retry failures. Owner/admin can review, staff only assigned threads; no public media. Voice activation, IN-52 voicemail/privacy/retention approval, external provider fallback and deletion proof remain outside engineering. Disposable Postgres, unit, accessibility and full PR CI are merge gates. Next: COM-L10.


**2026-10-09 — COM-L8 merged (#370, pending exact-head GitHub CI before merge):** Twilio voice endpoints are signed against the approved HTTPS origin, account and owned number. Calls use owner-approved Denver business hours and an approved phone destination only after voice policy activation (still OFF); a private press-1 step and durable parent/child callback ledger prevent carrier voicemail or duplicate events from being recorded as staff answering. Call decline, conflicts and missing staff answer are kept as missed/unknown evidence. No ordinary call recording, voicemail, live sending, spending or provider settings change. Tested using disposable PostgreSQL and the COM-L8 regression suite. Next COM-L9: gated voicemail/private media and missed-call inbox.


**2026-10-09 — test isolation (#367):** tests that write records existing once for the whole database run one at a time;
the health sweep counts only issues it actually recorded; CI uses the ECR Public copy of the Postgres image. No test was
skipped or weakened.

**2026-10-09 — COM-L6B authorized communications inbox (#364):**
The private Owner Desk → Communications workflow now provides bounded
SMS thread lists and drillthrough, unread per staff user, assignment,
workflow status, and version-conflict protection. Every handler checks
an active team account; staff can access only assigned threads. Ambiguous
numbers never expose a guessed customer's account or lead linkage; message
text is decrypted only for authorized thread detail. Audit history records
assignments/status without message content. All customer texts remain off,
including the held-for-review day-of reminders. Card: docs/pr-cards/COM-L6B.md.
**Next: COM-L7** private call/voicemail schema after exact-head merge.

**2026-10-09 — W-21B merged (#366), Claude's lane:** when the customer is done with one machine of a set, the owner
records it on the repair screen: the rest go to single prices (keeping the agreement's term discount, IN-72), the
already-billed part of the month is credited, and Stripe's monthly item changes from the next period.

**2026-10-09 — COM-L6A template preview and reminder safety cutover:**
Approved SMS templates now validate variables, render immutable encrypted text
and count GSM-7/UCS-2 segments correctly at preparation and final dispatch.
Owner Settings → Notifications previews template samples, conservative Unicode
lengths and explicitly unknown costs. The old day-of reminder cron can no longer
send via the legacy path bypassing COM-L5B consent. It counts held-for-review
jobs without marking them texted. Automated sending still needs the COM-L6B
authorized recipient/job workflow and separate owner activation.
**Next: COM-L6B**, authorized inbox and user read cursors. No live sending.
Card: docs/pr-cards/COM-L6A.md.

**2026-10-09 — COM-L5B complete (merged by the COM-L5B PR after exact-head CI):**
Signed STOP/START/HELP events now produce private, replay-safe scoped consent evidence even
while the inbound inbox is disabled. STOP blocks ordinary SMS to an address (including
unresolved/shared numbers); START is only provider re-enable evidence, never marketing
or broad transactional consent. Portal opt-in writes a versioned exact transactional
disclosure and sender/phone scope; an old phone is revoked when changed. Marketing and
customer messaging remain off. Tested on isolated disposable PostgreSQL, no migration.
Card: `docs/pr-cards/COM-L5B.md`. **Next: COM-L6A**, validated templates, segment preview,
and migration of existing reminders. Public lead disclosure text/form choices remain
explicit follow-up work, not implied by COM-L5B.

**2026-10-09 — W-21A merged (#365), Claude's lane:** a machine taken for repair with no replacement (a swap with no
new machine delivered, or a pickup of some machines while others stay) now starts an out-of-service period; when a
machine is back the customer is credited exactly the days without it on the next bill (any line, set or single).
To do "Return or replace…" (urgent after 3 days, owner setting), a screen with the three ways forward, and a portal
note. (W-21B followed as #366.)

**2026-10-09 — W-16A (#360) and W-16B (#362) merged, built by Claude beside Sol's chain (Chris: "you take W-16A/B and
W-21"):** a washer and dryer set is a **rental package** of separate machines. Sets are managed in Settings → Products
and pricing → Sets and packages and shown on the website and quote form. Agreements and quotes can now rent a set ("Rent
as"), with the server checking one machine per part. Old one-record sets show on To do as "Split … into separate
machines", with a guided screen that keeps history, the rental and exact cost/tax totals. (W-21 followed as #365/#366.)

**2026-10-09 — W-0C MERGED (#359), exact-head CI required before merge:**
After latest `main` c712834 (which includes #356, #357 and the completed in-flight #358),
failed automatic charges on recorded invoices now become DELINQUENT without reopening PAID
or VOID invoices, and an idempotently claimed event records its failed attempt. To do shows
DELINQUENT (with or without due date), PARTIALLY_PAID and overdue OPEN; its button goes
straight to the invoice with the unpaid dollars. No late-fee change; no live payments,
customer SMS/email, provider spending, or tax filing activated. Card: `docs/pr-cards/W-0C.md`.
**Batch W Amendment B approved (IN-69), set/repair credits D-WB8 / W-21; IN-71**
settled for launch at seven-year owner-configurable record retention, with CPA review still
outstanding. W-0C resolves the original payment failure defect and does not implement W-21.

**2026-10-09 — COM-L4B PR #354 MERGED (80ac467):** exact-head required CI passed and performance baseline passed after one retry. Account-scoped default-off Twilio dispatch, last-minute consent/STOP checks, durable single-attempt claim, and fail-safe UNKNOWN recovery remain off in production. No sending, provider spending or phone activation authorized.

**2026-10-09 — COM-L4A merged (#353), following COM-L3 #352:** strict owner-controlled default-off SMS policy, evidence-based consent, canonical STOP suppression, private encrypted and idempotently prepared message intents. **Next: COM-L4B**, claimed delivery and last-minute sender/consent/readiness verification, then L5 inbound consent/reconciliation. No live sending, phone activation, billing or provider spending.

**2026-10-09 — Batch W Amendment A (tax filing on autopilot) added:** W-9 filing autopilot, W-10 use-tax "File now" + filled DR 0252, W-11 live GIS rates (waits on IN-61, may run early once done), W-12 XML return file (waits on IN-62, IN-44). Nothing ever submits or pays on Chris's behalf (D-WA2, IN-63). **D-WA6:** W-2 now also gives every seller-tax answer one dated next step (`nextPurchaseTaxStep`); W-13 receipt reading waits on IN-64; out-of-state seller tax waits on the CPA (IN-65).

**COM-L2 merged (#346, 2026-10-09):** the additive telecom account, number, contact-point/binding and send-attempt schema passed exact-head CI and disposable PostgreSQL backup/restore validation. COM-L3 extends its account and delivery lineage. SMS and provider spending remain off.

**2026-10-09 — test interference fixed (#367):** tests that write the one business-settings row or filing accounts now
run one at a time (guarded by `tests/shared-state-tests-listed.test.ts`), and the health sweep counts only issues it
actually recorded. The chance failures in tax and health-sweep tests are gone (two full local runs clean).

**Recovered unfinished work (2026-10-09, read before starting anything):** found uncommitted in the Vercel Sandbox
`appliance-desk-s1c-oct8` and committed there (not on GitHub; the sandbox clone originally lacked push credentials; this is resolved as of 2026-10-09):
- `/vercel/appliance-desk`, branch `recovery/t7d-leftovers-2026-10-09`, commit `691a02f` — edits to the tax overview
  (`workspace-overview.ts`, `sales-tax/page.tsx`, its test, T-7D card, contract log) left after #328 merged. Compare with
  `main`; keep only what main lacks, as part of W-3 (taxes in one place) — or discard if superseded.
  The main sandbox checkout is on that recovery branch: `git checkout main && git pull` before new work.
- **Test race fixed in #337:** `tests/system-issue-sweep-integration.test.ts` no longer compares global table counts; it
  records the sweep's own writes (only `systemIssue` allowed). If a similar global-count assertion fails by chance
  elsewhere, fix it the same way.

**Order:** see "Current queue" above. Keep owner/legal/CPA and live payment gates. [MASTER-ROADMAP](MASTER-ROADMAP.md) is
the single handoff; [PLAN](PLAN.md) owns acceptance; implementing sessions start at [SESSION-START](SESSION-START.md).

## Built

A/B/C/R/B2/D/E/E2, F-part-1, G, T (engineering) and S are merged; COM-L1A … COM-L6A, W-0A/W-0B/W-0C, W-16A/W-16B and W-21A/W-21B are merged. Existing operations, financial evidence, renewals, custody, parts, messaging, backups and security must not be rebuilt. E2’s public visual result was rejected as final quality; V remains. Website content controls and owner workspace additions remain designed future work.

## Remaining stages

| Stage | State |
|---|---|
| T completion | Engineering complete through #328; owner/CPA/provider/go-live gates remain |
| S | **Complete** (#330–#334) |
| COM-L6B…L15 → W-1…W-20 (W-16A/B, W-21 done) → V → F-part-2 | Approved remaining launch engineering and final product proof |
| K → M → O → COM-N | Approved later engineering; K/M after launch unless owner reschedules |
| BP | Proposed business documents/design; runtime acceptance still required |
| O32/O29/direct QBO/P/COM-A | Explicitly deferred or owner-selected prerequisites |

## Gates and limitations

- Stripe test; live customer email/SMS off. Owner approvals still govern activation, provider purchases and production writes.
- CPA/attorney/GIS, COM setup/consent/retention, V visual approval and final launch inputs remain in OWNER-INPUTS/GO-LIVE-CHECKLIST.
- Official-page fetchability does not prove a tax answer. Preserve source failures and the manual path.
- Historical audits remain final-review inputs under F2-D; this cleanup is not a full security certification.
- See **Environment** below for local database testing.

History and prior acceptance: [retired working snapshot](archive/reset-2026-10-08/README.md). Do not use its old unchecked boxes as the current queue.

## Environment (update when it changes)

- **Cost target ~$20/month (2026-10-09):** no previews for `ai/**` branches; release to `live` per batch, weekly safety net (workflow
  `release.yml`; IN-68 switches Vercel's production branch to `live`); sandbox sessions stop after 30 minutes; heavy
  checks run in free GitHub Actions. The sandbox push key **does** carry over to new sessions (verified: session started
  15:49 UTC after the old one expired had both injection rules).

- **Vercel build costs (2026-10-09):** builds now skip when only docs/tests/CI files changed, on PRs too, and
  transfer branches never build. IN-67 done: the ruleset no longer requires a "Preview" deployment (only `ci`), so skipped previews never block merges.

- **Sandbox GitHub push:** Installed 2026-10-09 by the owner through network header injection, never stored in the repository or sandbox environment; expires 2027-10-09 (one year). Dry-run verified; regular git push now works using HTTP/1.1. Use the fallback runbook if needed.
  **Check (2026-10-09, Claude):** the key was attached to the running session only — the sandbox's saved settings had no
  injection rule, so it disappears when that session ends. Whoever holds the key applies the same `networkPolicy` with
  `update_sandbox` (saved settings) so every future session keeps it.
- **Sandbox browser:** Chromium and its system libraries installed in `appliance-desk-s1c-oct8` on 2026-10-09 (a real
  launch verified). If a later session reports "No matching installed Chromium": `npm run sandbox:browser` once.

- **Local database testing:** Vercel Sandbox, project `appliance-desk`. Persistent sandbox in use:
  **`appliance-desk-s1c-oct8`** (most recently active, 2026-10-09; main checkout `/vercel/appliance-desk`, per-card
  worktrees beside it, PostgreSQL 18). Older persistent `appliance-desk-batch-t1` may have an expired snapshot. Resume,
  don't recreate — steps in PLAYBOOK 4b. Stop the session when done.

Older entries (October 8 cleanup, K-CASH design note, publication-check note, S-2, COM-L1A and COM-L1B evidence) moved to
[archive/STATUS-LOG.md](archive/STATUS-LOG.md) on 2026-10-09.
