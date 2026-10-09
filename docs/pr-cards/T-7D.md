### PR #328 code-review completion (2026-10-08)

Four reviewer findings were addressed without changing production tax,
filing, billing or owner/CPA activation gates:

1. The earliest OPEN-period query excludes periods before each active
   account's current firstPeriodStart in PostgreSQL **before** applying
   the bounded take. Regression creates 26 obsolete periods ahead of two
   valid ones and checks both remain visible.
2. The Overview reuses already-authorized Today inbox tax categories,
   including license/exemption/official-rate and source alerts, RDF
   refunds, purchase-use-tax, invoice/Stripe tax and acquisition review.
   A bounded summary links to the complete Today inbox; it never claims
   a truncated list contains all live cases.
3. Taxability shows Recorded only after all default charge cells are
   CPA-confirmed and all currently verified areas satisfy applicable
   jurisdiction-specific requirements, with no undecided override
   bypass. Home-rule areas do not inherit state-collected decisions.
4. Filing-account setup requires an active SALES_RETURN with official
   account number, portal URL, decided basis and first period. Calendar
   status checks all active accounts, not the first page only.

Added isolated PostgreSQL and pure rule regressions; local typecheck,
lint, migration check and browser CI remain exact-head merge gates.

# T-7D — Tax overview, attention routing and acceptance closeout

