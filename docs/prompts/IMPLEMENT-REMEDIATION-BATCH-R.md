# Implement Remediation Batch R

Work in `christcr2012/appliance-desk`.

## Preconditions

1. Do **not** begin code until PR #175 is merged to `main`.
2. Start from the then-current `main`, not from the old review SHA.
3. Read, in order:
   - `AGENTS.md`
   - `docs/START-HERE.md`
   - `docs/STATUS.md`
   - `docs/AI-PR-READ-FIRST.md`
   - `docs/designs/REMEDIATION-BATCH-R-2026-10-04.md` (authoritative design)
   - `docs/designs/CHANGES-SINCE-DESIGN.md`
4. Read every final review thread on #175 and fold valid overlapping findings into this batch.
5. Perform and write the required drift check at the top of the remediation design before coding. If #175 already fixed one of R01–R17, record exact evidence and do not rebuild it.

## Goal

Close the 17 still-actionable findings from the two 2026-10-03 Sol reviews without expanding scope into later feature work.

Build one stack with three substantial PRs:

1. **R1 — billing/lineage:** R01–R05.
2. **R2 — provenance/estimates:** R06–R12.
3. **R3 — ops integrity/scaling:** R13–R17.

Follow the design literally. Do not split into one PR per finding. Do not combine the entire batch into one giant PR.

## Hard rules

- Preserve all #175 missing-item/substitution/subscription behavior and tests.
- Preserve #174 job-scoped STAFF authorization; do not reopen generic STAFF inventory authority.
- No Stripe/email/SMS live activation.
- No external provider call inside a Prisma transaction or while holding DB locks.
- Real-Postgres tests for every concurrency/transaction finding.
- Use explicit provider outcomes; normal return is not proof of success.
- Zero delivered equipment must never start recurring billing.
- Delivery/return dates are America/Denver business facts, not retry timestamps.
- Deposit current liability ownership may move on renewal, but original receipt/payment provenance must remain immutable.
- Same payment behavior for legacy `SUCCEEDED` and current `succeeded` rows.
- Estimate expiry is enforced inside the locked response transaction.
- Inventory/purchasing business write + actor check + audit commit together.
- Do not implement C-09 pickup/return policy or Batch D/E/F features unless an exact remediation item requires a compatibility change named in the design.

## Review continuity

Before each PR merge:

- read prior/current Copilot/Codex/independent review threads;
- fix valid findings with regression tests in the current planned PR;
- record dispositions;
- if automated review is unavailable because of quota, record that truthfully and perform the independent diff review required by repo rules;
- require exact-head CI green and applicable preview verification.

## Final closure

After R3 merges, create `docs/reviews/2026-10-04-remediation-batch-r-acceptance.md` mapping R01–R17 to merged commit/test evidence, update STATUS and CHANGES-SINCE-DESIGN, and re-check what remains before C-09 / Batch D.

Do not claim Batch R complete until all 17 IDs have evidence and all three PRs are on `main`.