# DEC-2 — Researched starting values in the live app

Build spec: `docs/build-specs/engines/STARTING-VALUES.md`. Values and sources: `docs/research/2026-10-25-open-decisions.md`.
Approved by Chris 2026-10-25 (apply researched starting values live; never touch signed or billed history).
Depends on DEC-1a and, for the $5 late fee value, FEE-1. Risk: **tax charged on customer bills, late fees, settings writes** — read
`docs/AI-PR-READ-FIRST.md` and say in the PR how each applicable item is honored.

## Why
Questions with no answer were left as "UNDECIDED", which stopped features. Each now runs on the most likely answer
for a new Greeley rental business, labelled "Starting value — not confirmed", and waits for Chris or his CPA.

## One PR
Registry values, the late-fee fixes that make Chris's $5 answer real, and the one-time apply belong together: the
apply is pointless without the values, and the $5 value does nothing until new agreements read the setting.

## Acceptance
- [ ] Every registry subject has a researched `recommended` value with sources, or says why none exists (test).
- [ ] The nightly run applies each value once, only over untouched defaults, with a `DecisionRecord`, and shows one
      To do item until Chris marks them reviewed (integration test).
- [ ] Signed agreements and issued invoices are unchanged after the run (test compares rows).
- [ ] New agreements get the late fee, grace days and percent from Settings; renewals keep their old terms.
- [ ] Owner/admin can waive a late fee with a reason; it never comes back; staff cannot.
- [ ] Day-11 late fee (10-day rule for every rental) pinned by a test, including the DST change.
- [ ] `ci` green at the exact head; every review comment read.

## Progress
Built on branch `ai/claude/dec-2-starting-values` (stacked on DEC-1b, PR #603).
- [x] Registry values with sources: `src/domains/decisions/starting-values-data.ts`; new subjects `GREELEY-RATE-2F`, `LATE-FEE-AMOUNT`.
- [x] Nightly apply: `src/domains/decisions/starting-values.ts`, called from `/api/cron/books-nightly` (before the Books check so it never waits for Books).
- [x] Signed agreements and issued invoices unchanged (integration test compares rows).
- [x] New agreements / quote conversions / the wizard read the late fee from Settings; renewals keep old terms.
- [x] Waiver: already built by FEE-1 on the pending charge (the old `lateFeeWaivedAt` design is superseded); browser spec added.
- [x] Day-11 and clock-change test: `tests/late-fee-day11.test.ts`.
- [ ] `ci` green at the exact head and review comments read (see the PR).
