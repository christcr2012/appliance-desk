# STATUS — current work, blockers and next action

Updated October 9, 2026 (COM-L2 PR #346 merged as 12bcd837; latest deployment-cost/release controls #347–#351 merged). Batch T and Batch S are engineering-complete. COM-L1A/B and COM-L2 are merged. No live payments, customer messages, fee charging or tax filing are activated.

## Next

**2026-10-09 — COM-L4B PR #354 OPEN, final-head CI not yet generated (COM-L4A #353 merged):** default-off, account-scoped Twilio provider adapter; free Basic Lookup US verification, signed callback correlation, locked single-attempt dispatch, late STOP/policy/actor rechecks and fail-safe UNKNOWN recovery. **Next: COM-L5A verified inbound SMS and deterministic identity resolution**, then L5B consent projection. Existing reminders connect later in COM-L6A; no live sending, phone activation or provider spending authorized.

**Owner override (2026-10-09): Do not implement W-0C or W-OC until specifically authorized.** Existing W Amendment B plan stays approved but execution is paused at that card.

**2026-10-09 — Batch W Amendment B (connected business) APPROVED (IN-69; IN-70 → D-WB8 set/out-of-service rules).** First: **W-0C**,
a confirmed defect — a failed automatic card charge never reaches To do (invoice stays OPEN, or is DELINQUENT with no
due date the Today rule needs). Live payments are off, so no customer is affected. **W-0C is the next card after the
PR currently in flight** (design `docs/designs/BATCH-W-AMENDMENT-B.md` 6.1). The rest (purchases with serials, tax
proof and audit pack, washer + dryer sets as packages, early-return/out-of-service credits, connected pages, portal
flows, dollars-only and ⓘ) follows in the order in that file's section 8.

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
