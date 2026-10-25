# MASTER ROADMAP — scope and ordered work coverage

Audited baseline: main after #541, October 24, 2026 (documents re-checked against the code, Vercel and Neon that day). [STATUS](STATUS.md) holds current state; [PLAN](PLAN.md) holds remaining acceptance. Original documentation reset: [PR #138](https://github.com/christcr2012/appliance-desk/pull/138). This reset preserves history and the current two-lane process.

## Where things stand

Day-by-day delivery notes used to live here; they are history now and live in [STATUS](STATUS.md). Everything through T, S, COM-L, W (except W-11/12/13), V, F2,
K, K-CASH, M-1A…M-2B, O-1, O-2A, O-2B, O-3A, O-4…O-7 and ACC-1…ACC-5 is merged. The live/provider/owner acceptance checks stay separately PENDING on
[OWNER-CHECKLIST](OWNER-CHECKLIST.md); source completion does not supply their missing gates. No manual release is authorized.
Not built yet: M-2C, M-3, O-3B refund/credit/deposit approvals and COM-N1A…N4 (approved, an agent can start them), BP (proposed), AR app-wide redesign plus BA/LD/CU engines (designed, awaiting go-ahead),
W-11/12/13 (owner-gated), MCP-1…11. The full audited list is "What truly remains" in [PLAN](PLAN.md). **New 2026-10-23:** ACC (accounts and sign-in) is built and merged (#544–#548).

**New required implementer reading:** October 13
[56-subject owner-answer mapping](owner-decisions/2026-10-13-implementation-map.json)
and [complete engineering/acceptance contract](designs/OWNER-DECISIONS-2026-10-13-ENGINEERING.md).
A 56-subject inventory and 23 updated IN rows represent overlapping owner answers,
**not 56 new tickets or questions**. Build and test each subject when its *existing
approved roadmap unit* becomes active; no redesign from scratch or skipped unfinished
current unit. Implementation cards must apply corresponding contract invariants.

**Order of the old W queue (history, audited 2026-10-23):** W-22FIN, W-23, W-24, W-25, W-26, W-14, W-2, W-15, W-3…W-10,
W-19, W-17, W-20, V and F-part-2 are **all merged** (PRs #466, #470/#472, #473, #474, #478, #480–#486, #487–#494). Do not rebuild them.
Their live, provider and professional acceptance stays on [OWNER-CHECKLIST](OWNER-CHECKLIST.md). W-11 and W-12 are not built and wait on
IN-61 and IN-62/IN-44; W-13 is DEFERRED (IN-64).

Later K/M/O follow their approved sequencing and owner gates. **K-CASH was approved
for source engineering on 2026-10-19** (see the original K-CASH section and frozen
K-CASH-1/2 plan below). **BP remains PROPOSED and requires business/runtime
design approval**. K-CASH engineering approval is not permission to pay, publish,
activate banking providers, modify production data, or deploy outside release policy. Real professional/provider/business
acceptance is separate from code implementation, explicitly queued with revision,
procedure and re-entry trigger. CPA/counsel review restricts affected real use,
**not safe source development**; each restriction needs owner-unlock workflow.

## Approved sequence and owner gates

| Stage | Engineering order | Owner gate |
|---|---|---|
| Finish launch product | T → S → W-0A/W-0B → W-0C → COM-L (to L15) → **W-1…W-20** (Amendment B section 8; W-16A/B and W-21 already done) → V → F-part-2 | CPA/legal tax answers; COM sender/retention/activation; V rendered visual acceptance |
| Launch | GO-LIVE-CHECKLIST after final evidence | Chris authorizes live operation; engineering evidence is not activation |
| After launch | K → K-CASH (engineering approved; provider/release acceptance pending) → M → O → COM-N | K earlier only if Chris schedules; M IN-47 after launch; affected CPA/telecom decisions |
| Proposed later | BP after K/M/O, and relevant COM-N | Explicit runtime design acceptance; IN-48/49/50 for affected offers/programs |
| Deferred | O32, O29, direct QBO, P and COM-A | Actual accounts/data/selected scope and accepted design; never fake-ready |

## Implementing agent — paste this

> Run `npm run work -- start`; read `docs/SESSION-START.md`, the top STATUS handoff and the current card (plus its resume note `docs/pr-cards/<ID>.progress.md` if present). Find the cited design headings and named code/tests in bounded sections. Run the per-card drift protocol against latest main and the prerequisite's final reviewed head. If no execution card exists, write one short card from the approved design with exact current paths, transaction/permissions/provider boundaries, meaningful tests and completion evidence. Routine details are yours to implement; missing money/security/schema/provider decisions require a reviewed contract amendment first, not an unsafe guess or a mandatory model switch. Implement a coherent capability, run the cheap targeted checks, push once. While checks run, implement only the eligible immediate successor in the same chain. Batch blocking findings/failures, assign only safe low-risk follow-ups under PLAYBOOK, refresh exact-head gates, and merge when authorized and green. When finite CI is the only dependency, keep the turn active with PLAYBOOK’s bounded quiet completion wait. Update the existing card and STATUS; update the shared contract log only for downstream-relevant contract changes. Do not create a new handoff file. Continue while eligible work exists; stop only for a real gate, with committed work and the exact next action.

## Work coverage

`work-index.json` is the compact machine-readable coverage list. Existing cards are linked below; **JIT** rows are covered by the approved design and need their execution card written when their prerequisite is real. These rows are coherent capability boundaries, not a requirement to create artificially small PRs. Adjacent compatible work may share a reviewed PR under AGENTS' outcome-led risk/review guidance, while preserving acceptance/IDs/migration ownership. Proposed BP rows are planned scope, not approval.

### T and S — complete

Batch T (tax) is engineering-complete through T-7D #328 and Batch S (system issues) through S-2 #334. Their cards
remain in `pr-cards/` as the record of what was built; W-0A/W-0B fix defects found afterwards in T.

### COM-L

| Unit | Scope | Execution card | Prerequisite |
|---|---|---|---|
| COM-L3 (#352) | Threads, message links and template revisions schema | MERGED — [card](pr-cards/COM-L3.md) | COM-L2 |
| COM-L4A (#353) | Policy, consent eligibility and immutable communication intent | MERGED — [card](pr-cards/COM-L4A.md) | COM-L3 |
| COM-L4B (#354) | Account adapter, claimed SMS dispatch and recovery | MERGED — [card](pr-cards/COM-L4B.md) | COM-L4A |
| COM-L5A (#358) | Verified inbound SMS and deterministic contact resolution | MERGED — [card](pr-cards/COM-L5A.md) | COM-L4B |
| COM-L5B (#361) | Scoped consent actions and mandatory disclosure preservation | MERGED — [card](pr-cards/COM-L5B.md) | COM-L5A |
| COM-L6A (#363) | Template validation, segment preview and reminder migration | MERGED — [card](pr-cards/COM-L6A.md) | COM-L5B |
| COM-L6B (#364, merged) | Authorized SMS inbox and per-user read cursors | JIT — `COM-L6B.md` | COM-L6A |
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
| COM-L2 (#346) | COM-L2 | [card](pr-cards/COM-L2-FOUNDATION.md) | COM-L1B |

### W — workflows that tell the owner what to do (`designs/BATCH-W.md`, approved 2026-10-09)

| Unit | Scope | Execution card | Prerequisite |
|---|---|---|---|
| W-0A (#342) | Purchase use tax can be calculated, recalculated and filed | [card](pr-cards/W-0A.md) | — |
| W-0B (#343) | No dead Today links; delivery-fee records page | [card](pr-cards/W-0B.md) | — |
| W-0C (#359) | Failed automatic charges and partly paid invoices reach To do, linked to the invoice | MERGED — [card](pr-cards/W-0C.md) | — |
| W-1 | To do list: due date, amount, one button, snooze | JIT — `W-1.md` | COM-L15 |
| W-2 | Intake and purchase orders say what is owed, to whom, by when; every seller-tax answer gets one dated next step (D-WA6); built on W-14's purchase flow | JIT — `W-2.md` | W-14 |
| W-3 | Taxes in one place, in plain words | JIT — `W-3.md` | W-2 |
| W-4 | Rental turning points create draft visits and To do items | JIT — `W-4.md` | W-3 |
| W-5 | Failed, held and deposit payments on To do with buttons; "Send payment link" and "Take payment by phone" on any unpaid bill (2026-10-10) | JIT — `W-5.md` | W-4 |
| W-6 | Leads and quotes create follow-ups | JIT — `W-6.md` | W-5 |
| W-7 | First-time setup checklist | JIT — `W-7.md` | W-6 |
| W-8 | Simpler menu, Schedule screen, plain-words check | JIT — `W-8.md` | W-7 |
| W-9 | Tax filing autopilot: every period becomes a dated To do, $0 returns included; confirmation capture; nothing left unfiled | JIT — `W-9.md` | W-8 |
| W-10 | Use tax "File now" panel for Revenue Online + filled official DR 0252 to print | JIT — `W-10.md` | W-9 |
| W-11 | Live Colorado tax rates for every address (GIS API) — may run early once IN-61 is done | JIT — `W-11.md` | IN-61 |
| W-12 | Sales tax return as an XML upload file | JIT — `W-12.md` | W-10, IN-62, IN-44 |
| W-13 | Receipt photo reading pre-fills price and seller tax (optional) | JIT — `W-13.md` | W-2, IN-64 |
| W-18 | Plain-language kit: dollars-only money display/input, ⓘ explanations from one glossary, CI check (Amendment B) | JIT — `W-18.md` | W-1, IN-69 |
| W-22 | Charges at signing: $45 administrative setup fee per delivery location, large-order down payment (IN-73/74, added 2026-10-10) | JIT — `W-22.md` | W-18 |
| W-23 | Location contacts: unit label, tenant/on-site contacts and client permission per address (added 2026-10-10) | JIT — `W-23.md` | W-22 |
| W-24 | One link does the whole order: Chris's delivery choices, accept → sign → pay → password → portal; decline; trip fee (added 2026-10-10) | JIT — `W-24.md` | W-23 |
| W-25 | Phone orders: Chris enters, customer finishes by emailed link (added 2026-10-10; phone backup cancelled) | JIT — `W-25.md` | W-24 |
| W-26 | Spanish for customers: quote, agreement, signing, payment, portal, messages (added 2026-10-10) | JIT — `W-26.md` | W-25 |
| W-14 | Purchases: one receipt, many appliances each with model + serial, tax split by price | JIT — `W-14.md` | W-26 |
| W-15 | Tax proof per appliance + audit pack; parts purchases join the records | JIT — `W-15.md` | W-2 |
| W-16A | **MERGED (#360)** Rental packages (sets): schema, settings with shown saving, old set type → package, website + quote form + leads | `W-16A.md` | — (moved ahead by Chris 2026-10-09; runs beside Sol's chain) |
| W-16B | **MERGED (#362)** Set lines on agreements (one machine per part) and quotes; split old one-record sets (To do + guided screen) | `W-16B.md` | W-16A |
| W-21A | **MERGED (#365)** Taken for repair without replacement → out-of-service credit (any line), To do, screen, portal note | `W-21A.md` | W-16B |
| W-21B | **MERGED (#366)** A machine of a set the customer is done with: single price for the rest, partial-period credit, Stripe item change | `W-21B.md` | W-21A |
| W-19 | Remaining flow gaps (lead→quote, quote→draft, unsigned follow-up, failed signing payment, instant repair To do, pickup requests, pickup after any ending) | JIT — `W-19.md` | W-10 (W-21 done) |
| W-17 | Related panel + History on every record; search by serial/model/seller; cleaning step | JIT — `W-17.md` | W-19 |
| W-20 | Portal follows the flows: next steps, status timelines, next bill, Pay now | JIT — `W-20.md` | W-17 |

### V

| Unit | Scope | Execution card | Prerequisite |
|---|---|---|---|
| V-C1 | Typed content registry and historical compatibility | JIT — `V-C1.md` | W-20 |
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

### K-CASH — owner-approved engineering (2026-10-19), original dependency order

Design: `docs/designs/BATCH-K-CASH.md`; [research](research/2026-10-08-startup-banking-quickbooks.md).
Launch unchanged. K affected units read K-CASH section 9. Owner approved implementation of all roadmap K-CASH units; no live provider/payment or release authorization is implied.
JIT cards reflect actual merged K contracts; preserve the existing two-lane workflow.

| Unit | Scope | Execution card | Prerequisite |
|---|---|---|---|
| K-CASH-1 | **MERGED #506** — cash evidence schema, posting revision | `K-CASH-1.md` (joint K-CASH-1/2 frozen card) | K-8 |
| K-CASH-2 | **MERGED #506** — CSV imports and typed cash-event posting | `K-CASH-1.md` (joint frozen card) | K-CASH-1 |
| K-CASH-3 | **MERGED #507** — bank matches, immutable reconciliation, conservative cash readiness | `K-CASH-3.md` (frozen 2026-10-19 plan) | K-CASH-2 |
| K-CASH-4A | **MERGED #508** — envelope/targets/plans/settlement schema and restore | `K-CASH-4A.md` (joint frozen K-CASH-4A/4B plan) | K-CASH-3 |
| K-CASH-4B | **MERGED #508** — protected reserves and atomic envelope movements | `K-CASH-4A.md` (joint frozen plan) | K-CASH-4A |
| K-CASH-5A | **MERGED #509 — original engineering, owner acceptance still pending** — recurring plans, targets, settlements and forecast dedupe | `K-CASH-5A.md` (joint frozen 5A/5B) | K-CASH-4B |
| K-CASH-5B | **MERGED #509 — original engineering, owner acceptance still pending** — budget workspace and contextual source integration | `K-CASH-5A.md` (joint frozen 5A/5B) | K-CASH-5A |
| K-CASH-6 | **MERGED #511 — original QBO delivery engineering, real trial import/CPA acceptance pending** — DETAIL export, uncertain-import quarantine, owner attested delivery | `K-CASH-6.md` (frozen) | K-CASH-5B |
| K-CASH-7 | **MERGED #513 — original engineering; real bank/CPA acceptance pending** — immutable monthly plan versions, signed ledger/bank/budget variances and month-end snapshots | `K-CASH-7.md` (frozen original plan) | K-CASH-6 |

### M

| Unit | Scope | Execution card | Prerequisite |
|---|---|---|---|
| M-1A | Shop and resale stock schema | JIT — `M-1A.md` | K-CASH-7 (after design review) — *merged #530* |
| M-1B | Resale movement costs and use-tax withdrawals | JIT — `M-1B.md` | M-1A — *merged #530* |
| M-1C | Atomic local shop sale and refund domain | JIT — `M-1C.md` | M-1B — *merged #531* |
| M-1D | Sales and items-for-sale screens | JIT — `M-1D.md` | M-1C — *merged #531* |
| M-2A | Retired plans, salvage and lump scrap ledger | JIT — `M-2A.md` | M-1D — *merged #533* |
| M-2B | Retired workflow and scrap receipts | JIT — `M-2B.md` | M-2A — *merged #533* |
| M-2C | Used-appliance sale, owner-set price, recapture warning/CPA evidence, single balanced asset disposition ([design](designs/RETIRED-APPLIANCE-RESALE-TAX-2026-10-08.md)) | JIT — `M-2C.md` | M-2B — *NOT BUILT — stopped, see M-2C-STRONGER-MODEL-PROMPT* |
| M-3 | Hosted card payment for local invoices | JIT — `M-3.md` | M-2C — *built; see docs/pr-cards/M-3.md* |

### O

| Unit | Scope | Execution card | Prerequisite |
|---|---|---|---|
| O-1 | Settings history, guarded undo and live-switch inventory | JIT — `O-1.md` | M-3 — *merged #534; change preview, stale-save protection and full switch rows added 2026-10-24* |
| O-2A | Capability defaults and scoped domain guards | JIT — `O-2A.md` | O-1 — *merged #535* |
| O-2B | Per-person permissions UI and adversarial DTO proof | JIT — `O-2B.md` | O-2A — *permissions screen delivered inside #535; every settings-type save now honours the limit (see `O-2B.md`); the role-shaped proof of what each admin page sends is `e2e/role-shaped-pages.spec.ts`, finished 2026-10-25* |
| O-3A | Durable approvals and transactional command preparation | JIT — `O-3A.md` | O-2B — *merged #536; write-off and expense kinds only* |
| O-3B | Approval command adapters and Today decision workflow | JIT — `O-3B.md` | O-3A |
| O-4 | Scheduled price changes with frozen accepted terms | JIT — `O-4.md` | O-3B — *merged (appliance-type prices; rental set prices added 2026-10-25)* |
| O-5 | Goals, utilization attention and final control handoff | JIT — `O-5.md` | O-4 — *merged (monthly goals for cash and new rentals; idle and low-utilization warnings)* |
| O-6 | Manage my business: task search, controls and truthful readiness | JIT — `O-6.md` | O-5 — *merged (read-only map, search, four readiness cards)* |
| O-7 | Personal saved queues and workspace; mandatory Today tasks preserved | JIT — `O-7.md` | O-6 — *merged (pins, hidden optional nudges, saved views)* |

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

### ACC — accounts and sign-in (`designs/ACCOUNTS-AND-SIGN-IN.md`, approved 2026-10-23) — DONE (#544–#548)

Chris asked for invitation-based team accounts, roles/permissions, password reset and recovery, an owner account page,
and email/text sign-in codes. Slot (Chris confirmed 2026-10-23): start right after O-2B finishes, because the owner
currently cannot change his own password. Text codes need Twilio live and Chris's switch; email codes do not.

| Unit | Scope | Execution card | Prerequisite |
|---|---|---|---|
| ACC-1 | My account: own password, email, name, phone, devices, two-step settings | JIT — `ACC-1.md` | — |
| ACC-2 | Team invitations (7-day link), Staff/Admin levels, role changes, admin remove/restore | JIT — `ACC-2.md` | ACC-1 |
| ACC-3 | Sign-in codes by email or text, method policy per level, trusted devices | JIT — `ACC-3.md` | ACC-2 |
| ACC-4 | Owner resets an employee's sign-in, security notices, failed-attempt pause | JIT — `ACC-4.md` | ACC-3 |
| ACC-5 | Job roles (owner-editable screen bundles that only narrow a level) | JIT — `ACC-5.md` | ACC-4 |

### AR — the app-wide redesign (`designs/APP-REDESIGN.md`, designed 2026-10-25, awaiting go-ahead)

Chris: every page is "categories with related functions placed on them", not an application. AR rebuilds the desk
around five areas, four page types (work queue, record, guided flow, settings), one inbox, a command bar and a shared
component kit with build guards. It supersedes the screen units BA-4/5/6, LD-2/3 and CU-2/3.

| Unit | Scope | Prerequisite |
|---|---|---|
| AR-0 | Kit + guards + three reference screens on testing | — |
| AR-11 | App feel foundations (install, instant shell, optimistic + Undo, offline shell, keyboard/touch, speed budget) | AR-0 |
| AR-12 | Owner-friendly rules (choices, built-in views, plain words, grow-into-it, next-step tooltips, help) | AR-0 |
| AR-1 | Five areas, area tabs, profile menu, command bar, redirects | AR-11, AR-12 |
| AR-2 | Today inbox | AR-1 |
| AR-3 | Money area and invoices | AR-2 |
| AR-4 | Customers area (leads, customers, quotes, rentals, messages) | AR-3 |
| AR-5 | Schedule area | AR-4 |
| AR-6 | Equipment area | AR-4 |
| AR-7 | Books and Taxes screens | AR-3 |
| AR-8 | Settings | AR-1 |
| AR-9 | Insights tabs | AR-4, AR-6, AR-7 |
| AR-10 | Sweep and guards | AR-5, AR-6, AR-8, AR-9 |

### BA — books on autopilot (`designs/BOOKS-AUTOPILOT.md`, designed 2026-10-25, awaiting go-ahead)

Chris found the Books pages confusing: a raw journal, manual depreciation per appliance, no month-end workflow and rows
of unexplained links. The code also records entries only when a button is pressed (the nightly job is behind the
Stripe switch), contrary to Batch K. BA makes the app keep the books itself and gives the owner one monthly review.

| Unit | Scope | Execution card | Prerequisite |
|---|---|---|---|
| BA-1 | Nightly recording, auto-enroll appliances, automatic monthly depreciation, retirement link | JIT — `BA-1.md` | — |
| BA-2 | First-time setup for a brand-new business; correct starting balances | JIT — `BA-2.md` | BA-1 |
| BA-3 | "Review this month": checks, plain summary, accountant package, lock | JIT — `BA-3.md` | BA-2 |
| BA-4 | Books home: status, this month, task cards, "For your accountant" | JIT — `BA-4.md` | BA-3 |
| BA-5 | Equipment value screen with nothing to remember | JIT — `BA-5.md` | BA-4 |
| BA-6 | No bare link lists anywhere on the desk; guard test | JIT — `BA-6.md` | — (parallel) |

### LD — leads workspace (`designs/LEADS-WORKSPACE.md`, designed 2026-10-25, awaiting go-ahead)

| Unit | Scope | Execution card | Prerequisite |
|---|---|---|---|
| LD-1 | Stages, lead owner, speed to lead, duplicates, scale (indexes, search, cursor paging) | JIT — `LD-1.md` | — |
| LD-2 | Work queue: stage tabs, Next-up order, one-tap contact, filter sheet, saved views, bulk, board | JIT — `LD-2.md` | LD-1 |
| LD-3 | Lead detail workspace | JIT — `LD-3.md` | LD-2 |
| LD-4 | Lead insights | JIT — `LD-4.md` | LD-3 |

### CU — customers workspace (`designs/CUSTOMERS-WORKSPACE.md`, designed 2026-10-25, awaiting go-ahead)

| Unit | Scope | Execution card | Prerequisite |
|---|---|---|---|
| CU-1 | Customer list: segments, money and next event per row, filters, saved views, summary model, search, count fix | JIT — `CU-1.md` | — (shares LD-1 search indexes) |
| CU-2 | Customer record header, next-step card, quick actions | JIT — `CU-2.md` | CU-1 |
| CU-3 | One Customers area (Leads, Customers, Insights), shared search, insights | JIT — `CU-3.md` | CU-2, LD-4 |

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

Removed 2026-10-09 (withdrawn forecast and dated scope notes; the K-CASH section above is current): [snapshot](archive/reset-2026-10-09/MASTER-ROADMAP.md).

## Owner-requested Appliance Desk MCP architecture — October 17, 2026

The new [MCP design](mcp/README.md) and [ordered subsystem roadmap](mcp/ROADMAP.md)
cover MCP-1…MCP-11, including private reporter feedback and agent-assisted repair.
This is documented planned scope, no implemented or accepted MCP capability. The
first [MCP-1/MCP-2 card](pr-cards/MCP-1.md) starts with health/backup evidence;
subsequent work adds direct connection, delegated recovery, feedback, monitoring,
optimization and optional RTC/Hub interoperability. Direct service use needs no Hub.
Do not replace or edit an in-flight F2 card/packet. On activation register this new
batch and its original acceptance with work-index and the pinned validator in one
reviewed change; preserve every existing required unit. Source engineering, merged,
released and real acceptance remain separate. Design does not authorize production
configuration changes, live effects, paid infrastructure or manual release.

## Universal permissions audit overlay — owner October21

Use the [Sol 5.6 contract in existing authority guidance](END-USER-AUTHORITY.md#sol-56-remaining-verification-and-correction-contract--owner-2026-10-21) within the affected original capability/card. It supplies identity/role/customer/session audit and regression requirements without changing active packet, K-CASH or original launch order. Preserve signup policy and business safeguards; no new multi-business/MCP architecture or duplicate batch IDs are approved by this documentation.
