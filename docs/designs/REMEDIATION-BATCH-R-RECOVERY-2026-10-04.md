# Remediation Batch R — clean recovery addendum

Date: 2026-10-04
Authority: execution addendum to `REMEDIATION-BATCH-R-2026-10-04.md`; it narrows unsafe implementation choices but does not change R01–R17 business outcomes.

## 1. Recovery point

Current `main` at recovery is `e763c2986d9650fe251212a220e31dcf06e8a12f`.

The failed remediation branches never merged to `main`. Therefore **do not rewind `main`**: it already represents the pre-remediation product plus legitimate unrelated merges (#176, #177, #179–#182). Rewinding it would incorrectly discard good work.

Superseded history:
- #178 — first R1 implementation attempt; closed, never merged.
- #183 — R06 design-only draft stacked on #178; closed, never merged.
- #184 — Stripe calendar staging experiment stacked on #178; closed, never merged.

The only implementation reused from #178 is the reviewed pre-calendar snapshot at `83d4207627d6059116483ca5608baf4723ab4ea5`, whose merge-base is current `main`. Later Stripe calendar experiments are excluded.

## 2. Drift check

Compared with the design's original post-#175 base, current `main` adds documentation/roadmap decisions and E2 planning. No later executable change supersedes R01–R17. The #175 missing-item rule remains authoritative and compatible with R03/R04: a partial first delivery starts whole-agreement billing; a true zero-delivery visit does not.

No decision-level conflict was found for R01–R03, R05, or R06–R17.

### R04 Stripe provider-calendar conflict

The local R04 requirement remains valid: `RentalAgreement.firstDeliveredOn` is an immutable Colorado business-date fact, zero-delivery does not set it, fixed-term dates derive from it, and provider retries must not rewrite it.

The exact Stripe provider-calendar sub-step is **stopped under the original design's explicit stop boundary**. Stripe represents subscription anchors as UTC timestamps/configuration. Backdating plus a shifted UTC anchor introduces time-based proration, while a Denver-midnight UTC anchor changes local calendar date across DST. That conflicts with the existing rule: Colorado calendar billing periods, no intramonth proration, no changed money policy.

Therefore this clean R1 deliberately does **not** send `backdate_start_date`, `billing_cycle_anchor`, or `billing_cycle_anchor_config`. It preserves `firstDeliveredOn` in local state and Stripe metadata, and retains the pre-remediation provider charging behavior until a separately approved billing-calendar design can prove amount/date equivalence. Do not improvise another Stripe anchor in this batch.

This is intentionally a visible stop, not a hidden approximation.

## 3. Clean stack

One batch, one stack, three substantial PRs:

1. **R1 — billing/lineage (R01–R05)**
   - explicit handoff outcomes;
   - durable leases/CAS recovery for billing handoffs;
   - zero-delivery vs partial-delivery truth;
   - immutable first-delivery fact and delivery-based local term dates;
   - renewal/custody-lineage guards;
   - Stripe provider-calendar sub-step recorded as the explicit R04 stop above.

2. **R2 — provenance/estimates (R06–R12)**
   - immutable deposit source receipt and refund rail;
   - canonical successful-payment statuses;
   - no provider I/O inside webhook transactions;
   - transactional estimate validity/send claims;
   - strict business-date and repair-cost input parsing.

3. **R3 — operations integrity/scaling (R13–R17)**
   - guarded transactional inventory commands;
   - atomic PO creation and audit;
   - part-cost lock ordering;
   - durable PO-receipt replay identity including free-text lines;
   - bounded deterministic Today/exception queries.

Do not split these into one-issue PRs and do not combine all 17 findings into one PR.

## 4. Workflow gates

For every PR:
- start from its planned predecessor only;
- read `AGENTS.md`, `docs/PLAYBOOK.md`, `docs/AI-PR-READ-FIRST.md`, and prior review threads;
- keep tests with code; money/concurrency/race behavior requires real Postgres coverage;
- no weakening tests to make CI green;
- inspect exact-head CI and all final review threads;
- update status/docs with evidence before merge;
- no live Stripe, customer email/SMS, automatic-renewal activation, production fixtures/seeds, spending, destructive production data work, or direct commits to `main`.

A stacked PR is retargeted to `main` only after its predecessor merges, per `AGENTS.md`.
