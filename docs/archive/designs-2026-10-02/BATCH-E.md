# Design — Batch E: Communications, reporting, growth, branding & accessibility

Status: **APPROVED DESIGN — implement from this document** (written
2026-10-02 against `main` f272f51; B, C, D land first). Scope/acceptance:
`docs/PLAN.md` → Batch E. Constraints that are blocking:
`docs/AI-PR-READ-FIRST.md` items 3 and 9 (silent provider failures) and 4
(in-memory rate limiting is not a defense). Messaging to real customers stays
**off** throughout; this batch makes sending *recordable and recoverable*, it
does not turn it on.

## 0. Verify before starting

| # | Assumption | Check |
|---|---|---|
| A1 | B, C, D merged; STATUS says E is NEXT. | `docs/STATUS.md` |
| A2 | `src/lib/email.ts` `sendEmail` and `src/lib/sms.ts` `sendSms` return `{ sent: boolean }`, log-and-skip without keys, and return `{sent:false}` on any non-production deployment. | Read both (≈ 60 lines each). Keep these as the low-level senders. |
| A3 | Callers of `sendEmail`/`sendSms` are exactly: backup, late-fees, billing reminders, estimates, job day-of reminders, launch, leads, portal, referrals, auth, password-email. | `grep -rln "sendEmail(\|sendSms(" src`. New callers since then join the migration list. |
| A4 | Cron routes: `backup`, `billing-reminders`, `estimate-follow-ups`, `job-reminders`, `late-fees`, `launch-emails` (+ `billing-reconcile` from B), each guarded by `CRON_SECRET`. | `ls src/app/api/cron`. |
| A5 | `LaunchDelivery (subscriberId, step) @@unique` with `status` SENDING/… is PR #86's ledger and has its own tests. | schema + `tests/launch-*.test.ts`. **Never rewrite it.** |
| A6 | `ConsentRecord` has `customerId?`, a `kind` string, `details Json`. | schema. |
| A7 | Reminder senders use send-then-mark (`billingReminderSentForDate`, `dayOfReminderSentAt`). | `src/domains/billing/reminders.ts`, `src/domains/jobs/day-of-reminders.ts`. (P8 M4) |
| A8 | `src/domains/search/index.ts` `searchAll(query)` returns one shape regardless of role. | file. |
| A9 | `src/app/globals.css` defines `--color-*` semantic tokens; signed-in UI still uses ~1,100 `slate-*`/`gray-*` Tailwind classes. | `grep -rc "slate-\|gray-" src --include=*.tsx`. (P7 H4) |
| A10 | Batch A's Postgres-backed rate limiter exists in `src/lib/rate-limit.ts` with a `limit(key, …)` style API. | file — reuse for public endpoints here. |

## 1. Decisions

**E1. One `AutomationRun` row per cron invocation, claimed before work starts; "no row" ≠ healthy and "zero work" ≠ failed.** (O24/O25.) `runKey` is deterministic per schedule slot (`<ruleKey>:<business-date>` for daily crons, `<ruleKey>:<ISO hour>` for hourly) so a duplicate invocation of the same slot *finds* the row instead of creating a second one, and returns "already ran" without doing the work. A run left RUNNING for longer than its declared budget is shown as UNKNOWN. Counts are integers; errors are sanitized strings (reuse Batch B `sanitizeProviderError`); no message bodies, no addresses.

**E2. Every outgoing message is a `MessageDelivery` row created *before* the provider call, with a business idempotency key; the provider's "accepted" is never shown as "delivered".** (O26, RC6.) The low-level senders stay; a new `deliverMessage()` in `src/domains/messaging/` is the only thing domain code may call. Outcomes: `ACCEPTED` (provider took it), `FAILED` (provider said no), `UNKNOWN` (timeout/crash), later `DELIVERED` / `BOUNCED` / `COMPLAINED` from provider events (E3). After an UNKNOWN outcome, at most one *deliberate* retry is allowed, and only by the reconciliation pass after it has asked the provider whether the first attempt exists (Resend: `emails.get` by the stored id if we have one; otherwise list by idempotency key is not available → the run leaves it UNKNOWN and visible). Marketing sends check suppression (E3) inside `deliverMessage` immediately before the provider call. Senders migrate one at a time, each keeping its existing dedupe tests green: estimate follow-ups → launch (wraps PR #86's step loop; `LaunchDelivery` stays the sequence ledger, `MessageDelivery` records the send with key `launch-<subscriberId>-<step>`) → billing reminders → job reminders. Reminders become mark-then-send: claim the `…SentForDate`/`…SentAt` field in a transaction *first*, then send; a FAILED outcome clears the mark so the next run retries. (P8 M4.)

