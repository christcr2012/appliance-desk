# ACCT-1 — Your accountant's own sign-in

Build spec: `docs/build-specs/engines/ACCOUNTANT-ACCESS.md`. Requested and approved by Chris 2026-10-25 (an approved,
limited widening of access). Depends on ACC-1…6, BA-1, CMP-1, DEC-1. Risk: **permissions** — a new access level.

## Acceptance
- [ ] Only the owner can invite an accountant; second step required; no "remember this device"; access ends on a date.
- [ ] The accountant sees only Books, Taxes, Compliance, CPA Decisions, money reports and records Chris shares; every other route and function is refused (inventory tests).
- [ ] Allowed changes (adjustments, mappings, closes, reviewed marks, professional answers) are audited and listed for Chris.
- [ ] Never the vault, full tax ids, customer contact details, payments, refunds, sends or settings (tests).
- [ ] Remove, reset sign-in, change end date and "replace with a new accountant" work; history kept.
- [ ] `ci` green at the exact head; every review comment read.

## Progress
Not started.
