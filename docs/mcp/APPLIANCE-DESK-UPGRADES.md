# Required Appliance Desk upgrades

These changes belong in this repository and reuse current application code. They are requirements for implementation, not claims of repair. The pasted production reports establish symptoms only; no private logs, provider settings or recovery artifacts were verified during planning.

## MCP-1: accurate, useful health and diagnostic evidence

| Verified baseline finding | Required change and regression |
|---|---|
| `AutomationHealthState` uses failing/unknown/never-ran/unconfigured; page's `STATE_TONE` expects failed/uncertain/never-run/missing-configuration | Use one exhaustive exported state contract and typed presentation map. Test every state has a deliberate label/tone; render warning words as well as color. |
| `expectedEveryHours` exists but `getAutomationHealth` ignores it and can label an old success healthy | Add next expected/check times, grace and STALE state with shared computation. Default grace two hours, owner-configurable; weekly/calendar jobs honor real due dates, paused/blocked/never-run remain distinct. Test daily/weekly/monthly calendar, DST, old success, recent failure and future clock skew. Do not add a second stale algorithm beside `sources.ts`; reconcile and reuse it. |
| `getAutomationHealth` reads all historical AutomationRun rows | Query bounded latest/latest-success/latest-failure per rule (DB grouping/lateral queries or indexed bounded queries). Preserve deterministic tie order; test 10,000 synthetic runs and inspect query plan. |
| `safeError` stores partly scrubbed free text; issue record collapses to generic class; `exportDatabaseBackup` logs raw exception | Add structured failure stage/code and safe correlation ref at the source, allowlisted rendered explanation, and private structured logging without secret/customer values. Never expose raw stack/provider payload via MCP or public issue DTO. Keep existing incident fingerprint continuity. |
| User sees environment variable names without a usable next step | Show what is affected, last verified state, what the app checked and a role-appropriate setup/recheck link. Never show the credential. |

Use `tests/automation-health.test.ts`, `tests/ops-redaction.test.ts`, `tests/system-issues-integration.test.ts`, `tests/automation-runs-integration.test.ts` and owner health browser spec. Extend existing tests before creating parallel suites. Add exhaustive state test and secret/PII canary outputs. Error classification must preserve UNKNOWN when evidence is insufficient.

## MCP-2: trustworthy backup and media recovery status

Existing database export builds all tables in one repeatable-read Prisma transaction then uploads one JSON artifact. A transaction timeout or large snapshot is plausible; Blob configuration or retention failure is also plausible. None is the verified cause of the owner's failure. Inspect authorized logs and reproduce stages synthetically first.

Separate CAPTURE, SERIALIZE, UPLOAD, READBACK, PRUNE and MEDIA_COPY outcomes. Persist `BackupArtifact` with opaque ref, kind DATABASE/MEDIA_MANIFEST, format/migration/app revision, byte count, digest, created/verifiedAt, source run, state, protected storage locator. Agents see safe summaries only. A pruning failure after successful verified upload becomes retention attention, not “no backup exists.” Paginate retention listing and only prune eligible old verified artifacts; never delete the last known recoverable set. Retention starting value remains existing 30 days, now explained and owner configurable with preserved legal holds.

Move app-used media orchestration from import-through-`scripts/media-inventory.ts` into `src/domains/backup/media.ts`; retain script as a thin compatibility caller and reuse its tested tombstone logic. Do not duplicate it. Typed stage results survive transport timeout. If snapshot exceeds measured serverless memory/runtime, add resumable artifact work with a consistent snapshot strategy and approved existing worker; do not paginate unrelated transactions and call it a consistent backup. Record measured size/time and explicit unsupported bounds before choosing a worker. Increasing capacity/spending is not authorized by design work.

Private-photo readiness must reuse `getPrivatePhotoStore` but validate actual intended private store access through the provider adapter. Presence alone is not readiness. Distinguish missing token, missing ID, token/store mismatch, access denied, wrong visibility, unreachable provider and no source photos. Verify the backup destination's privacy separately: never infer it from a shared `BLOB_READ_WRITE_TOKEN` used for catalog images. Do not reuse public storage for private customer evidence. Do not print provider IDs or values into public docs.

Database artifact success, media inventory success, digest/readability check and restore rehearsal are separate facts. Missing source file is not silently counted recovered. Reuse privacy tombstones; copied metadata cannot resurrect deleted photos. New diagnostic/credential records must follow backup exclusion policy. Replace the existing backup-failure email's unverified claim that host recovery guarantees safety with accurate recorded facts; no live email sent during development.

Tests: existing backup/export/restore/media suites plus synthetic capture timeout, upload refusal, readback mismatch, successful upload+failed prune, paginated retention, source mismatch, media dependency failure, duplicate recovery request and deleted-photo tombstone during copy. Real disposable restore scenario proves rows, relationships and media integrity; no production overwrite. Keep the existing backup route authenticated with CRON_SECRET; MCP never obtains that secret or calls the cron endpoint as an authorization shortcut.

## MCP-3 to MCP-9: product integration

Add connection consent, revocation, policies, journal and health/repair UI to the existing System health area. Keep existing key list functional with explanatory migration copy: “Legacy check-up access: reads reported issues and adds findings; does not schedule monitoring.” Add “Connect an AI assistant” with endpoint, sign-in steps, permission choices, last successful connection and verified test. Do not ask owner to create an unexplained bearer token for normal OAuth setup.

Introduce metadata and routes through the route inventory; preserve public sign-up disabled, existing MFA/session role checks, redirects/security headers and normal customer portal isolation. Integrate actions/alerts with current To do/exceptions and settings glossary; one system incident, not duplicated counters. Existing full CI, e2e shard lists, backup schema checks and release policy apply. Later customer/staff tools must pass native resource checks, not owner-only shortcuts.

## MCP-10/11: user feedback

Add Report a problem / Suggest an improvement in Desk and account portal, a reporter's My reports view, and owner/admin triage linked from System health. Private support records use a distinct data model and permissions; safe incident linkage reuses existing issue tracking only after sanitization. See [feedback contract](FEEDBACK.md). Keep urgent appliance/service issues pointed at the existing maintenance workflow, with optional support report linkage; software feedback is not a promise of emergency service.
