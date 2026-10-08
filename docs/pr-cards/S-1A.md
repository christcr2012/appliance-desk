# S-1A — System issue schema and typed safe event writers

Status: **APPROVED** · Baseline inspected: `b2a06c2` (2026-10-08, #310).
Batch: S · Prerequisites: T-7D.
Base: latest merged prerequisite, or its top branch when stacking. One migration: `batch_s_system_issues`.
Sizing estimate: 440 production lines; target ≤15 production files; one risk area. Tests/docs excluded. The estimate is a planning bound, not a measured patch size.

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

Migrate only SystemIssue, SystemIssueNote, SystemIssueStatus/Severity from BATCH-S §2; OpsAgentKey belongs S-2. Use exact defaults/indexes; add SystemIssue.version Int default1 for owner CAS, SystemIssueNote.authorUserId and authorKeyId nullable (no FK until key exists), note author display is private, never exported by ops API. CHECK no two author identities, occurrence>0 and typed kind allowlist. Backup covers issues/notes.
New system-issues/{types.ts,render.ts,index.ts}: SystemIssueInput is exact union in design §3; recordSystemIssue(input):Promise<void> and resolveSystemIssue(fingerprint:string,reason:'SOURCE_SUCCEEDED'|'NO_STUCK_ITEMS'|'OWNER_REVIEWED'):Promise<void>. Fingerprint/severity derived in renderer; invalid strings/URLs rejected, official URL must match active watch. Never accept raw error message or client summary/detail. Upsert by fingerprint atomically increments and reopens a resolved issue; CAS increments version; resolve absent no-op. System recording failure is caught outside caller transaction, structured error-code-only logged, never rollbacks original work.
New ops-redaction.ts: redactForOps(text:string):string and assertNoKnownPersonNames(tx,text):Promise<void>; reject known full/last-name evidence from User/CustomerContact/Lead, plus source forbidden patterns; 2KB limit for new notes/reasons. Best-effort redaction is not a guarantee of anonymity: exported issue DTO excludes free-text notes/resolution reasons; structured summaries only. Owner-only private note actions added S-1C; API adds only structured notes S-2. Record this privacy amendment in BATCH-S.

## Required tests

- `tests/system-issues-integration.test.ts`: "concurrent upsert dedupes"; "resolved issue reopens"; "writer failure leaves business result intact".
- `tests/ops-redaction.test.ts`: "forbidden patterns"; "known full name rejected"; "export excludes free text".

Use real throwaway PostgreSQL for money, schema, permissions, idempotency and concurrency cases. Fake providers only at the client boundary. Assert persisted totals/states/audit evidence and a second run, not only return values. UI cards add the named browser spec to the least-loaded group in `e2e/shards.json`, recording the selected group in the PR; never skip it silently.

## Finishing commands

Use `set -o pipefail` so piping output cannot hide failures. Each command finishes:

- `timeout 600 npm run typecheck 2>&1 | tail -40`
- `timeout 600 npm run lint 2>&1 | tail -40`
- `timeout 600 npx vitest run tests/system-issues-integration.test.ts tests/ops-redaction.test.ts 2>&1 | tail -80`
- Migration owner: `node scripts/check-migrations.mjs`; include populated upgrade and restore coverage; no production seed/reset.

## Stop conditions and completion

Stop only the affected card for changed money ownership, missing approved legal/provider contract, new paid resource, destructive production operation, unsupported schema/permission semantics, or exceeding 800 production lines. Record a specific successor split before pushing over budget; no stubs or silently omitted acceptance. Routine file organization within this contract is the implementer's choice.

Done when every named case and batch acceptance mapped to this card passes, applicable phone/dark/keyboard/axe evidence is recorded, current documentation is updated, all valid review findings have dispositions, and exact-head CI/performance/preview/review gates pass. Merge under AGENTS; no ceremonial extra review cycles.
