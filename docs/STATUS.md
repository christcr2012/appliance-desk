# STATUS — where the work stands

**Keep this file short.** Update it at the end of every session (see
`docs/PLAYBOOK.md` Step 11). Entries older than the last two batches move to
`docs/archive/STATUS-LOG.md`. The long history before 2026-10-02 is in
`docs/archive/HANDOFF-2026-09-26-to-2026-10-02.md`.

Last updated: 2026-10-02 · `main` = `f272f51`

## Batch table

| Batch | Status | PR / branch | Evidence | Notes |
|---|---|---|---|---|
| A — Critical integrity & platform safety | **MERGED** | #136 (2026-10-02) | Full CI green; real-Postgres concurrency and adversarial auth tests | Audit registers stay open; nothing in A claims a B–F item. |
| B — Billing, provider reconciliation & financial ledger | **NEXT** | — | — | Needs owner policy inputs for renewal/termination/auto-renew financial contracts (see Owner inputs). Everything not depending on them proceeds. |
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

- **2026-10-02 (later)** — Design documents written for Batches B–F
  (`docs/designs/`), with the rule that implementation models build only
  from an approved design and stop where it is silent. B is designed
  against current code; C–F each open with a "verify before starting"
  table to re-check after the preceding batch merges.
- **2026-10-02** — Docs consolidated: new `AGENTS.md`, `START-HERE`,
  `STATUS`, `PLAN`, `PLAYBOOK`; retired plan files and old HANDOFF moved to
  `docs/archive/`. CI sharded (#137). Batch A merged (#136). Next: Batch B.
