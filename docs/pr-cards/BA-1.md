# BA-1 — Books record themselves: nightly recording, automatic enrollment and depreciation, retirement and disposal connected

Build spec: `docs/build-specs/engines/BOOKS-AUTOPILOT.md` section 1 (everything decided there; section 0 lists the
code gaps this fixes). Design: `docs/designs/BOOKS-AUTOPILOT.md`. Approved by Chris 2026-10-25. Risk: **books
entries (money records)** — never edit or delete entries; corrections are new entries; locked months stay locked.


## Acceptance
- [x] Focused unit/real-Postgres and browser acceptance suites ran green at `e033e291` (CI run 40310404105); merged-main head requires revalidation.
- [x] Existing person-facing Books flows retained; source posting, retirement and automatic record paths covered in regression/browser suites.
- [ ] `ci` green at the exact head; every review comment read.

## Implementation plan and evidence checklist

- [x] Add additive book-asset, settings and problem-record migration; update schema and database notes (migration applied in CI).
- [x] Refactor books writes to a checked person/equipment/automatic writer without exposing automatic writes to server actions (guard unit test).
- [x] Run nightly source posting even when Stripe sync is off; automatically enroll eligible appliances and post completed-month depreciation (nightly integration and route tests).
- [x] Surface missing acquisition evidence, unposted sources and nightly failures as actionable To do items (durable problem model and Today integration).
- [x] Connect equipment retirement, scrap/disposal, reopening and retired-appliance sales to balanced, reversible book entries without blocking equipment removal on a books error (disposal integration test).
- [x] Record qualifying money events promptly, best-effort after the business transaction commits (purchases, receipts, direct and approved write-offs/expenses, refunds, and paid-invoice/Checkout/refund webhooks; hooks are independent of live payment switches).
- [x] Cover concurrency, 360-month catch-up, batch rotation, locked months, permissions and disposal cycles in focused throwaway-Postgres tests (green at `e033e291`).
- [ ] Run exact-head CI and review every comment before an authorized merge. Codex review on `0d17ac10` found pause-key compatibility, unenrolled retirement, and pre-retirement disposal-date problems; all three addressed with regression tests in this patch and require fresh exact-head proof.

**Execution checkpoint (2026-10-25):** Before creating PR #610, confirmed no BA-1 implementation PR was open; based this branch on main `af5acc647cd35a9d3c93211e135c7c2f743b02b6`. This plan is not implementation evidence. Local checkout has no GitHub network access; use the repository's documented GitHub REST publishing fallback and free GitHub Actions checks.

## Progress
2026-10-25 — Implemented on `ai/chatgpt/ba-1`: additive migration, trusted
book writers, nightly recording with auto-enrollment and completed-month depreciation,
actionable books problems, Equipment retire/disposal/reopen journal connections,
and best-effort post-commit manual receipts, refunds, purchases and write-offs.
Unit and disposable Postgres tests cover guard boundaries, retirement/disposal cycles,
basic nightly catch-up and missing-cost exceptions. The cron's Stripe switch is
covered by a focused unit test.

**Proof:** Full GitHub Actions run 40310404105 passed secret scan, type-check/lint, all three unit/real-Postgres shards and all four browser shards at `e033e291`. A merge reconciliation with newer main commits is in preparation; this past run is not evidence for the later merge commit.

**Still to verify before BA-1 merge:** Resolve the concurrent billing branch changes without losing either feature, run exact-head CI again, and read every fresh review comment.
Expense approvals now commit before best-effort posting; pending journal errors remain visible and retry nightly.
No real business or production data touched.