Status: **APPROVED** · Baseline inspected: `b2a06c2` (2026-10-08, #310).
Batch: T · Prerequisites: T-7C.
Base: latest merged prerequisite, or its top branch when stacking. One migration: `none`.
Sizing estimate: 450 production lines; target ≤15 production files; one risk area. Tests/docs excluded. The estimate is a planning bound, not a measured patch size.

## Read only these

Read AGENTS, STATUS and this card first. Find the named heading/function with `rg -n`, then read ≤150 lines around it. Paths explicitly described as new below do not exist yet.
1. `docs/designs/BATCH-T.md` — only the amendment/heading cited below
2. `src/domains/exceptions/index.ts` — existing SALES_TAX kinds
3. `src/domains/tax/filing-attention.ts` — attention loaders
4. `src/app/desk/today/page.tsx` — attention groups

### Batch T integrated acceptance crosswalk (code evidence, not live activation)

The following maps every checklist row in `docs/PLAN.md` (lines 58–77 at the
current baseline) to delivered engineering and acceptance evidence. A module
or test path is **not** proof of a real provider/account connection; exact-head
CI and owner/CPA go-live conditions still apply.

| PLAN row | Engineering source / regression evidence | Release disposition |
| --- | --- | --- |
| 58 exact-address GIS/manual, not ZIP | `tax/locations.ts`; `tests/tax-locations-integration.test.ts`, `tax-workspace-queries.test.ts` | Built. Authenticated official GIS method/provider contract needs real owner verification |
| 59 billing/signature/invoice blockers | `assertTaxReadyForAgreement`; `tax/locations.ts`, `tax/local-invoice.ts`; `tests/tax-readiness-integration.test.ts` | Domain gates remain authoritative; overview repeats applicable blocker text, does not bypass them |
| 60 lease vs home rule | `tax/engine.ts`; `tests/tax-engine.test.ts` | Domain-owned |
| 61 Stripe areas/mirror & one-cent drift | `tax/stripe-rates.ts`, `tax/stripe-invoice-mirror.ts`; `tax-stripe-rates-integration.test.ts`, `tax-stripe-invoice-mirror-integration.test.ts` | Built, external Stripe activation gated |
| 62 future rate sync | `tax/rate-changes.ts`; `tax-rate-change-integration.test.ts` | Built, live provider gate |
| 63 guarded official updates, undo, source watch | `tax/official-rate-auto-apply.ts`, `official-source-watch.ts`; matching integration tests | Built; source/rate evidence owner-reviewed where required |
| 64 per-account accrual/cash, immutable return, amendment | `tax/filing-packet.ts`, `filing.ts`; `tax-filing-integration.test.ts`, `tax-filing-finalization-integration.test.ts` | Built; actual filing remains manual |
| 65 SUTS packet/copy/zero totals | `sales-tax/returns/[periodId]/page.tsx`, `filing-copy-field.tsx`; `tax-return-actions-integration.test.ts` | Built; specific SUTS wording requires IN-43/44 |
| 66 due dates, license & ICS/reminders | `tax/filing-attention.ts`, `tax/calendar-file.ts`, `returns/calendar.ics/route.ts`; `tax-filing-reminders-integration.test.ts` | Built, live outbound messaging gate |
| 67 Today exact return, unfiled until filed | `tax/filing-attention.ts`, `exceptions/rules.ts`, `sales-tax/returns`; `e2e/sales-tax.spec.ts` | Direct resolving links; cannot dismiss outstanding obligation |
| 68 use tax appliance/PO | `tax/use-tax.ts`; `tax-use-tax-integration.test.ts` | Built; actual reporting owner-confirmed |
| 69 acquisition statuses/DR0252 worksheet/frequency | `tax/acquisition.ts`, `tax/filing-packet.ts`; `appliance-acquisition-tax-integration.test.ts`, `use-tax-frequency.test.ts` | Engine built, **IN-33 interpretation remains an explicit owner/CPA gate** |
| 70 SUTS setup edit and annual check | `tax/setup.ts`, `sales-tax/setup`; `tax-setup-actions-integration.test.ts`, `tax-setup-review-integration.test.ts` | Built; actual tenant configuration/IN-43/44 owner input |
| 71 RDF qualifier/charge/filing/credits | `tax/rdf-records.ts`, `rdf-charges.ts`, `rdf-filing.ts`; `rdf-charge-integration.test.ts`, `rdf-filing-integration.test.ts` | Built, CPA/legal confirmation and live activation gated |
| 72 customer exemption evidence/scope/expiry | `tax/exemptions.ts`, `sales-tax/exemptions`; `tax-exemptions-integration.test.ts` | Built; private media remains private |
| 73 prepaid sales tax at signing | `tax/prepaid-invoice.ts`; `tax-prepaid-invoice-integration.test.ts` | Built |
| 74 owner-only mutations, ADMIN view, axe | `tax/setup.ts`, `tax/filing.ts`, `tax/workspace-overview.ts`; `e2e/sales-tax*.spec.ts` | Local permission tests passed; exact-head browser CI required |
| 75 single six-tab workspace, Today resolve | `sales-tax/layout.tsx`, `sales-tax/page.tsx`, `tax/workspace-overview.ts` | T-7D delivers; not a substitute for per-agreement billing readiness |
| 76 no invented official tax decisions | Tax rate versions & CPA-confirmed rules are stored in DB, not embedded as factual tax advice | Preserve empty/unknown statuses |
| 77 all batch-wide quality gates | `AGENTS.md`, `docs/PLAYBOOK.md` | Final PR exact-head CI, review, preview/performance and production safety still required |

**Open owner/provider gates remain open; they do not turn into green checkboxes:**
IN-17, IN-33–38 (especially use-tax-paid choice), IN-43/44, confirmed GIS method,
official Colorado/SUTS registration, filing payments, live Stripe provider
configuration and legally required tax advice. NO production live tax submission,
charge or payment has been exercised by this engineering acceptance.

## Drift check — every implementation, not only batch start

Follow `docs/implementation-contracts/DRIFT-PROTOCOL.md`. Compare the latest main/predecessor against this baseline and each named contract. Capture actual head, relevant changed files, schema/signature/guard/test differences, and the disposition in the PR and `docs/designs/CHANGES-SINCE-DESIGN.md`. A prior card's merge is a new baseline, never evidence this card still matches.

- Verify prerequisite cards are merged/accepted and inspect their final schema and public signatures; preserve the contract below. If a named existing path or semantic assumption changed, record the actual drift in this card before coding.
- Inspect the listed regression tests and adjacent guards. Use the current private-storage, active-actor, business-date and integer-cent helpers; keep live switches off.
- This card authorizes engineering only; owner/legal activation gates remain in OWNER-INPUTS and GO-LIVE-CHECKLIST.

## Build contract

New tax/workspace-overview.ts: getTaxWorkspaceOverview(actorId:string,now:Date):Promise<{setup:TaxSetupStepDTO[];nextReturn:TaxReturnSummaryDTO|null;attention:TaxAttentionDTO[];nextDue:TaxReturnSummaryDTO[]}>; server role checks; stable due order, no duplicate tax amounts. New sales-tax/page.tsx checklist and next return; six tabs; consolidated kind ordering overdue→amendment→due→not-ready→setup→info. Keep readiness blockers separate from filing/reminder/source checklist; present UNKNOWN acquisition as affected-rental blocker. All Today links land on implemented resolving page/anchor, not a non-existent route. Register routes in e2e inventory, add test fixtures at current tax-ready boundary.
Reconcile DATABASE/ARCHITECTURE/OWNER-GUIDE/BUSINESS-RULES and tax go-live lines against shipped code; close T only with an acceptance evidence row for every PLAN T requirement, including IN-33 pending use-tax-paid interpretation and authenticated GIS method contract. Production lookups/payments/filing remain owner gates, not a fake completed smoke test.

## Required tests

- `tests/tax-overview.test.ts`: "filing checklist not billing gate"; "all attention kinds resolve to existing routes"; "next due deterministic".
- `e2e/sales-tax.spec.ts`: "six tabs phone dark"; "today resolves tax work"; "full tax flow axe".

Use real throwaway PostgreSQL for money, schema, permissions, idempotency and concurrency cases. Fake providers only at the client boundary. Assert persisted totals/states/audit evidence and a second run, not only return values. UI cards add the named browser spec to the least-loaded group in `e2e/shards.json`, recording the selected group in the PR; never skip it silently.

## Finishing commands

Use `set -o pipefail` so piping output cannot hide failures. Each command finishes:

- `timeout 600 npm run typecheck 2>&1 | tail -40`
- `timeout 600 npm run lint 2>&1 | tail -40`
- `timeout 600 npx vitest run tests/tax-overview.test.ts 2>&1 | tail -80`
- Migration owner: `node scripts/check-migrations.mjs`; include populated upgrade and restore coverage; no production seed/reset.

## Stop conditions and completion

Stop only the affected card for changed money ownership, missing approved legal/provider contract, new paid resource, destructive production operation, unsupported schema/permission semantics, or exceeding 800 production lines. Record a specific successor split before pushing over budget; no stubs or silently omitted acceptance. Routine file organization within this contract is the implementer's choice.

Done when every named case and batch acceptance mapped to this card passes, applicable phone/dark/keyboard/axe evidence is recorded, current documentation is updated, all valid review findings have dispositions, and exact-head CI/performance/preview/review gates pass. Merge under AGENTS; no ceremonial extra review cycles.

### Implementation verification — 2026-10-08

Prerequisite T-7C's reviewed head was inspected on the working branch.
New `src/domains/tax/workspace-overview.ts` computes an owner/admin-only
read projection of setup tasks, nearest open return, stable due dates, and
ordered attention. The sales-tax Overview route renders the real six-tab
workspace and resolves each notice to existing Returns, Areas, Exemptions,
Taxability or Setup screens. The existing Today tax attention entry now
routes to the actual work rather than creating a new posting workflow.

Evidence: `tests/tax-overview.test.ts` — 3 isolated PostgreSQL cases pass
(the checklist is not a payment/billing gate; routes resolve; due sorting
remains deterministic). `e2e/sales-tax.spec.ts` is assigned to browser-c,
checking phone/dark six-tab navigation, Today resolution and accessibility.
Type-check, lint and diff check were run. No live government filing, GIS
credential, Stripe charging or customer communication was activated.

Engineering readiness and live business readiness are **different**.
Remaining legal/CPA choices, IN-33 acquisition use-tax interpretation,
authenticated production GIS method and production payment/filing proof
remain owner-gated; a local screenshot or test cannot satisfy them.
