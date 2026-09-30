# Overhaul execution checkpoint

Updated: 2026-09-30

| Field | Current value |
|---|---|
| Baseline | main 25bedf256485c99f66a8f5fcdc35d1c1dbc4afe5 |
| Historical stack | #86/#87/#88 merged; #89 closed unmerged; #90/#91/#92 merged |
| Current branch | ai/codex/overhaul-o02-preview-safeguards; new root because no open predecessor exists |
| Batch | B1 IN_PROGRESS; existing Sol Medium schedule; no model switch |
| O00 | VERIFIED documentation baseline |
| O01 | Owned by Claude; paused for usage reset per owner. Codex did not edit its files. |
| O02 database | Separate vercel-preview-2 branch and recorded READY deployment observed; full-card proof incomplete |
| O02A | PR #93: local checks and code CI 36732270552 passed; code preview READY; documentation-head checks and Codex review/merge next |
| O02 remaining | Environment-target/build/runtime fixture proof; verified independent preview file workflow; complete migration evidence |
| O09/O13 | Blocked until O01 and complete O02 gates pass |
| Authorization | Owner asked Codex to work around Claude's O01 pause; independent O02 subcard selected |
| Merge gate | Codex exact-head review + passing CI/applicable preview evidence; owner authorized Codex to merge its PRs as it goes on 2026-09-30 |
| Owner inputs | docs/OWNER-INPUTS.md |

O02A suppresses Vercel non-production email/SMS, requires Stripe test keys and
refuses live webhook events, and blocks upload token minting/backup reads,
writes and pruning until separate preview storage is verified. No environment
variables, credentials, customer data or paid resources changed.
This supersedes the stale #87 pointer. Check the remote tip before any next PR;
preserve Claude's O01 work. Do not call the whole O02 card complete.


## 2026-09-30 — Owner authorizes Codex merges

Chris explicitly changed the earlier merge arrangement: Codex may handle
merging its own PRs as it goes. For Codex-owned PRs, the earlier separate
Claude-review/owner-merge-approval hold is superseded. Codex reviews the exact
head, requires passing CI and applicable acceptance/preview evidence, and
merges through a PR with an expected-head SHA. No direct main commits.
Claude still owns O01. This authorizes no paid resources, live payment/email/
SMS activation, destructive data changes or automatic next-phase work.
Model-switch and product release checkpoints remain in effect.
