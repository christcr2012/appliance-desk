# T-7A — Tax setup, account and rule editing

Status: **APPROVED** · Baseline inspected: `b2a06c2` (2026-10-08, #310).
Batch: T · Prerequisites: T-6C4.
Base: latest merged prerequisite, or its top branch when stacking. One migration: `none`.
Sizing estimate: 500 production lines; target ≤15 production files; one risk area. Tests/docs excluded. The estimate is a planning bound, not a measured patch size.

## Read only these

Read AGENTS, STATUS and this card first. Find the named heading/function with `rg -n`, then read ≤150 lines around it. Paths explicitly described as new below do not exist yet.
1. `docs/designs/BATCH-T.md` — only the amendment/heading cited below
2. `src/lib/desk-navigation.ts` — Money group
3. `src/domains/tax/locations.ts` — confirmAddressLocation
4. `src/domains/tax/exemptions.ts` — existing commands
5. `src/domains/settings/index.ts` — locked settings saves

### Actual T-7A drift and execution checkpoint (2026-10-08)

- Started from merged T-6C4 (#321), `6f31f72013f0a1dcc1597160af32d329b27fa53e`, rather than the original planning SHA. The RDF filing, credit and conditional-billing blockers are preserved.
- Existing finance access uses `requireRole("OWNER", "ADMIN")`, while each mutation needs `requireRole("OWNER")` **and** `assertActiveTeamActor` inside its transaction. STAFF receives no tax workspace routes or navigation.
- `BusinessSettings.updatedAt` and `TaxFilingAccount.updatedAt` support optimistic concurrency; preserve signed/finalized periods when editing an account. Existing `TaxabilityRule` and immutable `TaxRateVersion` models are reused.
- New six-section shell presents enabled Setup and What's taxed first. Remaining planned views (Overview, Returns, Areas, Exemptions) are labeled not yet released until T-7B/C/D; no dead links represented as working controls.
- No new database migration or production billing/filing activation. Browser spec `e2e/sales-tax-setup.spec.ts` assigned to `browser-a`. Test-only ADMIN browser credentials are optional/conditional; domain-level owner-only admin denial is covered by real PostgreSQL tests.

## Drift check — every implementation, not only batch start

Follow `docs/implementation-contracts/DRIFT-PROTOCOL.md`. Compare the latest main/predecessor against this baseline and each named contract. Capture actual head, relevant changed files, schema/signature/guard/test differences, and the disposition in the PR and `docs/designs/CHANGES-SINCE-DESIGN.md`. A prior card's merge is a new baseline, never evidence this card still matches.

- Verify prerequisite cards are merged/accepted and inspect their final schema and public signatures; preserve the contract below. If a named existing path or semantic assumption changed, record the actual drift in this card before coding.
- Inspect the listed regression tests and adjacent guards. Use the current private-storage, active-actor, business-date and integer-cent helpers; keep live switches off.
- This card authorizes engineering only; owner/legal activation gates remain in OWNER-INPUTS and GO-LIVE-CHECKLIST.

## Build contract

§14 six-tab shell starts here. New src/app/desk/sales-tax/{layout.tsx,setup/page.tsx,setup/actions.ts,setup/accounts/[id]/page.tsx,taxability/page.tsx}; add single finance nav link. OWNER/ADMIN server-read, OWNER mutations except existing address-confirm roles. New tax/setup.ts: saveTaxSettings(actorId:string,input:TaxSettingsInput,expectedUpdatedAt:Date):Promise<void>; saveTaxFilingAccount(actorId:string,input:FilingAccountInput,expectedUpdatedAt:Date|null):Promise<{id:string}>. Strict DTO whitelist includes existing election/reporting/official-rate controls, RDF controls/rates, filing account §11.13 fields, business location and owner reminder settings only; import Prisma enum types, never arbitrary Partial<BusinessSettings>.
Create/update account under actor/settings/account locks, uniqueness and checked URLs; explanation/restore for each setting; raw SUTS credentials are never fields. Editable account/location IDs are private business data. New taxability matrix command validates category/jurisdiction and CPA confirmation per cell with actor/audit in transaction. Rate versions append immutable rows; corrections follow official-rate undo rules. Disclosure edits use existing legal gate; no automatic live activation. Include setup anchors and per-action in-page errors.

## Required tests

- `tests/tax-setup-actions-integration.test.ts`: "owner only settings"; "stale save conflict"; "account missing answers stays incomplete"; "new rate leaves history".
- `e2e/sales-tax-setup.spec.ts`: "owner setup phone"; "admin read only"; "staff URL denied"; "axe light dark".

Use real throwaway PostgreSQL for money, schema, permissions, idempotency and concurrency cases. Fake providers only at the client boundary. Assert persisted totals/states/audit evidence and a second run, not only return values. UI cards add the named browser spec to the least-loaded group in `e2e/shards.json`, recording the selected group in the PR; never skip it silently.

## Finishing commands

Use `set -o pipefail` so piping output cannot hide failures. Each command finishes:

- `timeout 600 npm run typecheck 2>&1 | tail -40`
- `timeout 600 npm run lint 2>&1 | tail -40`
- `timeout 600 npx vitest run tests/tax-setup-actions-integration.test.ts 2>&1 | tail -80`
- Migration owner: `node scripts/check-migrations.mjs`; include populated upgrade and restore coverage; no production seed/reset.

## Stop conditions and completion

Stop only the affected card for changed money ownership, missing approved legal/provider contract, new paid resource, destructive production operation, unsupported schema/permission semantics, or exceeding 800 production lines. Record a specific successor split before pushing over budget; no stubs or silently omitted acceptance. Routine file organization within this contract is the implementer's choice.

Done when every named case and batch acceptance mapped to this card passes, applicable phone/dark/keyboard/axe evidence is recorded, current documentation is updated, all valid review findings have dispositions, and exact-head CI/performance/preview/review gates pass. Merge under AGENTS; no ceremonial extra review cycles.
