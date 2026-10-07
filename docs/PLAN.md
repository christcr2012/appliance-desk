# PLAN — executable program plan

This is the executable plan. Completed batches remain here as the acceptance history; `docs/STATUS.md` identifies what is still next. Each active batch is implemented as the reasonably sized PR stack required by `AGENTS.md`, not one giant PR. Read the active batch's section fully; it is written to stand on its own. The audit root
causes behind it are in `docs/AUDIT_SYNTHESIS.md` (RC1–RC12), the detailed
findings in `docs/audits/Package-N-*.md` (cited as `P<package> <C|H|M><n>`),
and the business audit items in `docs/reviews/2026-10-01-business-logic-audit.md`
(`B01–B36`). The original overhaul cards (O00–O32) are folded in below; their
requirements are quoted inline so you do not need the archived card file.

Order: **A, B, C, R, B2, D, E, E2 (merged) → F-part-1 (backup/restore, media, capacity, runbooks) → G (audit fixes, owner security) → T (Colorado sales and use tax) → V (premium visual redesign) → F-part-2 (scenarios, owner guide, launch ledger) → launch → K (books and accounting exports) → O (owner controls) → P (ideas Chris picks)**, plus the deferred Google PR. G, T, V, K and O were added 2026-10-06 and approved by Chris the same day, together with the F split (IN-40, IN-41, IN-42). The step-by-step version with prerequisites is `docs/MASTER-ROADMAP.md`.
`docs/STATUS.md` says which one is next.

**Every batch has a design document in `docs/designs/` that says *how* to
build it** — decisions already made, exact schema, function signatures,
ordered work units, named tests, and where to stop and ask. This plan is
the *what* and the acceptance; the design is the *how*. Implementation
starts only from an approved design (`docs/designs/README.md`).

## Rules that apply to every batch

These are the acceptance requirements every batch inherits (the old plan
called this "gate G"):

- Focused behavioral tests for every new rule, permission and failure path;
  real-Postgres tests for anything concurrent or transactional.
- Type-check, lint, full CI green (throwaway Postgres, migrations,
  upgrade drill, build, browser/axe), and a Vercel preview that is clicked
  through.
- UI work is checked at 360 / 768 / 1440 px widths, by keyboard, and in light
  and dark themes; axe reports no violations.
- New tables or columns are added to backup/export coverage and the
  schema-health check, with the populated-upgrade drill asserting old rows
  keep sane defaults.
- No customer fixtures, test emails, or reset scripts against the live
  database. Stripe stays in test mode. No live message sending.
- The batch's PR description carries the acceptance checklist with evidence.
- Owner policy items (listed per batch) are inputs, not things to invent.
  Build the mechanism; leave the policy-dependent behavior switched off and
  listed in `docs/OWNER-INPUTS.md` until Chris answers.
- Business time is America/Denver (store UTC); DST edges are tested.
- Reuse what exists. The "Already shipped" list below is not to be rebuilt.

## Already shipped — do not rebuild

