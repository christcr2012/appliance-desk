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
