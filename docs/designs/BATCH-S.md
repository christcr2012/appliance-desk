# Design — Batch S: System issues inbox and the AI check-up

Status: **APPROVED DESIGN — implement from this document** (Chris, 2026-10-07: "When my system has problems, or flags
issues like moved pages, can all these be recorded to a place where I can have an AI agent check that place and design
solutions or otherwise figure out what's going on? … if it could be scheduled to check and address these things, that
would be great"). Runs **after Batch T, before Batch V** (`docs/MASTER-ROADMAP.md`). Two PRs.

**Who this is written for.** An implementing model following it literally. Plain-English owner text is part of the
deliverable.

---

## 0. Verify before starting

| # | Assumption | How to check |
|---|---|---|
| S-A1 | Every cron automation goes through `runAutomation` (`src/domains/automation/runs.ts`), which records an `AutomationRun` with `state` and `error`. | read `runs.ts` |
| S-A2 | `AUTOMATION_RULES` in `src/domains/automation/health.ts` lists every rule with a label and explanation, and `/desk/automations` shows their health. | read |
| S-A3 | `ProviderOperation` rows can be stuck (`PENDING` / uncertain) with `attempts` and `lastError`. | schema |
| S-A4 | Batch T's sources exist: GIS lookups returning `UNAVAILABLE`, rate-watch guardrail failures (13.2), `OfficialSourceWatch.consecutiveFailures` (13.3). If T has not merged, wire only what exists and list the rest in the PR. | grep `src/domains/tax` |
| S-A5 | Today items come from `src/domains/exceptions` (pure rules + loader), grouped by `ExceptionCategory`. | read |

## 1. Decisions

### D-S1 — One table is "the place": `SystemIssue`

Every problem the system detects about **itself** (not business work like a past-due invoice — those stay Today items)
is written to one table, de-duplicated by a fingerprint, with a plain-English summary for Chris and a technical detail
for an AI agent or developer. Sources wired in this batch:

| Source | Kind | Fingerprint | Severity | Auto-resolves when |
|---|---|---|---|---|
| `runAutomation` failure or overrun | `AUTOMATION_FAILED` | `automation:<ruleKey>` | high for billing/backup rules, else medium | that rule's next run succeeds |
| A configured rule has had **no successful run for more than 2× its expected interval** (new `expectedEveryHours` on each `AUTOMATION_RULES` entry: 24 daily, 168 weekly, 744 monthly), and is not already reported as `AUTOMATION_FAILED` | `AUTOMATION_STALE` | `automation-stale:<ruleKey>` | medium | it succeeds |
| `ProviderOperation` still PENDING/uncertain after 24 h | `PROVIDER_OPERATION_STUCK` | `provider-op:<kind>` (one issue per kind, count = rows) | high | none left stuck |
| Colorado address lookup `UNAVAILABLE` 3 days in a row (T 3.3) | `TAX_LOOKUP_UNAVAILABLE` | `tax-lookup` | medium | a lookup succeeds |
| Official page fetch failures ≥ 3 (T 13.3) | `SOURCE_PAGE_UNREACHABLE` | `source-page:<watchId>` | low | a fetch succeeds |
| Official page changed (T 13.3) | `SOURCE_PAGE_CHANGED` | `source-page-changed:<watchId>:<hash>` | low (informational) | owner marks reviewed |
| Rate change failed a guardrail (T 13.2) | `TAX_RATE_GUARDRAIL` | `tax-rate:<jurisdictionId>:<asOf>` | medium | applied or dismissed |
| Message delivery stuck UNKNOWN > 48 h | `MESSAGE_DELIVERY_UNKNOWN` | `message-unknown` | medium | none left |
| Required environment variable missing for an enabled rule (health `unconfigured`) | `CONFIGURATION_MISSING` | `config:<ruleKey>` | high | configured |

New sources later only add a row to this table in code (`src/domains/system-issues/sources.ts`), never a new place.

### D-S2 — Nothing private leaves the app (allowlisted, structured detail — review fix)

`summary` (owner words) and `detail` are **built only from typed fields**, never from free text: each kind has a
template that takes an allowlisted object such as `{ ruleKey, runId, startedAt, errorName, errorCode, count,
watchId, officialUrl, jurisdictionCode }`. Raw error **messages**, provider responses, addresses, names and amounts are
never passed in; the full error stays only in the existing private `AutomationRun.error` / `ProviderOperation.lastError`
(not exposed by the API). `errorName`/`errorCode` are the exception's class/code (e.g. `TaxLookupUnavailable`,
`STRIPE_TIMEOUT`), validated against `^[A-Za-z0-9_.:-]{1,80}$`; `officialUrl` must be an allowlisted watch URL.
Free-text fields that people write — `SystemIssueNote.body` and `resolvedReason` — go through a new shared
`redactForOps()` (strips emails, phone numbers, street-address patterns (number + street word), card-like and long digit
runs, `sk_`/`rk_`/`whsec_`/`Bearer` tokens, and anything matching a customer name or address in the database is **not**
attempted — instead the screen warns "Do not include customer details") and are capped at 2 KB. Tests: planted emails,
phones, a street address, a card number, a provider JSON blob and a key are removed from notes and resolution reasons;
an issue's `detail` cannot be constructed from an arbitrary string (type test).

