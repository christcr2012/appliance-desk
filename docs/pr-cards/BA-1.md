# BA-1 — Books record themselves: nightly recording, automatic enrollment and depreciation, retirement and disposal connected

Build spec: `docs/build-specs/engines/BOOKS-AUTOPILOT.md` section 1 (everything decided there; section 0 lists the
code gaps this fixes). Design: `docs/designs/BOOKS-AUTOPILOT.md`. Approved by Chris 2026-10-25. Risk: **books
entries (money records)** — never edit or delete entries; corrections are new entries; locked months stay locked.


## Acceptance
- [ ] Every test listed in spec section 1 passes on throwaway Postgres.
- [ ] People-facing behavior of existing Books actions unchanged except where the spec says.
- [ ] `ci` green at the exact head; every review comment read.

## Implementation plan and evidence checklist

- [ ] Add additive book-asset, settings and problem-record migration; update schema and database notes.
- [ ] Refactor books writes to a checked person/equipment/automatic writer without exposing automatic writes to server actions.
- [ ] Run nightly source posting even when Stripe sync is off; automatically enroll eligible appliances and post completed-month depreciation, safely across repeats and locked periods.
- [ ] Surface missing acquisition evidence, unposted sources and nightly failures as actionable To do items.
- [ ] Connect equipment retirement, scrap/disposal, reopening and retired-appliance sales to balanced, reversible book entries without blocking equipment removal on a books error.
- [ ] Record qualifying money events promptly, best-effort after the business transaction commits.
- [ ] Cover concurrency, 360-month catch-up, batch rotation, locked months, permissions and disposal cycles in focused throwaway-Postgres tests.
- [ ] Run exact-head CI and review every comment before an authorized merge.

**Execution checkpoint (2026-10-25):** Confirmed no BA-1 implementation PR is open; based this branch on main `af5acc647cd35a9d3c93211e135c7c2f743b02b6`. This plan is not implementation evidence. Local checkout has no GitHub network access; use the repository's documented GitHub REST publishing fallback and free GitHub Actions checks.

## Progress
2026-10-25 — Implemented on `ai/chatgpt/ba-1`: additive migration, trusted
book writers, nightly recording with auto-enrollment and completed-month depreciation,
actionable books problems, Equipment retire/disposal/reopen journal connections,
and best-effort post-commit manual receipts, refunds, purchases and write-offs.
Unit and disposable Postgres tests cover guard boundaries, retirement/disposal cycles,
basic nightly catch-up and missing-cost exceptions. The cron's Stripe switch is
covered by a focused unit test.

**Proof:** GitHub Actions run 40269991085 completed with all CI jobs green
at head `6be9cfac`. Later additions for purchase/refund immediate hooks, batch
selection, integration test improvements, and merging main are **not verified at
their latest head**. Exact-head PR CI/review required before any merge.

**Still to verify before BA-1 acceptance:** remaining source hooks (Stripe webhook,
other expense entry paths); explicit 360-month and 450-asset batch/locked-month
and concurrency proofs; current PR's full CI and review. No real business or
production data touched.
