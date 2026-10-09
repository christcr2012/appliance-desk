# PLAN — remaining scope and acceptance

Reconciled against main `b2a06c2` (#310), 2026-10-08. Current sequence is in [MASTER-ROADMAP](MASTER-ROADMAP.md); current head/blockers in [STATUS](STATUS.md). AGENTS owns workflow rules. This file owns acceptance, designs own semantic decisions, cards own the next bounded implementation. Do not read completed specifications as a work queue.

## Rules that apply to every batch

These are the acceptance requirements every batch inherits (the old plan
called this "gate G"):

- Focused behavioral tests for every new rule, permission and failure path;
  real-Postgres tests for anything concurrent or transactional.
- Applicable code checks and full CI green (throwaway Postgres, migrations,
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

Documentation-only changes use AGENTS’ documentation checks; application/UI/
DST/migration proofs above apply to the behavior actually changed.

## Built — do not rebuild

A, B, C, R, B2, D, E, E2, F-part-1 and G are merged. T is built through T-6b2 (#310): acquisition evidence/per-unit rules, RDF and tax workspace screens remain. E2's public visual result was rejected as final quality, so V remains. Live payments/customer email/SMS remain separately gated. Complete historical deliverables and acceptance are preserved in [the pre-reset plan](archive/reset-2026-10-08/PLAN.md), not discarded.

## Every remaining implementation

- Use the approved design's semantic contract; check current code and predecessor drift per [drift protocol](implementation-contracts/DRIFT-PROTOCOL.md).
- Write or refresh a short execution card only for the current unit and eligible immediate successor. The selected implementing model may write it from an approved complete design. No routine model switch or stronger-model gate. Low effort is suitable for mechanical/UI/docs work; use medium effort for interpreting transactional/provider/permission contracts and collect reviewed amendments for missing semantic decisions.
- Preserve real behavior tests, additive populated upgrade/restore proof where relevant, phone/light/dark/keyboard/axe for UI, role-shaped queries, immutable signed/financial evidence, exact-head gates and current owner/legal inputs.
- Register every work unit in `docs/pr-cards/work-index.json`. READY means card exists and contains a build/test contract; WRITE_CARD_AT_START means the design covers scope but the execution card must be written against its actual prerequisite. PROPOSED/DEFERRED is not runtime authorization. Do not label a filename or future estimate as implemented.
- Keep at most two implementation PRs in one dependency chain. Scope freezes after implementation; batch review/CI fixes, then merge as soon as current required gates pass. No extra paperwork stream or ceremonial rereview.

## Batch T — finish acquisition evidence, retail delivery fees and workspace screens

Design: `docs/designs/BATCH-T.md`; work coverage and prerequisites: work-index.

### Owner inputs / gates

IN-17 (rate check), IN-33 … IN-38 (`docs/OWNER-INPUTS.md`). IN-43 and IN-44 (Amendment A) only refine the return packet's wording and deduction names; they never block billing or launch. Everything starts "Not decided yet" and blocks billing until answered; the batch can be built and merged before the answers arrive.

### Acceptance checklist

These are integrated T exit criteria. Already merged engine/filing behavior is
regression evidence, not a request to rebuild it; remaining cards deliver the
acquisition/RDF/UI additions and final proof.

- [ ] Tax areas come from the exact address (GIS or confirmed manual entry), never from ZIP or city name.
- [ ] Billing setup, send-for-signature and local invoices are blocked with a plain-English list while any needed tax decision, address check or rate is missing.
- [ ] The lease election applies only to state-collected areas; home-rule cities use only their own rules (engine tests).
- [ ] Stripe subscription items carry one Stripe tax rate per taxable area; Stripe-mirrored invoices record per-area tax lines; a 1-cent difference from the engine raises a card.
- [ ] A rate change entered with a future date reaches every affected live subscription the day before it starts, exactly once.
- [ ] (Amendment C) Rate changes found in Colorado's official lookup are applied automatically when they pass the guardrails (reviewed area, seen on two days, within the size limit, never backdated), with a Today notice and undo; other differences become review tasks; watched official pages raise a Today task when they change.
- [ ] Per-filing-account worksheets (accrual or cash per the owner's setting); marking a period filed freezes it; a later change to a filed period opens an amended return for that same period (Amendment A 11.12).
- [ ] (Amendment A, 2026-10-07) Each return is a SUTS entry packet: per tax area in SUTS order, the exact numbers to type with copy buttons, a zero-return path, and a total equal to the tax customers were charged.
- [ ] (Amendment A) Every filing account has its periods, due dates (with Colorado's weekend/holiday rule) and license renewal on a calendar; the owner is prompted on Today and by email from the day a period closes until it is marked filed; a calendar file can be downloaded.
- [ ] (Amendment A 11.11) An unfiled return is a Today task that cannot be dismissed and disappears only when the return is marked filed; clicking it opens the guided "File this return" page (check → open SUTS → type these in with copy buttons and saved ticks → pay → confirmation).
- [ ] Use tax computed for appliances and purchase-order lines bought without (enough) tax.
- [ ] (Amendment D) The appliance entry form records whether sales tax was paid at purchase and how much; untaxed or under-taxed purchases record the use tax owed; each appliance's status decides whether its rent is exempt; the use-tax return (DR 0252 on Revenue Online, city use tax separately) is on the calendar with automatic annual/monthly frequency and a filled printable form or worksheet.
- [ ] (Amendment A 11.13) The owner enters and updates the SUTS setup (areas, codes, order, screen names, deduction names, frequency, license expiry) in the app; changes apply to open returns, are audited, and a yearly "check your SUTS setup" task appears.
- [ ] (Amendment B) Colorado retail delivery fee: the app decides automatically whether it applies (lease election, small-business exemption), counts one fee per qualifying delivery, charges it as a separate untaxed line or records it as paid by the business, and prepares its return on the same calendar.
- [ ] Customer exemptions with certificate photo, scope and expiry.
- [ ] (D-T14) A prepaid agreement gets one local invoice for its prepaid rent with sales tax at signing, so prepaid rent appears on returns.
- [ ] OWNER-only policy edits and filing; ADMIN limits enforced server-side; screens explained in plain words; axe clean.
- [ ] (Section 14) All tax screens live under one "Sales tax" entry in Money with six tabs (Overview, Returns, Areas & addresses, What's taxed, Exemptions, Setup); every tax Today item opens the exact screen that resolves it; the setup checklist matches the billing blockers word for word; on-screen wording follows the 14.6 glossary.
- [ ] No tax rate or taxability answer is written into code, seeds or docs as fact.
- [ ] Every item in "Rules that apply to every batch".

## Batch S — System issues inbox and the AI check-up

Design: `docs/designs/BATCH-S.md`; work coverage and prerequisites: work-index.

### Acceptance checklist

- [ ] Every D-S1 source records one de-duplicated issue and auto-resolves when the source recovers (integration tests).
- [ ] No customer data, keys or raw provider responses can be stored in an issue or note (redaction test with planted values).
- [ ] `/api/ops/issues` works only with a live owner-created key (stored hashed, revocable); the agent can read and add notes, never change data or resolve.
- [ ] System health page and Today "System" group (high only) render, axe clean, OWNER/ADMIN only.
- [ ] `docs/runbooks/AI-CHECKUP.md` contains the owner setup steps and the exact routine prompt; GO-LIVE-CHECKLIST has the setup lines.
- [ ] Every item in "Rules that apply to every batch".

## Batch COM — Business communications and telecom costs — APPROVED 2026-10-08

Design: `docs/designs/BATCH-COM.md`; work coverage and prerequisites: work-index.

### Launch acceptance (COM-L)

- [ ] UNKNOWN SMS never auto-replays; finalization/status/reconciliation serialize; early callbacks replay; STOP blocks every ordinary SMS purpose.
- [ ] Missing/unmarked/preview runtime, OFF activation, missing number, consent or A2P readiness cannot submit production SMS/calls.
- [ ] Account/number/contact/attempt/event evidence scoped and durable; one verified Voice/SMS identity, never invented or bought automatically.
- [ ] Two-way inbox/history works; shared/unknown numbers unresolved; explicit subject links, role-shaped queries/actions/private media.
- [ ] Editable versioned templates/disclosures, safe variables, rendered encoding/segments/cost preview and dispatch limits; existing job reminder migrated.
- [ ] Forwarding/human acceptance, parent/child legs, after-hours/missed calls; voicemail only if selected and privacy/recording approved.
- [ ] Paged retry-safe cost/usage/rate sync; estimates/provider-reported/invoice-reconciled totals distinct; no double-counted layers/categories/periods.
- [ ] Monthly spend/budgets/anomalies extend reports/dashboard/Today/S/automations; stale/unknown data visible; no blanket contact cutoff.
- [ ] Customer/lead/job/maintenance/billing/renewal surfaces share evidence; CustomerNotice legal gates preserved.
- [ ] Real-Postgres race/rollback/isolation, cost fixtures, browser/axe/restore and final F scenarios pass with evidence.
- [ ] IN-03/09/51/52/53 and applicable live/legal decisions resolved; runbook complete; provider behavior remains OFF until explicit activation.

### Near-term acceptance (COM-N)

- [ ] Workflow templates/rules activated individually; click-to-call/STAFF job-scoped actions preserve actor and legal boundaries.
- [ ] Verified paid statement links to one existing K Expense; no usage/top-up/invoice double posting; K closed-period correction.
- [ ] Service metrics, reliable linked-cost unit economics/forecasts registered in METRICS; sparse data is unavailable, no invented causal attribution.
- [ ] O controls and BP business scenarios consume existing evidence.

Section 9 defines 16 launch PR units (L1a/L1b plus L2–L15); large later units need bounded cards/splits before
implementation. Runtime boxes stay unchecked. Ordinary recordings/transcription, softphone, queues and AI reception
are later separately gated work.

## Batch V — "Evergreen Signature" visual redesign

Design: `docs/designs/BATCH-V.md`; work coverage and prerequisites: work-index.

### Acceptance checklist

- [ ] Chris accepts the before/after comparison of the public site (human gate).
- [ ] Brand kept exactly (kit colours, Manrope, 8/16 radii); the Split-R 45° cut is the one signature shape; no new colours outside tokens.
- [ ] All public marketing copy comes from site-content fields; no hard-coded promises remain (grep test).
- [ ] Hero address check uses only the owner's service area, is rate-limited, and stores nothing.
- [ ] Contrast unit test for every token pair; axe clean light/dark; complete focus rings on clipped elements; no horizontal scroll at 360px; reduced motion honoured.
- [ ] Desk Today day-timeline and severity words; Actual/Estimate tags from the METRICS registry; no behaviour change.
- [ ] Every item in "Rules that apply to every batch".

### Website content control acceptance — V-C1…V-C5

- [ ] Every public content item (all routes/variants, header/footer, metadata,
  form labels/messages, photos, links, descriptions, introductions and supported
  ad slots) has an editable content binding or one explicit source ownership.
- [ ] Owner edits from the real rendered page/section, sees location and shared
  usage, can replace a photo from a phone, and reviews exact text/photo/link diffs.
- [ ] Draft/preview/live are distinct; anonymous users cannot access draft HTML
  or media; stale/duplicate publish and post-commit failure outcomes are safe.
- [ ] Contact/catalog/pricing use one domain source; changing website prose never
  changes a charged amount or signed agreement. Promotion schedules are clear,
  default off and tested at Denver DST boundaries.
- [ ] Intentional empty/hide/default are distinct; restoration creates a reviewed
  draft and tells the owner which external-source facts it does not restore.
- [ ] Customized text/photos/links survive redesign and compatible rollback;
  new content types upgrade the editor before deployment, with coverage proof.
- [ ] Old revision codec, asset storage, populated-upgrade/backup/restore, active
  role/privacy boundaries, keyboard/phone/dark/light/axe and final F proof pass.

## Batch F-part-2 — final product proof (F-part-1 already complete)

Design: `docs/designs/BATCH-F.md`; work coverage and prerequisites: work-index.

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

## Batch W — Workflows that tell the owner what to do

**Design: `docs/designs/BATCH-W.md`** (approved by Chris 2026-10-09, IN-57…IN-60). W-0A/W-0B now; W-1…W-12 after COM-L,
before V (Amendment A, filing autopilot, adds W-9…W-12; W-11 may run early once IN-61 is done).

### Acceptance checklist

- [ ] W-0A: an owner can confirm the business tax address on screen; appliances waiting on setup get their use tax calculated automatically (once); use tax with no linked filing account raises a high To do item; Today and the appliance page say why tax is unknown and link the fix.
- [ ] W-0B: no Today item links to a page that doesn't exist (test); delivery-fee records waiting on a decision or amount have a page.
- [ ] Every To do item shows what, why, amount (if any), due date and one button; items sort by due date; snooze with reason.
- [ ] Saving an appliance (or receiving parts) with no seller tax shows what is owed, to whom and by when, and adds it to To do; "I'll check later" creates a dated To do.
- [ ] W-2 (D-WA6): `nextPurchaseTaxStep` gives every answer exactly one next step (full tax → done; partial or none → use tax on the right return with its legal due date; tax-free for rent → rent taxed; another state's tax → CPA To do until IN-65; later → To do in 3 days that turns high 7 days before the covering return closes); intake card, appliance page, PO receiving and To do all show the same step (tests per row); due dates come from the filing calendar, never hard-coded.
- [ ] W-13 (only if IN-64 is yes): a receipt photo pre-fills price and seller tax marked "check it"; nothing saves without Chris confirming.
- [ ] Taxes live in one menu entry; use tax is inside it; the return page starts with "File and pay $X on <site> by <date>"; money is typed in dollars.
- [ ] Signing creates a draft delivery visit + To do; a rental ending in 30 days asks renew / month-to-month / pickup; a decided ending creates a draft pickup visit; drafts never send or charge anything.
- [ ] Failed payments, held payments and deposit decisions appear on To do the same day with action buttons.
- [ ] A new lead appears as "Contact <name>" (same day by default); "contacted" asks for the next follow-up date; an approved quote creates a To do.
- [ ] A first-time setup checklist on Today (owner) until complete.
- [ ] About 14 menu entries; Dispatch, Jobs and Driver view are one Schedule screen; the plain-words check runs in CI.
- [ ] W-9 (Amendment A): every filing period creates "File and pay $X on <site> by <date>" on To do the day it closes ($0 returns included), reminds on schedule, captures confirmation number and date paid, and a nightly check proves no closed period is left without a filing item.
- [ ] W-10: the use-tax return page has a "File now" panel (opens Revenue Online, each value in screen order with a copy button) and prints the official DR 0252 filled in.
- [ ] W-11 (after IN-61): new and existing addresses get Colorado's rates automatically from the GIS API; unmatched addresses and a broken key become To do items; billing never uses an unconfirmed rate.
- [ ] W-12 (after IN-62 and IN-44): the sales tax return page offers an XML file that passes Colorado's schema in a test; not offered while a deduction line is undecided.
- [ ] Nothing in the app submits a return, stores a tax-site or bank login, or starts a tax payment (D-WA2).
- [ ] Every item in "Rules that apply to every batch".

---

## Batch K — Books: journal, expenses, Stripe fees, profit & loss, accounting exports

Design: `docs/designs/BATCH-K.md`; work coverage and prerequisites: work-index.

### Acceptance checklist

- [ ] Every money record the app keeps produces balanced double-entry journal entries exactly once (concurrent runs included); closed months never change.
- [ ] Stripe fees, service fees, disputes and payouts are synced nightly; the Stripe clearing balance is checked against Stripe daily.
- [ ] Expenses with receipt photos; staff submit, owner/admin post; void, never delete; recurring templates create drafts only; use tax recorded.
- [ ] Straight-line **book** depreciation with owner-set life and salvage; preserve retired appliance book value pending actual disposal instead of automatically expensing all remaining value at rental retirement. **Tax depreciation/adjusted basis** (including Section 179 and bonus) require CPA-backed evidence and are not inferred from book settings. [Resale tax and disposition design](designs/RETIRED-APPLIANCE-RESALE-TAX-2026-10-08.md).
- [ ] Profit & loss (accrual and cash), balance snapshot, appliance payback, 90-day cash forecast, customer health, year-end package — each number in the METRICS registry.
- [ ] Deterministic exports for QuickBooks Online, Xero, generic journal and cash-movements formats, daily-summary or detail, blocked until accounts are mapped.
- [ ] Every item in "Rules that apply to every batch".

## Batch K-CASH — cash envelopes, planned costs and bank reconciliation — owner-requested design

Design: [BATCH-K-CASH](designs/BATCH-K-CASH.md); [research](research/2026-10-08-startup-banking-quickbooks.md).
Documentation review precedes affected implementation. Proposed after K-8 before M; launch unchanged.
K section 9 amendments must be drift-checked before affected source/export/opening/forecast units.

- [ ] Duplicate-safe CSV preview/import, exact matching and zero-difference statement proof preserve immutable
  evidence/outstanding items/private access and owner reopening; no balancing plugs.
- [ ] Typed cash events/journal source revision/opening composition preserve balance, concurrency and liabilities.
- [ ] Confirmed-bank-cash-only envelopes protect deposits/credits/tax/RDF/card debt with shortage/as-of labels;
  stale/unknown blocks new funding but never recording real expenses.
- [ ] Assign/move/spend/reverse use atomic revision/idempotency; virtual allocations never transfer bank money.
- [ ] Recurring/annual/one-time costs and monthly/save-by-date/maintain targets carry forward, settle partially,
  reverse and avoid target/schedule double counting.
- [ ] Existing K forecast separates no-new-income coverage from expected collections; source dedupe and unknown
  costs explicit; unpaid invoices/pending Stripe funds cannot fund envelopes.
- [ ] Budget tabs/context cards integrate expense/purchasing/inventory/tax/COM/Today/METRICS; role-shaped access.
- [ ] Original/revised immutable monthly plans, spending vs funding variance, revenue/expense/profit trends,
  cash movement, drilldown/export ties, partial-period comparisons and fact-based month-end review; unknown
  history/attribution stays visible; no capital/deposit/tax/owner money misclassified as profit.
- [ ] QBO actual-tenant detail-import/matching/reconciliation proof, prepared vs imported status and overlapping/
  uncertain export quarantine; download never claims import.
- [ ] IN-54/55 recorded before account/budget activation; no application/spending/live payment authorization.
- [ ] Named real-Postgres/security/race/upgrade/restore/phone/dark/keyboard/axe tests pass.
- [ ] Every item in Rules that apply to every batch.

## Batch M — Shop sales and appliance endings

Design: `docs/designs/BATCH-M.md`; work coverage and prerequisites: work-index.

### Acceptance checklist

- [ ] Items marked "sold to customers" share the parts stock ledger; sales, refunds and repairs move stock exactly once (integration tests).
- [ ] A pickup sale is taxed at the shop's tax areas and a delivered sale at the customer's; delivered taxable sales follow the delivery-fee rules.
- [ ] Resale is recorded per purchase-order line; resale units create no use tax when bought and record use tax only when used or lost (tax-paid units in the same stock never do), following the fixed unit-order rule.
- [ ] Walk-in sales belong to the one built-in walk-in customer (cannot sign in, never emailed, hidden from customer lists); delivered sales need a real customer.
- [ ] Item and used-appliance sales post income only (no cost of goods sold — parts are expensed when bought).
- [ ] Retiring still removes the unit from everything rentable; every retired appliance can get a plan (sell / strip for parts / scrap / throw away / other), changeable until done; a sale completes its plan automatically. Used rental-asset sales can be priced at whatever the owner sets, even original cost or higher; show potential §1245 depreciation recapture, source-backed adjusted tax basis and CPA follow-up **rather than a resale-price cap**.
- [ ] Parts kept from a stripped appliance enter parts stock at $0 cost exactly once and list on the appliance page.
- [ ] Scrap checks are lump "Scrap money received" entries (scrap income); dump fees are normal expenses; no per-appliance fees are asked; a done plan writes off the remaining book value in Batch K.
- [ ] One Today follow-up item for retired appliances undecided or not done after the owner-set days (starting 30, 0 = off).
- [ ] Shop sales appear on the SUTS return and as "Shop sales" in revenue reports; screens explained in plain words; axe clean.
- [ ] Every item in "Rules that apply to every batch".

## Batch O — Owner controls

Design: `docs/designs/BATCH-O.md`; work coverage and prerequisites: work-index.

### Acceptance checklist

- [ ] Settings history in plain words with one-step undo through the normal save path.
- [ ] Per-person capability overrides whose defaults reproduce today's permissions exactly (table test).
- [ ] Approval thresholds per money action; requests execute once, re-validated, with expiry.
- [ ] Scheduled price changes applied once on their start date; agreements unchanged.
- [ ] Goals with pace on Today; idle-appliance and utilization alerts.
- [ ] Read-only page of every live switch with links.
- [ ] Every item in "Rules that apply to every batch".

### Owner workspace additions — O-6/O-7

- [ ] Manage my business offers task-oriented search, existing authorized routes
  and truthful source-specific readiness, preserving direct bookmarks.
- [ ] Pin tasks/save typed filtered views/reset with preview; per-user scope,
  stale revision, revoked role and malformed filter tests pass.
- [ ] Mandatory Today obligations cannot be hidden; empty filtered results do not
  claim no work exists. Setup help never exposes secrets or pretends provisioning.
- [ ] Settings/templates explain effects and effective dates in the screen, reuse
  domain validation and immutable customer facts, and provide safe restore paths.

## Batch BP — Business offers operations and partnerships — PROPOSED

Design: `docs/designs/BATCH-BP.md`; work coverage and prerequisites: work-index.

### Deliverables and acceptance

- [ ] Owner-editable named agreement templates with optional clauses, supported policy options, explicit inheritance and immutable customer copies.
- [ ] Versioned offers and explicit final-price mode; three-month terms, service zones, bounded promotions and immutable quotes.
- [ ] Verified-unused asset eligibility; scoped property permission and required installation evidence within existing job completion.
- [ ] Commercial master documents linked to existing customer/address agreements and consolidated statements.
- [ ] Settled-rent partner commission ledger, reversals, owner-approved manual settlements and a privacy-limited partner portal.
- [ ] Campaign acquisition costs and distinct cash/economic/accounting asset measures using K and METRICS.
- [ ] BP01–BP31 source dispositions reconciled; exact acceptance and race/security tests in design sections 6–7.
- [ ] IN-48/49/50 resolved for the selected release; existing tax/legal/live-provider gates preserved.

Business document creation is complete in the documentation branch. Runtime boxes above deliberately remain unchecked.
The design's 16 estimated slices need bounded PR cards and current-code drift checks before implementation.

BP remains PROPOSED; IN-48/49/50 gate affected activation. Write its execution cards only after acceptance and K/M/O drift reconciliation.

## Deferred scope — preserved, not secretly implemented

O32 Google Workspace: current integration specifications plus real account/delegation/Drive isolation walkthrough remain prerequisites. O29 CSV import: no real dataset. Direct QuickBooks sync: file exports used for a quarter, new accepted provider design/owner account. P candidates and COM-A: owner-selected scope plus accepted design before execution cards. [ROADMAP](ROADMAP.md) retains the choices. There is deliberately no fake runtime-ready card for an undefined feature.

## Launch gates

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

## Added acceptance refinements — existing capability ownership

- [ ] ENH-S / S-1C: typed role-scoped recovery links, explicit stale/unknown state;
  provider uncertainty guides reconciliation without blind retries.
- [ ] ENH-F / F2-D: discharge Package 1 findings against current evidence and prove
  post-commit notification failure cannot falsely fail durable approval or duplicate it.
- [ ] ENH-K / K-6: incomplete cost evidence remains unknown; metric source/as-of
  and scoped drill-down explain payback/profitability.
- [ ] ENH-O / O-1: pure impact preview, revision conflict and authorized undo preserve
  signed facts and existing approval/activation gates.
