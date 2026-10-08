# STATUS — current work, blockers and next action

Updated October 8, 2026. T-6D1 (#313), T-6D2 (#314) and workflow correction #316 are merged. T-6D3 (#315) and its dependent T-6C1 (#317) remain open at inspection; their inspected heads `2e6564e` and `c58385a` passed CI/performance. Merge still requires current exact-head preview/review evidence. Live payment and message activation are unchanged.

## Built

A/B/C/R/B2/D/E/E2, F-part-1 and G are merged. T through T-6b2 (#310) is merged, including audited filing finalization/amendments. Existing rental operations, signed evidence, renewals, custody, parts, messaging, backups and security must not be rebuilt. E2 technical scope shipped; owner rejected final public visual quality, so V remains.

## Next

**Finish #315 → #317 in dependency order**, then T-6C2…4 and T-7A…D. Refresh each execution card at its actual predecessor head. [MASTER-ROADMAP](MASTER-ROADMAP.md) is the single handoff for all later work; [PLAN](PLAN.md) holds acceptance. S and early COM cards exist; later cards are written just in time from approved designs and the coverage index.

## Remaining stages

| Stage | State |
|---|---|
| T completion | Acquisition, RDF and tax screens not built at baseline |
| S → COM-L → V → F-part-2 | Approved, not implemented at baseline; final launch product proof follows |
| K → M → O → COM-N | Approved later engineering; K after launch unless owner reschedules; M remains after launch |
| BP | Proposed design/business documents only; runtime acceptance still needed |
| O32/O29/direct QBO/P/COM-A | Explicitly deferred/owner-selected prerequisites; not implementation-ready |

## Gates and limitations

- Stripe test; live customer email/SMS off. No new activation, provider provisioning/purchase or production data write here.
- CPA/attorney tax/wording inputs, GIS authenticated method contract, COM number/A2P/retention, V visual approval and final launch authorization remain in OWNER-INPUTS/GO-LIVE-CHECKLIST.
- Official-page fetchability is not proof of a tax answer; preserve source failure/manual workflow evidence.
- Audit is a static code/document/contract reconciliation, not a complete runtime security certification or a new full-suite run. The attached October 1 findings were sampled against current source/tests; final all-finding review discharge remains F2-D.

History and full prior acceptance: [retired working snapshot](archive/reset-2026-10-08/README.md). Do not use historical unchecked boxes as today's work queue.

## Recovered interruption — October 8

Local staged generation/publication scripts and committed changes were recovered.
Published predecessor head: `60f3a9c` in PR #311. Two Codex findings are fixed:
restore active cross-batch acceptance rules and pin independent required unit IDs.
User-added content-control/owner-workspace design is folded into V/O, not a new
handoff file. At that recovery checkpoint, content-control runtime remained unimplemented and T-6D1 was next; use the current Next section above.

## Throughput refinement — October 8

Forecast and assumptions are in MASTER-ROADMAP, not a separate report. Routine
cards use Sol light/medium by risk; Sonnet is optional for one disputed contract.
Reuse verified disposable setup and authenticated publishing, inspect only changed
contracts, and avoid duplicate no-change handoff entries. Runtime next is in the current Next section above. Historical pace does not prove either model’s speed/quality.

## CI churn diagnosis — October 8

The 40 sampled PR workflow runs from 18:14–18:46 UTC included 25 cancelled
superseded runs across 20 heads, including both CI and performance (not 25 code
failures). #315 reconstructed 29 files in separate commits and published several
rapid heads; #317 repeated missing enum consumers and a required Customer fixture
field on two failed CI heads. #315 also missed a caller mock and JSX lint check.
Its final inspected CI passed in 6m28s; #317's inspected head subsequently passed.
The workflow now requires complete-tree publication and fresh cheap preflight,
and AGENTS matches PLAYBOOK's accountable low-risk review deferral. Required
checks stay intact. One earlier performance failure followed by later passes
does not establish flakiness; do not weaken its threshold without controlled
base/head measurements. Measure the next existing implementation PRs using
their history; do not create another tracking document or workstream.
