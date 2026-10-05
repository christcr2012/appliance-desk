# Design — Batch E: Communications, automation history, search, growth signals, brand tokens & accessibility

Status: **APPROVED DESIGN — implement from this document.** Originally approved 2026-10-02; **rewritten 2026-10-05 by
Claude Opus 5.5 against `main` 47bd833**, with the drift check done (section 0). Changes from the 2026-10-02 text are
marked **(changed 2026-10-05)** with the reason; the old text is in `docs/archive/designs-2026-10-02/BATCH-E.md`.

Scope and acceptance: `docs/PLAN.md` → Batch E. Blocking constraints: `docs/AI-PR-READ-FIRST.md` items 3 and 9
(silent provider failures) and 4 (in-memory rate limiting is not a defence). **Starts after Batch D merges.**
Messaging to real customers stays **off** throughout: this batch makes sending recorded and recoverable; it does not
turn anything on.

**For the implementing model (Sonnet 5.5 or Sol 5.6):** follow this literally; no tables, columns, settings, libraries
or patterns beyond those named; stop where it is silent (section 4).

---

## 0. Verify before starting

Checked against 47bd833 (+ B2, D designs) on 2026-10-05.

| # | Fact | How to check |
|---|---|---|
| A1 | B2 and D are merged; STATUS says E is next. | `docs/STATUS.md` |
| A2 | `sendEmail` (`src/lib/email.ts`) returns `{ sent, outcome, providerMessageId? }` (outcome `SENT`/`NOT_ATTEMPTED`/`REJECTED`/`UNKNOWN`; the id was added by B2) and never sends from a non-production deployment. `sendCustomerEmail` (`src/lib/customer-email.ts`) adds the owner switch. `sendSms` (`src/lib/sms.ts`) returns `{ sent: boolean }` only. | read the three files |
| A3 | Callers of `sendEmail`/`sendCustomerEmail`/`sendSms`: `backup`, `billing/late-fees.ts`, `billing/reminders.ts`, `estimates/index-base.ts` (send and follow-up), `jobs/day-of-reminders.ts`, `launch/index.ts`, `leads/index.ts`, `notices/index.ts`, `portal/index.ts`, `referrals/index.ts`, `lib/auth.ts`, `lib/password-email.ts` (+ D's privacy verification). New callers join the migration list. | `grep -rln "sendEmail(\|sendSms(\|sendCustomerEmail(" src` |
| A4 | Cron routes (all daily in `vercel.json`, each checks `CRON_SECRET`): `backup`, `billing-reconcile` (provider ops, handoffs, B2 billing-end sweeps, D's invoice freeze), `billing-reminders`, `estimate-follow-ups`, `job-reminders`, `late-fees`, `launch-emails`, `start-renewals` (runs several passes: auto-renewals, annual reminders, notices, billing extension, terminations, closing returned rentals, renewal starts). | `ls src/app/api/cron`; read `start-renewals/route.ts` |
| A5 | `LaunchDelivery (subscriberId, step) @@unique`, `status` String with SENDING meaning "uncertain, never retried blindly" (PR #86). **Never rewrite it.** | schema + `tests/launch-*.test.ts` |
| A6 | `ConsentRecord { customerId?, kind String, details Json? }`. | schema |
| A7 | Billing reminders and job day-of reminders still **send then mark** (`billingReminderSentForDate`, `dayOfReminderSentAt`); estimate send is already a locked claim before send (R10); estimate follow-ups claim before send (#200); notices have B2's state machine. | `src/domains/billing/reminders.ts`, `src/domains/jobs/day-of-reminders.ts` |
| A8 | `searchAll(rawQuery)` (`src/domains/search/index.ts`) calls `requireRole("OWNER","ADMIN","STAFF")` and returns the same fields (including lead email) for every role. | file |
| A9 | Colour tokens exist in `src/app/globals.css` (`--color-surface`, `canvas`, `canvas-alt`, `ink`, `ink-soft`, `ink-faint`, `line`, `line-strong`, `action`, `on-action`, `control`, `primary*`, `accent*`, `success`, `warning-*`, `danger`, `focus-ring`) with dark values under the `.dark` class (set on `<html>` by `src/lib/theme.ts`; `@custom-variant dark` targets `.dark`). `--color-focus-ring` is **not** in `@theme inline` yet. About 1,350 `gray-*` utility uses remain in `.tsx` files (no `slate-`). | `grep -rho "\b\(bg\|text\|border\|ring\|divide\)-\(slate\|gray\|neutral\|zinc\)-[0-9]\+" src --include=*.tsx \| sort \| uniq -c` |
| A10 | Rate limiting: `isRateLimited(key, { max, windowMs })` in `src/lib/rate-limit.ts`. (changed 2026-10-05: the old design called it `limit`.) | file |
| A11 | Only `src/app/api/webhooks/stripe` exists; there is no Resend or Twilio webhook route. | ls |
| A12 | Browser groups are `browser-a`…`browser-d` in `e2e/shards.json` (every spec in exactly one group; CI enforces it). | file |
| A13 | `CustomerNotice` (B2) is the record of what a customer is legally owed; its `providerMessageId`/`evidenceDate` are the legal evidence. | schema |

## 1. Decisions

**E1. One `AutomationRun` row per nightly pass, claimed before work starts; "no row" ≠ healthy and "zero work" ≠
failed.** (O24/O25.) `runKey` = `<ruleKey>:<Colorado business date>` (all crons are daily), so a duplicate invocation
for the same day finds the row and returns "already ran" without working. A run left RUNNING longer than its budget
shows as UNKNOWN. Counts are integers; errors are sanitized strings (`sanitizeProviderError`); no message bodies or
addresses. (changed 2026-10-05:) `start-renewals` and `billing-reconcile` run several passes; **each pass is its own
ruleKey** (`auto-renewals`, `annual-reminders`, `notices`, `auto-renew-billing`, `terminations`, `returned-rentals`,
`renewal-starts`; `provider-ops`, `job-handoffs`, `subscription-ends`, `invoice-artifacts`) so a failing pass is visible
and does not hide the others.

**E2. Every outgoing message is a `MessageDelivery` row created before the provider call, with a business
idempotency key; "accepted" is never shown as "delivered".** (O26, RC6.) The low-level senders stay; `deliverMessage()`
in `src/domains/messaging/` is the only thing domain code may call (auth/password email keeps `sendEmail` directly —
it is account security, not a business message). Outcomes: `ACCEPTED`, `FAILED` (provider refused), `UNKNOWN`
(timeout/crash), `NOT_SENT` (switch off, preview, no key — changed 2026-10-05: the code already distinguishes
`NOT_ATTEMPTED` and the ledger must not call that a failure), later `DELIVERED`/`BOUNCED`/`COMPLAINED` from provider
events. **Uncertain outcomes follow the B2 rule** (changed 2026-10-05, for one rule across the product): one immediate
retry with the identical key and payload (Resend replays the original answer for 24 hours); still unknown → `UNKNOWN`,
visible, never retried automatically. Senders migrate one per commit, each keeping its existing tests green: estimate
send and follow-ups → launch (wraps PR #86's loop; `LaunchDelivery` stays the sequence ledger; key
`launch-<subscriberId>-<step>`) → billing reminders → job reminders → referrals → late-fee notices → portal messages
→ lead notifications → **notices** (B2's sender calls `deliverMessage` with key `customer-notice-<id>` and keeps writing
its own evidence fields; `CustomerNotice` is not replaced). Billing and job reminders become claim-then-send: claim the
`…SentForDate`/`…SentAt` field in a transaction first; a `FAILED` or `NOT_SENT` outcome clears the claim so the next
run retries.

**E3. Provider events are stored by event id, verified before storage, and drive suppression through one table.**
(O28.) `ProviderEvent` unique `(provider, eventId)` for Resend (Svix signature verified with `RESEND_WEBHOOK_SECRET`)
and Twilio (`X-Twilio-Signature` checked with `TWILIO_AUTH_TOKEN`). `MarketingSuppression` (unique channel + normalized
address) is the only thing marketing sends consult; it is separate from the launch cursor. Twilio STOP →
`Customer.smsOptInAt = null`, `ConsentRecord { kind: "sms_opt_out", details: { source: "twilio_stop", eventId } }` and a
suppression row, in one transaction. Forged/unsigned → 400, nothing stored. Status only moves forward
(`ACCEPTED → DELIVERED`; `BOUNCED`/`COMPLAINED` terminal). A hard bounce suppresses marketing on that address and makes
later transactional sends to it record `FAILED` with "hard bounce on file". A bounce on a `CustomerNotice` email puts
that notice back to the owner as `UNCERTAIN` with the reason (the legal evidence question goes to a person).

**E4. Launch-list marketing requires confirmed mailbox ownership.** `LaunchSubscriber.confirmedAt`; the welcome step
sends a confirm link (single-use token, sha256 stored, 7-day expiry); marketing steps require `confirmedAt`. Existing
unconfirmed subscribers get no marketing until confirmed; the owner sees the count.

**E5. Search returns a role-shaped result decided in the query.** STAFF never receives lead email, phone or score
reasons, or any money field; the STAFF query does not select those columns (not post-filtered).

**E6. Brand tokens: a fixed mapping, a lint rule that stops regressions, dark mode stays on the existing `.dark`
mechanism.** (P7 H4.) (changed 2026-10-05: dark tokens and the theme switch already exist; E adds no second dark
mechanism.) Replace every `gray-*`/`slate-*`/`neutral-*`/`zinc-*` utility in `src/**/*.tsx` per the table in WU-E9;
delete any `dark:` variant whose only job was to swap a grey (the tokens already switch). Add `--color-focus-ring` to
`@theme inline` so `ring-focus-ring` exists. ESLint `no-restricted-syntax` fails on string literals matching
`/(^|\s)(dark:)?(bg|text|border|ring|divide|outline|placeholder)-(slate|gray|neutral|zinc)-\d/`. Status colours
are never the only carrier of meaning (text or icon always present). `prefers-reduced-motion: reduce` disables
transitions/animations globally; `forced-colors: active` and `prefers-contrast: more` give every control a visible
border.

**E7. Accessibility coverage is generated from a route inventory, stated as WCAG 2.2 AA engineering checks — never
"certified".** (P7 H5.) `e2e/route-inventory.ts` lists every page route with `{ path, role, fixture, manualOnlyReason? }`;
`e2e/accessibility-routes.spec.ts` runs axe on each at 360 and 1440, light and dark. A route is excluded only with a
written reason. Group assignment: put the new spec in whichever of `browser-a`…`browser-d` has the lowest measured
time (CI prints per-file durations); if any group then exceeds ~120 s, split the inventory into two specs across two
groups — never add a fifth group without changing the workflow matrix in the same PR.

**E8. Reports and growth signals get contracts before tuning; large lists are measured.** Each report/list query gets
a `tests/perf/*.test.ts` case on a generated fixture (1,000 customers, 2,000 invoices, 500 jobs, built through domain
functions in the throwaway database) asserting bounded result sizes and printing wall time; `docs/PERF-BASELINE.md`
keeps the numbers with the commit. Lead "last real contact" = latest of (manual call/note, ACCEPTED or DELIVERED message
to the lead, inbound form), defined in one function; utilization = current and rolling-30-day from Batch C's custody
episodes (`ApplianceCustodyEpisode`), never from assignments.

## 2. Schema changes (additive) — migration `20261008010000_batch_e_messaging`

```prisma
enum AutomationRunState { RUNNING SUCCEEDED FAILED UNKNOWN SKIPPED }

model AutomationRun {                 // E1
  id            String             @id @default(cuid())
  ruleKey       String
  runKey        String             // "<ruleKey>:<YYYY-MM-DD>" (+ ":retry<n>")
  state         AutomationRunState @default(RUNNING)
  environment   String             // "production" | "preview" | "ci" | "development"
  startedAt     DateTime           @default(now())
  finishedAt    DateTime?
  budgetSeconds Int                @default(300)
  counts        Json?              // integers only
  error         String?            // sanitized
  @@unique([ruleKey, runKey])
  @@index([ruleKey, startedAt])
}

enum MessageChannel { EMAIL SMS }
enum MessagePurpose { TRANSACTIONAL MARKETING }
enum MessageState   { PENDING ACCEPTED FAILED UNKNOWN NOT_SENT DELIVERED BOUNCED COMPLAINED SUPPRESSED }

model MessageDelivery {               // E2
  id                String         @id @default(cuid())
  idempotencyKey    String         @unique
  channel           MessageChannel
  purpose           MessagePurpose
  templateKey       String         // "estimate-send", "estimate-follow-up", "billing-reminder", "customer-notice", …
  recipientType     String         // "Customer" | "Lead" | "LaunchSubscriber" | "Staff"
  recipientId       String?
  recipientAddress  String         // email or E.164
  subjectType       String?
  subjectId         String?
  state             MessageState   @default(PENDING)
  providerMessageId String?        @unique
  attempts          Int            @default(1)
  lastError         String?
  requestedAt       DateTime       @default(now())
  acceptedAt        DateTime?
  deliveredAt       DateTime?
  updatedAt         DateTime       @updatedAt
  @@index([recipientType, recipientId, requestedAt])
  @@index([subjectType, subjectId])
  @@index([state, requestedAt])
}

model ProviderEvent {                 // E3
  id          String    @id @default(cuid())
  provider    String    // "resend" | "twilio"
  eventId     String
  type        String
  receivedAt  DateTime  @default(now())
  processedAt DateTime?
  summary     Json?     // message id, status, bounce type — no bodies
  @@unique([provider, eventId])
}

model MarketingSuppression {          // E3
  id        String         @id @default(cuid())
  channel   MessageChannel
  address   String         // lower-case email or E.164
  reason    String         // "unsubscribe" | "bounce" | "complaint" | "stop" | "manual"
  source    String         // "resend_event:<id>" | "twilio_stop:<id>" | "owner"
  createdAt DateTime       @default(now())
  @@unique([channel, address])
}

model LaunchSubscriber { confirmedAt DateTime?  confirmTokenHash String?  confirmExpiresAt DateTime? }  // E4
model Lead { lastRealContactAt DateTime? }                                                             // E8
model BusinessSettings { pausedAutomations Json @default("[]") }  // E1/WU-E3: ruleKeys the owner paused
```
All new tables: `BACKUP_MODEL_POLICY`, schema health, `docs/DATABASE.md`.

## 3. Work units (PR stack: [E1–E3] → [E4–E5] → [E6–E8] → [E9] → [E10–E11])

### WU-E1 — Schema, health, backup, docs
Section 2. Backup test includes the new tables.

### WU-E2 — `runAutomation` and the first wrapped pass (E1)
Files: `src/domains/automation/runs.ts` (new), `src/app/api/cron/estimate-follow-ups/route.ts`,
`tests/automation-runs.test.ts`, `tests/automation-runs-integration.test.ts`.
```ts
export async function runAutomation(input: { ruleKey: string; now?: Date; budgetSeconds?: number;
  work: () => Promise<{ counts: Record<string, number> }> }): Promise<{ outcome: "RAN" | "ALREADY_RAN" | "FAILED" | "PAUSED"; runId: string | null }>;
export function automationSlot(now?: Date): string;   // Colorado business date key
```
Insert `(ruleKey, runKey)`; on unique violation read it: SUCCEEDED/FAILED/SKIPPED → ALREADY_RAN; RUNNING younger than
budget → ALREADY_RAN; RUNNING older → mark UNKNOWN and insert `<runKey>:retry<n>`. A ruleKey listed in
`pausedAutomations` → SKIPPED row, `PAUSED`. Work runs outside the transaction; finish SUCCEEDED + counts or FAILED +
sanitized error; never rethrow (the route returns 200 with the outcome so Vercel does not blind-retry).
Tests: same day twice → ALREADY_RAN and work not called; throw → FAILED sanitized; stale RUNNING → UNKNOWN + retry row;
(integration) two concurrent invocations → exactly one runs; paused → SKIPPED, work not called.

### WU-E3 — Automation health page and the remaining passes (O25)
Files: `src/domains/automation/health.ts`, `src/app/desk/automations/page.tsx` (OWNER/ADMIN), each pass in A4 wrapped
one commit each (each commit re-runs that pass's existing tests), pause/resume action (OWNER only; writes
`pausedAutomations`; never deletes rows).
```ts
export async function getAutomationHealth(now?: Date): Promise<Array<{ ruleKey: string; label: string; explanation: string;
  lastSuccessAt: Date | null; lastFailure: { at: Date; error: string } | null;
  state: "healthy" | "failing" | "unknown" | "never-ran" | "paused" | "unconfigured"; resolutionHref: string }>>;
```
"unconfigured" = a required env var is missing (checked by name, value never shown); "never-ran" is not "healthy"; no
"Retry all" button. Every ruleKey has a one-sentence plain explanation on the page.

### WU-E4 — `deliverMessage` and sender migration (E2)
Files: `src/domains/messaging/{deliver.ts,suppression.ts}` (new), each sender in A3 migrated in its own commit in the
E2 order, `tests/messaging-deliver.test.ts`, `tests/messaging-deliver-integration.test.ts`, every existing sender test.
```ts
export async function deliverMessage(input: {
  idempotencyKey: string; channel: "EMAIL" | "SMS"; purpose: "TRANSACTIONAL" | "MARKETING"; templateKey: string;
  customerFacing: boolean;   // true → goes through sendCustomerEmail (owner switch)
  recipient: { type: string; id?: string; address: string }; subject?: { type: string; id: string };
  render: () => { subject?: string; text: string; actionLabel?: string; marketing?: { postalAddress: string; unsubscribeUrl: string } };
}): Promise<{ state: MessageState; deliveryId: string; providerMessageId: string | null }>;
export async function reconcileUnknownDeliveries(limit?: number): Promise<{ resolved: number }>;
```
Flow: transaction 1 inserts the row by key (an existing row in any state except `FAILED`/`NOT_SENT` is returned as is —
no second send); MARKETING with a suppression → `SUPPRESSED`, return; call the low-level sender with the key; map
`SENT` → ACCEPTED (+ id, `acceptedAt`), `REJECTED` → FAILED, `NOT_ATTEMPTED` → NOT_SENT, `UNKNOWN` → one identical retry
→ still unknown → UNKNOWN. `sendSms` is extended to return `{ sent, outcome, providerMessageId? }` the same way
(Twilio message SID). `reconcileUnknownDeliveries` (in `billing-reconcile`): for UNKNOWN rows with a
`providerMessageId`, read the provider status; without one, leave UNKNOWN and visible.
Tests: same key twice → one provider call; suppressed → SUPPRESSED, no call; REJECTED → FAILED and a reminder's claim
cleared; switch off → NOT_SENT, claim cleared, not shown as failure; unknown → exactly one retry; preview → NOT_SENT
with "previews never send"; PR #86 launch tests unchanged and green; B2 notice tests unchanged and green.

### WU-E5 — Provider events and suppression (E3)
Files: `src/app/api/webhooks/resend/route.ts`, `src/app/api/webhooks/twilio/route.ts` (new),
`src/domains/messaging/events.ts`, `tests/messaging-events.test.ts`, add both routes to
`e2e/security-response-headers.spec.ts` if it lists routes. Use the `svix` package only if it is already a dependency;
otherwise verify the Svix HMAC-SHA256 signature by hand per Resend's current webhook docs (check them; cite in the PR).
Rules: verify before parsing; store `ProviderEvent` in the same transaction as the state change; duplicate → 200 no-op;
unknown message id → store, change nothing; missing secret → 503, log no payload (P6 H7).
Tests: forged signature 400, nothing stored; replay no-op; out-of-order ends DELIVERED; STOP trio in one transaction;
bounce suppresses marketing and fails a later transactional send; bounce on a notice email → notice UNCERTAIN.

### WU-E6 — Launch confirmation (E4)
Files: `src/domains/launch/index.ts` (issue/verify token; marketing steps require `confirmedAt`), public confirm route
`src/app/launch/confirm/[token]/page.tsx`, `tests/launch-*.test.ts` (extend). Preserve PR #86's finite sequence and its
uncertain-SENDING rule.

### WU-E7 — Role-aware search; lead contact; utilization (E5, E8)
Files: `src/domains/search/index.ts` (`searchAll(rawQuery)` reads the session role from `requireRole`'s return value and
selects per role), `src/domains/leads/contact.ts` (new `recordRealContact`, maintains `Lead.lastRealContactAt` from
manual notes and ACCEPTED/DELIVERED messages), `src/domains/growth/*` (win-back uses it; utilization from custody),
`tests/search-roles.test.ts` (STAFF result JSON has no `email`, `phone`, `scoreReasons` keys for leads and no money
fields), `tests/leads-contact.test.ts`.

### WU-E8 — Report contracts and measured lists (E8)
Files: `src/domains/reports/definitions.ts` (extend D's `METRICS` with growth/utilization), `tests/perf/*.test.ts`,
`docs/PERF-BASELINE.md` (new), stable tie-breakers (`orderBy: [{ createdAt: "desc" }, { id: "desc" }]`) wherever a list
orders by a non-unique column (`grep -rn "orderBy:" src`), indexes only for queries the measurements show are slow.

### WU-E9 — Evergreen token migration (E6) — its own PR, mechanical, commits by area (desk, portal, auth, public, components)
Files: `src/app/globals.css` (add `--color-focus-ring` to `@theme inline`; reduced-motion and forced-colors rules),
`eslint.config.mjs` (the rule), every `.tsx` with a grey utility, `e2e/accessibility-dark-mode.spec.ts` (extend to
signed-in routes).
Mapping (apply exactly; a combination not in the table → stop and ask):

| Old | New |
|---|---|
| `bg-white` on a card/panel/surface | `bg-surface` |
| `bg-gray-50` | `bg-canvas` |
| `bg-gray-100`, `bg-gray-200` | `bg-canvas-alt` |
| `bg-gray-800`, `bg-gray-900` on a button or chip | `bg-action text-on-action` (remove the old text colour) |
| `text-gray-800`, `text-gray-900` | `text-ink` |
| `text-gray-600`, `text-gray-700` | `text-ink-soft` |
| `text-gray-400`, `text-gray-500` | `text-ink-faint` (then check contrast; axe must pass) |
| `border-gray-100`, `border-gray-200`, `divide-gray-100`, `divide-gray-200` | `border-line` / `divide-line` |
| `border-gray-300`, `border-gray-400` | `border-line-strong` |
| `ring-gray-*`, `focus:ring-gray-*` | `ring-focus-ring` |
| any `dark:` + grey utility | delete it (tokens switch by themselves) |
| `border-gray-900` (9 uses) | **stop and ask** — no token means "very dark border" |

Done when the lint rule passes with zero exceptions and axe is clean on every route in light and dark.

### WU-E10 — Route inventory and generated axe coverage (E7)
Files: `e2e/route-inventory.ts`, `e2e/accessibility-routes.spec.ts`, `e2e/shards.json`, `docs/ACCESSIBILITY.md` (new:
WCAG 2.2 AA engineering checks, the manual-only list with reasons, what axe does not prove; update
`docs/DESIGN-SYSTEM.md`'s heading from 2.1 to 2.2 AA).

### WU-E11 — Business-audit items, docs, PR
B01 (automation health + delivery ledger on records), B07 (every public POST rate-limited with `isRateLimited`,
including launch confirm and D's privacy intake; limits documented), B20 (consent: STOP trio + launch confirm), B26
(demand signal from custody + lead pipeline, labelled "estimate"), B29 (O27: customer and lead pages show a
"Messages" panel from `MessageDelivery` — template, recipient, state in words, never "sent" for NOT_SENT/FAILED/UNKNOWN),
B31 (health page states + `docs/runbooks/PROVIDER-OUTAGE.md`). Docs: `ARCHITECTURE.md` (env vars
`RESEND_WEBHOOK_SECRET`, webhook URLs), `BUSINESS-RULES.md` (consent, suppression, reminder claims),
`OWNER-GUIDE.md` (automations page, messages panel), `GO-LIVE-CHECKLIST.md` (register both webhooks; set the secret),
`CHANGES-SINCE-DESIGN.md`, `STATUS.md`.

**Conditional Google Workspace PR (O32)** is unchanged from `docs/PLAN.md` and is not part of this design; it needs its
own design when its prerequisites are met.

## 4. Stop-and-ask
1. Any section 0 row is false.
2. Anything that would make a real send happen in production (keys, switches) — always Chris.
3. A grey utility the mapping table does not cover.
4. Whether the launch confirm email may go to existing subscribers in production (yes only after IN-01/IN-02).
5. A new dependency for webhook verification that is not already installed.

## 5. Acceptance mapping
| PLAN E line | Evidence |
|---|---|
| Send false/timeout/crash/retry: no silent loss, no duplicate | WU-E4 tests |
| Launch opt-in pending until confirmed | WU-E6 tests |
| STOP suppresses and records consent | WU-E5 tests |
| STAFF search never returns OWNER-only lead PII | `tests/search-roles.test.ts` |
| Every metric defined with drill-through | WU-E8 + D's `METRICS` |
| Large lists measured | `docs/PERF-BASELINE.md` |
| Every route in axe coverage or documented | WU-E10 |
| Brand screenshots, forced-colors, reduced-motion, keyboard | WU-E9/E10 + PR screenshots |
| No certification claim | `docs/ACCESSIBILITY.md` |
| Each cron's dedupe tests still pass | WU-E3 commits |

## Amendments
(Dated entries only.)
