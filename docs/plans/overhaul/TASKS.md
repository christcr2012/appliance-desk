# Implementation cards — execute in model-batch order

## Current execution override — 2026-09-30

Chris requests completion of the approved work with the current model and no
more model switching. Larger coherent PRs and continued eligible work supersede
the earlier switch/phase-stop/card-size schedule. Acceptance, CI/preview and
separate activation/spending/destructive-change gates remain. The current
sequence and evidence ledger are in [COMPLETION-PLAN.md](COMPLETION-PLAN.md).
Earlier model and stack instructions below are historical where superseded.


**Execution order/model assignments: MODEL-BATCHES.md.** Its explicit mixed-card
splits supersede the L/S suggestions in headings below; dependencies and
acceptance criteria remain mandatory. EXECUTION-STATE.md records where to resume.
PR-STACK.md requires a linear chain and Claude review of all PRs before any merge.
At each model boundary, save progress and ask Chris to switch; do not continue
until the switch protocol is satisfied.

Initial card statuses are historical. Current completion/ownership is in
EXECUTION-STATE.md and the latest HANDOFF.
Each card is a bounded outcome, usually one PR. Where a card explicitly has
A/B parts, make separate dependency-ordered PRs; do not ask Luna to deliver
both at once. Do not execute the whole backlog from a single prompt.

L = GPT-6 Luna, High reasoning, small UI/query task.
S = GPT-6.1 Sol, Medium reasoning (Chris’s available setting, confirmed
2026-09-30), including backend and review tasks. These are recommended task assignments, not
promises that a particular model will pass. A stronger review is mandatory
for S cards; it can be a separate review session, not parallel agents.

Global gate G (every application PR): focused behavioral tests, typecheck,
lint, full CI (real Postgres + build + Playwright/axe), preview, acceptance
check and HANDOFF. UI additionally needs 360/768/1440 widths, keyboard and
light/dark checks. New data tables join backup/export and schema health.
No customer fixtures, test emails or reset scripts on the shared live DB.
File scopes below are entry points, not permission to overwrite whole files.
If a proposed change needs >8 application files or two unrelated domains,
split it into a smaller prerequisite card and preserve these acceptance rules.

## Release A — a safe and consistent foundation

### O00 — Reconcile baseline and record proof (L)
- Depends: none. Read AGENTS, latest HANDOFF, OWNER-INPUTS, DESIGN sections1–3.
- Scope: docs/DESIGN-SYSTEM.md, ROADMAP.md, this task ledger; inspect current main/PRs.
- Build: mark old palette/logo/manual-migration/backup/photo notes as historical
  where contradicted by current code; reference Evergreen implementation.
  Record PR #86 status before relying on launch routes. Do not recreate shipped features.
- Accept: feature matrix links to real files; all inputs have stable IDs;
  main remains unchanged; plan status is distinguishable from implementation.
- Proof: link/path and contradiction review. Documentation-only—no app test rerun required locally.

### O01 — Verify role-safe data across workspaces (S)
- Depends: O00. Read session, current route guards and customer-isolation rules.
- Scope: src/domains/exceptions/index.ts, desk/today, domains/search, customer
  timeline and linked finance summaries; tests/session and customer-isolation.
- Build: test STAFF access to Today/search/customer summaries for finance
  leakage. Today is reachable by STAFF and current exception query includes
  billing data: determine approved field visibility, then filter at query/DTO
  boundary; do not merely hide links. Keep current operational abilities.
- Accept: unauthorized roles cannot obtain restricted amounts or documents
  through direct URL/action/search/export; customer A cannot access B.
- Proof: role-by-surface matrix and real negative tests, G. No speculative new role enum.

### O02 — Isolate preview build and runtime (S)
- Depends: O00. Scope: Vercel project config, Neon test branch, migration
  pipeline, ARCHITECTURE/DECISIONS, environment validation (new helper if needed).
- Build: explicit test DB for previews, independent private file namespace,
  test payment keys, non-sending notification mode. Verify build-time migration
  target and runtime target, not only NEXT_PUBLIC flags. Keep production env intact.
- Accept: preview changes cannot migrate/write the production DB or send
  customer messages; migration tested from prior schema and empty schema.
- Proof: redacted environment identities and a disposable preview fixture,
  evidence it is absent from production, G. No credentials in logs. Ask before
  paid resources or destructive cleanup. If blocked, schema cards stay blocked.

### O03 — Semantic style foundation (L)
- Depends: O00. Scope: globals.css, DESIGN-SYSTEM, components/status-badge,
  theme tests; read current token and override comments.
