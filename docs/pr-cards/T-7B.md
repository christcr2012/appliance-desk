# T-7B — Areas, official sources and exemption navigation

Status: **APPROVED** · Baseline inspected: `b2a06c2` (2026-10-08, #310).
Batch: T · Prerequisites: T-7A.
Base: latest merged prerequisite, or its top branch when stacking. One migration: `none`.
Sizing estimate: 450 production lines; target ≤15 production files; one risk area. Tests/docs excluded. The estimate is a planning bound, not a measured patch size.

## Read only these

Read AGENTS, STATUS and this card first. Find the named heading/function with `rg -n`, then read ≤150 lines around it. Paths explicitly described as new below do not exist yet.
1. `docs/designs/BATCH-T.md` — only the amendment/heading cited below
2. `src/domains/tax/official-rate-auto-apply.ts` — attention/undo/manual commands
3. `src/domains/tax/official-source-watch.ts` — acknowledgeOfficialSourceChange
4. `src/domains/tax/exemptions.ts` — existing exemption command and evidence guards

## Drift check — every implementation, not only batch start

Follow `docs/implementation-contracts/DRIFT-PROTOCOL.md`. Compare the latest main/predecessor against this baseline and each named contract. Capture actual head, relevant changed files, schema/signature/guard/test differences, and the disposition in the PR and `docs/designs/CHANGES-SINCE-DESIGN.md`. A prior card's merge is a new baseline, never evidence this card still matches.

- Verify prerequisite cards are merged/accepted and inspect their final schema and public signatures; preserve the contract below. If a named existing path or semantic assumption changed, record the actual drift in this card before coding.
- Inspect the listed regression tests and adjacent guards. Use the current private-storage, active-actor, business-date and integer-cent helpers; keep live switches off.
- This card authorizes engineering only; owner/legal activation gates remain in OWNER-INPUTS and GO-LIVE-CHECKLIST.

## Build contract

New sales-tax/areas/page.tsx and exemptions/page.tsx; extend setup official-sources section. Reuse existing exemption form/commands and current owner-verified artifact handling; no second exemption data model. Route all source-watch and rate-review attention to exact anchors; display source failure/coverage honestly. ADMIN confirms address per existing command; OWNER publishes/undoes rates and exemption policy. No arbitrary fetch URL on form; official source transport remains SSRF-protected.
New tax/workspace-queries.ts: getTaxAreasPage(actorId:string,input:{cursor?:string;limit:number;status?:'REVIEW'|'VERIFIED'}):Promise<{rows:TaxAreaDTO[];nextCursor:string|null}>; getTaxExemptionsPage(actorId:string,input:{cursor?:string;limit:number}):Promise<{rows:TaxExemptionDTO[];nextCursor:string|null}>. Stable (createdAt,id) cursors, limits1..100, restricted DTOs. Use existing certificate links and customer ownership; explicit missing provider contract is a manual-location workflow, not successful automated lookup.

## Required tests

- `tests/tax-workspace-queries.test.ts`: "stable pagination"; "finance role filtering"; "unknown provider status visible".
- `e2e/sales-tax-areas.spec.ts`: "review and undo allowed roles"; "exemption navigation"; "source failure visible"; "axe".

Use real throwaway PostgreSQL for money, schema, permissions, idempotency and concurrency cases. Fake providers only at the client boundary. Assert persisted totals/states/audit evidence and a second run, not only return values. UI cards add the named browser spec to the least-loaded group in `e2e/shards.json`, recording the selected group in the PR; never skip it silently.

## Finishing commands

Use `set -o pipefail` so piping output cannot hide failures. Each command finishes:

- `timeout 600 npm run typecheck 2>&1 | tail -40`
- `timeout 600 npm run lint 2>&1 | tail -40`
- `timeout 600 npx vitest run tests/tax-workspace-queries.test.ts 2>&1 | tail -80`
- Migration owner: `node scripts/check-migrations.mjs`; include populated upgrade and restore coverage; no production seed/reset.

## Stop conditions and completion

Stop only the affected card for changed money ownership, missing approved legal/provider contract, new paid resource, destructive production operation, unsupported schema/permission semantics, or exceeding 800 production lines. Record a specific successor split before pushing over budget; no stubs or silently omitted acceptance. Routine file organization within this contract is the implementer's choice.

Done when every named case and batch acceptance mapped to this card passes, applicable phone/dark/keyboard/axe evidence is recorded, current documentation is updated, all valid review findings have dispositions, and exact-head CI/performance/preview/review gates pass. Merge under AGENTS; no ceremonial extra review cycles.
