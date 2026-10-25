# DEC-1 — Decisions & reviews center

Design: `docs/designs/DECISIONS-CENTER.md`. Build spec: `docs/build-specs/engines/DECISIONS-CENTER.md` (everything is
decided there). Approved by Chris 2026-10-25. Depends on AR-0a (kit) for the screens; the data, registry and
provisional-tax pieces (spec 1–5) can start now. Risk: **settings writes, tax engine behavior, file uploads**. Read
`docs/AI-PR-READ-FIRST.md` (authorization; uploads are a public-form-like surface for the owner only).

## Why
Open business, tax and legal questions were stalling features. Every question now runs on a starting value and
waits in one place in the app, with forms Chris can send to his CPA, attorney or translator and answers he (or his
coding agent) can bring back.

## Split (two PRs)
Reason: the data/provisional-tax change touches the tax engine and is reviewable on its own; the screens need the
kit.
- **DEC-1a** — spec 1–5 (migration, registry, reads/writes, provisional tax values) + tests.
- **DEC-1b** — spec 6–7 (screens, forms, import) + browser spec. MCP tools (spec 8) ship with MCP-3.

## Acceptance
- [ ] Every `UNDECIDED`-capable field is covered by a registry subject (test).
- [ ] Keep / Change / Ask / Enter answer / Reopen work for the owner, read-only for admins, refused for staff.
- [ ] A provisional tax value calculates and is labelled "not confirmed"; confirming keeps history.
- [ ] Downloaded .docx and PDF forms contain every open code; a filled .docx imports back to the same answers; the
      preview token prevents applying anything different from what was shown.
- [ ] Nothing can be applied to the past; signed and billed history unchanged (test).
- [ ] `ci` green at the exact head; every review comment read.

## Progress
Not started.