- Build: action/on-action, subtle surface and control-border semantics using
  existing Evergreen colors. Explicit dark pairs; preserve compatibility
  overrides. Document spacing/type rules from DESIGN section5.
- Accept: no rebrand; all button/text pairs meet existing contrast gate;
  current public and authenticated themes retain behavior.
- Proof: contrast values for new pairs, theme tests + G.

### O04 — Page/list/form primitives (L, split by primitive family if needed)
- Depends: O03. Scope: new src/components/desk/{page-header,section-card,
  empty-state,filter-bar}.tsx; reuse pagination/status icons.
- Build: typed narrow APIs, no business queries inside primitives. Prove on
  one low-risk existing Tasks list before migrating the rest.
- Accept: labelled states, URL filters, focus recovery, long-title wrapping,
  pending/error states without losing input. No unused component catalog.
- Proof: keyboard interaction plus behavior test on migrated page, G.

### O05 — Grouped responsive navigation (L)
- Depends: O01/O04. Scope: desk/layout, desk-sidebar, authed-header,
  global-search-box, new navigation config.
- Build: DESIGN section4 groups, persistent URLs, mobile drawer + shortcuts;
  one shared permission-aware nav model. Current dashboard remains reachable.
- Accept: 23 destinations discoverable without one flat wall of links,
  correct active parent, Escape/focus return, no sideways body scroll, STAFF
  receives no restricted nav data. No domain/business behavior change.
- Proof: each role's expected links + keyboard/mobile screenshots, G.
- RELEASE A stop: report preview and HANDOFF; obtain direction before release B.

## Release B — daily use and practical CRM

### O06 — Today workspace (L)
- Depends: O05. Scope: desk/today, domains/exceptions read APIs, domains/tasks
  read APIs, one shared date formatter if absent.
- Build: DESIGN Today blueprint, role-safe summaries, due tasks, explicit
  resolution links. America/Denver formatting and day boundaries. Start with
  existing exceptions; setup panel can link to launch/settings, not execute them.
- Accept: next job opens in 1 action; stale tasks appear; zero/loaded/error
  states truthful; no mixed UTC/local “today”; no finance shown to STAFF.
- Proof: midnight/DST boundaries in tests, task/job fixture and G.

### O07 — Customer overview and record tabs (L)
- Depends: O05/O01. Scope: desk/customers/[id]/page, existing panels,
  domains/customers/timeline read APIs (pagination may be a separate PR).
- Build: link-based Overview/Properties/Rentals/Service/Billing/Activity tabs;
  reuse existing actions and ownership. Paginate timeline with stable order.
- Accept: existing property/contact/statement/action paths retained; only
  selected tab data fetched; all author/timestamp/context preserved; no
  internal notes in portal. “Load more” does not duplicate or omit equal timestamps.
- Proof: fixture with >100 timeline entries, role checks and G.

### O08 — Lead workbench (L)
- Depends: O05. Scope: desk/leads list/detail, domains/leads bounded reads,
  tests/leads and scoring; no schema change in this card.
- Build: filters and next-action layout from DESIGN; derive quote status from
  existing estimates; link notes and tasks. Keep current scoring/reasons.
- Accept: existing enums unchanged; Lost reason required; conversion still
  uses guarded server action; no duplicate accounts from repeated clicks.
- Proof: lead-conversion/scoring regressions, URL/back behavior, G.

### O09 — Task assignment data (S)
- Depends: O01/O02. Scope: StaffTask schema/migration, domains/tasks,
  tasks/actions, backup manifest and schema-health checks.
- Build: nullable assignee, explicit priority, update/version check; active
  staff validation and task mutation audit. Existing tasks remain unassigned.
  Preserve team-shared visibility unless IN-13 explicitly chooses otherwise.
- Accept: invalid assignees rejected; stale edit returns conflict; due dates
  validated; repeated completion is safe; hidden records not exposed through links.
- Proof: migration upgrade and concurrent update/role tests, G.

### O10 — Follow-up task UI (L)
- Depends: O09/O08/O07. Scope: desk/tasks, linked-tasks-panel, task-row,
  new-task-form. Reuse O09 server actions.
- Build: Mine/Unassigned/Team views, due/priority/assignee controls, note-to-
  task shortcut. No automated messages or invented follow-up promises.
- Accept: task stays linked when moving between list and record; stale edit
  keeps user's text; completed/reopened state confirmed by server.
- Proof: create/assign/complete/reopen flow, keyboard and G.

### O11 — Property context across customer actions (L)
- Depends: O07. Scope: customers service-addresses/contacts panels, jobs/new
  and agreements/new query-prefill; existing ServiceAddress data only.
