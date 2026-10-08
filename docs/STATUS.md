# STATUS — current work, blockers and next action

Updated October 8, 2026. Acquisition work T-6D1…3 (#313–#315) is merged; #315 includes the reviewed ADMIN read-only worksheet correction. T-6C1 (#317) merged as main 7acc04a. T-6C2 work is open in PR #319 with a corrected publication in progress; it awaits exact-head CI and final review. No customer charging has been enabled. No live payments, customer messages or fee charging are activated.

## Next

After #319 merges, start **T-6C3**, then T-6C4 and T-7A…D. Refresh each card against its actual merged prerequisite. [MASTER-ROADMAP](MASTER-ROADMAP.md) remains the single handoff; [PLAN](PLAN.md) owns acceptance. No extra handoff document is needed.

## Built

A/B/C/R/B2/D/E/E2, F-part-1 and G are merged. T through acquisition UI/frequency/worksheet is merged; T-6C1 added the RDF schema and decision foundation; T-6C2 is in review. Existing operations, financial evidence, renewals, custody, parts, messaging, backups and security must not be rebuilt. E2’s public visual result was rejected as final quality; V remains. Website content controls and owner workspace additions remain designed future work.

## Remaining stages

| Stage | State |
|---|---|
| T completion | RDF recording/charging/filing and tax workspace screens remain |
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
