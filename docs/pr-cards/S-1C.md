# S-1C — System health page and Today system group

Status: **APPROVED** · Baseline inspected: `b2a06c2` (2026-10-08, #310).
Batch: S · Prerequisites: S-1B.
Base: latest merged prerequisite, or its top branch when stacking. One migration: `none`.
Sizing estimate: 430 production lines; target ≤15 production files; one risk area. Tests/docs excluded. The estimate is a planning bound, not a measured patch size.

## Read only these

Read AGENTS, STATUS and this card first. Find the named heading/function with `rg -n`, then read ≤150 lines around it. Paths explicitly described as new below do not exist yet.
1. `docs/designs/BATCH-S.md` — D-S1–D-S5 and the owning schema/function headings
2. `src/domains/automation/runs.ts` — runAutomation
3. `src/domains/automation/health.ts` — AUTOMATION_RULES/getAutomationHealth
4. `src/domains/exceptions/index.ts` — role-shaped attention

## Drift check — every implementation, not only batch start

Follow `docs/implementation-contracts/DRIFT-PROTOCOL.md`. Compare the latest main/predecessor against this baseline and each named contract. Capture actual head, relevant changed files, schema/signature/guard/test differences, and the disposition in the PR and `docs/designs/CHANGES-SINCE-DESIGN.md`. A prior card's merge is a new baseline, never evidence this card still matches.

- Verify prerequisite cards are merged/accepted and inspect their final schema and public signatures; preserve the contract below. If a named existing path or semantic assumption changed, record the actual drift in this card before coding.
- Inspect the listed regression tests and adjacent guards. Use the current private-storage, active-actor, business-date and integer-cent helpers; keep live switches off.
- This card authorizes engineering only; owner/legal activation gates remain in OWNER-INPUTS and GO-LIVE-CHECKLIST.

## Build contract

New system-issues/queries.ts: listSystemIssues(actorId:string,input:{status?:SystemIssueStatus;cursor?:string;limit:number}):Promise<{rows:SystemIssueDTO[];nextCursor:string|null}>; addOwnerSystemIssueNote(actorId:string,input:{issueId:string;body:string;expectedVersion:number}):Promise<void>; markSystemIssueResolved(actorId:string,input:{issueId:string;reason:string;expectedVersion:number}):Promise<void>. OWNER/ADMIN reads, OWNER writes; actor inside transaction, lock/CAS, redaction/name rejection fails atomically. State ACKNOWLEDGED remains open for attention; manual resolved issue reopens if source persists.
Rename nav display /desk/automations to System health, preserve route and old anchors. Issue list severity/newest stable ordering, note/error display, source resolving link and owner mark-resolved reason. Existing health/pause controls remain intact. Today SYSTEM_ISSUE group contains only HIGH open/acknowledged issues with PII-free summary, finance actors only. Counts paginate server-side; no raw AutomationRun.error/provider payload exposed. Key UI added by S-2 later; do not render placeholder controls now.

## Required tests

- `tests/system-issue-actions-integration.test.ts`: "admin cannot resolve"; "stale version rejected"; "name note rejected with no row".
- `e2e/system-health.spec.ts`: "owner resolve and recurring reopen"; "staff direct URL denied"; "phone dark axe".

Use real throwaway PostgreSQL for money, schema, permissions, idempotency and concurrency cases. Fake providers only at the client boundary. Assert persisted totals/states/audit evidence and a second run, not only return values. UI cards add the named browser spec to the least-loaded group in `e2e/shards.json`, recording the selected group in the PR; never skip it silently.

## Finishing commands

Use `set -o pipefail` so piping output cannot hide failures. Each command finishes:

- `timeout 600 npm run typecheck 2>&1 | tail -40`
- `timeout 600 npm run lint 2>&1 | tail -40`
- `timeout 600 npx vitest run tests/system-issue-actions-integration.test.ts 2>&1 | tail -80`
- Migration owner: `node scripts/check-migrations.mjs`; include populated upgrade and restore coverage; no production seed/reset.

## Stop conditions and completion

Stop only the affected card for changed money ownership, missing approved legal/provider contract, new paid resource, destructive production operation, unsupported schema/permission semantics, or exceeding 800 production lines. Record a specific successor split before pushing over budget; no stubs or silently omitted acceptance. Routine file organization within this contract is the implementer's choice.

Done when every named case and batch acceptance mapped to this card passes, applicable phone/dark/keyboard/axe evidence is recorded, current documentation is updated, all valid review findings have dispositions, and exact-head CI/performance/preview/review gates pass. Merge under AGENTS; no ceremonial extra review cycles.

## Added acceptance ENH-S

Include BATCH-S’s 2026-10-08 actionable recovery amendment: allowlisted role-scoped
route + manual instruction per kind, source as-of and explicit UNKNOWN/stale label.
No action resends an uncertain provider operation. Tests cover role shaping,
missing source, stale timestamp, partial-page scan and unsafe retry absence.

## October 8–9 implementation drift and handoff
- The actual merged predecessor is S-1B #331 (`15b7eaf`), not the
  original `b2a06c2` baseline. No schema changes are needed in S-1C.
  Existing issue/version, typed summaries and recovery source links remain.
- The health screen stays at `/desk/automations`, preserving the task
  pause/resume controls and anchors. The navigation label is now **System health**.
  ADMIN reads are allowed; OWNER-only notes and resolutions recheck active
  ownership inside their PostgreSQL transaction and lock the issue row.
  Every accepted change increments the issue version; stale submissions
  fail without inserting a note or mutating status.
- Human notes and reasons are private, capped, redacted and checked
  against stored person names. They must never be exported through S-2's
  external agent API. Recovery links are server allowlisted, with OWNER
  requirements masked to an ADMIN and UNKNOWN provider outcomes explicitly
  warning against blind retries.
- Today shows only HIGH OPEN or ACKNOWLEDGED issues to OWNER/ADMIN, with
  structured PII-free summary; STAFF sees no system issues. Server queries
  cap result size and expose pagination. The browser spec belongs to
  `browser-a` in `e2e/shards.json`.
- Real throwaway PostgreSQL integration cases verify ADMIN read-only,
  owner CAS, planted-name rejection with no stored row, and recurring
  source reopening. Browser proof covers owner actions, staff direct
  URL isolation, and the existing 360/1440 light/dark axe helper.