**E3. Provider events are stored by provider event id, verified before storage, and drive suppression through one table.** (O28.) `ProviderEvent` (unique `(provider, eventId)`) for Resend (Svix signature headers verified with `RESEND_WEBHOOK_SECRET`) and Twilio (`X-Twilio-Signature` validated with the auth token). `MarketingSuppression` (unique by normalized email or E.164 phone) is the only thing marketing sends consult; it is separate from the launch sequence cursor. Twilio STOP → `Customer.smsOptInAt = null`, a `ConsentRecord{kind:"sms_opt_out", details:{source:"twilio_stop", eventId}}`, and a suppression row — all in one transaction. Forged/unsigned events → 400, nothing stored. Out-of-order events: status moves only forward (`ACCEPTED → DELIVERED → …`; `BOUNCED`/`COMPLAINED` are terminal).

**E4. Launch-list eligibility requires confirmed mailbox ownership.** `LaunchSubscriber` gains `confirmedAt`; the welcome step sends a confirm link (single-use token hash) and marketing steps require `confirmedAt`. Existing subscribers without `confirmedAt` are not sent marketing until confirmed (the owner can see the count).

**E5. Search returns a role-shaped DTO decided server-side.** STAFF never receives OWNER-only lead PII (email/phone/score reasons on leads; financial fields anywhere). The query itself is role-aware (does not select the fields), not post-filtered.

**E6. Brand tokens: a mechanical mapping, a lint rule that prevents regression, and dark theme on the Evergreen dark tokens.** (P7 H4.) `docs/brand/09_Handoff` and `globals.css` already define the semantic tokens; this batch replaces `slate-*`/`gray-*`/`neutral-*` utilities in signed-in UI with the semantic classes per a fixed table (below), adds an ESLint `no-restricted-syntax` rule that fails on `className` strings containing `/(^|\s)(bg|text|border|ring|divide)-(slate|gray|neutral|zinc)-/`, and defines `@media (prefers-color-scheme: dark)` / `[data-theme="dark"]` values for every token from the kit's `dark.*` entries. Status colors (`--color-status-*`) are separate and never the only carrier of meaning (icon or text always accompanies them).

**E7. Accessibility coverage is generated from a route inventory, and the target is stated as WCAG 2.2 AA engineering checks — never "certified".** (P7 H5.) `e2e/route-inventory.ts` lists every top-level route with `{ path, role, fixture, manualOnlyReason? }`; a generated spec runs axe on each at 360/1440, light/dark. A route may be excluded only with a written `manualOnlyReason`. Shard assignment: the generated spec goes in its own group `accessibility-routes` (add to `e2e/shards.json` and the workflow matrix) if the `accessibility-and-security` group would exceed ~120 s — check the duration notice.

**E8. Reports and growth signals get explicit contracts before any tuning; big lists are measured, not guessed.** Each report/list query gets a `tests/perf/*.test.ts` fixture (1,000 customers / 2,000 invoices / 500 jobs, generated in the throwaway DB) that asserts bounded result sizes and records wall time into the test output; `docs/PERF-BASELINE.md` keeps the numbers. Lead "last real contact" = latest of (manual call/note, ACCEPTED message to the lead, inbound form) — defined in one function; utilization = current and rolling-30-day from C's custody timestamps.

## 2. Schema changes (additive)

