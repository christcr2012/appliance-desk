# STATUS — where the work stands

**Keep this file short.** Update it at the end of every session (see
`docs/PLAYBOOK.md` Step 11). Entries older than the last two batches move to
`docs/archive/STATUS-LOG.md`. The long history before 2026-10-02 is in
`docs/archive/HANDOFF-2026-09-26-to-2026-10-02.md`.

Last updated: 2026-10-03 (evening) · `main` includes the whole Batch B stack through #161 (merge b72f05d)

## Batch table

| Batch | Status | PR / branch | Evidence | Notes |
|---|---|---|---|---|
| A — Critical integrity & platform safety | **MERGED** | #136 (2026-10-02) | Full CI green; real-Postgres concurrency and adversarial auth tests | Audit registers stay open; nothing in A claims a B–F item. |
| B — Billing, provider reconciliation & financial ledger | **IN PROGRESS (core merged; follow-ups open)** | Merged to `main`: #141, #145, #146, #147, #148, #149, #151, #152, #153, #154, #159, #161 (2026-10-03) | Real-database tests for provider operations, receipts/allocations, credits, refunds, late fees, write-off races, renewals, drift workbench, statements and reports; acceptance ledger `docs/reviews/2026-10-03-batch-b-acceptance.md` with review dispositions; CI green at each merged head | Built but switched OFF (#159, #161): renewal reminders as saved notices, owner master switches for live customer email and for automatic renewals (both default OFF; see `docs/GO-LIVE-CHECKLIST.md`). Not done: the renewal lifecycle gaps R1/R2 (order of overlapping Stripe updates, billing stop after a crash), R3 (customer cancel after the first renewal), R4 (annual reminders), R6 (store provider message id), D2 (evidence rule for manual delivery); estimate follow-up claim-before-send. Owner answers still open (all in `docs/OWNER-INPUTS.md`): IN-17 (only the CPA's check of the 7.375% rate; the exact-rate work itself is done), IN-21 (month-to-month notice wording and approval to send live customer email), IN-24 (only the company-caused waiver now; the customer-caused late-return charge is built, see "Pickup and delivery billing" below), IN-25 (is the early-ending fee taxable). IN-26 and IN-27 are answered and built. Design prompt for the stronger model: `docs/prompts/DESIGN-BATCH-B-RENEWAL-LIFECYCLE.md`. The "Automatic renewals" switch must stay OFF until that is built. Scheduled early-termination execution is done (#159, ledger line 'Auto-renew consent and scheduled early termination execution'); what remains around it is that prepaid rentals ended early are settled by the owner by hand, the company-caused late-pickup waiver (Batch C, IN-24), and the per-customer terms screens (Batch D). #161 (merge b72f05d) is in `main`; #163 and #164 are docs-only and still open. Do not mark B complete until that list is empty or Chris accepts it. |
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

## Batch B — what is left (as of 2026-10-03, evening)

The core of Batch B (ledger, provider reconciliation, statements, reports, locked
terms, exact tax, held payments) is merged; see
`docs/reviews/2026-10-03-batch-b-acceptance.md` for the item-by-item evidence.
Chris asked (2026-10-03) for the leftovers to be finished inside Batch B as a
second stack, `batch-b-completion-*`, in this order. Tick each when merged:

- [x] Recommended starting terms policy (IN-19), editable by owner and admin (migration 20261003200000 writes the starting values once, only if the owner entered nothing; "Restore recommended starting terms" button in Settings; tests: recommended-terms, recommended-terms-integration, terms-policy-form)
      (this PR).
- [x] Renewals signed ahead of time get a "signed, starts later" (SCHEDULED) state (IN-22): nightly start, one-step hand-off, reports, exceptions (PR in this stack; tests `agreements-scheduled-renewal-integration`, `scheduled-renewal-rules`).
- [x] Held-payment screen: owner resolves a held payment per case (IN-23): Billing → Held payments, recommended choice highlighted (tests `billing-held-payments-integration`, `held-payment-card`).
- [x] Auto-renew and scheduled early-termination execution (nightly pass: month-to-month renewal queued for customers who agreed; agreed endings carried out with the fee invoiced, never auto-charged; prepaid rentals left for the owner; tests `agreements-auto-renew-and-termination-integration`, `auto-renew-termination-rules`). Pickup-based billing stop is Batch C (IN-24).
- [x] (renewal reminder part) Notices: saved record, held-until-delivered rule, Desk → Notices (tests `renewal-reminder`, `agreements-auto-renew-and-termination-integration`). Owner email switch built (Desk → Settings → Notifications). Still open: the month-to-month 30-day change notice, waiting on Chris's IN-21 answer.
- [ ] Term-change notices (IN-21), month-to-month part: notice record and 30-day rule; email sending
      stays OFF until Chris approves live customer email.
