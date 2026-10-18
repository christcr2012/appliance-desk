# MCP-1 / MCP-2 — trustworthy health and backup evidence

Status: **DESIGN READY; ENGINEERING NOT STARTED**. Baseline inspected:
`ef8af2cdd2e7dcd1322ff0163b32ca6ab34c42fe`. Parent design:
[Appliance Desk MCP](../mcp/README.md). Full semantics:
[upgrades](../mcp/APPLIANCE-DESK-UPGRADES.md) and
[persistence](../mcp/DATA-AND-RECOVERY.md).

## Startup and delivery boundary

Read AGENTS/SESSION-START and apply [DRIFT-PROTOCOL](../implementation-contracts/DRIFT-PROTOCOL.md).
Reconcile actual main, active F2 packet and PR #494 before changing anything;
that PR owns F2-C/F2-D, screenshots/guide/launch evidence. This design does not
change their engineering status or supersede their acceptance. On MCP activation,
register original MCP units and pinned index validator together, author the current
execution JSON from these real anchors, and freeze/commit the bundle plan before code.
One suggested bundle includes whole MCP-1 and MCP-2, not one PR per helper.
Estimated production workload 600–1000 meaningful changed lines; verify actuals,
split only for a documented migration/review boundary and retain full criteria.
The no-implemented-MCP state changes only with source/test/merge evidence.

## Existing anchors and consumers

| Path | Symbol / contract |
|---|---|
| `src/domains/automation/health.ts` | AutomationHealthState, AUTOMATION_RULES, getAutomationHealth |
| `src/app/desk/automations/page.tsx` | STATE_TONE, stateLabel, AutomationsPage |
| `src/domains/automation/runs.ts` | safeError, claimRun, runAutomation |
| `src/domains/system-issues/sources.ts` | collectSystemIssueInputs, sweepSystemIssues |
| `src/domains/system-issues/render.ts` | renderSystemIssue |
| `src/domains/system-issues/ops-api.ts` | getOpsIssues, authorizeOpsRequest |
| `src/domains/backup/index.ts` | buildDatabaseBackupSnapshot, exportDatabaseBackup, pruneOldBackups |
| `src/app/api/cron/backup/route.ts` | GET; RAN/ALREADY_RAN dependency handling |
| `scripts/media-inventory.ts` | runMediaInventoryAndCopy, findLatestDatabaseBackupUrl |
| `src/lib/photo-storage.ts` | getPrivatePhotoStore, isPrivatePhotoPath |
| `src/domains/backup/media-deletion.ts` | deletePrivatePhotoWithRecovery |
| `src/domains/backup/manifest.ts` | BACKUP_MODEL_POLICY, BACKUP_TABLES |

## Finite build sequence

1. Reconcile existing stale issue checks; define one exhaustive health state/DTO
   and presentation mapping. Add nullable diagnostic fields only if necessary.
2. Add indexed bounded latest/success/failure queries and real-calendar freshness.
   Map typed source error/stage/correlation into safe owner/MCP DTO, not raw text.
3. Introduce backup artifact/stage evidence and protected locators; update schema,
   backup policy, populated upgrade and restore ordering. Private token/store
   readiness has explicit invalid/missing/denied/unknown states, no values.
4. Separate verified capture/upload from prune failure; paginate safe retention;
   preserve last recoverable set. Extract media domain orchestration while script
   remains thin caller. Bind media to verified persisted database artifact.
5. Define explicit failed/unknown recovery command semantics without globally
   changing billing/message replay; journal execution arrives in MCP-5.
6. Update existing health UI and source/run diagnostics, glossary and living docs.
   Record real backup root cause only if authorized logs/proof were obtained.

## Acceptance and exact fixtures

Full M1/M2 acceptance in [roadmap](../mcp/ROADMAP.md) remains binding.
- 10,000 AutomationRuns across two daily rules plus weekly/calendar rules:
  old success, newer failure, paused, missing config, never run, overdue,
  clock skew and both Denver DST edges; no whole-history materialization.
- Planted secret/name/email/address/URL in an exception never reaches safe DTO,
  console capture, generic issue, notification or MCP response.
- Capture timeout, upload denial, digest mismatch, prune error after verified
  upload, >1000 retention objects, last good set, token/store mismatch,
  deleted-photo tombstone during copy, ALREADY_RAN with failed predecessor.
- Disposable real restore verifies rows/relationships and media; no active
  credentials restored. No production fixture, provider write or message.

## Verification and closeout

Extend existing `tests/automation-health.test.ts`, `tests/ops-redaction.test.ts`,
`tests/system-issues-integration.test.ts`, `tests/automation-runs-integration.test.ts`,
`tests/backup-export.test.ts`, `tests/backup-restore-integration.test.ts`,
`tests/media-inventory.test.ts`, scenario 09 and `e2e/system-health-keys.spec.ts`.
Use existing preflight/db/browser wrappers, one shared DB run at a time; exact
selectors in the JIT packet. Required exact-head CI/review, drift/living docs,
merge, release and real-acceptance distinctions follow AGENTS unchanged.
MCP-3/4 depend on the stable safe DTO; update their JIT card only after this
actual reviewed boundary. Update acceptance.json honestly; no fabricated passes.
