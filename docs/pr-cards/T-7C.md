# T-7C — Guided filing and private evidence

Status: **APPROVED** · Baseline inspected: `b2a06c2` (2026-10-08, #310).
Batch: T · Prerequisites: T-7B.
Base: latest merged prerequisite, or its top branch when stacking. One migration: `none`.
Sizing estimate: 480 production lines; target ≤15 production files; one risk area. Tests/docs excluded. The estimate is a planning bound, not a measured patch size.

## Read only these

Read AGENTS, STATUS and this card first. Find the named heading/function with `rg -n`, then read ≤150 lines around it. Paths explicitly described as new below do not exist yet.
1. `docs/designs/BATCH-T.md` — only the amendment/heading cited below
2. `src/domains/tax/filing.ts` — existing exact commands
3. `src/domains/tax/filing-packet.ts` — packet union
4. `src/domains/tax/calendar-file.ts` — existing ICS
5. `src/domains/documents/artifacts.ts` — private artifact access

### Implementation drift and evidence (October 8)

Inspected predecessor T-7B merged in #323 and current main after documentation-only K-CASH #324 and retired-resale design #325. Neither changed the existing filing commands or Prisma return/evidence models; preserve the new authoritative K/M design docs without substituting their older checkpoint copies.

New private OWNER/ADMIN returns index, details, amendments, downloadable authenticated CSV/ICS, and phone-friendly guidance. OWNER-only checklist, filed/paid evidence and amendment decisions call the existing transactional authority; ADMIN has view-only access. Filed return details render stored immutable worksheet, not recomputed tax. Optional private photo upload is claimed and validated against the return-specific Blob prefix inside filing finalization, no provider or money activation. Existing safe `toCsv` is used.

Local `npm run typecheck`, `npm run lint`, 3 isolated PostgreSQL `tax-return-actions` tests passed. New browser spec assigned to browser-a; require exact-head GitHub CI and review resolution before merge. No migration or live legal submission.

### PR #327 review corrections (October 8)

Resolved P1/P2 scope findings before merge: positive additional-tax amendments use the actual filed amendment command; credit/zero-tax corrections are restricted in BOTH the UI and domain to documented handled-outside resolution. Display the full corrected packet by named filing area with copyable gross, deductions, tax and total, not only internal delta identifiers. Verify private Blob object existence at the storage-provider boundary BEFORE opening the filing transaction; transactional scope checking and Photo claim still occur with the return lock. Use stable content-derived keys for owner checklist progress so old checkmarks never silently map to changed filing instructions. Explicit consequence-aware owner checkbox is required by the form and server action before irreversible filing, payment and amendment decisions. Include copy controls for original returns.

New isolated PostgreSQL tests assert nonpositive amendment rejection and stable checklist content. Initial CI browser staff-calendar test was following an auth redirect to a 200 login page; test now requests with maxRedirects=0 to check the actual access response. CI must be repeated at exact reviewed head.

## Drift check — every implementation, not only batch start

Follow `docs/implementation-contracts/DRIFT-PROTOCOL.md`. Compare the latest main/predecessor against this baseline and each named contract. Capture actual head, relevant changed files, schema/signature/guard/test differences, and the disposition in the PR and `docs/designs/CHANGES-SINCE-DESIGN.md`. A prior card's merge is a new baseline, never evidence this card still matches.

- Verify prerequisite cards are merged/accepted and inspect their final schema and public signatures; preserve the contract below. If a named existing path or semantic assumption changed, record the actual drift in this card before coding.
- Inspect the listed regression tests and adjacent guards. Use the current private-storage, active-actor, business-date and integer-cent helpers; keep live switches off.
- This card authorizes engineering only; owner/legal activation gates remain in OWNER-INPUTS and GO-LIVE-CHECKLIST.

## Build contract

New /desk/sales-tax/returns list, returns/[periodId], returns/[periodId]/amend and authenticated CSV/ICS routes beneath sales-tax. Server load packet/status; filed page renders frozen worksheet only, open page blockers then generated checklist/copy values; progress saves using existing saveFilingEntryProgress and exact schema. OWNER can mark filed/paid or amendment handled; ADMIN reads 'Ask owner'; existing domain actor locks remain authoritative.
CSV cells use src/lib/csv.ts; filenames IDs only, no account secrets. Evidence upload uses private media controls outside transaction then claim/validate within finalization; cleanup abandoned upload via existing retention policy. SALES_RETURN, USE_TAX_RETURN and RDF have explicit packet layouts; never call revenue/tax math on page. Signed/paid state cannot be implied by saving progress. Render notices for incomplete SUTS screen mapping/worksheet fallback without blocking engineering. Wrong customer/role/media copied URLs denied.

## Required tests

- `tests/tax-return-actions-integration.test.ts`: "stale filing rejected"; "private confirmation scope"; "CSV formula safety".
- `e2e/sales-tax-returns.spec.ts`: "guided filing and frozen read back"; "amendment mode"; "admin cannot file"; "phone keyboard axe".

Use real throwaway PostgreSQL for money, schema, permissions, idempotency and concurrency cases. Fake providers only at the client boundary. Assert persisted totals/states/audit evidence and a second run, not only return values. UI cards add the named browser spec to the least-loaded group in `e2e/shards.json`, recording the selected group in the PR; never skip it silently.

## Finishing commands

Use `set -o pipefail` so piping output cannot hide failures. Each command finishes:

- `timeout 600 npm run typecheck 2>&1 | tail -40`
- `timeout 600 npm run lint 2>&1 | tail -40`
- `timeout 600 npx vitest run tests/tax-return-actions-integration.test.ts 2>&1 | tail -80`
- Migration owner: `node scripts/check-migrations.mjs`; include populated upgrade and restore coverage; no production seed/reset.

## Stop conditions and completion

Stop only the affected card for changed money ownership, missing approved legal/provider contract, new paid resource, destructive production operation, unsupported schema/permission semantics, or exceeding 800 production lines. Record a specific successor split before pushing over budget; no stubs or silently omitted acceptance. Routine file organization within this contract is the implementer's choice.

Done when every named case and batch acceptance mapped to this card passes, applicable phone/dark/keyboard/axe evidence is recorded, current documentation is updated, all valid review findings have dispositions, and exact-head CI/performance/preview/review gates pass. Merge under AGENTS; no ceremonial extra review cycles.
