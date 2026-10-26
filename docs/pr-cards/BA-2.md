# BA-2 — First-time books setup a new owner can finish; correcting starting balances

Build spec: `docs/build-specs/engines/BOOKS-AUTOPILOT.md` section 2 (everything decided there; section 0 lists the
code gaps this fixes). Design: `docs/designs/BOOKS-AUTOPILOT.md`. Approved by Chris 2026-10-25. Risk: **books
entries (money records)** — never edit or delete entries; corrections are new entries; locked months stay locked.
Depends on BA-1 (actor refactor and autopilot).

## Acceptance
- [x] All BA-2 acceptance tests, including disposable PostgreSQL corrections and replay cases, passed at implementation head `72ac47ff` in CI run 40355797414.
- [x] Existing non-setup Books actions retained; new setup and correction screens covered by repo CI and role tests.
- [ ] Final docs-only commit requires exact-head CI; previous complete CI run 40355797414 passed at `72ac47ff`, and Codex opening-Stripe finding has been fixed with an integration test. Review thread disposition recorded.

## BA-2 implementation and evidence plan
- [x] Provide the owner-only four-step setup wizard; an admin sees an owner-help message.
- [x] Derive the recommended start date from the first purchase, invoice, expense or today; default zero opening balances for a new business and accept verified nonzero balances for an existing one.
- [x] Show the owner-contribution path and preselect the matching expense account without taking or sending money.
- [x] Initialize exactly once using the existing authenticated Books command; kick off bounded, best-effort catch-up without blocking the successful setup.
- [x] Add a Books setup To do item for the owner only, with urgency rising after the first invoice, and clear it on successful setup.
- [x] Support owner-only, locked, append-only corrections to opening balances, numbered by correction cycle, safe across retries and across closed periods.
- [x] Replace old irreversible-opening wording on Books home and add a correction form with a reason.
- [x] Cover authorization, defaults, zero and nonzero opening, corrections, double-submit, closed periods and Today with throwaway PostgreSQL tests.
- [ ] Final exact-head CI and review-thread resolution; BA-1 already merged.

**Dependency:** BA-1 merged as PR #610. BA-2 PR #613 now targets `main`; the current branch contains a merge of the latest main.

## Progress
All BA-2 feature screens, finance rules, real-Postgres tests, owner guidance and latest main reconciliation are implemented. Full CI passed at `72ac47ff` (run 40355797414, typecheck/lint, all unit/database shards and browser shards). Codex found a missing corrected-opening Stripe reconciliation baseline; fixed and tested at that passing head. This documentation update awaits its own exact-head CI before merge. No production finance data or provider settings touched.
