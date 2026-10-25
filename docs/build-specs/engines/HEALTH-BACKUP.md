# Build spec — Trustworthy system health and backups (MCP-1, MCP-2)

Cards: `docs/pr-cards/MCP-1.md` (health), `docs/pr-cards/MCP-2.md` (backups). Design: `docs/mcp/APPLIANCE-DESK-UPGRADES.md`
and `docs/mcp/DATA-AND-RECOVERY.md`. Approved by Chris 2026-10-25 ("Agent connection + feedback"). These two units
need no outside account: everything is tested on throwaway Postgres and fake Blob clients. Seeing a real production
backup run is an owner/hosting fact recorded on the checklist, never claimed from tests.

Current code, read on 2026-10-25 (line numbers approximate; re-check before editing):
- `src/domains/automation/health.ts`: states `healthy | failing | unknown | never-ran | paused | unconfigured`;
  31 rules in `AUTOMATION_RULES`, all `expectedEveryHours: 24` except `tax-rate-watch` (168). `getAutomationHealth`
  loads **every** `AutomationRun` with no limit and never uses `expectedEveryHours` (an old success shows healthy).
- Staleness exists only in `src/domains/system-issues/sources.ts` (~line 83) as "more than 2 × expected hours since the
  last success" in plain UTC milliseconds; a rule that never ran raises nothing.
- `src/app/desk/automations/page.tsx` `STATE_TONE` uses `failed`, `uncertain`, `missing-configuration`, `never-run`
  — none match the real states, so four states fall back to the neutral tone. The page also prints the raw stored
  `error` text.
- `src/domains/automation/runs.ts` `safeError` strips URLs, emails, `sk_`/`rk_` keys and 40+ character tokens, not phone
  numbers or street addresses; `runAutomation` never records a failure code or stage.
- `src/domains/backup/index.ts` `exportDatabaseBackup`: one try/catch around snapshot, upload and prune, so the three
  failures look the same and a prune failure after a good upload reports "backup failed"; no read-back check; prune
  reads only the first `list()` page and deletes by file date, including the newest good copy's photo manifest and
  possibly the last good backup. The backup URL is not saved, so the photo copy (`media-copy`) on an `ALREADY_RAN`
  day falls back to "the newest file in backups/".
- `scripts/media-inventory.ts` loads deletion tombstones once at the start, so a photo deleted during the copy can
  still be copied.

---

## MCP-1 — Health that tells the truth

### 1. One state list (`src/domains/automation/health-states.ts`, pure)
```ts
export const HEALTH_STATES = ["healthy", "late", "failing", "running", "unknown", "never-ran", "paused", "unconfigured"] as const;
export type HealthState = (typeof HEALTH_STATES)[number];
export const HEALTH_PRESENTATION: Record<HealthState, { label: string; tone: "good" | "attention" | "bad" | "info" | "neutral"; meaning: string }> = {
  healthy:      { label: "Working",              tone: "good",      meaning: "Ran on time and finished." },
  late:         { label: "Late",                 tone: "attention", meaning: "Hasn't finished when it should have." },
  failing:      { label: "Failed",               tone: "bad",       meaning: "The last run stopped with a problem." },
  running:      { label: "Running now",          tone: "info",      meaning: "Started and not finished yet." },
  unknown:      { label: "Not sure",             tone: "attention", meaning: "The last run didn't report back." },
  "never-ran":  { label: "Hasn't run yet",       tone: "neutral",   meaning: "No run recorded since it was added." },
  paused:       { label: "Paused",               tone: "neutral",   meaning: "You paused it." },
  unconfigured: { label: "Needs setup",          tone: "attention", meaning: "A setting it needs is missing." },
};
```
`AutomationHealthState` in `health.ts` becomes an alias of `HealthState`. The page imports `HEALTH_PRESENTATION`
(delete `STATE_TONE`); the label text is always shown next to the colour. Test: every state has a presentation and the
page renders each (component test with one fake row per state).

### 2. When a job is due (`src/domains/automation/schedule.ts`, pure)
- Extend `AutomationRuleDefinition` with `schedule: { kind: "daily"; denverHour: number } | { kind: "weekly";
  weekday: 0-6; denverHour } | { kind: "monthly"; day: 1-28; denverHour }` and remove `expectedEveryHours` (update
  all 31 rules; derive each `denverHour` from the rule's cron in `vercel.json`, which is in UTC — convert with the
  Denver offset **of that date**, and add a unit test that reads `vercel.json` and checks every cron path has a rule
  and the hours agree for a January and a July date).
- `lastDueAt(rule, now)`: the most recent scheduled Denver time ≤ now (DST-correct via the existing
  `src/lib/business-date.ts` helpers; add `denverDateTimeToUtc(dateKey, hour)` there if missing, tested on 8 Mar and 1
  Nov 2026).