- Build: property selector with active rentals, upcoming jobs and service
  requests. Preselect the chosen property on the next action.
- Accept: no new CRM/account duplicate; contact is not an authorized portal
  user by implication; property from another customer is rejected server-side.
- Proof: multi-address account + cross-customer negative test, G.
- RELEASE B stop: owner walkthrough of Today, customer and one lead; IN-12.

## Release C — rental and service operations

### O12 — Rental builder and agreement progress (L; Sol review)
- Depends: O05/O11. Scope: agreements/new/rental-wizard, agreement detail;
  use existing createDraftAgreement/addRentalLine/sendForSignature actions.
- Build: stepper, explicit save checkpoints, resume, summary and independent
  signature/payment/equipment/delivery/billing milestones.
- Accept: no financial computation reimplemented in UI; prices/terms preserved;
  retry does not create duplicate drafts/lines; signed != delivered != billed.
- Proof: existing reservation/signing/prepay tests plus draft-resume e2e, G.

### O13 — Job duration and assignment contract (S)
- Depends: O02/O01. Scope: Job schema/migration, domains/jobs/dispatch,
  job action validation, backup and schema-health.
- Build: optional active staff assignee + durationMinutes + version.
  Null durations use the documented 120-minute advisory fallback; no fake backfill.
  Store instants in UTC, display and date selection in America/Denver.
- Accept: conflict calculation uses intervals for same assignee; unassigned
  jobs visibly unassigned; conflicting edits rejected; completion side effects unchanged.
- Proof: overlaps, end=start boundary, DST, archived assignee, concurrency, G.

### O14 — Dispatch and job detail UI (L)
- Depends: O13/O05. Scope: desk/dispatch, jobs/new and job-detail-panel.
- Build: duration/assignee controls, conflict explanation and explicit
  reschedule confirmation with affected customer/job. Agenda default on phone.
- Accept: schedule update doesn't silently send a new customer message;
  cancelled/completed jobs do not appear active; unscheduled queue retained.
- Proof: day/week/agenda consistency and reschedule conflict test, G.

### O15 — Field and maintenance workflow polish (L; Sol review)
- Depends: O14. Scope: desk/driver, maintenance list/detail, photo-upload-field.
- Build: large controls, job context, checklist/photo/notes order, upload
  progress/errors and customer-request-to-job link. Keep existing lifecycle.
- Accept: failed network/upload doesn't claim completion; unchecked advisory
  checklist still follows current policy; repeated completion doesn't bill twice.
- Proof: completion retry + upload failure + request linkage, G.

### O16 — Appliance record overhaul (L)
- Depends: O05/O15. Scope: inventory/[id] page/panels/history, fleet read UI.
- Build: overview/history/photos/costs/parts tabs; clear condition, status,
  location and next guided action. Keep existing QR and guided-action logic.
- Accept: no direct status bypass; rental history and inspection evidence
  preserved; repair earnings estimates labelled; QR not a private-data backdoor.
- Proof: existing lifecycle/swap/return/concurrency tests + record navigation, G.

### O17 — Purchasing usability and optional reorder points (L then S if data needed)
- Depends: O05/O02. A: existing suppliers/parts/purchase-order screens to
  shared patterns; no migration. B: optional nullable part reorderPoint and
  supplier preference, read-only low-stock suggestions; separate PR with S.
- Scope: desk/parts, purchase-orders, suppliers; domains/purchasing and
  PartRecord schema only in B. Verify actual domain filenames before editing.
- Accept: receiving cannot exceed remaining quantity; no double stock entry;
  draft suggestion never buys anything. Null threshold means no low-stock claim.
- Proof: existing purchasing tests plus partial/repeated receiving; G each PR.
- RELEASE C stop: demonstrate rental -> delivery -> service -> return.

## Release D — money, customers and owner control

### O18 — Money workspace presentation (L; Sol review)
- Depends: O05/O01. Scope: desk/billing and customer statement views,
  existing domains/billing read APIs; no Stripe write behavior changes.
- Build: balances, pending/failed synchronization, deposits and invoice history
  clearly separated; filtered list and exact detail links.
- Accept: cents math and permission gates preserved; refunds/deposits not
  counted as rent; no live-key activation; no second ledger.
- Proof: invoice/payment/statement fixture totals plus role tests, G.

### O19 — Reporting definitions and drill-through (S for query changes, L for UI)
- Depends: O18. Scope: desk/reports/revenue/growth/fleet, domains/reports,
  revenue/earnings queries. One report family per PR.
- Build: date basis and calculation label, actual vs estimated, missing cost
  flags and links to backing records. Rename source ROI claims to conversion
  unless spend/revenue attribution truly exists.
