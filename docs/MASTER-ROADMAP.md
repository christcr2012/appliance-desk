# MASTER ROADMAP — the one handoff

Audited baseline: main `b2a06c2` (#310), October 8. [STATUS](STATUS.md) holds current state; [PLAN](PLAN.md) holds remaining acceptance. Original documentation reset: [PR #138](https://github.com/christcr2012/appliance-desk/pull/138). This reset preserves history and the current two-lane process.

## What is next

**Next after this T-6C1 PR merges: T-6C2** — delivery-fee records with stable sale identity. Acquisition work T-6D1…3 (#313–#315) is merged; this PR completes the RDF schema/decision foundation. T then finishes per-appliance tax, acquisition UI/frequency, delivery fees and the Sales tax workspace. Build current tax cards in dependency order; refresh each against actual predecessor code. No customer billing/filing is activated by this plan.

## Approved sequence and owner gates

| Stage | Engineering order | Owner gate |
|---|---|---|
| Finish launch product | T → S → COM-L → V → F-part-2 | CPA/legal tax answers; COM sender/retention/activation; V rendered visual acceptance |
| Launch | GO-LIVE-CHECKLIST after final evidence | Chris authorizes live operation; engineering evidence is not activation |
| After launch | K → K-CASH (documentation review pending) → M → O → COM-N | K earlier only if Chris schedules; M IN-47 after launch; affected CPA/telecom decisions |
| Proposed later | BP after K/M/O, and relevant COM-N | Explicit runtime design acceptance; IN-48/49/50 for affected offers/programs |
| Deferred | O32, O29, direct QBO, P and COM-A | Actual accounts/data/selected scope and accepted design; never fake-ready |

## Implementing agent — paste this

> Read AGENTS, STATUS, this roadmap and the next card only. Find the cited design headings and named code/tests in bounded sections. Run the per-card drift protocol against latest main and the prerequisite's final reviewed head. If no execution card exists, write one short card from the approved design with exact current paths, transaction/permissions/provider boundaries, meaningful tests and completion evidence. Routine details are yours to implement; missing money/security/schema/provider decisions require a reviewed contract amendment first, not an unsafe guess or a mandatory model switch. Implement a coherent capability, run the cheap targeted checks, push once. While checks run, implement only the eligible immediate successor in the same chain. Batch blocking findings/failures, assign only safe low-risk follow-ups under PLAYBOOK, refresh exact-head gates, and merge when authorized and green. When finite CI is the only dependency, keep the turn active with PLAYBOOK’s bounded quiet completion wait. Update the existing card and STATUS; update the shared contract log only for downstream-relevant contract changes. Do not create a new handoff file. Continue while eligible work exists; stop only for a real gate, with committed work and the exact next action.

## Work coverage

`work-index.json` is the compact machine-readable coverage list. Existing cards are linked below; **JIT** rows are covered by the approved design and need their execution card written when their prerequisite is real. These rows are coherent capability boundaries, not a requirement to create artificially small PRs. Adjacent compatible work may share a reviewed PR within AGENTS' budget, while preserving acceptance/IDs/migration ownership. Proposed BP rows are planned scope, not approval.

### T

| Unit | Scope | Execution card | Prerequisite |
|---|---|---|---|
| T-6D1 | Acquisition evidence and safe purchase recording | [card](pr-cards/T-6D1.md) | T-6b2 |
| T-6D2 | Per-appliance rent tax and purchase-tax completion | [card](pr-cards/T-6D2.md) | T-6D1 |
| T-6D3 | Acquisition UI, use-tax frequency and worksheet | [card](pr-cards/T-6D3.md) | T-6D2 |
| T-6C1 | Retail delivery fee schema and decision engine | [card](pr-cards/T-6C1.md) | T-6D3 |
| T-6C2 | Record delivery fees with stable sale identity | [card](pr-cards/T-6C2.md) | T-6C1 |
| T-6C3 | Customer fee charging and provider recovery | [card](pr-cards/T-6C3.md) | T-6C2 |
| T-6C4 | Fee filing, credits and readiness | [card](pr-cards/T-6C4.md) | T-6C3 |
| T-7A | Tax setup, account and rule editing | [card](pr-cards/T-7A.md) | T-6C4 |
| T-7B | Areas, official sources and exemption navigation | [card](pr-cards/T-7B.md) | T-7A |
| T-7C | Guided filing and private evidence | [card](pr-cards/T-7C.md) | T-7B |
| T-7D | Tax overview, attention routing and acceptance closeout | [card](pr-cards/T-7D.md) | T-7C |

### S

| Unit | Scope | Execution card | Prerequisite |
|---|---|---|---|
| S-1A | System issue schema and typed safe event writers | [card](pr-cards/S-1A.md) | T-7D |
| S-1B | Bounded source sweep and lifecycle integration | [card](pr-cards/S-1B.md) | S-1A |
| S-1C | System health page and Today system group | [card](pr-cards/S-1C.md) | S-1B |
| S-2 | Private ops keys, safe API and checkup runbook | [card](pr-cards/S-2.md) | S-1C |

### COM-L

| Unit | Scope | Execution card | Prerequisite |
|---|---|---|---|
| COM-L3 | Threads, message links and template revisions schema | JIT — `COM-L3.md` | COM-L2 |
| COM-L4A | Policy, consent eligibility and immutable communication intent | JIT — `COM-L4A.md` | COM-L3 |
| COM-L4B | Account adapter, claimed SMS dispatch and recovery | JIT — `COM-L4B.md` | COM-L4A |
| COM-L5A | Verified inbound SMS and deterministic contact resolution | JIT — `COM-L5A.md` | COM-L4B |
| COM-L5B | Scoped consent actions and mandatory disclosure preservation | JIT — `COM-L5B.md` | COM-L5A |
| COM-L6A | Template validation, segment preview and reminder migration | JIT — `COM-L6A.md` | COM-L5B |
| COM-L6B | Authorized SMS inbox and per-user read cursors | JIT — `COM-L6B.md` | COM-L6A |
| COM-L7 | Call legs, private media and retention schema | JIT — `COM-L7.md` | COM-L6B |
| COM-L8 | Deterministic call routing, acceptance and callback reducer | JIT — `COM-L8.md` | COM-L7 |
| COM-L9 | Optional voicemail private ingest and missed-call inbox | JIT — `COM-L9.md` | COM-L8 |
| COM-L10 | Exact decimal telecom cost and cursor persistence | JIT — `COM-L10.md` | COM-L9 |
| COM-L11 | Read-only usage, rate and readiness sync | JIT — `COM-L11.md` | COM-L10 |
| COM-L12 | Spend reconciliation, estimates and configurable alert rules | JIT — `COM-L12.md` | COM-L11 |
| COM-L13A | Owner telecom setup, templates and private statement evidence | JIT — `COM-L13A.md` | COM-L12 |
| COM-L13B | Evidence-labelled costs in existing reports, Today and health | JIT — `COM-L13B.md` | COM-L13A |
| COM-L14A | Customer and lead communication timelines | JIT — `COM-L14A.md` | COM-L13B |
| COM-L14B | Job, maintenance and billing contextual communications | JIT — `COM-L14B.md` | COM-L14A |
| COM-L15 | Launch communications proof and truthful owner setup handoff | JIT — `COM-L15.md` | COM-L14B |
| COM-L1A | COM-L1A | [card](pr-cards/COM-L1A-SMS-SEND-SAFETY.md) | S-2 |
| COM-L1B | COM-L1B | [card](pr-cards/COM-L1B-CALLBACK-INTEGRITY.md) | COM-L1A |
| COM-L2 | COM-L2 | [card](pr-cards/COM-L2-FOUNDATION.md) | COM-L1B |

### V

| Unit | Scope | Execution card | Prerequisite |
|---|---|---|---|
| V-C1 | Typed content registry and historical compatibility | JIT — `V-C1.md` | COM-L15 |
| V-C2 | Photo library with private drafts and explicit publication | JIT — `V-C2.md` | V-C1 |
| V-C3 | Every public content binding and scheduled promotions | JIT — `V-C3.md` | V-C2 |
| V-C4 | Clear owner editing, preview, publish and restore | JIT — `V-C4.md` | V-C3 |
| V-C5 | Redesign compatibility and full content coverage proof | JIT — `V-C5.md` | V-C4 |
| V-1 | Signature tokens using the shared content registry | JIT — `V-1.md` | V-C5 |
| V-2 | Signature homepage and safe service-area check | JIT — `V-2.md` | V-1 |
| V-3 | Remaining public pages with editable copy | JIT — `V-3.md` | V-2 |
| V-4 | Desk and portal signature polish and evidence | JIT — `V-4.md` | V-3 |

### F2

| Unit | Scope | Execution card | Prerequisite |
|---|---|---|---|
| F2-A | Integrated rental and financial scenarios 1–5 | JIT — `F2-A.md` | V-4 |
| F2-B | Integrated security, messages, privacy and continuing rentals | JIT — `F2-B.md` | F2-A |
| F2-C | Current owner guide and reproducible screenshots | JIT — `F2-C.md` | F2-B |
| F2-D | Review discharge, launch ledger and rollback | JIT — `F2-D.md` | F2-C |

### K

| Unit | Scope | Execution card | Prerequisite |
|---|---|---|---|
| K-1A | Accounting schema, system accounts and restoration | JIT — `K-1A.md` | F2-D |
| K-1B | Pure balanced posting rules and evidence adapters | JIT — `K-1B.md` | K-1A |
| K-2A | Journal poster, periods, opening balances and concurrency | JIT — `K-2A.md` | K-1B |
| K-2B | Accounts, opening setup and journal browser | JIT — `K-2B.md` | K-2A |
| K-3 | Stripe balance paging, clearing and nightly books | JIT — `K-3.md` | K-2B |
| K-4A | Expense lifecycle and private receipt uploads | JIT — `K-4A.md` | K-3 |
| K-4B | Expense phone workflow and recurring drafts | JIT — `K-4B.md` | K-4A |
| K-5 | Immutable accounting export batches | JIT — `K-5.md` | K-4B |
| K-6 | Book depreciation, pending-retirement book assets and CPA tax-basis evidence ([design](designs/RETIRED-APPLIANCE-RESALE-TAX-2026-10-08.md)) | JIT — `K-6.md` | K-5 |
| K-7 | Profit, balance and appliance payback | JIT — `K-7.md` | K-6 |
| K-8 | Forecast, customer health and year-end package | JIT — `K-8.md` | K-7 |

### K-CASH — owner-requested design, documentation review pending

Design: `docs/designs/BATCH-K-CASH.md`; [research](research/2026-10-08-startup-banking-quickbooks.md).
Launch unchanged. K affected units read K-CASH section 9; no application/payment authority.
JIT cards reflect actual merged K contracts; preserve the existing two-lane workflow.

| Unit | Scope | Execution card | Prerequisite |
|---|---|---|---|
| K-CASH-1 | Cash evidence schema, typed events and posting revision | JIT — `K-CASH-1.md` | K-8 |
| K-CASH-2 | CSV imports and typed cash-event posting | JIT — `K-CASH-2.md` | K-CASH-1 |
| K-CASH-3 | Bank matches, reconciliation and cash readiness | JIT — `K-CASH-3.md` | K-CASH-2 |
| K-CASH-4A | Envelope, target and planned-cost schema | JIT — `K-CASH-4A.md` | K-CASH-3 |
| K-CASH-4B | Protected reserves and atomic envelope movements | JIT — `K-CASH-4B.md` | K-CASH-4A |
| K-CASH-5A | Recurring plans, targets, settlements and forecast dedupe | JIT — `K-CASH-5A.md` | K-CASH-4B |
| K-CASH-5B | Budget workspace and contextual source integration | JIT — `K-CASH-5B.md` | K-CASH-5A |
| K-CASH-6 | QBO detail export, import proof and owner handoff | JIT — `K-CASH-6.md` | K-CASH-5B |
| K-CASH-7 | Published plans, variance/trend reports and month-end review | JIT — `K-CASH-7.md` | K-CASH-6 |

### M

| Unit | Scope | Execution card | Prerequisite |
|---|---|---|---|
| M-1A | Shop and resale stock schema | JIT — `M-1A.md` | K-CASH-7 (after design review) |
| M-1B | Resale movement costs and use-tax withdrawals | JIT — `M-1B.md` | M-1A |
| M-1C | Atomic local shop sale and refund domain | JIT — `M-1C.md` | M-1B |
| M-1D | Sales and items-for-sale screens | JIT — `M-1D.md` | M-1C |
| M-2A | Retired plans, salvage and lump scrap ledger | JIT — `M-2A.md` | M-1D |
| M-2B | Retired workflow and scrap receipts | JIT — `M-2B.md` | M-2A |
| M-2C | Used-appliance sale, owner-set price, recapture warning/CPA evidence, single balanced asset disposition ([design](designs/RETIRED-APPLIANCE-RESALE-TAX-2026-10-08.md)) | JIT — `M-2C.md` | M-2B |
| M-3 | Hosted card payment for local invoices | JIT — `M-3.md` | M-2C |

### O

| Unit | Scope | Execution card | Prerequisite |
|---|---|---|---|
| O-1 | Settings history, guarded undo and live-switch inventory | JIT — `O-1.md` | M-3 |
| O-2A | Capability defaults and scoped domain guards | JIT — `O-2A.md` | O-1 |
| O-2B | Per-person permissions UI and adversarial DTO proof | JIT — `O-2B.md` | O-2A |
| O-3A | Durable approvals and transactional command preparation | JIT — `O-3A.md` | O-2B |
| O-3B | Approval command adapters and Today decision workflow | JIT — `O-3B.md` | O-3A |
| O-4 | Scheduled price changes with frozen accepted terms | JIT — `O-4.md` | O-3B |
| O-5 | Goals, utilization attention and final control handoff | JIT — `O-5.md` | O-4 |
| O-6 | Manage my business: task search, controls and truthful readiness | JIT — `O-6.md` | O-5 |
| O-7 | Personal saved queues and workspace; mandatory Today tasks preserved | JIT — `O-7.md` | O-6 |

### COM-N

| Unit | Scope | Execution card | Prerequisite |
|---|---|---|---|
| COM-N1A | Lead, estimate and signature SMS | JIT — `COM-N1A.md` | O-7, COM-L15 |
| COM-N1B | Job and maintenance SMS | JIT — `COM-N1B.md` | COM-N1A |
| COM-N1C | Billing, renewal and refund SMS | JIT — `COM-N1C.md` | COM-N1B |
| COM-N2 | Verified click-to-call and assigned staff actions | JIT — `COM-N2.md` | COM-N1C |
| COM-N3 | Verified telecom statement to existing books expense | JIT — `COM-N3.md` | COM-N2, K-8 |
| COM-N4 | Observed service metrics, unit economics and forecasts | JIT — `COM-N4.md` | COM-N3 |

### BP

| Unit | Scope | Execution card | Prerequisite |
|---|---|---|---|
| BP-1 | Commercial template, quote, campaign and promotion schema | JIT — `BP-1.md` | COM-N4, O-5 |
| BP-2A | Template validation and pure configurable offer quoting | JIT — `BP-2A.md` | BP-1 |
| BP-2B | Issued quote acceptance and promotion cap integrity | JIT — `BP-2B.md` | BP-2A |
| BP-3 | Template and offer editors with full price disclosure | JIT — `BP-3.md` | BP-2B |
| BP-4 | Verified-unused and first deployment schema | JIT — `BP-4.md` | BP-3 |
| BP-5 | Unused qualification, reservation and substitution integrity | JIT — `BP-5.md` | BP-4 |
| BP-6 | Property authorization and installation evidence schema | JIT — `BP-6.md` | BP-5 |
| BP-7A | Scoped permission issue, signature and revocation | JIT — `BP-7A.md` | BP-6 |
| BP-7B | Minimal private permission-signing page | JIT — `BP-7B.md` | BP-7A |
| BP-8 | Installation assessments and guarded completion | JIT — `BP-8.md` | BP-7B |
| BP-9 | Property evidence and phone installation workflow | JIT — `BP-9.md` | BP-8 |
| BP-10 | Portfolio master contract schema | JIT — `BP-10.md` | BP-9 |
| BP-11A | Commercial schedule quoting and portfolio volume policy | JIT — `BP-11A.md` | BP-10 |
| BP-11B | Portfolio master and schedule signing workflow | JIT — `BP-11B.md` | BP-11A |
| BP-12 | Stable partner programs and append-only commission schema | JIT — `BP-12.md` | BP-11B |
| BP-13A | Partner signed artifacts and code effective-version resolution | JIT — `BP-13A.md` | BP-12 |
| BP-13B | Deterministic cash attribution and commission accrual | JIT — `BP-13B.md` | BP-13A |
| BP-14 | Owner manual settlements and books liability | JIT — `BP-14.md` | BP-13B |
| BP-15A | Partner membership and restricted summary APIs | JIT — `BP-15A.md` | BP-14 |
| BP-15B | Owner partner workflow and private partner portal | JIT — `BP-15B.md` | BP-15A |
| BP-16 | Campaign cost, business metrics and owner handoff | JIT — `BP-16.md` | BP-15B |

## Owner-facing handoff stays small

Use STATUS and this roadmap. Detailed cards/designs are for the coding agent; no per-PR handoff documents, separate attachment packs or copied schema books. The final owner guide is rewritten only when the final product is verified (F2-C). Remaining choices retain their existing OWNER-INPUTS IDs.

## Improvements folded into the existing work

These are acceptance refinements, not four new workstreams or new launch gates.
The implementing agent includes them in the named capability, or splits only
when its measured budget requires it. Check current code first; do not rebuild
already proved behavior.

| ID | Existing unit | Improvement and proof |
|---|---|---|
| ENH-S | S-1C | Actionable, role-scoped alert recovery links; explicit stale/unknown evidence; no blind provider resend |
| ENH-F | F2-D | Post-commit notification failure cannot falsely fail a durable estimate approval; retry proof without duplicate accounts/agreements |
| ENH-K | K-6 | Profitability/payback shows incomplete cost evidence, source/as-of and safe unknown results |
| ENH-O | O-1 | Pure settings impact preview, stale-revision protection and authorized undo; preserve signed customer facts |

Exact contracts and named cases are appended to the existing S/F/K/O designs.
Broader ideas wait for evidence from real use rather than expanding launch scope.

## Owner content and control additions — October 8

Website control is broader than today's selected-text editor. V-C1…V-C5 extends
the existing Website screen to all public copy/photos/links and supported ad
slots, with clear location, draft/live comparison, phone preview and reviewed
publishing. Contact/catalog/prices use their existing authoritative editors
within that workspace. Future redesigns must preserve customized content and
upgrade the registry/editor alongside any new content type. Full contract and
proof are in the existing V design; no second CMS or layout builder.

O-6/O-7 adds a task-oriented control center, safe setup/readiness links, pinned
shortcuts and saved filtered queues. Existing O/BP/COM units gain contextual
help, effective-date/impact previews and configurable templates without a second
policy engine. All runtime additions remain to implement; this PR designs them.
Keep mandatory Today work visible and preserve signed facts/activation gates.

## Delivery forecast — October 8, 2026 (planning estimate)

GitHub creation: September 26, 15:05:48 UTC (09:05:48 Denver). Through main #310,
276 PRs merged; 217 touched src/prisma/operational scripts. In the preceding
48 hours, 31 such PRs merged, about 15.5/day. Their median open-to-merge was
53 minutes; this excludes pre-PR implementation and overlaps stacked work.
Classification is path-based, not a verified measure of delivered features or
model identity. Diff line totals include rework and are not useful work volume.

Current finite scope: 49 launch-stage card groups, 34 later approved groups,
21 proposed BP groups. Groups may combine/split while retaining pinned acceptance.
PR counts are **not** completion counts for the roadmap groups. No reliable
PR-to-group ratio has been measured, and the groups differ sharply in scope.
Consequently the historic 15.5 PRs/day cannot support a delivery date or a
numeric remaining-work estimate. The earlier October 13–25 estimates are
withdrawn rather than presented as a forecast.

**Forecast calibration:** After three representative approved implementation
groups merge, record the group IDs, implementation start and merge timestamps,
production scope, CI/review rework and blockers. Use that evidence to build
separate observed rates for small/medium/high-risk groups and then publish
conditional calendar ranges for launch, all approved work, and BP if accepted.
Do not equate a PR to a group when cards were combined or split.

The work counts (49 launch, 34 later approved, 21 proposed) describe scope,
not remaining days. Owner decisions, CPA/legal review, telecom sender setup,
visual approval and final launch authorization can impose additional waiting
regardless of engineering throughput. The deferred scope has no forecast.

## October 8 cash-budget scope addition

Nine owner-requested K-CASH groups added after K-8 before M, subject to documentation review.
Earlier scope counts above predate this addition and are historical, not current totals/delivery dates.
No new rental-launch gate, model handoff or runtime implementation. Expected collections are forecast only;
direct QBO remains deferred. One bank/Free is a tenant-verification candidate, not a proven integration.
