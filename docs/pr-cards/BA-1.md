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
2026-10-25, branch `ai/chatgpt/ba-1`: additive schema/migration, checked book writers,
nightly recording plus enrollment/depreciation, durable books To do items, equipment retirement/disposal
connections and post-commit manual receipt/write-off posting are coded. Guard and disposable PostgreSQL
tests have been added. **Not verified yet:** exact-head CI, test coverage of every acceptance example,
webhook/refund/purchase post-commit hooks and any reviewer findings. No PR opened or merge claimed.

