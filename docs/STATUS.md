# STATUS — where the work stands

**Keep this file short.** Update it at the end of every session (see
`docs/PLAYBOOK.md` Step 11). Entries older than the last two batches move to
`docs/archive/STATUS-LOG.md`. The long history before 2026-10-02 is in
`docs/archive/HANDOFF-2026-09-26-to-2026-10-02.md`.

Last updated: 2026-10-03 · `main` = `9b5860b` (this file was stale from 2026-10-02 until now)

## Batch table

| Batch | Status | PR / branch | Evidence | Notes |
|---|---|---|---|---|
| A — Critical integrity & platform safety | **MERGED** | #136 (2026-10-02) | Full CI green; real-Postgres concurrency and adversarial auth tests | Audit registers stay open; nothing in A claims a B–F item. |
| B — Billing, provider reconciliation & financial ledger | **IN PROGRESS** | Merged: #141 (receipts), #145 (B1 ledger core), #146 (B2 reconciliation). Open, stacked: #147 `ai/claude/batch-b-term-and-tax` (WU-B10), then `ai/claude/batch-b-term-start-and-policy-settings` | Code and tests exist for WU-B1–B9 (provider ops, Stripe customer/subscription idempotency, receipts and allocations, referrals, refunds, credits, late fees, reconciliation page and cron). WU-B10 pieces in the open PR with local full-suite evidence. | Remaining: WU-B10 follow-ups (below), WU-B11 reports/statements on the ledger, WU-B12 docs for the ledger tables and rules, acceptance ledger. Owner to enter: IN-19 policy values (in the app). |
| C — Rental-to-service operations, custody, inventory & purchasing | NOT STARTED | — | — | Depends on B's ledger primitives where money is touched. |
| D — Owner/customer control plane, website, evidence & privacy | NOT STARTED | — | — | Uses B contracts for renewal/cancel UI. |
| E — Communications, reporting, growth, branding & accessibility | NOT STARTED | — | — | Google (O32) only if GW prerequisites are ready; otherwise one later PR. |
| F — Integrated verification, recovery, owner handoff & launch ledger | NOT STARTED | — | — | Human/owner gates stay explicit. |