- `graceMinutes`: new setting `BusinessSettings.automationLateGraceMinutes Int @default(120)` (owner-editable on the
  System health page: "How long after a job's usual time before we call it late. Starting value 2 hours, because a
  few jobs run back-to-back and Vercel can start them a little late.", restore recommended).
- State rule (first match wins): paused → `paused`; any `requiredEnv` missing → `unconfigured`; no run ever →
  `never-ran` **if** `now < createdOrFirstDue + grace` else `late` (the rule's `addedOn` date in the definition, so a new
  rule doesn't show late on its first day); latest run RUNNING and started < budget ago → `running`; latest run
  FAILED → `failing`; latest UNKNOWN (or RUNNING past budget) → `unknown`; latest success `finishedAt` <
  `lastDueAt − 0` and `now > lastDueAt + grace` → `late`; else `healthy`. A clock-skew guard: a run `startedAt` in the
  future by more than 5 minutes is ignored and logged.
- `sources.ts` stale check is replaced by a call to the same function (`state === "late"` → the existing
  `AUTOMATION_STALE` issue; `never-ran` past grace → `late` → same issue). Keep fingerprints `automation-stale:<rule>`.

### 3. Bounded reads
`getAutomationHealth(now)` reads, per rule, only the latest run, the latest SUCCEEDED and the latest FAILED, with one
SQL query:
```sql
SELECT k.rule_key, l.*, sx.*, fx.*
FROM unnest($1::text[]) AS k(rule_key)
LEFT JOIN LATERAL (SELECT id AS latest_id, state AS latest_state, "startedAt" AS latest_started, "finishedAt" AS latest_finished,
                          "failureCode" AS latest_code, "failureStage" AS latest_stage, "correlationId" AS latest_ref
                   FROM "AutomationRun" WHERE "ruleKey" = k.rule_key ORDER BY "startedAt" DESC, id DESC LIMIT 1) l ON true
LEFT JOIN LATERAL (SELECT "finishedAt" AS last_success FROM "AutomationRun"
                   WHERE "ruleKey" = k.rule_key AND state = 'SUCCEEDED' ORDER BY "startedAt" DESC, id DESC LIMIT 1) sx ON true
LEFT JOIN LATERAL (SELECT "finishedAt" AS last_failure FROM "AutomationRun"
                   WHERE "ruleKey" = k.rule_key AND state = 'FAILED' ORDER BY "startedAt" DESC, id DESC LIMIT 1) fx ON true
```
(`$1` = the rule keys from `AUTOMATION_RULES`; use `prisma.$queryRaw` with a tagged template.)
Add index `@@index([ruleKey, state, startedAt])` (additive). Test with 10,000 runs over two rules: result correct, and
`EXPLAIN` (run in the test) uses an index scan on `AutomationRun` (assert the plan text contains `Index`). Ties sort by
id.

### 4. Typed failures without private text
- Additive `AutomationRun` fields: `failureCode String? @db.VarChar(60)`, `failureStage String? @db.VarChar(30)`,
  `correlationId String? @db.VarChar(40)`; `SystemIssue` gets the same three (nullable; old rows show "Not recorded").
- `src/domains/automation/failures.ts`: `class AutomationFailure extends Error { code; stage }` and a code list with plain
  explanations and next steps (`FAILURE_CODES: Record<string, { explain: string; next: string; href?: string }>`), at
  least: `CONFIG_MISSING`, `PROVIDER_UNREACHABLE`, `PROVIDER_REFUSED`, `TIMEOUT`, `DATABASE_BUSY`, `DATA_PROBLEM`,
  `BACKUP_CAPTURE`, `BACKUP_UPLOAD`, `BACKUP_READBACK`, `BACKUP_PRUNE`, `MEDIA_STORE_NOT_READY`, `MEDIA_COPY`,
  `UNCLASSIFIED`. `classifyFailure(cause)`: an `AutomationFailure` keeps its code; Prisma timeout/serialization errors →
  `DATABASE_BUSY`; `AbortError`/timeout → `TIMEOUT`; Stripe/Blob SDK errors by class name → `PROVIDER_*`; anything else
  → `UNCLASSIFIED` (never guessed).
- `runAutomation` stores `failureCode`, `failureStage`, a random `correlationId` (also written to the server log line
  with the same id) and **stops storing free text**: `error` keeps only `safeError()` for old readers but the page,
  issues, emails and every future MCP output use `FAILURE_CODES[code].explain` instead. Extend `safeError` to also strip
  phone numbers (`/\+?\d[\d\s().-]{8,}\d/`) and anything after "address" keys in JSON (`"address":"…"`).
- System health page row: label + explanation + "What to do: {next}" + link + "Reference {correlationId}" (so a
  helper can find the log line). Never the raw error, never an env value; env **names** only for `unconfigured`.
- Tests: canary — throw an error containing a planted secret `sk_live_canary…`, email, phone, street address and
  person name inside a job; assert none appears in the run row (except `error` scrubbed), issue, page HTML, email
  body or ops API output. Existing `tests/ops-redaction.test.ts`, `tests/automation-runs-integration.test.ts` and
  `tests/system-issues-integration.test.ts` extended, not duplicated. The legacy ops key keeps exactly its powers
  (list issues, add structured notes): a test asserts the ops API response has no `failureStage` content beyond the
  code and the safe explanation.

### 5. Browser
`e2e/system-health.spec.ts` (extend): one row per state seeded in the test database renders its label; keyboard
reaches every "What to do" link; axe on phone and desktop, light and dark.

---

## MCP-2 — Backups you can trust

### 6. Record every backup file (additive migration with MCP-2)
```prisma
model BackupArtifact {
  id            String   @id @default(cuid())
  kind          BackupArtifactKind      // DATABASE | MEDIA_MANIFEST
  state         BackupArtifactState     // VERIFIED | UPLOADED_UNVERIFIED | FAILED | PRUNED
  runId         String?                 // AutomationRun.id that made it
  databaseArtifactId String?            // MEDIA_MANIFEST → its DATABASE artifact
  databaseArtifact BackupArtifact? @relation("BackupPair", fields: [databaseArtifactId], references: [id], onDelete: Restrict)
  mediaManifests BackupArtifact[] @relation("BackupPair")
  pathname      String   @unique        // e.g. backups/2026-10-25-….json — a path, never a full URL with tokens
  formatVersion Int
  migrationId   String?
  appRevision   String?
  sizeBytes     Int
  sha256        String   @db.Char(64)
  tableCounts   Json?                   // DATABASE only
  photoCounts   Json?                   // MEDIA_MANIFEST only: { copied, reused, missing, tombstoned }
  failureStage  String?
  createdAt     DateTime @default(now())
  verifiedAt    DateTime?
  prunedAt      DateTime?
  @@index([kind, state, createdAt])
}
```
Backup policy: `BackupArtifact: "backupArtifact"` in the manifest (the rows describe backups; restoring them is
harmless and keeps history). Docs: `docs/DATABASE.md`.

### 7. Stages (`src/domains/backup/index.ts`)
`exportDatabaseBackup()` becomes four steps, each wrapped so a failure throws `AutomationFailure` with its stage:
1. **CAPTURE** — the existing REPEATABLE READ snapshot (unchanged) → JSON bytes; measure ms and bytes and include them
   in the run `counts` (`captureMs`, `bytes`).
2. **UPLOAD** — `put` exactly as today; then insert `BackupArtifact { state: UPLOADED_UNVERIFIED, sha256 of the bytes }`.
3. **READBACK** — `get` the object with the same token, hash it, compare; equal → `state VERIFIED, verifiedAt`; else
   `state FAILED, failureStage READBACK` and throw `BACKUP_READBACK`.
4. **PRUNE** — section 8. A prune failure **does not** fail the backup: the run succeeds, `counts.pruneFailed = 1`, and
   the system records issue `BACKUP_RETENTION_ATTENTION` (new `SystemIssueKind`, severity medium, fingerprint
   `backup-prune`), "Today's backup is safe. Removing old copies didn't finish; storage may grow until it does."
Backup destination check (before CAPTURE): the backup store must be private. Today it uses `BLOB_READ_WRITE_TOKEN`,
the same token the public catalog images use. Add `getBackupStore()` in `src/lib/photo-storage.ts`: prefer
`BACKUP_BLOB_READ_WRITE_TOKEN` + `BACKUP_BLOB_STORE_ID` (new env names; matched like `getPrivatePhotoStore` does);
else fall back to the private photo store under the `backups/` prefix (it is already private and verified); never the
public token. If neither is configured → `CONFIG_MISSING` with next step "Connect the private storage in Vercel (see
your checklist)". The put already uses `access: "private"`; keep it. Add a checklist row (once) for Chris: confirm
which store backups use, with steps — the app shows on the System health page which one it uses ("private photo
store" / "backup store") without ids.
Also move the hard-coded preview private store id (`VERIFIED_PREVIEW_PRIVATE_STORE_ID` at the top of
`src/lib/photo-storage.ts`) into the existing `PREVIEW_PRIVATE_*` env names: this public repository must not carry
private storage identifiers (AGENTS.md section 1). Missing in preview → the same `CONFIG_MISSING` path.
The failure email (`sendBackupFailureAlertToChris`) states only the stage explanation and reference, removes the
current sentence claiming the host's recovery guarantees safety, and is still sent only through the existing email
switch (no live email in development).

### 8. Pruning that can't delete the last good backup
`pruneBackups(now, retentionDays)` (retention = new setting `backupRetentionDays Int @default(30)`, 7–365, explained:
"How long to keep daily backups. Starting value 30 days. The newest working backup is always kept."):
- Candidates come from the **database** (`BackupArtifact` where `state in (VERIFIED, UPLOADED_UNVERIFIED, FAILED)`,
  `createdAt < now − retentionDays`), oldest first, 200 per run — not from `list()`. Never a candidate, whatever
  their age: (a) the newest VERIFIED DATABASE artifact; (b) the newest **complete pair** — the newest VERIFIED
  DATABASE artifact that has a MEDIA_MANIFEST — and that manifest. (a) and (b) are usually the same backup; after an
  outage longer than the retention period they differ (the new backup has no photo list yet), and both are kept, so
  the last complete recovery set survives even if the next photo copy fails. Test: 40-day-old complete pair + new
  database-only backup + photo copy failing afterwards → the old pair is still there.
- For each: `del(pathname)`; on success `state PRUNED, prunedAt`; a pair is pruned manifest first, database second.
- Old files with no artifact row (made before this change): one-time sweep using paginated `list({ cursor })` (loop
  until `hasMore` is false, max 20 pages per run), only files under `backups/` whose date prefix is older than the
  retention **and** older than the oldest VERIFIED artifact; never the newest file overall.
Tests: 1,200 fake objects across pages; newest good set kept even if 400 days old; prune failure → backup success +
retention issue; a pair always removed together.

### 9. Photos follow the right backup
- Move the orchestration from `scripts/media-inventory.ts` into `src/domains/backup/media.ts` (`runMediaCopy({
  databaseArtifactId })`), keeping the script as a 10-line wrapper that calls it (its CLI flags unchanged).
- The cron route passes the VERIFIED DATABASE artifact made **by this run**, or on `ALREADY_RAN` the newest VERIFIED
  DATABASE artifact for **today's** run slot; if there is none, media copy is skipped with `failureCode
  BACKUP_CAPTURE` ("No verified backup today to pair photos with"). It never falls back to "the newest file in the
  folder".
- Private store readiness (`checkPrivateStoreReady()`): returns one of `READY | MISSING_TOKEN | MISSING_STORE_ID |
  TOKEN_STORE_MISMATCH | ACCESS_DENIED | UNREACHABLE` by calling `list({ limit: 1, prefix: "jobs/" })` with the
  private token; shown on System health; anything but READY → `MEDIA_STORE_NOT_READY` with the matching next step.
  (`NO_SOURCE_PHOTOS` is not an error: copied 0.)
- Tombstones: re-check the tombstone list **for each photo right before its copy** (one indexed query per batch of
  100 ids), so a deletion during the run is respected; test with a deletion injected between listing and copying.
- The manifest write creates the `MEDIA_MANIFEST` artifact with `databaseArtifactId` and `photoCounts`; missing photos
  are counted as missing, never as recovered.

### 10. Retry, safely
`retryBackupNow(actorId)` (OWNER, button "Run the backup again" on System health, shown only when today's backup run
is FAILED or UNKNOWN): runs `exportDatabaseBackup` + media copy outside the daily slot with run key
`manual:{uuid}`. Because `claimRun` only checks its own `(ruleKey, runKey)`, the start is serialized first: one
transaction takes `pg_advisory_xact_lock(hashtext('backup-run'))`, checks there is no `AutomationRun` with `ruleKey in
('backup','backup-manual','media-copy')` in state RUNNING started within its budget, and only then inserts the
`backup-manual` run row (RUNNING); otherwise "A backup is already running". The daily `backup` cron takes the same lock
and check before its own `claimRun`, so a manual run and the nightly run never overlap. It never changes the daily
slot's contract for other jobs. Audit `backup.manual_run`. Test: two clicks at once (different request ids) → one run; a click during the nightly run → refused.

### 11. Restore drill (test only)
Extend `tests/backup-restore-integration.test.ts`: make a backup with the fake Blob client, restore into the CI
`appliance_desk_restore` database, verify row counts and three relationships (customer → agreement → invoice), then
restore media from the manifest into a second fake store with `restoreMediaFromManifest` and compare hashes;
a tombstoned photo is not restored. No real store, no production data.

### 12. Tests summary
`tests/automation-health.test.ts` (states, schedule, DST, skew, never-ran grace), `tests/automation-schedule-vercel.test.ts`
(cron ↔ rules), `tests/automation-health-bounded-integration.test.ts` (10,000 runs, plan), `tests/automation-failures.test.ts`
(classification + canaries), `tests/backup.test.ts` (stages, readback mismatch, prune failure, private store choice),
`tests/backup-prune-integration.test.ts`, `tests/media-inventory.test.ts` (moved logic, tombstone during copy, pairing),
`tests/backup-retry-integration.test.ts`, restore drill above, `e2e/system-health.spec.ts`.