### D-S3 — A private, read-mostly door for an AI agent

`GET /api/ops/issues` returns open and recently resolved issues as JSON; `POST /api/ops/issues/<id>/notes` lets the agent
add a note and set `ACKNOWLEDGED`. Nothing else: the agent cannot change settings, data, or resolve issues (resolution
happens when the underlying problem stops, or by the owner).

- **Authentication:** an **AI check-up key** the owner creates in the app (Settings & activity → System health → "Create
  AI check-up key"). Shown once; only a SHA-256 hash is stored (`OpsAgentKey`), with label, created/last-used time,
  revoke button. Header `Authorization: Bearer <key>`, constant-time comparison. No key → the endpoints return 404.
  Keys never appear in logs, the issue list, or audit `newValue`.
- Rate limit with the existing limiter (60 requests/hour per key). Responses are `Cache-Control: no-store`.
- The public repository never receives issue contents automatically; an agent that opens a GitHub issue or PR must
  follow AGENTS.md (no customer data, no identifiers) — the routine prompt repeats this.

### D-S4 — The scheduled check-up is a Claude Routine (ChatGPT/Codex can use the same door)

Claude Code on the web has **Routines** (scheduled runs in a fresh cloud session with this repository). The check-up
routine runs every morning, reads the issues through D-S3, investigates each new or changed one in the code, and then:

1. **Owner action needed** (missing setting, page moved, CPA question): writes a plain-English note on the issue with
   the exact steps, and includes it in the summary to Chris.
2. **Code problem:** follows AGENTS.md — branch, minimal fix with tests, PR; does **not** merge (an unattended run never
   merges); notes the PR link on the issue.
3. **Unclear:** notes what it checked and what it needs.
It ends with a short plain-English summary (the routine's completion notification to Chris). Hard limits from AGENTS.md
apply unchanged (no production data writes, no live payments/SMS/email switches, no purchases). The exact prompt is in
`docs/runbooks/AI-CHECKUP.md` (written in S-2). Any other agent with scheduled tasks (ChatGPT/Codex) can use the same
endpoint and prompt; Claude is the documented default because its routines run with the repository attached.

### D-S5 — Where Chris sees it

- `/desk/automations` becomes **System health** (nav label "System health", same route, same group): top section
  "Problems the system found" (open issues, newest severity first, each with summary, first/last seen, count, agent
  notes, "Mark resolved" for OWNER with reason), then the existing automation health list, then "AI check-up" (keys,
  last time the agent checked in = last key use, link to the runbook).
- **Today:** open `high` issues appear as one group "System" (category `SYSTEM_ISSUE`), linking to System health. Medium
  and low stay on the System health page only (so Today is not flooded).
- Visible to OWNER and ADMIN; keys created and revoked by OWNER only.

## 2. Schema (additive) — migration `<timestamp>_batch_s_system_issues`

```prisma
enum SystemIssueStatus { OPEN ACKNOWLEDGED RESOLVED }
enum SystemIssueSeverity { HIGH MEDIUM LOW }

model SystemIssue {
  id             String              @id @default(cuid())
  fingerprint    String              @unique
  kind           String              // one of D-S1's kinds; validated in code
  severity       SystemIssueSeverity
  status         SystemIssueStatus   @default(OPEN)
  summary        String              // owner words
  detail         String              // technical, redacted, ≤ 4 KB
  occurrences    Int                 @default(1)
  firstSeenAt    DateTime            @default(now())
  lastSeenAt     DateTime            @default(now())
  resolvedAt     DateTime?
  resolvedReason String?             // "Source succeeded" | owner text
  notes          SystemIssueNote[]
  @@index([status, severity, lastSeenAt])
}

model SystemIssueNote {
  id        String      @id @default(cuid())
  issueId   String
  issue     SystemIssue @relation(fields: [issueId], references: [id])
  author    String      // "AI check-up (<key label>)" or the owner's name
  body      String      // ≤ 4 KB, redacted like D-S2
  createdAt DateTime    @default(now())
}

model OpsAgentKey {
  id         String    @id @default(cuid())
  label      String
  keyHash    String    @unique
  createdByUserId String
  createdAt  DateTime  @default(now())
  lastUsedAt DateTime?
  revokedAt  DateTime?
}
```

Backup coverage: `SystemIssue` and notes yes; `OpsAgentKey` **excluded** from exports (hashes only, but not needed for
recovery — a restored system gets a new key). Schema-health list updated.

## 3. Functions (`src/domains/system-issues/`)

```ts
export async function recordSystemIssue(input: { kind: SystemIssueKind; fingerprint: string; severity: Severity; summary: string; detail: string }): Promise<void>;
// upsert by fingerprint: new → OPEN; existing OPEN/ACKNOWLEDGED → occurrences+1, lastSeenAt, refreshed text;
// RESOLVED → reopen (status OPEN, resolvedAt null). Redacts. Never throws into the caller (a failure here is logged).
export async function resolveSystemIssue(fingerprint: string, reason: string): Promise<void>; // no-op if absent
export async function listSystemIssues(filter): Promise<...>;                 // OWNER/ADMIN screens and the API
export async function addSystemIssueNote(issueId, author, body): Promise<void>;
export async function createOpsAgentKey(actorUserId, label): Promise<{ key: string }>; // OWNER; returns plaintext once
export async function verifyOpsAgentKey(bearer: string): Promise<OpsAgentKey | null>;  // constant-time, updates lastUsedAt
```

Writers: `runAutomation` calls `recordSystemIssue` on failure and `resolveSystemIssue` on success (same transaction
boundary rules as its run ledger; a failure to record never fails the run). A new daily rule `system-issues-sweep`
(inside the existing `billing-reconcile` route as another `runAutomation` call — no new cron) checks the stale/stuck/
unconfigured sources in D-S1 and resolves ones that cleared.

## 4. Work units and PRs

- **S-1 — WU-S1:** schema, `recordSystemIssue`/`resolveSystemIssue`, typed detail templates and `redactForOps`,
  `expectedEveryHours` on every `AUTOMATION_RULES` entry (and on Batch T's rules), writers for every D-S1 source that exists,
  sweep rule, System health page section, Today `SYSTEM_ISSUE` group. Tests: `tests/system-issues.test.ts` (pure:
  fingerprints, reopen, redaction of planted PII/keys), ★ `tests/system-issues-integration.test.ts` (automation failure
  records then success resolves; a daily rule with no success for 49 h and a weekly rule for 15 days become stale, a
failing rule is not double-reported as stale; stuck provider op counted once; concurrency: two writers same fingerprint → one row,
  occurrences 2), browser: System health renders issues, axe clean at 360/1440 light/dark.
- **S-2 — WU-S2:** `OpsAgentKey`, key screen, `/api/ops/issues` GET and notes POST, rate limit, `docs/runbooks/AI-CHECKUP.md`
  (owner setup steps + the routine prompt), OWNER-GUIDE section "System health and the AI check-up". Tests:
  ★ `tests/ops-api-integration.test.ts` (no key → 404; revoked → 404; wrong key → 404 with constant-time compare;
  notes cannot carry PII; agent cannot resolve; rate limit), `tests/ops-key.test.ts` (shown once, stored hashed).

## 5. Owner steps after S-2 (go-live checklist lines)

1. System health → **Create AI check-up key** → copy it once.
2. In Claude's cloud environment settings (environment menu → Edit): add the key as a **network secret / environment
   variable named `APPLIANCE_DESK_OPS_KEY`**, and add the site's domain (`robinsonappliancerentals.com`) under
   **Allowed domains**. Never paste the key into a chat.
3. Ask Claude to create the routine "Appliance Desk morning check-up" (daily, about 7:45 am Denver) with the prompt in
   the runbook. You get a short summary each morning; nothing is merged without CI and review.

## 6. Stop-and-ask

- **S-S1** A source cannot be summarised without customer data (then it does not belong in `SystemIssue`; make it a
  Today item instead).
- **S-S2** The existing rate limiter or auth helpers cannot protect a non-session API route without new libraries.
- **S-S3** Routines in Chris's Claude plan cannot reach the production domain (network policy) — document the manual
  alternative (Chris starts the check-up session by hand) instead of weakening D-S3.
