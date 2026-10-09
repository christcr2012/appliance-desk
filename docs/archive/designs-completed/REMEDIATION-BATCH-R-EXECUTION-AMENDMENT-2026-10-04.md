> **RETIRED DOCUMENT — reference only.** Moved to `docs/archive/` on 2026-10-09.
> Nothing in this file is a current instruction; any "current", "next", "approved" or
> "supersedes" language below is historical. The batch is built: its behavior is in the
> code and tests. The working documents are `AGENTS.md`, `docs/SESSION-START.md`,
> `docs/STATUS.md`, `docs/PLAN.md` and `docs/PLAYBOOK.md`.

# Remediation Batch R — execution-shape amendment

**Date:** 2026-10-04  
**Authority:** owner direction during Remediation Batch R implementation.  
**Applies to:** `docs/designs/REMEDIATION-BATCH-R-2026-10-04.md`, `docs/designs/REMEDIATION-BATCH-R-RECOVERY-2026-10-04.md`, `docs/prompts/IMPLEMENT-REMEDIATION-BATCH-R.md`, and the general PR-sizing guidance in `AGENTS.md` for this remediation batch only.

This amendment changes **PR packaging only**. It does not change the finding definitions, business rules, safety gates, stop boundaries, required tests, or acceptance criteria in the authoritative Remediation Batch R design.

## Revised PR shape

R01–R05 were completed and merged together in clean recovery PR #185. Do not split or revisit that merged work unless a later finding or review identifies a real regression.

Each remaining finding gets its own focused PR from the then-current `main`:

- R06 — immutable deposit payment provenance
- R07 — canonical successful-payment statuses
- R08 — webhook/provider transaction boundary
- R09 — estimate expiry enforcement
- R10 — atomic/idempotent initial estimate send
- R11 — Colorado business-date parsing
- R12 — strict repair-cost money parsing
- R13 — guarded inventory command transactions
- R14 — atomic purchase-order creation
- R15 — part-usage cost/read locking
- R16 — purchase-order receipt operation identity
- R17 — bounded Today/exception queries

For Remediation Batch R R06–R17, this owner-directed one-finding-per-PR rule is the specific exception to the general `AGENTS.md` guidance against one-item PRs. Each PR remains limited to its finding plus compatibility work explicitly required by the authoritative design or valid review feedback. Do not create review-only micro-PRs: valid review findings are fixed in the same finding PR before merge.

## Validation and sequencing

Optimize for **first-pass correctness**, not for minimizing the number of CI runs. Before opening each PR, inspect the complete affected workflow, update tests with the implementation, run the cheap focused validation available to the agent, and self-review the diff for regressions and scope drift. CI usage is currently free, but avoid wasteful reruns by correcting failures and review findings at their root.

Every finding PR must still satisfy the existing exact-head CI, preview, review, migration/schema-health, and real-Postgres requirements that apply to its risk. While one PR is running CI/review, the next finding may be prepared, but before opening or merging it must start from the actual merged `main` so its review diff contains only that finding.

The final Batch R acceptance ledger still maps R01–R17 to exact merged commits and test evidence. `docs/STATUS.md` and `docs/designs/CHANGES-SINCE-DESIGN.md` are finalized after the final finding merges, followed by the required C-09 / Batch D readiness reassessment.
