# STATUS — current work, blockers and next action

Updated October 9, 2026 (W-16A #360 and W-16B #362 rental packages; W-0C #359; COM-L5B in Sol lane). Batch T and Batch S are engineering-complete. No live payments, customer messages, fee charging or tax filing are activated.

## Next

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

**2026-10-09 — W-16A (#360) and W-16B (#362) merged, built by Claude beside Sol's chain (Chris: "you take W-16A/B and
W-21"):** a washer and dryer set is a **rental package** of separate machines. Sets are managed in Settings → Products
and pricing → Sets and packages and shown on the website and quote form. Agreements and quotes can now rent a set ("Rent
as"), with the server checking one machine per part. Old one-record sets show on To do as "Split … into separate
machines", with a guided screen that keeps history, the rental and exact cost/tax totals. **Next on this lane: W-21**
(early returns of one machine and out-of-service credits, D-WB8). Sol's lane is unchanged.

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

**Recovered unfinished work (2026-10-09, read before starting anything):** found uncommitted in the Vercel Sandbox
`appliance-desk-s1c-oct8` and committed there (not on GitHub; the sandbox clone originally lacked push credentials; this is resolved as of 2026-10-09):
- `/vercel/appliance-desk`, branch `recovery/t7d-leftovers-2026-10-09`, commit `691a02f` — edits to the tax overview
  (`workspace-overview.ts`, `sales-tax/page.tsx`, its test, T-7D card, contract log) left after #328 merged. Compare with
  `main`; keep only what main lacks, as part of W-3 (taxes in one place) — or discard if superseded.
  The main sandbox checkout is on that recovery branch: `git checkout main && git pull` before new work.
- **Test race fixed in #337:** `tests/system-issue-sweep-integration.test.ts` no longer compares global table counts; it
  records the sweep's own writes (only `systemIssue` allowed). If a similar global-count assertion fails by chance
  elsewhere, fix it the same way.

**Order after W-0:** COM-L2 … COM-L15 → W-1 … W-12 (W-11/W-12 when their gates clear) → V → F-part-2. Keep owner/legal/CPA and live payment
gates. [MASTER-ROADMAP](MASTER-ROADMAP.md) is the single handoff; [PLAN](PLAN.md) owns acceptance; implementing sessions
start at [SESSION-START](SESSION-START.md).

## Built

A/B/C/R/B2/D/E/E2, F-part-1, G, T (engineering) and S are merged; COM-L1A and COM-L1B are merged. Existing operations, financial evidence, renewals, custody, parts, messaging, backups and security must not be rebuilt. E2’s public visual result was rejected as final quality; V remains. Website content controls and owner workspace additions remain designed future work.

## Remaining stages

| Stage | State |
|---|---|
| T completion | Engineering complete through #328; owner/CPA/provider/go-live gates remain |
| S | **Complete** (#330–#334) |
| W-0A/W-0B → COM-L → W-1…W-8 → V → F-part-2 | Approved remaining launch engineering and final product proof |
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
