# Build spec — Assistant actions: preview, approve, do it once, check it (MCP-5)

Card: `docs/pr-cards/MCP-5.md`. Design: `docs/mcp/DATA-AND-RECOVERY.md` (journal algorithm, states, concurrency
fixtures) and `CONTRACT.md` (recovery action list). Approved by Chris 2026-10-25. Depends on MCP-4 (connection and
tool registry), MCP-2 (backup retry) and DEC-1a (decision answers). Risk: **the first assistant tools that change
things**. Read `docs/AI-PR-READ-FIRST.md`.

**What Chris gets:** an assistant can (1) apply the answers from a completed CPA/attorney/translator form, and (2) run
a small list of safe repair actions (run the health check again, retry the backup or photo copy, pause/resume a job,
check a backup file). Every change is shown to him first; nothing happens until he approves; each change happens once
even if the assistant retries; and the app checks afterwards that it really happened. He sees every action on System
health › Assistant activity.

## 1. Data (additive migration `20261029000000_agent_operations`)
```prisma
model AgentOperation {
  id               String   @id @default(cuid())
  connectionId     String
  connection       McpConnection @relation(fields: [connectionId], references: [id], onDelete: Restrict)
  actorUserId      String                       // the person the assistant acts as
  tool             String   @db.VarChar(80)
  action           String   @db.VarChar(60)     // e.g. RETRY_DATABASE_BACKUP, APPLY_DECISION_ANSWERS
  targetRef        String?  @db.VarChar(120)     // safe ref: rule key, artifact id, "decisions"
  requestKeyDigest String   @db.Char(64)         // sha256(connectionId + ":" + requestKey)
  argsHash         String   @db.Char(64)         // sha256 of canonical JSON args
  previewHash      String?  @db.Char(64)
  preview          Json?                         // safe summary shown to Chris
  verifyIntent     Json?                         // bounded, safe facts verify() needs: e.g. [{ subjectId, expectedValue, effectiveFrom }] or { artifactAfter: ISO } — written in Transaction A, before dispatch
  state            AgentOperationState           // PREVIEWED | AWAITING_APPROVAL | AUTHORIZED | RUNNING | SUCCEEDED | FAILED | UNKNOWN | DENIED | CANCELLED | EXPIRED
  leaseToken       String?  @db.Char(32)
  leaseExpiresAt   DateTime?
  attempt          Int      @default(0)
  approvedByUserId String?
  approvedAt       DateTime?
  expiresAt        DateTime                      // approval window: 30 minutes after preview
  startedAt        DateTime?
  finishedAt       DateTime?
  safeResult       Json?
  failureCode      String?  @db.VarChar(60)
  verification     Json?                         // what was read back and when
  createdAt        DateTime @default(now())
  @@unique([connectionId, tool, requestKeyDigest])
  @@index([state, leaseExpiresAt])
  @@index([actorUserId, createdAt])
}
```
`McpConnection`: add `operations AgentOperation[]`. Backup policy: backed up (history), and the restore script sets
every non-final operation to `CANCELLED` with `failureCode: "RESTORED"` (test). Scopes added to `MCP_SCOPES`:
`ops:maintain` ("Run safe repair actions you approve: re-check health, retry a backup, pause or resume a job") and
`decisions:apply` ("Apply answers to your open questions after you approve them"). Existing connections keep their
old scopes; Chris reconnects (or edits the connection's scopes on the card — OWNER only) to grant new ones.

## 2. The action registry (`src/domains/agent-control/actions.ts`)
```ts
type ActionDef<A> = {
  action: string; scope: "ops:maintain" | "decisions:apply";
  args: z.ZodType<A>;
  roles: ("OWNER" | "ADMIN")[];
  preview(ctx, args): Promise<{ summary: string; changes: { label: string; now: string; after: string }[]; costNote?: string; targetRef: string }>;
  execute(ctx, args, op: { id: string }): Promise<{ safeResult: Json }>;   // calls an existing domain command, never raw SQL
  verifyIntent(ctx, args): Json;                                            // stored before dispatch
  verify(ctx, intent: Json, result?: Json): Promise<{ ok: boolean; observed: Json }>;
  approval: "OWNER_IN_APP" | "OWNER_IN_CONVERSATION";
};
```
| Action | Calls | Verify | Approval |
|---|---|---|---|
| `RUN_DIAGNOSTIC_SWEEP` | `sweepSystemIssues(now)` | issue list read back | conversation |
| `RETRY_DATABASE_BACKUP` | `retryBackupNow(actorId)` (MCP-2) | a new VERIFIED DATABASE artifact exists | in app |
| `RETRY_MEDIA_COPY` | `runMediaCopy({ databaseArtifactId })` | a MEDIA_MANIFEST artifact for that backup exists | in app |
| `PAUSE_AUTOMATION` / `RESUME_AUTOMATION` | `setAutomationPaused(actorId, ruleKey, pause)` (`src/domains/automation/health.ts`; OWNER) | rule paused state read back | in app |
| `VERIFY_RECOVERY_ARTIFACT` | read the artifact with the private token, hash it | hash equals stored `sha256` | conversation |
| `APPLY_DECISION_ANSWERS` | DEC-1 `applyAnswers(actorId, answers, confirmToken)` | for each answer in `verifyIntent`: a PROFESSIONAL_ANSWER `DecisionRecord` for that subject made after the operation started, **and** either (effective today) the current value equals the expected value, or (future date) a not-cancelled `DecisionScheduledChange` with that value and date exists — never activating early to pass the check | conversation |
"In app" = Chris taps Approve on System health › Assistant activity (works for anything with storage cost or that
stops a job). "In conversation" = the assistant shows him the preview and he says yes; the assistant then calls
execute with the `previewId`. Both kinds require the preview first; there is no "execute without preview" path.
Restore-over-production, deleting data, money and messages are **not** actions and cannot be added without a new
approved card.

## 3. Tools
- `appliance_action_preview { action, args, requestKey }` → `{ previewId, summary, changes, costNote?, approval,
  expiresAt }`. Creates (or returns, same key + same args) an `AgentOperation` in `PREVIEWED` (conversation) or
  `AWAITING_APPROVAL` (in app; also makes a To do item `ASSISTANT_APPROVAL` "Your assistant wants to {summary}",
  href `/desk/automations#assistant-activity`). Same key + different args → tool error `CONFLICT`.
- `appliance_action_execute { previewId, requestKey }` → runs section 4; returns the operation.
- `appliance_operation_get { operationId }` → state, safe result, verification, next step (own connection's, or any
  for the OWNER's own connections).
- `appliance_decisions_preview_answers` / `appliance_decisions_apply_answers` are thin names for
  `APPLY_DECISION_ANSWERS` (DEC-1 section 8) — preview returns DEC-1's table and `confirmToken`; apply = execute.

## 4. Execute (`src/domains/agent-control/operations.ts`) — follows DATA-AND-RECOVERY "Durable write algorithm"
1. Transaction A (short): lock `McpConnection` → `AgentOperation` (`FOR UPDATE`) in that order; recheck connection not
   revoked, scope present, user active with an allowed role (`assertActiveTeamActor(tx, actorUserId, def.roles)`),
   operation not expired, state `PREVIEWED` (conversation) or `AUTHORIZED` (approved in app); if already `SUCCEEDED`
   / `FAILED` / `UNKNOWN` → return it unchanged (retry-safe). Recompute the preview and compare `previewHash`
   (something changed → `EXPIRED`, tool error "Things changed — preview again"). Set `RUNNING`, `attempt + 1`,
   `leaseToken = random`, `leaseExpiresAt = now + 5 min`, `startedAt`, and **`verifyIntent`** (from `def.verifyIntent(ctx,
   args)`: only ids, expected values and dates — no free text, ≤ 8 KB). Commit.
2. Run `def.execute` **outside** the transaction (it calls domain commands that take their own locks).
3. Transaction B: lock the operation; if `leaseToken` no longer matches (a stale worker) → write nothing. Else run
   `def.verify`; `ok` → `SUCCEEDED` with `safeResult`, `verification`; `!ok` → `FAILED` with `failureCode
   VERIFY_FAILED`. An exception from execute → `FAILED` if the command proves no effect (it threw before doing
   anything: domain validation errors), otherwise `UNKNOWN`.
4. `UNKNOWN` operations (and `RUNNING` past lease) are reconciled by the nightly `system-issues-sweep` run: verify
   works from the stored `verifyIntent` alone (a process lost between the effect and saving the result is still
   checked); call
   `def.verify`; ok → `SUCCEEDED`, else leave `UNKNOWN` and raise system issue `ASSISTANT_ACTION_UNCERTAIN` with the
   next step "Check {target} on System health". Never re-execute automatically.
5. Approve/Deny in app (`approveAgentOperation(actorId, id)` / `deny…`): OWNER only, lock, `AWAITING_APPROVAL` →
   `AUTHORIZED` (+ `approvedByUserId`, `approvedAt`) or `DENIED`. Approval does not run it; the assistant's execute
   call does (so the assistant sees the outcome). Expired previews → `EXPIRED` by the sweep.
6. Audit every transition as `mcp.operation.{state}` with operation id, action and targetRef — no args, no answers
   text.

## 5. Screen — System health › Assistant activity (`#assistant-activity`)
List (newest first, 25 per page): when, which assistant, what (`summary`), state word ("Waiting for you",
"Approved", "Done", "Didn't work", "Not sure — check", "Declined", "Expired"), and for waiting items **Approve** /
**Decline** (ConfirmDialog showing the `changes` table and `costNote`). Done items show "Checked: {verification in
words}". OWNER sees all; ADMIN sees their own connections' items and cannot approve.

## 6. Tests (DATA-AND-RECOVERY "Concurrency fixtures", adapted)
`tests/mcp-operations-integration.test.ts` (throwaway Postgres, fake domain commands that count calls):
20 parallel executes with the same key → one command call; same key different args → CONFLICT; preview → change the
target (pause the rule elsewhere) → execute → EXPIRED; revoke the connection between approve and execute → refused,
no call; role downgraded → refused; execute throws after its effect → UNKNOWN → nightly verify → SUCCEEDED; stale
lease worker writes nothing; denied/expired cannot run; approval needs OWNER; kill-between: the fake command commits its effect, then the worker throws before Transaction B →
nightly verify from `verifyIntent` → SUCCEEDED. `tests/mcp-decisions-apply-integration.test.ts`: a future-dated answer →
SUCCEEDED via the scheduled change (setting unchanged until its date);
preview a filled form's answers → apply with the token → settings changed through DEC-1 functions, `DecisionRecord`
via `MCP`; tampered answers with the old token → refused; "Other" answer recorded, setting untouched.
`e2e/mcp-activity.spec.ts`: owner approves a waiting backup retry; axe, phone/desktop, light/dark.