- Accept: fixtures reconcile to source records; unknown cost is not proof of
  profit; timezone/date bounds consistent; no charts with mock results.
- Proof: known-value fixtures including refunds/unpaid invoices + G.

### O20 — Customer portal task-first redesign (L; isolation review by Sol)
- Depends: O05/O18. Scope: account/page/layout/rentals/maintenance/billing
  in small page-family PRs; reuse domains/portal.
- Build: next visit, relevant balance, rental/property summary, prominent
  problem-reporting and pickup-request paths; clearer status copy.
- Accept: no account cross-access; requests don't auto-cancel/charge;
  no internal staff notes; existing payment links and notifications retained.
- Proof: customer A/B tests, mobile request/photo flow, G each page-family PR.

### O21 — Settings information architecture (L; action split reviewed by Sol)
- Depends: O05. Scope: desk/settings, domains/settings, existing pricing/staff
  forms; add bounded section routes or URL tabs.
- Build: DESIGN settings groups and section-specific saves. Reuse validators;
  existing BusinessSettings/SiteContent, not another settings database.
- Accept: saving profile cannot reset prices/staff/policy fields; unknown or
  unconfirmed inputs clearly identified; secrets never displayed; old link works.
- Proof: unrelated-field preservation test, unauthorized save negative, G.
- RELEASE D stop: portal + settings walkthrough; no live payment activation.

## Release E — controlled growth and automation

### O22 — Website draft/publish data (S)
- Depends: O02/O21. Scope: SiteContent schema/revisions, domains/site-content
  (new if needed), public content readers, backup/schema health.
- Build: bounded schemas for approved text/FAQ/image-alt/meta fields; version
  conflict handling, published pointer and retained prior revision. No arbitrary HTML/JS.
- Accept: drafts invisible publicly, publish is atomic and authorized;
  rollback republishes retained revision; catalog prices never duplicated in copy.
- Proof: public vs draft read and conflicting publish tests, G.

### O23 — Website editor and public finishing (L)
- Depends: O22; PR #86 merged or explicitly integrated before launch controls.
- Scope: desk/settings/website (new), public page sections, existing content readers.
- Build: labelled fields, image alt, preview and explicit publish; household
  and property-manager pathways; profile/contact consistency.
- Accept: no invented opening dates, free delivery or testimonials; no
  public personal-address inference; current approved assets used.
- Proof: edit -> preview -> publish -> rollback on isolated fixture, G.
- Owner gates: IN-01/02/03/05/06/10/11 only for affected content/activation.

### O24 — Automation run history foundation (S)
- Depends: O02. Scope: new AutomationRun schema/domain, one existing low-risk
  cron wrapper, backup/schema health. Do not migrate every cron at once.
- Build: unique rule/run key, running/succeeded/failed/unknown states,
  environment and sanitized counts/errors. Protect cron authorization.
- Accept: duplicate invocation doesn't duplicate recorded run; unknown
  outcome visible; records do not include secrets or raw personal message bodies.
- Proof: crash/duplicate/concurrency tests, G; old sender behavior unchanged.

### O25 — Automation health UI and staged instrumentation (L then S per sender)
- Depends: O24/O05. A: OWNER/ADMIN-only health page with last success, failed
  run, disabled/unconfigured distinction, links to resolution. B: instrument
  other crons one per PR after preserving their original dedupe tests.
- Scope: new desk/settings/automations, existing cron routes/domains.
- Accept: no blind Retry All; pause doesn't delete records; zero work != failed
  and missing run != healthy. New wrapper cannot duplicate late fees or emails.
- Proof: seeded status UI + each sender regression, G.

### O26 — Outgoing message ledger pilot (S)
- Depends: O24. Scope: MessageDelivery schema/domain, lib/email adapter,
  exactly one reminder sender, backup/schema health.
- Build: unique business idempotency key, provider ID, intent/recipient linkage,
  accepted/failed/unknown states. Marketing checks suppression immediately before send.
- Accept: at most one intended attempt after ambiguous outcome until reconciled;
  acceptance isn't labelled delivered; no raw secrets; transactional purposes separate.
- Proof: timeout-after-accept, returned error, concurrency and opt-out race, G.
- Preserve PR #86 LaunchDelivery; do not rewrite it as part of the pilot.

### O27 — Communication visibility in records (L)
- Depends: O26/O07/O08. Scope: customer/lead activity tabs and new read DTO.
- Build: distinguish manual call/note from actual outgoing email status;
  approved template preview, recipient preview, confirmed sends only where
  existing authorization permits. No Gmail sync or new unsolicited campaign.