Earlier roadmap work that is already shipped and must not be rebuilt
(details in `docs/PLAN.md` → "Already shipped"): foundation/styles/
navigation (O00, O03–O05), Today workspace, customer record tabs, lead
workbench (O06–O08), task assignment and follow-up UI (O09/O10, #134),
property context (O11, #134), preview isolation proof (O02, #134), rental
builder draft/resume (O12 partial), money presentation (O18 partial), portal
home (O20 partial), settings section saves (O21 partial), revenue and fleet
reports (O19 partial, #133), security response headers (#132), session
deny-by-default (#131), CI parallelized and sharded (#136, #137).

## Infrastructure facts that affect work

- CI: ~4.5 min per full run, 3 browser shards (`e2e/shards.json`). Budget ≤ 5 min.
- Preview deployments use an isolated Neon branch and a Preview-only private
  file store; preview photo-upload and backup APIs are deliberately disabled.
  Evidence: `docs/plans/overhaul/PREVIEW-ISOLATION-PROOF.md`.
- Stripe is in **test mode**. Customer email/SMS sending is **off**. Public
  sign-up is **disabled** (accounts are provisioned server-side).
- Production `Photo` table was confirmed empty/test-only before private media
  landed (Batch A); no media migration was needed.
- Chris plans to upgrade the Neon plan for protected branches and per-preview
  database branching; not done yet.

## Batch B — what is left (as of 2026-10-03)

- **Done in the WU-B10 PR:** Colorado billing-period helper with DST tests,
  early-termination quote/request, renewal draft, auto-renew consent, tax
  rounding helpers (thousandth-percent), policy fields exposed in settings.
- **Done in the stacked term-start PR (`ai/claude/batch-b-term-start-and-policy-settings`):**
  fixed terms start at delivery (end date saved at first billing attempt, sent
  to Stripe as `cancel_at`), and Settings → "Ending and renewing rentals" lets
  the owner enter every termination/renewal value in the app.
- **Done in the locked-terms PR (stacked on the term-start PR):** agreements keep
  their own ending/renewal terms (frozen when sent for signing; per-customer
  override stored but no screen yet), quotes and auto-renew use those locked
  terms, customers can act on their own agreement, the early-termination request
  time is set by the server, renewal drafts keep their agreed start date, term-end
  readers use the saved end date, settings writes re-check the active owner/admin,
  and ending early needs published wording. This fixed all 5 Codex findings on
  #147/#148 (dispositions in the PR). New process: review fixes ride the next
  planned PR (AGENTS.md).
- **Not done, honestly:** (0) 30-day notice to customers when terms change,
  month-to-month terms taking effect after that notice, the notice email (live
  customer email needs Chris's approval), and per-customer terms screens
  (estimate/setup/sign-up) — planned for the next PR; agreements sent for
  signing before this change have no locked terms; (1) Chris has not entered the policy values yet, so
  early-termination quotes and auto-renew are unavailable until he does (IN-19);
  (2) tax rate storage, settings screen, agreement snapshot and Stripe tax-rate
  creation still use tenths of a percent (IN-17 follow-up); (3) renewal drafts
  carry no appliance assignments and nothing acts on auto-renew consent yet;
  (4) no customer- or owner-facing screen shows a termination quote or starts a
  renewal yet (Batch D); (5) WU-B11 and WU-B12; (6) the new settings tab's
  accessibility scan and form were verified locally by unit/component tests, but
  the browser test of it runs first in CI.

## Open items carried across batches

- Historical review threads: ~50 remain open in
  `docs/reviews/2026-10-01-review-reconciliation.md`; each batch discharges
  the ones in its area with evidence.
- B01–B36 (`docs/reviews/2026-10-01-business-logic-audit.md`): mapped into
  Batches B–F; none accepted yet.
- Audit findings: 8 Critical were Batch A's scope; the 58 High / 51 Medium are
  mapped per batch in `docs/PLAN.md`. Launch gates are in `docs/PLAN.md`.
- O29 CSV import: deferred until a real import dataset exists.
- O32 Google Workspace: conditional; see Batch E.

## Owner inputs currently blocking something

See `docs/OWNER-INPUTS.md` for the full register. The ones Batch B needs:

- Early-termination fee policy, unused-term/refund policy, auto-renew terms
  and notice periods (B34–B36 financial contracts). Build the
  provider/ledger plumbing without them; keep policy-dependent behavior
  unexercised until answered.
- Tax precision policy (if the ledger corrections require a rounding
  decision).

## Session log (last two batches only)

- **2026-10-03 (Claude, locked terms)** — Chris: terms must be changeable system-wide without touching existing agreements, 30-day notice for month-to-month, per-customer customization; review fixes ride the next PR. Built locked terms + the 5 Codex fixes on a branch stacked on the term-start PR.

- **2026-10-03 (Claude, later)** — Chris answered IN-20 (terms start at delivery) and said policy values must be settable in the app. Built both on a branch stacked on #147; local full-suite evidence in the PR.

- **2026-10-03 (Claude)** — Reviewed repo state (STATUS was behind: B1/B2 had merged). Built WU-B10 mechanism on `ai/claude/batch-b-term-and-tax`: tests ran locally against a throwaway Postgres. Found the fixed-term end-date gap (IN-20). Chris asked for stacked PRs in smaller chunks (see DECISIONS).

- **2026-10-02 (later)** — Design documents written for Batches B–F
  (`docs/designs/`), with the rule that implementation models build only
  from an approved design and stop where it is silent. B is designed
  against current code; C–F each open with a "verify before starting"
  table to re-check after the preceding batch merges.
- **2026-10-02** — Docs consolidated: new `AGENTS.md`, `START-HERE`,
  `STATUS`, `PLAN`, `PLAYBOOK`; retired plan files and old HANDOFF moved to
  `docs/archive/`. CI sharded (#137). Batch A merged (#136). Next: Batch B.