```prisma
enum AutomationRunState { RUNNING SUCCEEDED FAILED UNKNOWN SKIPPED }

model AutomationRun {                 // E1
  id          String             @id @default(cuid())
  ruleKey     String             // "late-fees" | "billing-reminders" | …
  runKey      String             // "<ruleKey>:<slot>"
  state       AutomationRunState @default(RUNNING)
  environment String             // "production" | "preview" | "ci" | "development"
  startedAt   DateTime           @default(now())
  finishedAt  DateTime?
  budgetSeconds Int              @default(300)
  counts      Json?              // { considered, acted, skipped } — integers only
  error       String?            // sanitized
  @@unique([ruleKey, runKey])
  @@index([ruleKey, startedAt])
}

enum MessageChannel { EMAIL SMS }
enum MessagePurpose { TRANSACTIONAL MARKETING }
enum MessageState   { PENDING ACCEPTED FAILED UNKNOWN DELIVERED BOUNCED COMPLAINED SUPPRESSED }

model MessageDelivery {               // E2
  id               String         @id @default(cuid())
  idempotencyKey   String         @unique   // "<sender>-<subject id>-<qualifier>"
  channel          MessageChannel
  purpose          MessagePurpose
  templateKey      String         // "estimate-follow-up-1", "billing-reminder", …
  recipientType    String         // "Customer" | "Lead" | "LaunchSubscriber" | "Staff"
  recipientId      String?
  recipientAddress String         // email or E.164; needed for suppression and events
  subjectType      String?        // the business record this is about
  subjectId        String?
  state            MessageState   @default(PENDING)
  providerMessageId String?       @unique
  attempts         Int            @default(1)
  lastError        String?
  requestedAt      DateTime       @default(now())
  acceptedAt       DateTime?
  deliveredAt      DateTime?
  updatedAt        DateTime       @updatedAt
  @@index([recipientType, recipientId, requestedAt])
  @@index([state, requestedAt])
}

model ProviderEvent {                 // E3
  id          String   @id @default(cuid())
  provider    String   // "resend" | "twilio"
  eventId     String
  type        String
  receivedAt  DateTime @default(now())
  processedAt DateTime?
  summary     Json?    // sanitized: message id, status, bounce type — no bodies
  @@unique([provider, eventId])
}

model MarketingSuppression {          // E3
  id        String   @id @default(cuid())
  channel   MessageChannel
  address   String   // normalized lower-case email or E.164
  reason    String   // "unsubscribe" | "bounce" | "complaint" | "stop" | "manual"
  source    String   // "resend_event:<id>" | "twilio_stop:<id>" | "owner"
  createdAt DateTime @default(now())
  @@unique([channel, address])
}

model LaunchSubscriber { confirmedAt DateTime?  confirmTokenHash String?  confirmExpiresAt DateTime? }   // E4
model Lead { lastRealContactAt DateTime? }   // E8 — maintained by the one function; nullable
```

## 3. Work units

### WU-E1 — Schema, health, backup, docs
Section 2. `AutomationRun`, `MessageDelivery`, `ProviderEvent`, `MarketingSuppression` join schema-health and backup.

### WU-E2 — `runAutomation` wrapper, one cron wrapped (E1)
Files: `src/domains/automation/runs.ts` (new), `src/app/api/cron/estimate-follow-ups/route.ts` (first), `tests/automation-runs.test.ts`, `tests/automation-runs-integration.test.ts`.
```ts
export async function runAutomation<T>(input: { ruleKey: string; slot: string; budgetSeconds?: number; work: () => Promise<{ counts: Record<string, number> }> }): Promise<{ outcome: "RAN"|"ALREADY_RAN"|"FAILED"; runId: string }>;
// tx: insert AutomationRun unique (ruleKey, runKey) → on unique violation read it: SUCCEEDED/FAILED/SKIPPED → ALREADY_RAN; RUNNING and younger than budget → ALREADY_RAN; RUNNING and older → mark UNKNOWN, insert a new run with runKey suffix ":retry<n>".
// run work outside the tx; finish with SUCCEEDED+counts or FAILED+sanitized error; never rethrow provider errors to the route (route returns 200 with the outcome so Vercel does not retry blindly; failures are visible in O25).
export function slotForDaily(now = new Date()): string;   // business date key (America/Denver)
export function slotForHourly(now = new Date()): string;
```
Tests: duplicate slot → ALREADY_RAN and the work function not called; crash mid-work (throw) → FAILED with sanitized error; stale RUNNING → UNKNOWN + retry row; (integration) two concurrent invocations → exactly one runs.