- Accept: no “sent” for drafts/failures; only authorized customer/lead data;
  record links work; no placeholder inbox with imaginary messages.
- Proof: accepted/failed/unknown fixture and role checks, G.

### O28 — Provider-event handling and suppression (S)
- Depends: O26. Scope: signed Resend event endpoint, event-ID uniqueness,
  MessageDelivery reconciliation and relevant launch suppression adapter.
- Build: verify current official provider docs at implementation time;
  handle duplicate/out-of-order events; complaint/bounce/suppression policy
  documented; separate global marketing suppression from one campaign cursor.
- Accept: forged events rejected; repeat events safe; suppressed marketing
  cannot resume from late delivery event; no deletion of billing evidence.
- Proof: provider signature/replay/order tests and production-disabled preview, G.
- Owner gate: do not enable new customer messaging merely because webhooks work.

### O29 — CSV import, only if actual import demand exists (S then L)
- Depends: O02/O07/O16. A: preview parser and explicit field mappings for
  one entity type. B: bounded, idempotent commit and UI; separate PRs.
- Scope: new domains/imports and owner import page; existing customer/asset
  creation services with a no-notification import mode explicitly reviewed.
- Accept: preview reports duplicate/malformed rows; no silent overwrite,
  implicit invitations, or lifecycle bypass; formula-injection-safe exports;
  repeated batch can't duplicate records; user confirms exact batch.
- Proof: malformed/partial/failure/retry dataset tests, G. Defer if no dataset.
- RELEASE E stop: operator demonstrates failed-run diagnosis and safe recovery.

## Release F — evidence and handoff

### O30 — End-to-end regression and measured capacity (S)
- Depends: implemented chosen releases; O29 may remain explicitly deferred.
- Scope: e2e, fixtures, performance script/report in isolated env, no production data.
- Build: DESIGN section8 scenarios, 360/768/1440 layouts, light/dark, keyboard,
  customer/staff boundaries and large-list query checks. Measure before tuning.
- Accept: all invariants remain true; list payloads bounded; no persistent
  >20% regression under same fixtures without explanation/approval.
- Proof: CI links, screenshots, query timings and manual accessibility findings;
  manual screen-reader check remains explicit until a person actually performs it.

### O31 — Owner guide, launch checks and release (L documentation; Sol release review)
- Depends: O30 and applicable OWNER-INPUTS.
- Scope: OWNER-GUIDE, HANDOFF, ROADMAP, operational runbook; no new features.
- Build: plain-English walkthrough, disabled integrations/input register,
  backup/restore and rollback instructions, known limits and final preview.
- Accept: owner can change public contact, price, service area, catalog
  visibility and notification settings without code; understand failed saves
  and automations; no unresolved critical issue concealed by a “done” label.
- Proof: owner review + explicit production release authorization. Revert UI
  commit on failure; leave additive DB tables in place, never destructive rollback.
- End: report what is deployed vs pending. Do not begin deferred features automatically.

## Status ledger format

Maintain a small table here when implementation starts:
`ID | status | branch/PR | verified commit | tests/preview | blocker/input IDs`.
Allowed status: NOT_STARTED, IN_PROGRESS, BLOCKED, IN_REVIEW, VERIFIED,
DEPLOYED, DEFERRED. VERIFIED requires G; DEPLOYED requires observed production
release. A planning document, passing typecheck, or a screenshot alone is not VERIFIED.

## External Google Workspace setup dependencies

[Claude Workspace setup register](CLAUDE-WORKSPACE-SETUP.md) owns GW-01–GW-14.
O00 reconciles its observed inventory; O21 email settings consume GW-04/GW-07;
O26–O28 communication work preserves existing Resend and uses verified routing
where relevant. O31 reports GW-08/GW-09 activation evidence or explicit blockers.
Drive/Calendar/Tasks/Contacts integrations stay conditional and require their
own authorized card before runtime sync is built. Every newly discovered
Workspace dependency gets a GW entry; these are external setup tasks, not
additional model batches or completed application cards.


## 2026-09-30 status reconciliation

| ID | Status | Evidence / ownership | Remaining gates |
|---|---|---|---|
| O00 | VERIFIED | Merged #88; documentation baseline | None for documentation scope |
| O01 | IN_PROGRESS | Claude owns replacement for closed #89; usage reset pending | Complete role fix and G |
| O02 | IN_PROGRESS | Claude database isolation; Codex O02A on ai/codex/overhaul-o02-preview-safeguards | Full environment/runtime/storage/migration proof; G and review |
| O09/O13 | BLOCKED | No new code started | O01/O02 verified |
