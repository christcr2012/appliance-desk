# Remediation Batch R — execution-shape amendment

**Date:** 2026-10-04  
**Authority:** owner direction during Remediation Batch R implementation.  
**Applies to:** `docs/designs/REMEDIATION-BATCH-R-2026-10-04.md` and `docs/prompts/IMPLEMENT-REMEDIATION-BATCH-R.md`.

This amendment changes **PR packaging only**. It does not change the finding definitions, business rules, safety gates, stop boundaries, required tests, or acceptance criteria in the authoritative Remediation Batch R design.

## Revised PR shape

PR #178 / R1 remains the already-implemented exception and may merge with R01–R05 together. Those findings are already coupled through billing handoff, first-delivery anchoring, renewal serialization, and current rental lineage; dismantling that validated work would add risk without changing behavior.

After R1 merges, each remaining finding gets its own focused PR from the then-current `main`:

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

Each PR must remain limited to its finding plus compatibility work explicitly required by the authoritative design or valid review feedback. Do not use review-only micro-PRs: a valid review finding is fixed in the same finding PR before merge.

## Validation and sequencing

Every finding PR must still satisfy the existing exact-head CI, preview, review, migration/schema-health, and real-Postgres requirements that apply to its risk. While one PR is running CI/review, the next finding may be prepared on a stacked branch, but before opening or merging it must be rebased/fast-forwarded from the actual merged `main` so its review diff contains only that finding.

The final Batch R acceptance ledger still maps R01–R17 to exact merged commits and test evidence. `docs/STATUS.md` and `docs/designs/CHANGES-SINCE-DESIGN.md` are updated after the final finding merges, followed by the required C-09 / Batch D readiness reassessment.