### WU-E3 — Automation health UI (O25) and the remaining crons
Files: `src/app/desk/automations/page.tsx` (OWNER/ADMIN), `src/domains/automation/health.ts` (`getAutomationHealth(): Array<{ ruleKey, label, lastSuccessAt, lastFailure?, state: "healthy"|"failing"|"unknown"|"never-ran"|"disabled"|"unconfigured", resolutionHref }>`), wrap `billing-reminders`, `job-reminders`, `late-fees`, `launch-emails`, `backup`, `billing-reconcile` one commit each, each commit re-running that sender's existing tests.
Rules: "disabled" (feature flag/owner choice) is distinct from "unconfigured" (missing env); no "Retry all" button; pause = a settings flag read by the route, never a deletion; missing run shows "never ran", not "ok".

### WU-E4 — `deliverMessage` and sender migration (E2)
Files: `src/domains/messaging/{deliver.ts,templates.ts,suppression.ts}` (new), each sender in A3's list migrated in its own commit in the order given in E2, `tests/messaging-deliver.test.ts`, `tests/messaging-deliver-integration.test.ts`, every existing sender test file (must stay green).
```ts
export async function deliverMessage(input: {
  idempotencyKey: string; channel: "EMAIL"|"SMS"; purpose: "TRANSACTIONAL"|"MARKETING"; templateKey: string;
  recipient: { type: string; id?: string; address: string }; subject?: { type: string; id: string };
  render: () => { subject?: string; text: string; actionLabel?: string; marketing?: { postalAddress: string; unsubscribeUrl: string } };
}): Promise<{ state: MessageState; deliveryId: string }>;
// tx1: upsert MessageDelivery by idempotencyKey — if exists and state ∉ {FAILED} → return it (no second send; UNKNOWN is not retried here);
//      MARKETING: if MarketingSuppression has the address → state SUPPRESSED, return;
// call sendEmail/sendSms (low-level, unchanged) with idempotencyKey; map {sent:true} → ACCEPTED (+providerMessageId when the sender returns one — extend sendEmail to return Resend's id), {sent:false} → FAILED, throw/timeout → UNKNOWN.
export async function reconcileUnknownDeliveries(limit = 50): Promise<{ resolved: number }>;   // called by billing-reconcile cron: Resend emails.get(providerMessageId) when known; else leave UNKNOWN
```
Mark-then-send for reminders: claim the `…SentForDate`/`…SentAt` field with `updateMany where <field> is null/≠` in a tx, then `deliverMessage`; on FAILED clear the claim in a second tx.
Tests: same key twice → one provider call; suppressed address → SUPPRESSED and no call; `{sent:false}` → FAILED and (for reminders) the claim is cleared; provider throw → UNKNOWN and not retried by a second `deliverMessage`; launch step tests from PR #86 unchanged and green; non-production → every delivery recorded as FAILED with error "non-production: sending disabled" (so previews show the ledger without sending).

