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
- **DEC-1a (spec 1–5) — built, PR open (branch `ai/claude/dec-1a-decisions-data`), not merged.**
  - Migration `20261026030000_decision_record`: `DecisionRecord`, `DecisionScheduledChange`, `TaxabilityRuleVersion`
    (existing rules copied from 1970-01-01), `TaxabilityRule.provisional*`.
  - Registry `src/domains/decisions/registry.ts`: 43 subjects — IN-33 (lease choice + Greeley rent), IN-34 (10 state
    default charges + 11 Greeley charges), IN-35, IN-37 (who pays + is it owed), IN-39 (bad-debt tax), IN-71, IN-79, and
    "keep what the app does now" subjects IN-44, IN-46, IN-56, IN-65, IN-07, IN-21, IN-31, IN-38, IN-52, IN-76, IN-78,
    IN-83, IN-84, IN-06. All `recommended: null` (DEC-2 fills them).
  - Reads/writes `src/domains/decisions/index.ts`: list/get (owner + admin), keep / change / ask / professional answer /
    reopen / starting value (owner only, settings row locked, subject's own `…InTx` save), preview + apply answers with
    the shared signed token (`src/lib/preview-token.ts`, bank import moved onto it), scheduled changes applied by the
    nightly `scheduled-prices` run.
  - Tax: `getTaxabilityRulesAsOf` (rule of the charge's date, scheduled changes overlaid before the nightly run), provisional
    cells (`saveProvisionalTaxabilityCell`), engine labels results `provisional`, "What gets taxed" shows "Starting value —
    not confirmed by your CPA".
  - Acceptance status: lines 1–3 and 5 covered by unit tests (fakes) and `tests/decisions-integration.test.ts`
    (throwaway Postgres, CI); line 4 (forms/import) is DEC-1b.
- **DEC-1b (spec 6–7) — built, PR open (branch `ai/claude/dec-1b-decisions-screens`).** Screens
  `/desk/settings/decisions` and `/desk/settings/decisions/import`, kit `DecisionCard` (KIT 4.22), downloads
  `/desk/settings/decisions/form?for=…&format=docx|pdf`, parser `src/domains/decisions/parse.ts`, file routes under
  `/api/desk/decisions/`, Today card, `e2e/decisions.spec.ts`. Differences from the spec (reasons in the PR): uploads go
  through the server (not `PhotoUploadField`) so the type is checked by the file's content; the PDF uses "[ ]" boxes
  (Helvetica has no ☐); "Other" is printed only for questions that accept it; download is two buttons, not a menu.
- Differences from the spec (reasons in the PR): reads take the signed-in person's id (role checked in the query);
  scheduled changes run in the always-on `scheduled-prices` nightly job, not `books-nightly` (off until Stripe books
  sync is switched on); IN-79 runs on the setup fee's planning value — the CPA-confirmed setup-fee approval stays on
  Settings › Signing charges; a preview row can also be `OTHER` ("needs a change to the app").
- Review fixes (2026-10-26): a rule saved for a cell with no history is "not decided" for earlier dates; saves on a
  setting's own screen (tax rules, Tax setup, filing basis, record keeping, Signing charges) cancel a waiting decision
  for it (audited); the attached form is bound to the preview and kept with a previewed question; a preview applies
  once; a waiting change whose decider lost owner access is cancelled with a To do instead of failing nightly.
