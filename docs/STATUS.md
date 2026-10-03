# STATUS — where the work stands

**Keep this file short.** Update it at the end of every session (see
`docs/PLAYBOOK.md` Step 11). Entries older than the last two batches move to
`docs/archive/STATUS-LOG.md`. The long history before 2026-10-02 is in
`docs/archive/HANDOFF-2026-09-26-to-2026-10-02.md`.

Last updated: 2026-10-02 · `main` = `4ea3653`

## Batch table

| Batch | Status | PR / branch | Evidence | Notes |
|---|---|---|---|---|
| A — Critical integrity & platform safety | **MERGED** | #136 (2026-10-02) | Full CI green; real-Postgres concurrency and adversarial auth tests | Audit registers stay open; nothing in A claims a B–F item. |
| B1 — Ledger/referrals/refunds/late fees | **PR OPEN** | #145 · `ai/chatgpt/batch-b-ledger-core` | Real-Postgres referral, refund, write-off/payment and late-fee race coverage; normal CI running | Split from Batch B at the clean WU-B8 boundary to reduce review/CI scope. |
| B2 — Provider reconciliation, terms/tax, reporting & closeout | **IMPLEMENTED; VALIDATE AFTER B1** | `ai/chatgpt/batch-b-referral-ledger` | Provider-recovery, authorization, term/tax, ledger/report tests on branch | Keep stacked work intact; open B2 only after B1 validates/merges so we do not run two full CI cycles simultaneously. |
| C — Rental-to-service operations, custody, inventory & purchasing | NOT STARTED | — | — | Depends on B's ledger primitives where money is touched. |
| D — Owner/customer control plane, website, evidence & privacy | NOT STARTED | — | — | Uses B contracts for renewal/cancel UI; owner policy values remain a separate input. |
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

## Batch B implementation facts

- `Receipt` is the incoming-cash event; `Payment` allocates receipt cash to an
  invoice. Combined payments and overpayments therefore count as cash once.
- Refund-to-credit changes settlement but is not cash leaving the business;
  actual invoice refunds and deposit refunds are cash outflows.
- Provider writes that can outlive a request use durable operation state and
  preserve ambiguous outcomes for reconciliation rather than guessing.
- Sales-tax storage keeps the legacy `taxRatePermille` field name but Batch B2
  uses thousandths of one percentage point (`7375 = 7.375%`) and migrates old
  stored values without changing their effective rate.
- Early-termination quotes land on billing anniversaries rather than prorating
  a partial billing period. Renewal creates a linked DRAFT; auto-renew consent
  is explicit and disabling it does not cancel an agreement.

## Open items carried across batches

- Historical review threads are tracked in
  `docs/reviews/2026-10-01-review-reconciliation.md`; each batch discharges
  the ones in its area with evidence.
- B01–B36 (`docs/reviews/2026-10-01-business-logic-audit.md`) remain mapped
  across Batches B–F; only work with direct implementation/evidence is closed.
- Audit findings and launch gates remain mapped in `docs/PLAN.md`.
- O29 CSV import: deferred until a real import dataset exists.
- O32 Google Workspace: conditional; see Batch E.

## Owner inputs currently blocking something

See `docs/OWNER-INPUTS.md` for the full register.

- Nothing blocks B1 or the B2 domain implementation. IN-17 tax precision is
  answered and implemented on B2.
- IN-19 (actual termination/renewal policy values and customer-facing terms)
  blocks later policy UI/activation, not the Batch B plumbing.
- Live Stripe activation remains separately gated by IN-08.

## Session log (last two batches only)

- **2026-10-02 (Batch B split)** — At Chris's request, split the large Batch B
  PR plan in half. #145 contains only B6–B8 ledger/referral/refund/late-fee
  work. B9–B12 remain intact on `ai/chatgpt/batch-b-referral-ledger` and will
  be validated/opened only after B1 completes.
- **2026-10-02 (Batch B implementation)** — Implemented provider recovery,
  reconciliation/drift inspection, term/tax contracts and ledger-based report
  corrections on the B2 branch; static audit also corrected checkout tax
  precision, anniversary-aligned termination, ambiguous cancellation recovery,
  and refund-to-credit cash classification before PR validation.