### WU-E5 — Provider events and suppression (E3)
Files: `src/app/api/webhooks/resend/route.ts`, `src/app/api/webhooks/twilio/route.ts` (new), `src/domains/messaging/events.ts`, `tests/messaging-events.test.ts`, `e2e/security-response-headers.spec.ts` (unchanged) — add the two routes to the security-headers check list if that spec enumerates routes.
Rules: verify signature before parsing the body into anything; store `ProviderEvent` (unique) in the same transaction as the state change; duplicate event → 200 no-op; unknown message id → store the event, change nothing; `email.bounced`/`email.complained` → delivery terminal + suppression row; Twilio STOP → opt-out trio (E3). Env: `RESEND_WEBHOOK_SECRET` documented in `docs/ARCHITECTURE.md`; missing secret → route returns 503 and logs *no* payload (P6 H7).
Tests: forged signature 400 and nothing stored; replay no-op; out-of-order (`delivered` before `sent`) ends DELIVERED; STOP suppresses and records consent; bounce suppresses marketing only (transactional still allowed? **No** — bounce suppresses both channels' marketing *and* flags the address; transactional sends to a hard-bounced address are recorded FAILED with reason "hard bounce on file" — simpler and safer).

### WU-E6 — Launch confirmation (E4)
Files: `src/domains/launch/*` (confirm token issue/verify; marketing steps gated on `confirmedAt`), public confirm route, `tests/launch-*.test.ts` (extend). Preserve PR #86's finite sequence.

### WU-E7 — Role-aware search (E5), lead contact semantics and utilization (E8)
Files: `src/domains/search/index.ts` (`searchAll(query, role)`), `src/domains/leads/contact.ts` (new `recordRealContact` + `lastRealContactAt` maintenance from messaging ACCEPTED events and manual notes), `src/domains/growth/*`, `tests/search-roles.test.ts` (negative: STAFF result JSON contains no `email`/`phone`/`scoreReasons` keys for leads), `tests/leads-contact.test.ts`.

### WU-E8 — Report contracts and measured lists (E8)
Files: `src/domains/reports/definitions.ts` (extend D6), `tests/perf/*.test.ts`, `docs/PERF-BASELINE.md`, pagination tie-breakers (`orderBy: [{createdAt:"desc"},{id:"desc"}]`) wherever a list orders by a non-unique column (grep `orderBy:`), indexes for the measured queries only.

### WU-E9 — Evergreen token migration (E6)
Files: `src/app/globals.css` (dark tokens from `docs/brand/03_Design_System/brand-tokens.json` `dark.*`), `eslint.config.*` (the restricted-syntax rule), every `src/**/*.tsx` with `slate-`/`gray-`/`neutral-`/`zinc-` classes — mechanical, in commits by area (desk, portal, auth, public), `e2e/accessibility-dark-mode.spec.ts` (extend to signed-in routes).
Mapping table (apply exactly; anything not in the table → stop-and-ask):
| Old | New |
|---|---|
| `bg-white` (surfaces) | `bg-surface` |
| `bg-slate-50`, `bg-gray-50` | `bg-canvas` |
| `bg-slate-100`, `bg-gray-100` | `bg-canvas-alt` |
| `text-slate-900`, `text-gray-900` | `text-ink` |
| `text-slate-600/700`, `text-gray-600/700` | `text-ink-soft` |
| `text-slate-400/500`, `text-gray-400/500` | `text-ink-faint` |
| `border-slate-200`, `border-gray-200` | `border-line` |
| `border-slate-300`, `border-gray-300` | `border-line-strong` |
| `bg-slate-900` buttons | `bg-action text-on-action` |
| `ring-slate-*` focus | `ring-control` |
Define the Tailwind utilities for these names in `globals.css` `@theme` if not present. `prefers-reduced-motion` → disable transitions globally; `prefers-contrast: more` and `forced-colors: active` → borders on all controls, no color-only states.

### WU-E10 — Route inventory and generated axe coverage (E7)
Files: `e2e/route-inventory.ts`, `e2e/accessibility-routes.spec.ts` (generated loop), `e2e/shards.json` (new group if needed), `docs/ACCESSIBILITY.md` (new: target WCAG 2.2 AA engineering checks; manual-only list with reasons; what axe does not prove).

### WU-E11 — B-register items, docs, PR
B01 (reminder surface: automation health + delivery ledger on records), B07 (public abuse: Batch A limiter on all public POSTs incl. the new confirm/privacy routes; document the limits), B20 (consent: E3 trio + launch confirm), B26 (demand forecast: explainable signal from C's custody + lead pipeline, labelled estimate), B29 (customer communication visibility: O27 record panels), B31 (outage messaging: health page states + `docs/runbooks/PROVIDER-OUTAGE.md`). `docs/ARCHITECTURE.md` env vars (`RESEND_WEBHOOK_SECRET`), `BUSINESS-RULES.md` (consent, suppression, reminder claims), `OWNER-GUIDE.md` (automations page, messages on records), `STATUS.md`.

## 4. Stop-and-ask
1. Any Section 0 assumption false.
2. Any change that would make a real send happen in production (enabling keys, flipping a flag) — owner gate, always.
3. A `slate/gray` usage that the mapping table does not cover.
4. Whether the launch confirm email may go out to existing subscribers in production (it is a transactional send to people who already opted in; the design says yes **only** after IN-01/IN-02 are answered).

## 5. Acceptance mapping
PLAN E lines ↔ WU-E4 (send false/timeout/crash/retry), WU-E6 (opt-in pending), WU-E5 (STOP), WU-E7 (STAFF search negative), WU-E8 (metric definitions; measured lists), WU-E10 (route coverage), WU-E9 (brand screenshots; forced-colors/reduced-motion), `docs/ACCESSIBILITY.md` (no certification claim), WU-E3 (each cron's dedupe tests still pass).
