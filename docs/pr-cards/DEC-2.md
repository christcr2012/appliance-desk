# DEC-2 — Researched starting values in the live app

Build spec: `docs/build-specs/engines/STARTING-VALUES.md`. Values and sources: `docs/research/2026-10-25-open-decisions.md`.
Approved by Chris 2026-10-25 (apply researched starting values live; never touch signed or billed history).
Depends on DEC-1a. Risk: **tax charged on customer bills, late fees, settings writes** — read
`docs/AI-PR-READ-FIRST.md` and say in the PR how each applicable item is honored.

## Why
Questions with no answer were left as "UNDECIDED", which stopped features. Each now runs on the most likely answer
for a new Greeley rental business, labelled "Starting value — not confirmed", and waits for Chris or his CPA.

## One PR
Registry values, the late-fee fixes that make Chris's $5 answer real, and the one-time apply belong together: the
apply is pointless without the values, and the $5 value does nothing until new agreements read the setting.

## Acceptance
- [ ] Every registry subject has a researched `recommended` value with sources, or says why none exists (test).
- [ ] The nightly run applies each value once, only over untouched defaults, with a `DecisionRecord`, and puts one
      To do on Chris's list (integration test).
- [ ] Signed agreements and issued invoices are unchanged after the run (test compares rows).
- [ ] New agreements get the late fee, grace days and percent from Settings; renewals keep their old terms.
- [ ] Owner/admin can waive a late fee with a reason; it never comes back; staff cannot.
- [ ] Day-6 late fee pinned by a test, including the DST change.
- [ ] `ci` green at the exact head; every review comment read.

## Progress
Not started.
