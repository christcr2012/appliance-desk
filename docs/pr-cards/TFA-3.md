# TFA-3 — Watching official sources and updating itself

Build spec: `docs/build-specs/engines/TAX-FEE-AUTOPILOT.md` sections 12–17. Requested by Chris 2026-10-25. Depends on
TFA-1. Risk: **tax rule changes** — always approved by Chris on To do (his rule, 2026-10-25); strict parsers.

## Acceptance
- [x] The official-page watches are on (owner switch) and read daily inside each rule's known change window.
- [x] Strict parsers for the RDF rates, Greeley rate, IRS 1099 threshold and Colorado interest; a changed page layout → "couldn't read", never a guess (fixture tests).
- [x] Every reading that differs goes to To do for Chris to approve; nothing is applied automatically (test); the old rate auto-apply starts off.
- [x] Greeley's post-election rate goes through the existing rate review path (Approve on To do).
- [ ] No network in CI; `ci` green at the exact head; every review comment read.

## Progress
Built on `ai/vivienne/tfa-3-final` (Vivienne, 2026-10-26):
- Migration `20261104000000_tfa3_rule_watches`: `LegalRuleObservation` table, `OfficialSourceWatch.parserKey`,
  `BusinessSettings.watchOfficialTaxPages` (starting value on), activates the six seeded watches, adds three
  parser watches (RDF rates, IRS 1099 instructions, Colorado penalties & interest), and turns the old GIS rate
  auto-apply off as the starting value (schema default + existing rows).
- Four strict parsers (`src/domains/rules/parsers/`) read the saved official pages: RDF (six parts must sum to
  the stated total), Greeley rate, IRS 1099 threshold (MISC and NEC amounts must agree; the December revision
  stamp sets the tax year), Colorado interest (discounted/regular columns in the page's own order). Anything
  unexpected returns "couldn't read" — never a guess. Known limitation: the live Greeley page does not state
  its rate in a sentence yet, so its watcher reports "couldn't read" until the city publishes one; the
  post-election rate flows through the rate review path and the GREELEY-RATE-2F decision.
- Readings are stored per business day (`LegalRuleObservation`); a reading that differs from the rule book
  appears on To do as "Rule change to review" with the evidence, read-once vs read-the-same-way-on-2-days
  confidence, and a plain-words plausibility note. Approve writes an OFFICIAL_WATCH rule version for the date
  the page states (late approvals ride the TFA-1 true-up); "Not right" dismisses it and the same reading
  never asks again. Nothing is applied without Chris's Approve (gate TFA-3-G2).
- Greeley (gate TFA-3-G3): TaxRateVersion stays the writer of record — bills read it. Every Greeley approval
  or manual save also mirrors the same value and date into a `greeley.sales_rate` rule version, so the Rules
  screen and the bills always agree. Greeley's own rate always waits for review, even if auto-apply is on.
- Cadence: weekly on Mondays; daily inside each parser's window (RDF Apr 15–Jul 1; IRS 1099 and Colorado
  interest Nov 1–Jan 31; Greeley Nov 4–Dec 31, 2026). Hash-only watches keep the old behavior.
- Rules screen gains the owner-only "Watch the official tax pages" switch; the setup screen explains that
  auto-apply off means every new rate waits on To do.
- DQ-TFA3-1..4 filed in `docs/OWNER-INPUTS.md` for the CPA (section 17 questions, starting values in place).
- Review round 1 (PR #646 CI + Codex): the CI unit shard caught two T-5b1 assertions pinning the pre-TFA-3
  starting values (auto-apply on, watches seeded inactive) — updated to the TFA-3 values, and the metadata
  suite joined SHARED_SETTINGS_TESTS because it asserts on the seeded watches the watch suite toggles.
  Three Codex findings fixed with regression tests: parser failure counts reset only after a successful
  reading (repeated couldn't-read failures reach the warning count; unread pages are not marked seen);
  dated readings compare to the rule in force on their own date, so a past-period correction still asks;
  a Greeley rate first read after its start date is recorded, surfaces in rate review, and can be applied
  by the owner from its real start date (the automatic path still never applies into the past).
- Local evidence: parsers 13/13; observation integration 9/9; watch integration 18/18; rate review 6/6;
  Today role access 11/11; registries 24/24; backup/automation/cron/exceptions suites 45/45 — all on
  throwaway Postgres via the repo launcher. Browser proof is CI's `e2e/tax-rules.spec.ts` (watch switch).