| Area | What exists | Where |
|---|---|---|
| Foundation & navigation (O00, O03–O05) | Semantic Evergreen tokens, desk primitives (page header, section card, empty state, filter bar), grouped responsive navigation with mobile drawer, role-aware nav model | `src/components/desk/`, `src/app/desk/layout.tsx`, `globals.css` |
| Today workspace (O06) | Role-safe summaries, due tasks, exceptions, Denver day boundaries | `src/app/desk/today` |
| Customer record (O07) | Overview/Properties/Rentals/Service/Billing/Activity tabs, paginated timeline with stable cursors | `src/app/desk/customers/[id]` |
| Lead workbench (O08) | Filters, next-action layout, quote status from estimates, guarded conversion | `src/app/desk/leads` |
| Tasks (O09/O10) | Assignee/priority/version on StaffTask, Mine/Unassigned/Team/Completed views, note-to-task, conflict-preserving editor | `src/domains/tasks`, `src/app/desk/tasks` (#134) |
| Property context (O11) | Property selector with rentals/jobs/requests, cross-customer rejection | customers panels, jobs/new, agreements/new (#134) |
| Preview isolation (O02) | Preview DB branch, Preview-only private store, non-sending mode, runtime proof | `docs/plans/overhaul/PREVIEW-ISOLATION-PROOF.md` (#134) |
| Rental builder (O12, partial) | Stepper with durable draft checkpoints, resume, actor-scoped draft dedupe, agreement progress milestones | `src/app/desk/agreements/new` |
| Estimates | Staff-created estimates with no-login customer approval; conversion to agreement shells (made atomic in Batch A) | `src/domains/estimates` |
| Money presentation (O18, partial) | Invoice/statement views, filtered lists, exact document links, Jobber-style invoice document | `src/app/desk/billing` |
| Reports (O19, partial) | Revenue definitions with drill-through; fleet/asset cost & utilization report | `src/app/desk/reports` (#133) |
| Portal home (O20, partial) | Session-derived identity, bounded DTOs, next visit, open invoice, problem/pickup paths | `src/app/account` |
| Settings (O21, partial) | Section-specific saves with field whitelists, atomic settings+audit, price-save feedback | `src/app/desk/settings` (#130) |
| Work orders, print documents | Printable work order per job; shared print button | `src/app/desk/jobs/[id]/work-order` |
| Security | Response headers verified (#132); sessions deny-by-default for malformed/deactivated (#131); public sign-up disabled, trusted provisioning, private evidence media, DB-backed rate limiting, STAFF offboarding fence (#136) | `src/lib/auth.ts`, `src/lib/rate-limit.ts`, `src/lib/session.ts` |
| Billing | Stripe test-mode subscriptions, webhooks made atomic with dedupe (#128), prepaid guard (#125), manual payments & write-offs serialized (#136) | `src/domains/billing` |
| CI | Parallel jobs, docs-only fast path, 3 browser shards, ≤5-min budget | `.github/workflows/ci.yml`, `e2e/shards.json` |

---

## Batch A — Critical integrity & platform safety — MERGED (#136)

What it established, and what later batches must reuse rather than reinvent:

- **Atomic state claims.** Every read-then-write transition runs in a
  transaction that locks the row (`SELECT … FOR UPDATE`) and checks the
  expected state/version. Pattern lives in agreements, estimates, manual
  payments, maintenance transitions. Copy it; do not write a new one.
- **`assertActiveTeamActor`** — shared transactional guard that re-checks the
  acting staff member inside the transaction, so deactivation wins over an
  in-flight write.
- **Trusted provisioning** replaces public sign-up (`scripts/create-ci-login.ts`
  for CI; server-side provisioning in app code). Unattached CUSTOMER users
  cannot be adopted by email alone. Password reset revokes sessions.
- **Private evidence media** by default with authenticated photo reads;
  catalog/marketing imagery stays public.
- **Shared Postgres-backed rate limiter** on public contact, launch signup,
  signing and estimate-response paths.

The eight Critical findings (P1 C1, P1 C2, P2 C1, P6 C1, P8 C1 and the
Stripe-identity ones P2 C2/C3/C4 as far as local atomicity goes) are closed
or moved to Batch B where they are provider-side. Nothing in A claims a B–F
outcome.

---

## Batch B — Billing, provider reconciliation & financial ledger — MERGED (leftovers in B2)

**Design: `docs/designs/BATCH-B.md`** — read it in full before Step 2 of the playbook; its work units are the commit order.

### Purpose

Make money and provider state durable, reconcilable, and reportable from one
coherent ledger model, so every later batch can trust it.

### Open these first

`docs/AI-PR-READ-FIRST.md` (blocking), `docs/BUSINESS-RULES.md` (billing,
fees, deposits, referrals), `docs/DATABASE.md` (billing tables),
`docs/audits/Package-2-Agreements-Pricing-Referrals.md`,
`docs/audits/Package-5-Configuration-Reporting.md`,
`docs/audits/Package-8-Operational-Core-Residual-Risk.md` (billing sections),
`docs/AUDIT_SYNTHESIS.md` RC2 and RC3, `src/domains/billing/webhooks.ts`,
`src/lib/stripe.ts`.

### Deliverables

1. **Durable Stripe identity.** One canonical Stripe Customer per local
   Customer under concurrency/retry (P2 C4); durable Stripe subscription ID
   with recovery when the local write fails after the provider call succeeded
   (P2 C2); durable product/object identity where needed. Pattern: record the
   intent locally first, call the provider with an idempotency key, reconcile
   on return or on the next webhook.
2. **Referral reward ledger** that is idempotent per side (P2 C3): a reward
   cannot duplicate or partially replay.
3. **Late fees exactly once** under concurrent cron runs (P2/P8).
4. **Provider/local close & cancel reconciliation**: cancelling locally and
   at Stripe cannot drift; a write-off cannot override a racing paid invoice.
5. **Receipt and allocation model** (P5/P8): one allocation/receipt record
   so overpayment, refunds, credits and deposit liability are represented
   exactly once and are not double-spendable; gross/net/refund/deposit/tax/
   credit line categories are explicit.
6. **Refund, credit and deposit-liability decision workflows** at the domain
   level (owner decision UI is Batch D).
7. **Business-audit items** B03, B06, B09, B12, B13, B18, B22, B28, B31
   (read each row in the B-register; implement the financial part here, UI
   in D).
8. **Fixed-term boundary + renewal/termination/auto-renew financial
   contracts** (B34–B36) — the ledger and provider plumbing; policy values
   come from owner inputs.
9. **Financial effective-date / business-calendar semantics** (RC10 for
   money): billing dates and periods computed in America/Denver, one shared
   helper.
10. **Read-only drift workbench**: a desk view listing local-vs-Stripe
    mismatches with no automatic repair.
11. **Statements and reports** consume the corrected primitives (customer
    statement reconciles to invoice/payment/refund/credit detail). Keep the
    existing invoice/statement presentation; change what feeds it.

### Acceptance checklist

- [ ] Provider-success/local-failure reconciliation tests for customer,
      subscription and referral paths.
- [ ] No duplicate Stripe Customer / subscription / referral credit under
      concurrency or retry (real-Postgres tests with simulated provider).
- [ ] Webhook out-of-order and unknown-state scenarios reconcile without
      loss or double-apply (extends #128's dedupe tests, does not replace them).
- [ ] Late fee exactly once under concurrent cron invocations.
- [ ] Write-off cannot override a racing paid invoice.
- [ ] Gross / net / refund / deposit / tax / credit category tests.
- [ ] Manual overpayment produces one receipt with no double-spendable credit.
- [ ] Customer statement totals reconcile to line detail in a fixture that
      includes refunds, unpaid and partially paid invoices.
- [ ] Fixed-term end, renewal, cancellation and auto-renew scenarios do not
      overlap subscriptions or double-charge a deposit (policy values
      parameterized).
- [ ] Drift workbench lists seeded mismatches and performs no writes.
- [ ] Stripe test mode only; no live keys touched.
- [ ] `docs/BUSINESS-RULES.md` updated for every rule that changed;
      `docs/DATABASE.md` for every table.
- [ ] Every item in "Rules that apply to every batch".

### Owner inputs / gates

Termination fee, unused-term/refund policy, auto-renew terms and notice
periods, tax precision policy, and any live reconciliation/collection
approval. Build around them; do not invent values.

### Not in this batch

Owner decision screens (D), customer-facing renewal UI (D), message sending
for billing reminders (E), live payment activation (owner gate).

---

## Batch C — Rental-to-service operations, custody, inventory & purchasing — MERGED (item 14 in B2)

**Design: `docs/designs/BATCH-C.md`** — read it in full before Step 2 of the playbook; its work units are the commit order.

### Purpose

Make the physical operation match the database: scheduled intent, real
custody, service work, return, inspection and parts usage.

### Open these first

`docs/BUSINESS-RULES.md` (rental lifecycle, jobs, maintenance, inventory
statuses), `docs/plans/overhaul/DESIGN.md` sections 6–8 (dispatch, driver,
appliance screens), `docs/audits/Package-8-*.md`, `docs/audits/Package-1-*.md`
(maintenance), `docs/AUDIT_SYNTHESIS.md` RC4, `src/domains/jobs`,
`src/domains/inventory`, `src/domains/maintenance`, `src/domains/purchasing`.

### Deliverables

1. **Job duration and assignment contract (O13).** On Job: optional active
   staff assignee, `durationMinutes`, `version`. Null duration uses the
   documented 120-minute advisory fallback — no fake backfill. Conflicts are
   computed on time intervals for the same assignee; an unassigned job is
   visibly unassigned; stale edits are rejected; completion side effects are
   unchanged. Tests: overlaps, end = start boundary, DST, archived assignee,
   concurrency.
2. **Dispatch and job detail UI (O14).** Duration/assignee controls, conflict
   explanation, explicit reschedule confirmation naming the affected
   customer/job; agenda view default on phone. A schedule change never
   silently sends a customer message; cancelled/completed jobs do not show
   as active; the unscheduled queue stays.
3. **Partial / no-show / reschedule workflow** with explicit outcomes
   recorded on the job.
4. **Field and maintenance workflow polish (O15).** Driver view with large
   controls, job context, checklist → photos → notes order, upload
   progress/errors, customer request linked to its job. A failed upload or
   network error never claims completion; repeated completion never bills
   twice; checklist policy unchanged.
5. **Custody truth (RC4).** Inventory assignment history reflects the real
   handoff (delivery/return completion), not planned workflow; swap intent is
   staged until physical completion; cancelled/rescheduled swap leaves
   original custody intact; concurrent swap/replacement cannot double-book.
6. **Inspection evidence.** Checklist pass evidence and version enforced at
   return/inspection; terminal checklist corrections keep history.
7. **Appliance record overhaul (O16).** Overview/history/photos/costs/parts
   tabs; condition, status, location and next guided action; no direct status
   bypass; rental history and inspection evidence preserved; repair earnings
   labelled as estimates; QR is not a private-data backdoor.
8. **Appliance-line removal/history model repair**; asset-number
   concurrency with defined batch semantics.
9. **STAFF authority is job-scoped to the current action**, not a
   historical link; job/appliance scope validation on every mutation (P8).
10. **Maintenance scheduling** requires a correctly linked job, request,
    appliance, customer and property.
11. **Purchasing usability (O17A)** on shared patterns, no migration:
    receiving cannot exceed remaining quantity; no double stock entry.
    **O17B** (optional reorder point + supplier preference, read-only low-stock
    suggestions) only if the data contract is justified; null threshold means
    no low-stock claim.
12. **Supplier/part archival and auditability**; part over-consumption
    discrepancy policy; `JobPartUsage`/cost provenance so there is one truth
    for parts cost.
13. **Business-audit items** B02, B04, B05, B10, B14, B16, B17, B25, B29,
    B32, B33; capture the demand inputs B26 will need later.
14. **(Moved to Batch B2, 2026-10-05: `docs/designs/BATCH-B2.md` WU-B2-9.)** **Billing stops at pickup/return (owner requirement IN-24, 2026-10-03; design work unit C-09 in `docs/designs/BATCH-C-UPDATE-2026-10-03.md`; blocked on the shared billing design and IN-26/IN-27).** Completing the pickup or return job ends billing on that date. If the pickup happens after the agreed end date, the job records whether the delay was the customer's or the company's; company-caused delay means the days after the agreed end date are not billed (waived, with an audit record and a plain-English line on the statement). Build on the early-ending/auto-renew execution already merged (`src/domains/agreements/termination-execution.ts` ends the rental and sets Stripe's end date on the agreed date); customer-caused lateness is built (by the day, owner setting; PR #165), as is the late-delivery credit (IN-26) — the remaining pieces are the company-fault waiver and the subscription rule for a missing item (delivered late or swapped same-type: stays; permanently cancelled: comes off Stripe from the next period; Chris 2026-10-03, specified in `docs/prompts/DESIGN-BATCH-C-LITERAL-SPECS.md`). Tests: late by company waives, late by customer bills per the chosen rule, DST day boundaries.

### Acceptance checklist

- [ ] One real-DB + browser scenario: lead/customer → agreement/reservation
      → schedule delivery → deliver → billing-ready handoff → maintenance
      request → visit or swap → removal → inspection → available/maintenance
      disposition.
- [ ] Cross-customer / cross-agreement appliance tampering denied.
- [ ] Cancelled or rescheduled swap leaves original custody intact.
- [ ] Concurrent swap/replacement: second one sees unavailability.
- [ ] Job lifecycle conflict creates no silent contradiction.
- [ ] Assignment history timestamps equal the physical handoff time.
- [ ] Concurrent inventory creation yields unique human asset numbers.
- [ ] Receiving / usage / discrepancy / job cost reconcile in a fixture.
- [ ] Driver and dispatch surfaces pass phone / keyboard / axe checks.
- [ ] Dispatch and reminder day boundaries correct in America/Denver incl. DST.
- [ ] Existing lifecycle / swap / return / concurrency tests still pass.
- [ ] Every item in "Rules that apply to every batch".

### Owner inputs / gates

Three owner answers gate the money rules in item 14 (pickup/return billing) and must be collected before that work is built: **IN-24** (a customer-caused late return bills by the day or by the whole month; company-caused delay is already decided: not billed), **IN-26** (if only part of an order is delivered, billing starts for the delivered items or waits for the whole order) and **IN-27** (whether the pickup day counts as a billable day). Nothing may bill on a guess. These answers do not gate asset numbering, the parts ledger/archival or scheduling, but no slice may be built until it has an approved design with literal schema and signatures (see `docs/designs/BATCH-C.md`, approval table at the top). Reorder-point feature (O17B) only if justified.

### Not in this batch

Owner decision UI for deposits/refunds (D); automation run history (E).

---

## Batch B2 — Renewal lifecycle, month-to-month rentals and pickup billing end (finishes Batches B and C) — MERGED (#205–#208)

**Design: `docs/designs/BATCH-B2.md`** (written 2026-10-05; approved by Chris 2026-10-05).

### Purpose

Close the last open pieces of Batches B and C so automatic renewals *can* safely be switched on later: the independent
review of PR #161 (`docs/reviews/2026-10-03-pr161-independent-review.md`, findings R1–R7, D1, D2), the month-to-month
30-day terms-change notice mechanism (IN-21), and Batch C item 14 / work unit C-09 (stop billing at return; company-delay
waiver, IN-24). Nothing is switched on by this batch.

### Deliverables

1. One stored, versioned "when should Stripe stop billing" answer per subscription, saved with every decision that
   changes it and applied to Stripe by one worker at a time, newest decision wins (R1, R2).
2. Customers can end a month-to-month rental online, including after a fixed term rolls over (R3).
3. Annual reminders for continuing month-to-month rentals, tracked across replacement agreements (R4).
4. Notice states with fenced evidence, no stale promises, safe handling of uncertain email, fair retries (R5–R7);
   hand-delivery evidence rules (D2).
5. Month-to-month terms versions and the 30-day change notice (IN-21 mechanism; wording still Chris's to approve).
6. Company-delay waiver on late-return bills; agreements closed once everything is back and the agreed end has passed
   (C-09).
7. Early returns (IN-29): owner settings for billing (continue to the agreed end or stop at pickup), unused paid days
   (keep, credit or refund), the early-ending fee (agreed terms, none or custom), and ask-me vs apply-defaults, with a
   per-rental override screen.
8. A "Fix a missed reminder" screen with every option (IN-30).

### Acceptance checklist

- [ ] Every named test in `BATCH-B2.md` passes (real Postgres for each ordering, crash and race case).
- [ ] `grep -rn "syncSubscriptionTerm\|syncTerminationEnd" src` returns nothing.
- [ ] Customer rollover-and-end flow checked in the browser (My rentals).
- [ ] Each review finding R1–R7, D1, D2 has a disposition with test evidence in the PR.
- [ ] Every item in "Rules that apply to every batch".

### Owner inputs / gates

IN-21 (wording of the change notice and annual reminder); IN-29 and IN-30 are answered (early-return options and the
missed-reminder screen are part of this batch); IN-31 (counsel: hand-delivery channels, annual reminder) is deferred by
Chris and stays documented;
the "Automatic renewals" switch stays OFF until counsel has read the wording (`docs/GO-LIVE-CHECKLIST.md`).

---

## Batch D — Owner/customer control plane, website, evidence & privacy — MERGED (final #214)

**Design: `docs/designs/BATCH-D.md`** — read it in full before Step 2 of the playbook; its work units are the commit order.

### Purpose

Make business-operational capabilities manageable without code or database
access, while preserving historical and legal evidence.

### Open these first

`docs/plans/overhaul/DESIGN.md` sections 4–7 (settings, portal, website
editor), `docs/OWNER-GUIDE.md`, `docs/BUSINESS-RULES.md` (settings, fees,
terms), `docs/audits/Package-5-*.md`, `docs/audits/Package-6-*.md`,
`docs/audits/Package-7-*.md`, `docs/AUDIT_SYNTHESIS.md` RC7, RC8, RC11,
`src/domains/settings`, `src/domains/portal`, `src/domains/site-content` (if
present), `docs/OWNER-INPUTS.md`.

### Deliverables

1. **Money workspace completion (O18).** Balances, pending/failed
   synchronization, deposits and invoice history clearly separated; cents
   math and permission gates untouched; refunds/deposits never counted as
   rent; no second ledger.
2. **Reporting definitions (O19 remaining).** Earnings, source/growth
   conversion (rename "ROI" to conversion unless real spend attribution
   exists), each metric with date basis, calculation label, actual vs
   estimated, missing-cost flags and drill-through to backing records.
3. **Customer portal completion (O20).** Remaining rentals / maintenance /
   billing pages task-first; renewal, cancellation and auto-renew
   **interaction and consent surfaces** using Batch B's contracts; no
   cross-account access; requests never auto-cancel or charge; no internal
   staff notes exposed.
4. **Settings information architecture (O21 remaining).** Remaining
   sections; `BusinessSettings` coverage/deprecation matrix; owner-manageable
   hours, closures, social links, logo/banner where retained; secrets never
   displayed; saving one section cannot reset another.
5. **Website draft/publish data (O22).** Bounded `SiteContent` revisions for
   approved text/FAQ/image-alt/meta fields; version-conflict handling;
   published pointer; prior revision retained; no arbitrary HTML/JS; catalog
   prices never duplicated into copy.
6. **Website editor (O23).** Labelled fields, image alt, preview, explicit
   publish, rollback; household and property-manager pathways; no invented
   opening dates, free delivery or testimonials; no public personal-address
   inference. Owner gates IN-01/02/03/05/06/10/11 apply only to affected
   content.
7. **Inspection checklist editor** with publishing and versioning (pairs
   with Batch C's enforcement).
8. **Deposit / refund / dispute owner decision UI** on Batch B's domain
   workflows.
9. **Signed agreement and invoice artifact preservation**: private,
   reproducible, downloadable, backed up per approved policy; signing
   disclosure/evidence export.
10. **Privacy export / deletion request intake** with identity verification
    and an owner fulfillment workflow that never destroys required financial,
    signature or audit evidence; retention/legal-hold boundaries documented in
    a runbook.
11. **Legal-page production/indexing gate** (legal pages are not indexed or
    linked as final until the owner approves their content, IN-07).
12. **Granular role UI** only to the extent an approved permission model
    exists (IN-13); otherwise OWNER/ADMIN/STAFF stay as they are.
13. **Supplier / part / archive / history screens** that Batch C's domain
    changes require.
14. **Business-audit items** (frontend portions) B03, B06, B08, B09, B13,
    B19, B21, B23, B24, B28, B30, B34–B36.

### Acceptance checklist

- [ ] Owner can change every Class-A business setting (contact, prices,
      service area, catalog visibility, notifications, hours) without code.
- [ ] Public site reads published content only; drafts invisible.
- [ ] Preview / publish / rollback preserve exact version and actor.
- [ ] Changing current settings or contract terms never rewrites historical
      signed evidence.
- [ ] Customer cannot act on another customer's agreement, privacy request
      or document (A/B tests).
- [ ] Signed artifacts are private, reproducible, downloadable, backed up.
- [ ] Privacy deletion preserves required financial/signature/audit evidence.
- [ ] Raw provider secrets are never editable or visible in the app.
- [ ] Report fixtures with known values (incl. refunds, unpaid invoices)
      reconcile to source records; unknown cost is never shown as profit.
- [ ] Settings: unrelated-field preservation test; unauthorized save
      negative test.
- [ ] Every item in "Rules that apply to every batch".

### Owner inputs / gates

IN-01, IN-02, IN-03, IN-05, IN-06, IN-07, IN-10, IN-11 for the affected
public content; IN-13 for any role expansion. Approval of renewal/termination
policy text for customer-facing surfaces.

### Not in this batch

Message sending (E); Google (E/conditional); launch authorization (F).

---

## Batch E — Communications, reporting, growth, branding & accessibility — MERGED (final #222)

**Design: `docs/designs/BATCH-E.md`** — read it in full before Step 2 of the playbook; its work units are the commit order.

### Purpose

Make automated communication recoverable, business signals trustworthy, and
the entire UI visibly and semantically one Evergreen product.

### Open these first

`docs/AI-PR-READ-FIRST.md` (email/SMS constraints), `docs/DESIGN-SYSTEM.md`,
`docs/brand/`, `docs/audits/Package-4-*.md`, `docs/audits/Package-7-*.md`,
`docs/AUDIT_SYNTHESIS.md` RC6, RC9, RC12, `src/lib/email.ts`,
`src/lib/sms.ts`, the cron routes under `src/app/api/`, the launch-list
domain (PR #86 `LaunchDelivery`).

### Deliverables

1. **Automation run history foundation (O24).** `AutomationRun` with unique
   rule/run key; running/succeeded/failed/unknown; environment and sanitized
   counts/errors; cron authorization protected. Duplicate invocation never
   duplicates a recorded run; unknown outcome visible; no secrets or raw
   personal message bodies stored. Wrap one low-risk cron first.
2. **Automation health UI (O25).** OWNER/ADMIN-only page: last success,
   failed run, disabled-vs-unconfigured distinction, links to resolution.
   No blind "Retry all"; pause never deletes records; zero work ≠ failed,
   missing run ≠ healthy. Then instrument the other crons one by one,
   preserving each sender's original dedupe tests.
3. **Durable message ledger (O26).** `MessageDelivery` with unique business
   idempotency key, provider ID, intent/recipient linkage,
   accepted/failed/unknown. Marketing checks suppression immediately before
   send. At most one intended attempt after an ambiguous outcome until
   reconciled; "accepted" is never labelled "delivered". Roll out to
   estimate, launch, billing and job reminder senders. Preserve PR #86's
   `LaunchDelivery`; do not rewrite it.
4. **Communication visibility in records (O27).** Customer/lead activity
   distinguishes manual call/note from actual outgoing email status;
   template and recipient preview; confirmed sends only where existing
   authorization permits; no "sent" for drafts/failures; no placeholder inbox.
5. **Provider events and suppression (O28).** Signed Resend event endpoint
   with event-ID uniqueness; duplicate/out-of-order handling; complaint/
   bounce/suppression policy documented; global marketing suppression
   separate from any campaign cursor; forged events rejected. Twilio STOP
   synchronizes suppression and records the consent event. Enabling new
   customer messaging remains an owner gate.
6. **Launch-list email ownership** confirmed before marketing eligibility
   (opt-in stays pending until confirmed).
7. **Role-aware global search**: STAFF never queries or receives OWNER-only
   lead PII.
8. **Lead qualification/rescoring** and win-back "last real contact"
   semantics; current/rolling utilization and explainable demand/growth
   signals.
9. **Business-audit items** B01 (reminder surface), B07 (public abuse
   protection beyond Batch A's limiter), B20 (consent), B26 (demand
   forecast), B29 (customer communication), B31 (outage messaging).
10. **Report/accounting projection fixes** not already done in B; stable
    pagination/index/query cleanup; bounded queries measured, not guessed.
11. **Evergreen semantic-token migration** across desk, portal and auth;
    dark theme on Evergreen dark tokens (not generic slate overrides);
    semantic status colors separate and never meaning-alone;
    `prefers-reduced-motion`, `prefers-contrast`, `forced-colors`,
    focus/keyboard/zoom/reflow/screen-reader acceptance; axe coverage
    expanded to every current top-level route or a documented manual-only
    rationale; accessibility target stated as WCAG 2.2 AA.
12. **Google Workspace (O32)** only if its prerequisites are ready — see the
    conditional PR below.

### Acceptance checklist

- [ ] Provider send false / timeout / crash / retry scenarios reconcile with
      no silent loss and no duplicate send.
- [ ] Launch opt-in remains pending until mailbox ownership is confirmed.
- [ ] STOP immediately suppresses future app sends and records consent.
- [ ] STAFF search never returns OWNER-only lead PII (negative test).
- [ ] Every report metric has source/population/time/gross-net definition
      and drill-through.
- [ ] Large-list/query behavior measured with fixtures (numbers recorded).
- [ ] Every top-level route is in accessibility coverage or has a documented
      manual-only rationale.
- [ ] Brand screenshots (light/dark, mobile/desktop, print) reviewed against
      Evergreen tokens.
- [ ] Forced-colors / high-contrast / reduced-motion / manual keyboard
      checks pass.
- [ ] No claim of legal accessibility certification from axe alone.
- [ ] Each cron's original dedupe tests still pass after instrumentation.
- [ ] Every item in "Rules that apply to every batch".

### Owner inputs / gates

IN-01/IN-02 before any marketing send is enabled; IN-09 before SMS; the
"enable messaging" decision itself is always an explicit owner gate.

### Conditional Google Workspace PR (O32)

Only when all of these are true: Releases A/B-equivalent work verified,
Chris has done his live walkthrough, connector cards P4-1–P4-3 in the
google-workspace-mcp repo are done, and the one-time owner setup exists
(service account, delegation entry, two env vars). Spec and resource IDs:
`docs/plans/google-workspace-integration/README.md`; setup register:
`docs/plans/overhaul/CLAUDE-WORKSPACE-SETUP.md` (GW-01…GW-14).

Scope, in one PR with ordered commits (not six PRs): `src/lib/google.ts`
identity module; jobs ↔ "Deliveries & Service" calendar (app owns existence,
calendar may move times — a reschedule on the phone moves the job, a
cancelled job cancels its event); signed agreements and invoice/statement
PDFs filed to the existing Drive folders within a minute; customer/lead
email history from Gmail, reply as support@ with the Evergreen signature,
audited; only mail matching a known customer/lead stored. Additive schema
only; non-production runs in dry-run unless explicitly enabled. Resend stays
the transactional sender. Sync failures never block a business action and
are visible with Retry. Tests for payload builders, matcher, conflict rule
and naming; one documented end-to-end run against the real calendar/Drive/
mailbox with test data; `docs/ARCHITECTURE.md` env-var table updated. Not
in scope: Google Tasks/Keep, Sheets reporting, Contacts sync.

If prerequisites are not ready when Batch E is, ship E without pretending
O32 is done and leave this as the one allowed follow-up PR.

### Not in this batch

Launch authorization and the final evidence ledger (F).

---

## Batch E2 — Visual redesign: owner desk, public site and customer portal (desktop, phone, light and dark) — FINAL PR #263

**Design: `docs/designs/BATCH-E2.md`** (written 2026-10-05; approved by Chris 2026-10-05; home page decided — IN-32). (Added at Chris's request, 2026-10-04: the whole redesign, not just phone screens, goes after E and before F.)

### Purpose

Give the finished product the polished, modern look Chris approved in the 2026-10-04 mockup, on every screen and every device, without changing what any screen does. This is a visual layer on top of Batch E's Evergreen token migration: it reuses E's tokens and dark theme and adds none of its own.

### Open these first

`docs/ROADMAP.md` entry "Owner desk and public site visual redesign" (direction and mockup rules), `docs/DESIGN-SYSTEM.md`, `docs/brand/` (especially `03_Design_System/brand-tokens.json` and the brand handoff rules), `docs/plans/overhaul/DESIGN.md`, the finished Batch E token migration, and `docs/design-mockups/redesign-2026-10-04/` (a copy of the mockup: layout and feel only; its text is placeholders).

### Deliverables

1. **Owner desk shell and Today screen** in the approved direction: dark evergreen side menu with a lime "current page" pill, ivory working area, one headline stat card beside plain stat cards, visit list with a status word and icon on every row, "Needs your attention" panel. Every number and line comes from real data (no sample figures).
2. **Phone layout for the owner desk**: bottom tab bar (Today, Schedule, Customers, Billing, More), one dominant action at the top, single-column cards, every tap target at least 44px. Checked at 360, 390 and 768 px wide.
3. **Every other owner/staff screen** brought into the same look through shared components (cards, stat cards, status pills, lists, tables that become cards on a phone, forms), not screen-by-screen copies.
4. **Customer portal** in the same look, phone first, since customers use it on their phones.
5. **Public website** (home and the other public pages). Home page decided (IN-32, 2026-10-04): ivory in light mode, evergreen in dark mode, one dominant action in both. Public text comes from `BusinessSettings`, agreement terms and `docs/BUSINESS-RULES.md`; no invented claims.
6. **Dark mode** on every screen using the kit's dark tokens, with a visible switch and the system setting honored.
7. **Real logo files** from `docs/brand/` used everywhere (not the mockup's drawn stand-in).
8. **Accessibility is not lost**: contrast measured by axe and by hand for every text/background pair (the mockup's colors were never measured), visible focus, status never by color alone, reduced motion respected, forced colors checked, zoom to 200% and reflow without sideways scrolling.
9. **Print and email**: existing printable pages and customer emails keep working and keep the brand look.
10. **Photos**: Chris will re-use the current appliance photos already in the app (`public/appliances`); no new photography. The design decides where they appear (for example the public hero and rental cards) and keeps their alt text and sizes correct; where a photo is missing, the brand-color treatment is used.

### Acceptance checklist

- [ ] No screen's behavior, permissions or numbers change: all existing unit and integration tests pass untouched except for markup/text selectors, each such change listed in the PR.
- [ ] Every top-level route has light and dark, phone and desktop screenshots recorded in the PR.
- [ ] Axe passes on every route in light, dark and phone width; contrast values recorded for each pair.
- [ ] Keyboard, focus, zoom 200%, reflow, forced-colors and reduced-motion checks pass (same list as Batch E).
- [ ] No hard-coded colors, radii or sizes outside the token files (lint or test guard).
- [ ] No sample data, invented text or placeholder `[BRACKETS]` remain anywhere.
- [ ] Browser suite stays within its CI time budget (`docs/ARCHITECTURE.md` "Keeping CI fast").
- [ ] Chris has seen and approved the public home page and the phone owner desk before the PR that builds each merges.
- [ ] Every item in "Rules that apply to every batch".

### Owner inputs / gates

Home page direction answered (IN-32: ivory light, evergreen dark). Chris sees the home page and the phone desk on the preview before those PRs merge. Photos are settled: current ones are re-used (Chris, 2026-10-04).

### Not in this batch

New features, new screens or changed business rules (anything noticed goes to `docs/ROADMAP.md`); the final launch evidence ledger (F).

---

## Batch G — Audit fixes and owner-account security

**Design: `docs/designs/BATCH-G.md`** (approved by Chris 2026-10-06). Source: `docs/reviews/2026-10-06-owner-audit-and-recommendations.md` F1, F2, F4, F5.

### Acceptance checklist

- [ ] `npm audit --omit=dev` shows no high or critical advisories; CI green.
- [ ] A cancelled rental stops counting toward estimated earnings on the day it was cancelled (real-Postgres test).
- [ ] Owner and admin must enrol in two-step login (authenticator code + backup codes); the requirement is an owner setting explained on screen; enforcement is server-side, not only a redirect; recovery runbook exists.
- [ ] Users can sign out their other sessions; the owner can sign a staff member out everywhere.
- [ ] `docs/STATUS.md` matches merged work.
- [ ] Every item in "Rules that apply to every batch".

---

## Batch T — Colorado sales and use tax

**Design: `docs/designs/BATCH-T.md`** (approved by Chris 2026-10-06). Required before the first real customer (legal compliance).

### Purpose

Replace the single business-wide tax rate with address-exact Colorado tax: state, county, city and special districts from the Department of Revenue's free GIS lookup; the short-term lease election; home-rule cities (Greeley) with their own rules; owner-maintained taxability; customer exemptions; Stripe collecting exactly what the app computes; return worksheets per filing account; use tax on untaxed purchases.

### Owner inputs / gates

IN-17 (rate check), IN-33 … IN-38, IN-43, IN-44 (`docs/OWNER-INPUTS.md`). Everything starts "Not decided yet" and blocks billing until answered; the batch can be built and merged before the answers arrive.

### Acceptance checklist

- [ ] Tax areas come from the exact address (GIS or confirmed manual entry), never from ZIP or city name.
- [ ] Billing setup, send-for-signature and local invoices are blocked with a plain-English list while any needed tax decision, address check or rate is missing.
- [ ] The lease election applies only to state-collected areas; home-rule cities use only their own rules (engine tests).
- [ ] Stripe subscription items carry one Stripe tax rate per taxable area; Stripe-mirrored invoices record per-area tax lines; a 1-cent difference from the engine raises a card.
- [ ] A rate change entered with a future date reaches every affected live subscription the day before it starts, exactly once.
- [ ] Per-filing-account worksheets (accrual or cash per the owner's setting); marking a period filed freezes it; later corrections appear on the next worksheet.
- [ ] (Amendment A, 2026-10-07) Each return is a SUTS entry packet: per tax area in SUTS order, the exact numbers to type with copy buttons, a zero-return path, and a total equal to the tax customers were charged.
- [ ] (Amendment A) Every filing account has its periods, due dates (with Colorado's weekend/holiday rule) and license renewal on a calendar; the owner is prompted on Today and by email from the day a period closes until it is marked filed; a calendar file can be downloaded.
- [ ] (Amendment A 11.11) An unfiled return is a Today task that cannot be dismissed and disappears only when the return is marked filed; clicking it opens the guided "File this return" page (check → open SUTS → type these in with copy buttons and saved ticks → pay → confirmation).
- [ ] Use tax computed for appliances and purchase-order lines bought without (enough) tax.
- [ ] Customer exemptions with certificate photo, scope and expiry.
- [ ] OWNER-only policy edits and filing; ADMIN limits enforced server-side; screens explained in plain words; axe clean.
- [ ] No tax rate or taxability answer is written into code, seeds or docs as fact.
- [ ] Every item in "Rules that apply to every batch".

---

## Batch V — "Evergreen Signature" visual redesign

**Design: `docs/designs/BATCH-V.md`** (approved by Chris 2026-10-06). Concept: `docs/design-mockups/signature-2026-10-06/` and the private artifact "Evergreen Signature". Follows Chris's 2026-10-06 judgement that E2's public site looked too similar to the old one.

### Acceptance checklist

- [ ] Chris accepts the before/after comparison of the public site (human gate).
- [ ] Brand kept exactly (kit colours, Manrope, 8/16 radii); the Split-R 45° cut is the one signature shape; no new colours outside tokens.
- [ ] All public marketing copy comes from site-content fields; no hard-coded promises remain (grep test).
- [ ] Hero address check uses only the owner's service area, is rate-limited, and stores nothing.
- [ ] Contrast unit test for every token pair; axe clean light/dark; complete focus rings on clipped elements; no horizontal scroll at 360px; reduced motion honoured.
- [ ] Desk Today day-timeline and severity words; Actual/Estimate tags from the METRICS registry; no behaviour change.
- [ ] Every item in "Rules that apply to every batch".

---

## Batch F — Integrated verification, recovery, owner handoff & launch ledger

**Design: `docs/designs/BATCH-F.md`** — read it in full before Step 2 of the playbook; its work units are the commit order.

### Purpose

Prove the finished product survives real workflows, scale, provider and
recovery failure, and owner operation — then hand it to Chris.

### Open these first

`docs/plans/overhaul/DESIGN.md` section 8 (workflows to demonstrate),
`docs/OWNER-GUIDE.md`, `docs/OWNER-INPUTS.md`, `docs/DATABASE.md` (backup),
the launch gates at the end of this file,
`docs/reviews/2026-10-01-review-reconciliation.md`,
`docs/reviews/2026-10-01-business-logic-audit.md`.

### Deliverables

1. **End-to-end regression and measured capacity (O30).** DESIGN section 8
   scenarios at 360/768/1440, light/dark, keyboard; customer/staff
   boundaries; large-list query checks measured before tuning. List payloads
   bounded; no persistent >20% regression under the same fixtures without
   explanation and approval.
2. **Integrated scenarios** (real DB + browser where applicable):
   1. new lead → customer → estimate → approval → agreement → signature →
      delivery → recurring billing;
   2. the same with provider failure/timeout and safe retry;
   3. maintenance request → linked visit → repair/swap → return/removal →
      inspection;
   4. manual/offline payment + overpayment + refund/credit + statement/report
      reconciliation;
   5. fixed-term end → renew / early terminate / auto-renew per approved policy;
   6. staff activation → permitted field work → deactivation while requests
      are in flight;
   7. launch/estimate/billing/job communication send failure and reconciliation;
   8. privacy request/export with retention-preserving fulfillment;
   9. database restore to an isolated environment plus private media
      recovery and verification;
   10. a representative owner workflow with no code or DB assistance.
3. **Recovery runbooks**: provider outage, unknown Stripe state, message
   delivery, auth/account recovery, storage; backup snapshot consistency and
   restore procedure.
4. **Owner guide and operational runbook (O31).** Plain-English walkthrough;
   disabled-integrations and input register; backup/restore and rollback
   instructions; known limits; final preview. Chris can change public
   contact, prices, service area, catalog visibility and notification
   settings without code and can understand failed saves and automations.
5. **Remaining historical review-thread discharge** with evidence.
6. **Final B01–B36 acceptance ledger**; production configuration and input
   register; legal/policy/provider approval register; launch / no-launch
   checklist.

### Acceptance checklist

- [ ] All ten integrated scenarios pass with linked evidence.
- [ ] Capacity numbers recorded for large account / fleet / invoice / job /
      report fixtures.
- [ ] Isolated database restore and private media recovery proven.
- [ ] Every launch gate below is either checked with evidence or explicitly
      listed as an owner decision.
- [ ] No unresolved Critical/High is hidden behind a "done" label.
- [ ] Rollback plan: revert the UI commit on failure; additive DB tables stay;
      never a destructive rollback.
- [ ] Every item in "Rules that apply to every batch".

### Human / owner gates that stay explicit (never implied by passing tests)

Final visual/brand acceptance; screen-reader and manual accessibility
walkthrough; legal/privacy/terms/signing/termination/renewal policy approval;
live Stripe/Twilio/Resend/Google activation; paid provider/spending
decisions; production destructive cleanup or reconciliation; the actual
launch authorization. End the batch by reporting what is deployed vs pending;
do not start deferred features.

---

## Batch K — Books: journal, expenses, Stripe fees, profit & loss, accounting exports

**Design: `docs/designs/BATCH-K.md`** (approved by Chris 2026-10-06). Depends on T.

### Acceptance checklist

- [ ] Every money record the app keeps produces balanced double-entry journal entries exactly once (concurrent runs included); closed months never change.
- [ ] Stripe fees, service fees, disputes and payouts are synced nightly; the Stripe clearing balance is checked against Stripe daily.
- [ ] Expenses with receipt photos; staff submit, owner/admin post; void, never delete; recurring templates create drafts only; use tax recorded.
- [ ] Straight-line book depreciation with owner-set life and salvage.
- [ ] Profit & loss (accrual and cash), balance snapshot, appliance payback, 90-day cash forecast, customer health, year-end package — each number in the METRICS registry.
- [ ] Deterministic exports for QuickBooks Online, Xero, generic journal and cash-movements formats, daily-summary or detail, blocked until accounts are mapped.
- [ ] Every item in "Rules that apply to every batch".

---

## Batch O — Owner controls

**Design: `docs/designs/BATCH-O.md`** (approved by Chris 2026-10-06). After K. Every control starts in the position that changes nothing.

### Acceptance checklist

- [ ] Settings history in plain words with one-step undo through the normal save path.
- [ ] Per-person capability overrides whose defaults reproduce today's permissions exactly (table test).
- [ ] Approval thresholds per money action; requests execute once, re-validated, with expiry.
- [ ] Scheduled price changes applied once on their start date; agreements unchanged.
- [ ] Goals with pace on Today; idle-appliance and utilization alerts.
- [ ] Read-only page of every live switch with links.
- [ ] Every item in "Rules that apply to every batch".

---

## Deferred (not scheduled)

- **O29 CSV import** — only when a real, authorized import dataset exists.
  Then: preview parser with explicit field mappings for one entity type;
  bounded idempotent commit; duplicate/malformed row reporting; no silent
  overwrite, implicit invitations or lifecycle bypass; formula-injection-safe
  exports; repeated batch cannot duplicate records. (Also B27.)
- Items in `docs/ROADMAP.md`.

---

## Launch-readiness gates

The plain-English list of every switch, key and decision needed for real customers is `docs/GO-LIVE-CHECKLIST.md` (owner request 2026-10-03: everything is built working in the code, off in previews and live in production only when the owner completes the listed step). Every PR that adds a switch or a provider dependency adds a line there.

Discharged across Batches A–F. A gate is checked only with linked evidence.

**Gate 1 — Critical findings (all eight must be closed; no "accept risk"):**
P1 C1, P1 C2, P2 C1, P2 C2, P2 C3, P2 C4, P6 C1, P8 C1.

**Gate 2 — High findings:** P1 H1–H7, P2 H1–H8, P3 H1–H5, P4 H1–H6,
P5 H1–H7, P6 H1–H7, P7 H1–H7, P8 H1–H11 — each fixed or explicitly mapped to
verified replacement behavior. A High may be deferred only by an explicit
owner decision when the affected capability is also out of launch scope and
no legal/security/financial invariant is contradicted.

**Gate 3 — Medium findings:** every Medium assigned to a batch or documented
as post-launch hardening with rationale and no hidden Critical/High
dependency.

**Gate 4 — B01–B36:** each with behavior evidence and owner acceptance, or an
owner-approved scope change; B27 conditional on a real dataset; policy items
use actual approved policy.

**Gate 5 — Historical reviews:** every remaining valid thread mapped to a
batch/result; fixed threads resolved only after exact-head/full-CI evidence;
obsolete findings carry a documented disposition.

**Gate 6 — Recovery and platform evidence:** isolated restore; private media
recovery; provider unknown-outcome reconciliation; account recovery/session
behavior; cron/message run history and retry.

**Gate 7 — Accessibility / brand / product acceptance:** Evergreen token
migration accepted; light/dark/mobile/desktop visual review; WCAG 2.2 AA
engineering checks across the route/state inventory; forced-colors /
high-contrast / reduced-motion / keyboard / zoom manual checks; screen-reader
walkthrough; full business lifecycle completed through real user surfaces.

**Gate 8 — Owner / legal / provider release inputs:** public contact and
company information confirmed; legal/privacy/terms and agreement policy
approved; renewal/termination/auto-renew rules approved; tax policy
decisions (IN-17, IN-33 … IN-38 answered and entered, Batch T); live provider credentials verified; spending decisions approved;
destructive production operations separately approved; Chris explicitly
authorizes launch.
