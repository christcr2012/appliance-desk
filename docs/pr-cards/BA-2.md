# BA-2 — First-time books setup a new owner can finish; correcting starting balances

Build spec: `docs/build-specs/engines/BOOKS-AUTOPILOT.md` section 2 (everything decided there; section 0 lists the
code gaps this fixes). Design: `docs/designs/BOOKS-AUTOPILOT.md`. Approved by Chris 2026-10-25. Risk: **books
entries (money records)** — never edit or delete entries; corrections are new entries; locked months stay locked.
Depends on BA-1 (actor refactor and autopilot).

## Acceptance
- [ ] Every test listed in spec section 2 passes on throwaway Postgres.
- [ ] People-facing behavior of existing Books actions unchanged except where the spec says.
- [ ] `ci` green at the exact head; every review comment read.

## BA-2 implementation and evidence plan
- [ ] Provide the owner-only four-step setup wizard; an admin sees an owner-help message.
- [ ] Derive the recommended start date from the first purchase, invoice, expense or today; default zero opening balances for a new business and accept verified nonzero balances for an existing one.
- [ ] Show the owner-contribution path and preselect the matching expense account without taking or sending money.
- [ ] Initialize exactly once using the existing authenticated Books command; kick off bounded, best-effort catch-up without blocking the successful setup.
- [ ] Add a Books setup To do item for the owner only, with urgency rising after the first invoice, and clear it on successful setup.
- [ ] Support owner-only, locked, append-only corrections to opening balances, numbered by correction cycle, safe across retries and across closed periods.
- [ ] Replace old irreversible-opening wording on Books home and add a correction form with a reason.
- [ ] Cover authorization, defaults, zero and nonzero opening, corrections, double-submit, closed periods and Today with throwaway PostgreSQL tests.
- [ ] Pass exact-head CI and read every review comment before merge, keeping BA-1 ahead of BA-2.

**Stack dependency:** this BA-2 branch starts from unmerged BA-1 head `22b255df362b`. PR must target the BA-1 branch until BA-1 is merged, then retarget to main.

## Progress
The setup wizard, owner-only To do, preselected Owner contributions shortcut, and versioned opening-balance correction with reasons are coded on `ai/chatgpt/ba-2`. Disposable PostgreSQL test source is added but not yet proven by CI. No BA-2 PR/merge or owner acceptance claimed. Tests and the dependency update are the next verification steps.
