# BA-1 — Books record themselves: nightly recording, automatic enrollment and depreciation, retirement and disposal connected

Build spec: `docs/build-specs/engines/BOOKS-AUTOPILOT.md` section 1 (everything decided there; section 0 lists the
code gaps this fixes). Design: `docs/designs/BOOKS-AUTOPILOT.md`. Approved by Chris 2026-10-25. Risk: **books
entries (money records)** — never edit or delete entries; corrections are new entries; locked months stay locked.


## Acceptance
- [ ] Every test listed in spec section 1 passes on throwaway Postgres.
- [ ] People-facing behavior of existing Books actions unchanged except where the spec says.
- [ ] `ci` green at the exact head; every review comment read.

## Progress
Not started.