- [x] Out-of-order Stripe webhook cases (acceptance item 3): real-Postgres tests `billing-webhook-ordering-integration` (the code already handled them; now proven).

Moved to a later batch on purpose (not forgotten): per-customer terms screens
(estimate / setup / sign-up) and the customer- and owner-facing screens that show
a termination quote or start a renewal belong to Batch D, which owns those screens.

## Pickup and delivery billing (2026-10-03, built ahead of the Batch C design at Chris's direction)

Branch `ai/claude/pickup-billing-rules`, PR #165, stacked on #164. Chris answered
IN-24 (customer-caused part), IN-26 and IN-27 with three rules and asked for them
as owner settings; built as stated. (The first push misread rule 2 as an
"early return" credit; corrected in the same PR — `docs/DECISIONS.md`.)

- [x] Settings: Desk → Settings → Pickups and deliveries (late-return daily
      rate: monthly ÷ 30 or fixed; late-delivery credit basis: ÷ 30 or actual
      days; pickup day not billed, on by default), explained on the screen, with
      "Restore recommended values". Migrations `20261003270000_pickup_billing_rules`
      and `20261003280000_late_delivery_credit`.
- [x] Late return: one open invoice with a `Late return – [item] – [N] days`
      line per item (+ the agreement's tax) when a REMOVAL job completes with a
      pickup date after the end date, whatever the agreement's status. Never
      auto-charged. Dates come from the job's recorded/scheduled date.
- [x] Late delivery: staff tick items not delivered when completing a delivery
      job; the whole agreement bills as normal; Today lists "Item not delivered
      yet"; a later delivery job credits the missing days
      (`Credit – [item] delivered late – [N] days`) via Stripe balance credit,
      shown on the next mirrored bill; "never delivered" removal credits every
      month billed.
- [x] Pickup day not billed.
- [x] Tests: 3-day late return; pickup after the end date while still ACTIVE is
      late, no credit; one item delivered 10 days late on a 2-item agreement
      (whole agreement billed, 10-day credit); never delivered and removed →
      full credit (real Postgres); an old referral credit is not shown on a
      new bill (real Postgres); pickup on the 1st not charged; DST, rounding,
      fixed rate, actual-days basis, recorded-date handling, settings parsing.
      Full suite green on a throwaway Postgres.
- [ ] **Not built (Batch C design):** company-caused late pickup waiver (IN-24);
      the subscription rule for a missing item (Chris, 2026-10-03: delivered
      late or swapped same-type → stays; permanently cancelled → removed from
      Stripe from the next period), specified in
      `docs/prompts/DESIGN-BATCH-C-LITERAL-SPECS.md`.
- Merge of #165 is Chris's coding agent's call, not Claude's.

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

See `docs/OWNER-INPUTS.md` for the full register. Chris gave direction on
2026-10-03: IN-19 use best practice and keep it editable (starting values now
installed); IN-22 use best practice for a renewal signed in advance (built: see
"Answered" in OWNER-INPUTS); IN-23 per-case choice with a recommended option.
IN-22 and IN-23 are both built.
Still waiting on him: IN-21 (wording and approval for sending live customer
emails; building continues with sending switched off), IN-17's CPA check of the
7.375% rate.

## Session log (last two batches only)

- **2026-10-03 (Claude, pickup billing rules)** — Chris gave the three pickup/delivery billing rules (late return per day per item; an item missing from the first delivery billed with the whole agreement and credited per day on the next bill once delivered; pickup day never charged) as owner settings with defaults, to be built on the open PR (#164). Built as `ai/claude/pickup-billing-rules` / PR #165 stacked on #164: settings section with on-screen explanations, pure rule module, job-completion wiring (recorded work date, "not delivered" ticks, waiting-item records), Stripe balance credit, labeled lines on the mirrored bill, Today item, docs. First push misread rule 2 as an early-return credit; Chris corrected it and the same PR now carries the late-delivery version (one commit, one CI run). Full suite green locally on a throwaway Postgres. Open for Chris: the company-fault waiver (Batch C design).

- **2026-10-03 (Claude, Batch B close-out + review catch-up)** — Chris asked whether I was following the review-continuity rule. I was not for #151–#153 (I had only read the #148/#149 comments). Read every open Codex thread on #148–#153 (9) and dispositioned each in the close-out PR: 3 fixed in this PR (signing wording, browser test of the signing terms, legacy `SUCCEEDED` payments in statements), 1 fixed by a safety migration (old/new tax columns kept in step during deploys), 1 design doc amended (D12), 3 already fixed (evidence in PR), 1 still open (renewal shows active before its start date, IN-22). Also fixed a real race (a Stripe payment arriving while a write-off is saved) and added real-database tests for credit, webhook race, renewals and drift. Acceptance ledger: `docs/reviews/2026-10-03-batch-b-acceptance.md`. Rule from now on: every new PR starts by reading the previous PR's review threads and fixing or dispositioning each.

- **2026-10-03 (Claude, evening)** — Reviewed the two stacked PRs (#148, #149: CI green, merge not yet). Codex found two real issues on #149. Fixed one here: the signing page now shows the locked early-ending and auto-renew terms before the customer signs (stacked PR on #149; full suite 173 files / 1,210 tests on a throwaway Postgres). The other (a renewal signed early shows as active) needs Chris to choose an approach — IN-22. Review dispositions: #148 actor re-check and term-end readers — fixed in #149; #149 signing-page disclosure — fixed in this PR; #149 early-active renewal — still open (IN-22).

- **2026-10-03 (Claude, CI speed + secrets)** — Chris made the repo public (free Actions minutes) and asked for the fastest CI at equal or better quality plus secret checks. CI is now parallel (secret scan, type-check+lint, unit ×3, browser ×4, gate `ci`), runs on every push, and scans for secrets/private identifiers (`scripts/check-secrets.mjs` + gitleaks over full history). Production Neon/Vercel ids scrubbed from docs/tests (still in git history; ids only). See AGENTS.md "CI", ARCHITECTURE "CI layout and speed", DECISIONS 2026-10-03. Chris still must: enable GitHub secret scanning + push protection, set fork-PR approval to "require approval for all outside contributors", optionally rotate the production Neon password. #147/#148/#149 are stacked and unmerged; Batch B is not complete.

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

**Batch C design gate (2026-10-03).** The Batch C design is not approved unchanged: a stronger-model update (`docs/designs/BATCH-C-UPDATE-2026-10-03.md`) amends it. Asset numbering, parts ledger and scheduling can be designed and approved separately; custody/completion, swaps, maintenance chain and pickup/return billing wait for the amended design and the shared billing design (PR #161 independent review R1-R4: `docs/prompts/DESIGN-BATCH-B-RENEWAL-LIFECYCLE.md`). Owner answers still needed: IN-24 (late return by day or month), IN-26, IN-27. PR #161 merged as `b72f05d`; this drift-check branch was brought up to date with that main (clean merge, no conflicts). Assumptions A2–A10 of the old design were re-read against the code at `b72f05d` and still match; the remaining gate is the stronger model's literal schema and signatures, plus Chris's answers above. Chris confirmed on 2026-10-03 that the Oct 3 update was the whole stronger-model review and nothing newer exists, so **no Batch C slice is approved for code yet**, including asset numbering, the parts ledger and scheduling (the update requires each to have an amended, explicit design first). The prompt that asks the stronger model for that specification, in two parts (Part 1 needs no billing decisions), is `docs/prompts/DESIGN-BATCH-C-LITERAL-SPECS.md`. No Batch C code has been written.

**Batch C literal specification (2026-10-03, Claude).** Written to `docs/designs/BATCH-C-LITERAL-SPEC-2026-10-03.md` (docs only, by Claude Sonnet 5.5, not the stronger model). It covers scheduling, asset numbers, parts ledger and archival, custody, completion with per-appliance results, swaps, maintenance, inspection and permissions, the earnings correction, and Chris's missing-item subscription rule. **Waiting for Chris's approval; no Batch C code may start until he approves it in `docs/designs/README.md`.** Still blocked: C-09 pickup/return billing (shared billing contract and the IN-24 company-fault answer). No Batch C code has been written.
