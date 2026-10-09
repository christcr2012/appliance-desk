# STATUS — current work, blockers and next action

Updated October 9, 2026 (main `aea29ba3`). **Batch T is engineering-complete** (through T-7D #328). **Batch S is
complete:** S-1A #330, S-1B #331, S-1C #332, S-2 #334 (plus the test-fixture drift fix #333). **COM-L1A** merged as
#335. No live payments, customer messages, fee charging or tax filing are activated.

## Next

**2026-10-09 — Batch W approved (IN-57…IN-60).** Next implementation: **W-0A** then **W-0B** (`docs/pr-cards/W-0A.md`, `W-0B.md`; no prerequisite, no migration) — they fix purchase use tax that could never be calculated and a dead Today link. Then COM-L resumes at COM-L1B; W-1…W-8 come after COM-L15 and before V. Design: `docs/designs/BATCH-W.md`.

**Order after W-0:** COM-L1B → COM-L2 … COM-L15 → W-1 … W-8 → V → F-part-2. Keep owner/legal/CPA and live payment
gates. [MASTER-ROADMAP](MASTER-ROADMAP.md) is the single handoff; [PLAN](PLAN.md) owns acceptance; implementing sessions
start at [SESSION-START](SESSION-START.md).

## Built

A/B/C/R/B2/D/E/E2, F-part-1 and G are merged. T through acquisition UI/frequency/worksheet is merged; T-6C1 added the RDF schema and decision foundation; T-6C2 finalized immutable RDF delivery and sale evidence. Existing operations, financial evidence, renewals, custody, parts, messaging, backups and security must not be rebuilt. E2’s public visual result was rejected as final quality; V remains. Website content controls and owner workspace additions remain designed future work.

## Remaining stages

| Stage | State |
|---|---|
| T completion | Engineering complete through #328; owner/CPA/provider/go-live gates remain |
| S → COM-L → V → F-part-2 | Approved remaining launch engineering and final product proof |
| K → M → O → COM-N | Approved later engineering; K/M after launch unless owner reschedules |
| BP | Proposed business documents/design; runtime acceptance still required |
| O32/O29/direct QBO/P/COM-A | Explicitly deferred or owner-selected prerequisites |

## Cleanup and autonomy — October 8

Two open implementation PRs were recovered: #315 and #317. #315’s last permission finding is fixed with persisted-state regression and exact-head review. #317 is synced once onto its final merged prerequisite; its populated upgrade/restore proof now covers configured settings and real RDF rate/record evidence.

Nine existing git worktrees were inventoried, plus the two isolated completion worktrees. Historical dirty work in four worktrees was preserved in local recovery commits under `refs/recovery/20261008/` and named stashes, then left clean. The rental-builder/job fixes shipped in `06d8342c`, customer workspace in `6c3a3a29`, audit in #127 and business templates in #287. Older revenue copies are superseded by receipt-ledger implementation `3514bdc0` and subsequent work. They are recovery history, not another implementation queue. Canonical checkout: `/workspace/scratch/c15372445dd5/appliance-desk`; lower agents start from fresh main here, not an old snapshot.

The instruction to end a turn solely because CI remained was removed. Use the existing two lanes, then a quiet bounded completion wait when finite CI is the only dependency. Provider/session limits still require a real resume mechanism; repo instructions do not restart an ended chat. Publish complete trees atomically, refresh the target base before preflight, and defer only accountable low-risk findings. Tests, exact-head checks, preview and required reviews remain mandatory.

For throughput assessment count **three implementation merges beginning with #317**, excluding #315/#316 and documentation-only #318. Record one brief result here after the next two implementation merges: elapsed time, substantive delivery/defects, red runs, superseded cancellations and base-sync work. No extra report or tracking lane.

## Gates and limitations

- Stripe test; live customer email/SMS off. Owner approvals still govern activation, provider purchases and production writes.
- CPA/attorney/GIS, COM setup/consent/retention, V visual approval and final launch inputs remain in OWNER-INPUTS/GO-LIVE-CHECKLIST.
- Official-page fetchability does not prove a tax answer. Preserve source failures and the manual path.
- Historical audits remain final-review inputs under F2-D; this cleanup is not a full security certification.
- This workspace has generated Prisma clients and reusable dependencies. The existing Vercel Sandbox has PostgreSQL 18 binaries outside PATH; on October 8 an isolated 127.0.0.1-only database named appliance_desk_test was migrated/seeded and 27 real-Postgres targeted integration tests passed. GitHub CI uses PostgreSQL 17 and remains the exact-head gate; no Neon or production database was used.

History and prior acceptance: [retired working snapshot](archive/reset-2026-10-08/README.md). Do not use its old unchecked boxes as the current queue.

## Cash-budget / startup banking design — October 8

Owner-requested documentation-only K-CASH design and dated primary-source research; proposed K-8 → nine K-CASH
groups → M, documentation reviewed and owner-approved for planning only. No runtime built or launch/T queue change. Confirmed-cash envelopes,
protected obligations, annual/recurring costs/targets, bank CSV matching/reconciliation, QBO import evidence and
contextual screens specified. K opening/export/forecast/posting-revision amendments explicit. IN-54/55 gate
account-specific activation, not synthetic engineering. No bank/provider/spending/live-money activation.

## Targeted publication checks — October 8

Owner requested immediate throughput improvements without recreating historical
failures. `npm run preflight` consolidates static checks and selected unit/database/
browser regressions; shared disposable fixtures now include ADMIN and dummy auth.
PLAYBOOK Step 4 replaces conflicting browser recipes. Full CI remains mandatory.
Launcher regression tests exercise failure propagation, selectors and incomplete
browser evidence; actual build/database/browser proof still comes from the named
local runs or exact-head CI, not the command plan. No launch gate or feature queue
changes. Assess the next three implementation merges for completed scope and red
CI rounds rather than raw PR counts; no extra report/workstream.

Local database testing uses Vercel Sandbox PostgreSQL. The shared launcher was
verified in the existing sandbox with six tax-overview integration tests passing
and zero skips; its disposable database was cleaned up. Missing PostgreSQL in a
scratch checkout is not evidence that the project sandbox is unavailable.
The final CI run exposed a purchasing browser-test race: its supplier-save URL
assertion also matched the `/new` form. Require the saved detail URL and named
supplier heading before navigating away; preserve all persistence/accessibility
assertions and normal timeouts.


## S-2 implementation evidence — October 9 UTC

Private OWNER-issued hashed/revocable AI check-up keys; safe typed GET issue API
and structured-only POST note API; server-side 60/hour/key limiter; manual
routine instructions without activation. New key model and nullable note
author reference are covered by disposable PostgreSQL schema/migration,
backup export/restore sanitization and 26 passing targeted DB/unit tests
including legacy owner notes, Today role behavior and navigation. Typecheck
and lint pass locally. New owner/admin keyboard/axe browser spec is registered
in browser-c; exact-head GitHub CI and preview are mandatory; local browser
binary unavailable. No payments, provider sends, external scheduled routine,
production database writes or spending enabled. Owner IN-45 remains deferred.


## COM-L1a pending merge — SMS safety

After Batch S-2 (PR #334) and before later COM features, COM-L1a adds
independent OFF-by-default SMS master activation, verified-STOP/dispatch
serialization, and one-shot UNKNOWN send semantics. Existing email retry
behavior remains unchanged; non-production/unmarked environments cannot
call Twilio even when credentials are accidentally present. Focused
real-Postgres messaging, SMS and deployment regressions (54 tests, initial
local validation) passed. Live SMS remains OFF; no provider configuration
or customer messaging was enabled. Exact-head CI and preview required.
