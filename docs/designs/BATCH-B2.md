# Design — Batch B2: Renewal lifecycle, month-to-month rentals and pickup billing (finishes Batches B and C)

Status: **WAITING FOR CHRIS'S ONE-LINE APPROVAL** in `docs/designs/README.md` (it settles money and notice rules).
Written 2026-10-05 by Claude Opus 5.5 against `main` 47bd833 (#200), after reading every function this document
names. It replaces two open prompts: `docs/archive/prompts/DESIGN-BATCH-B-RENEWAL-LIFECYCLE.md` (findings R1–R7, D1, D2 of
`docs/reviews/2026-10-03-pr161-independent-review.md`) and the blocked C-09 section of
`docs/designs/BATCH-C-LITERAL-SPEC-2026-10-03.md`. Scope and acceptance: `docs/PLAN.md` → Batch B2.

**Who this is written for.** An implementing model (Claude Sonnet 5.5 or ChatGPT Sol 5.6) that follows it literally.
Every decision below is already made. Do not re-decide; do not add tables, columns, statuses, settings, libraries or
patterns that this document does not name. Where it is silent on something that matters, stop (section 6).

**Nothing in this batch turns anything on.** Live customer email stays OFF, the "Automatic renewals" switch stays OFF,
Stripe stays in test mode. This batch makes the renewal and ending machinery correct so that Chris *can* turn
automatic renewals on later (after counsel reads the wording; `docs/GO-LIVE-CHECKLIST.md`).

---

## 0. Verify before starting (drift check — every row takes under a minute)

The design was checked against 47bd833 on 2026-10-05. If `main` has moved, re-check each row; a false row is a stop.

| # | Assumption | How to check |
|---|---|---|
| A1 | Stripe end dates are changed in exactly these places: `syncSubscriptionTerm` (called from `auto-renew.ts` `createAutoRenewal` and `extendBillingForDeliveredAutoRenewals`, `renewal-start.ts` `startRenewalIfDue`, `agreements/index.ts` `runCloseAgreementContinuation`) and `syncTerminationEnd` (called from `term.ts` `requestEarlyTermination` and `termination-execution.ts` `executeAgreedTermination`); retried by `reconcileSubscriptionUpdate` in `src/domains/billing/reconciliation-base.ts`. Subscriptions are created with `cancel_at` in `checkout.ts` (`cancelAtSecondsFor`). | `grep -rn "syncSubscriptionTerm\|syncTerminationEnd\|subscriptions\.update\|subscriptions\.cancel\|subscriptions\.create" src` |
| A2 | `subscription-line.ts` (line price reduction, key `subscription-line-reduce-…`) changes subscription **items**, never `cancel_at`. | read `sendLineUpdate` |
| A3 | `closeAgreementInTx` claims `SUBSCRIPTION_CANCEL` (key `subscription-cancel-<agreementId>`) in the caller's transaction and returns `revertRenewalId` for a cancelled SCHEDULED renewal; `runCloseAgreementContinuation` runs after commit. | `src/domains/agreements/index.ts` lines ~570–770 |
| A4 | `CustomerNotice.status` is a `String` with values `PENDING`, `SENDING`, `SENT`, `NOT_NEEDED`; there is no provider message id column; `sendEmail` returns `{ sent, outcome }` with no message id. | `prisma/schema.prisma` model `CustomerNotice`; `src/lib/email.ts` |
| A5 | `renewalCreateData` copies prices and settings but not `termsSnapshot`, `renewalPreference` or any consent field; the continuation of a fixed term is `termMonths: null`. | `src/domains/agreements/renewal-data.ts` |
| A6 | `recordLateReturnOnRemoval` charges from `agreement.endDate` only (it ignores `terminationEffectiveOn`). | `src/domains/billing/pickup-billing-events.ts` |
| A7 | `completeJob` (`src/domains/jobs/completion.ts`) is the only way to complete a job; REMOVAL results close custody and call `recordLateReturnOnRemoval`; nothing in it ends an agreement. | read the REMOVAL branch |
| A8 | `ProviderOperationStatus` is `PENDING SUCCEEDED FAILED UNKNOWN DRIFT`; `detectDrift` lists PENDING/UNKNOWN/FAILED only. | schema + `detectDrift` |
| A9 | Production has no customers, agreements or subscriptions (checked read-only 2026-10-04). If that is no longer true, the backfills in section 2 must be re-proved on a copy before merging. | `docs/STATUS.md` Batch C row; ask Chris before reading production |
| A10 | `__setStripeClientForTests` exists in `src/lib/stripe.ts`; the real-Postgres test pattern is `tests/*-integration.test.ts` with `CI=true`. | grep |

---

## 1. Decisions (made — do not re-open)

### The billing-end contract (closes R1, R2; it is the "shared billing contract" Batch C was blocked on)

**B2-1. One stored answer per Stripe subscription: "when should Stripe stop billing?"** A new row,
`SubscriptionEndIntent`, keyed by the Stripe subscription id, holds that answer (`mode` + `cancelAt`), a `version`
that goes up every time the answer changes, and what was last confirmed in Stripe (`appliedVersion`,
`appliedMode`, `appliedCancelAt`). Reason: the review showed that separate "extend" and "revert" operations, each
correct alone, can finish in the wrong order and leave billing running after a customer opted out. One answer per
subscription, with a version, makes "newest decision wins" checkable.

**B2-2. The answer is always derived from the agreements, by one pure function, never typed in.**
`deriveSubscriptionEnd` (section 3) is the only place the rules live. Every caller asks it; nobody passes a date.
Reason: a retry or a late worker can then never apply stale data, because it re-derives from today's records.

**B2-3. The answer is saved in the same database transaction as the decision that changes it.** Every place that
changes something the answer depends on (list in WU-B2-3) calls `recomputeSubscriptionEndInTx(tx, subscriptionId)`
before its transaction commits. Reason (R2): a crash after the decision commits can no longer lose the instruction,
because the instruction *is* the committed row.

**B2-4. Stripe is told after commit by one worker per subscription at a time (a lease on the row), and the worker
only marks success if the version it applied is still the newest.** If the version moved while it was talking to
Stripe, it loops and applies the newer answer. A crashed worker's lease expires after
`PROVIDER_OPERATION_LEASE_MS` (120 s); the nightly sweeps pick the row up. Reason (R1): this is the ordering the old
design lacked, without holding a database lock across a network call (forbidden by `AGENTS.md`/Batch R).

**B2-5. Setting an end date is a convergent write: the worker always reads Stripe first and writes only when
Stripe differs.** So an UNKNOWN outcome needs no special recovery: the next read shows whether it landed. Each
write still goes through `ProviderOperation` (key `subscription-end-<subscriptionId>-v<version>`) so the drift
workbench shows it. Older keys for the same subscription become `SUPERSEDED` (new additive enum value) when a newer
version is applied.

**B2-6. Ending a subscription completely stays where it is.** `closeAgreementInTx` keeps its own
`SUBSCRIPTION_CANCEL` operation; the derived answer for a closed agreement is `CLOSED`, which the worker treats as
"nothing to send". Line-price reductions (`subscription-line.ts`) are untouched. An end date that is already in the
past is never sent to Stripe (Stripe refuses it); the closing step cancels instead.

**B2-7. Returning equipment never changes billing by itself.** (C-09, IN-24.) Billing ends only on an *agreed*
ending: the fixed term's end, an early ending, or a month-to-month ending (B2-9). A pickup after that date is
charged by the day (built, PR #165); a pickup before it does not shorten billing (no refund of unused days; owner
question IN-29 records this default). When the last appliance of an agreement comes back and its agreed ending has
passed, the agreement is ended on that agreed date through `closeAgreementInTx`. When equipment comes back and **no**
ending is recorded, the owner gets a HIGH task and a Today item ("Returned, still billing") — the system never
guesses a fee, a notice period or who was at fault. Reason: this keeps every money rule Chris already approved and
adds no new one.

**B2-8. Company-caused late pickup is a waiver recorded against the late-return bill.** (Chris, 2026-10-03, IN-24.)
Only OWNER/ADMIN may record it, with a required note. Waived days default to every charged day; the owner may enter
fewer. The bill keeps its `Late return – [item] – [N] days` lines and gains matching negative
`Waived – our delay – [item] – [N] days` lines (new line kind `LATE_RETURN_WAIVER`, report category RENT) and a
negative tax line, with an audit record. A waiver is refused once the bill has a payment applied (the owner uses the
refund/credit forms instead). Staff completing a pickup cannot choose "our delay"; the owner records it afterwards
from the job page, or chooses it while completing the pickup himself.

### Month-to-month rentals (closes R3, R4 and the mechanism part of IN-21)

**B2-9. A month-to-month rental can be ended online by the customer, at any time, with no fee.** The ending date is
the first billing anniversary on or after (today + the month-to-month notice days). It reuses the existing ending
columns (`terminationRequestedAt`, `terminationEffectiveOn`, `terminationFeeCents = 0`,
`terminationPolicyVersion`), so the nightly `runDueTerminations` ends it and the billing-end answer stops Stripe one
second before that date. OWNER/ADMIN may choose an earlier anniversary (never earlier than the next one) with a
written reason — for example when the customer has already returned everything. Fixed-term early-ending fees are
never copied into month-to-month rentals. Reason (R3): after a fixed term rolls over, the customer previously had no
way to cancel online; Colorado expects an easy online cancel.

**B2-10. Month-to-month terms are versioned; a change reaches a customer only 30 days after their notice was
delivered.** (Chris, 2026-10-03: "month-to-month agreements follow the current terms after a 30-day notice to all
customers".) The month-to-month terms are exactly two values: days of notice to end, and the wording. Prices, late
fees and tax stay as each agreement was signed. Saving those two values in Settings creates a new
`MonthToMonthTermsVersion` and one `TERMS_CHANGE` notice per active month-to-month rental. An agreement's effective
version is the newer of (the version it started on) and (the newest version whose notice to that customer was
delivered at least `monthToMonthChangeNoticeDays` days ago). A customer whose notice was never delivered stays on
the older terms. The notice wording is an owner setting with a starting draft; Chris approves the wording (IN-21)
before customer email is turned on.

**B2-11. The continuous rental is tracked across agreement records.** Two new columns copied by `renewalCreateData`:
`continuityRootId` (the first agreement's id) and `continuousSince` (the first agreement's `firstDeliveredOn`).
Replacement agreements never reset them.

**B2-12. Annual reminders for month-to-month rentals.** Colorado (C.R.S. 6-1-732(4)(b)) asks, for renewals shorter
than twelve months, for a reminder 25–40 days before the renewal that would carry the contract past each continuous
twelve-month period. For every ACTIVE month-to-month rental with no ending requested, the nightly job queues an
`ANNUAL_REMINDER` notice for the next 12-month boundary of `continuousSince` once that boundary is 40 days away. A
boundary already covered by a delivered fixed-term `RENEWAL_REMINDER` for a renewal starting that same Colorado day
gets none. A missed annual reminder never stops billing (counsel to confirm, IN-31); it shows on Today as HIGH.

### Notices (closes R5, R6, R7, D2)

**B2-13. A notice has one of these states:** `PENDING` (waiting for its window or a retry time), `SENDING` (claimed),
`SENT` (delivered with evidence), `UNCERTAIN` (the email service may have accepted it; a person must look),
`MISSED` (its last allowed day passed before delivery; never sent automatically after that), `FAILED` (refused three
times; a person must look), `NOT_NEEDED` (withdrawn). Transitions are only those in section 4.

**B2-14. Evidence is immutable and fenced to the attempt that claimed it.** The recipient address is frozen at the
first claim. Each claim writes a random `claimToken`; a completion only counts if the token still matches. The email
service's message id and acceptance time are stored. The date that counts for the legal window is `evidenceDate`:
the provider's acceptance time for email, the mailing date plus the owner's mail-transit days for mail, the hand-over
date for in-person written copies.

**B2-15. An uncertain email is retried only with the identical request, and only inside the email service's
duplicate-protection time.** Resend keeps idempotency keys for 24 hours and returns the original answer for a
repeated key with the same content. After an UNKNOWN answer the sender retries once, immediately, with the same key
and payload. A claim left `SENDING` by a crashed run is retried the same way if it is less than 23 hours old;
older ones become `UNCERTAIN`. A notice whose renewal was cancelled while it was uncertain keeps its evidence
question open (it is not silently marked `NOT_NEEDED`).

**B2-16. Fair sending.** Each run takes at most 50 notices that are `PENDING` and due (`nextAttemptAt` empty or
past), earliest deadline first. A refusal waits one day; the third refusal makes the notice `FAILED`. A notice is
never sent before its first allowed day or after its last allowed day.

**B2-17. Delivery by hand needs a real channel and evidence.** Allowed channels: `MAIL`, `BUSINESS_MAILBOX` (sent
from the business's own email account), `IN_PERSON_WRITTEN` (a printed copy handed over), and `TEXT_OR_APP` (only
when the customer has opted in to texts). A phone call is **not** a delivery (the statute lists mail, email, or
another easily accessible form the customer authorized). Required: channel, date, the address/number used, and a
note. Who may record it is an owner setting, starting value "Owner only". Counsel confirms the list (IN-31).

**B2-18. A missed renewal reminder never sends a stale promise.** It becomes `MISSED`, the automatic renewal can
never start (existing gate), billing ends on the old date (B2-2 already gives that answer, because extension needs a
delivered reminder), and Today shows two choices: cancel the automatic renewal now, or keep it waiting while the
owner gets a renewal signed by hand. Doing nothing leaves the renewal blocked (owner question IN-30 records this).

---

## 2. Schema changes (additive only) — migration `20261006010000_batch_b2_lifecycle`

```prisma
// B2-5
enum ProviderOperationStatus {
  PENDING
  SUCCEEDED
  FAILED
  UNKNOWN
  DRIFT
  SUPERSEDED   // a newer version of the same subscription end date was applied
}

// B2-1
enum SubscriptionEndMode {
  NO_END   // Stripe keeps billing monthly (month-to-month)
  END_AT   // Stripe stops billing at cancelAt
  CLOSED   // the agreement holding this subscription is ended or cancelled; the close path cancels it
}

model SubscriptionEndIntent {
  stripeSubscriptionId String              @id
  version              Int                 @default(1)
  mode                 SubscriptionEndMode
  cancelAt             DateTime?           // END_AT only; always a whole second
  reason               String              // rule code from deriveSubscriptionEnd, e.g. "TERM_END"
  holderAgreementId    String              // the agreement that held the subscription when derived
  appliedVersion       Int                 @default(0)
  appliedMode          SubscriptionEndMode?
  appliedCancelAt      DateTime?
  appliedAt            DateTime?
  leaseToken           String?
  leaseUntil           DateTime?
  attempts             Int                 @default(0)
  nextAttemptAt        DateTime?
  lastError            String?
  createdAt            DateTime            @default(now())
  updatedAt            DateTime            @updatedAt

  @@index([nextAttemptAt])
  @@index([holderAgreementId])
}

// B2-8
enum InvoiceLineItemKind {
  // … existing values unchanged …
  LATE_RETURN_WAIVER   // negative: "Waived – our delay – [item] – [N] days"
}

model LateReturnWaiver {
  id               String   @id @default(cuid())
  jobId            String   @unique
  invoiceId        String
  waivedDays       Int      // per item, at most that item's charged days
  waivedCents      Int      // positive number: total removed before tax
  waivedTaxCents   Int      // positive number
  note             String
  recordedByUserId String
  createdAt        DateTime @default(now())

  @@index([invoiceId])
}

// B2-10
model MonthToMonthTermsVersion {
  id                String   @id @default(cuid())
  version           Int      @unique
  noticeDays        Int      // days of notice to end a month-to-month rental
  termsText         String   // the wording customers see
  publishedAt       DateTime @default(now())
  publishedByUserId String?  // null for the seeded version 1
}

model RentalAgreement {
  // B2-11
  continuityRootId           String?
  continuousSince            DateTime?
  // B2-10: the month-to-month terms version this agreement started on (null for fixed terms)
  monthToMonthTermsVersion   Int?
  @@index([continuityRootId])
}

// B2-13 … B2-17 (status stays a String; new values listed in section 4)
model CustomerNotice {
  earliestAt        DateTime?  // first moment it may be delivered (null = any time)
  deadlineAt        DateTime?  // last moment it may be delivered (null = no deadline)
  sentToAddress     String?    // frozen at first claim
  providerMessageId String?    @unique
  acceptedAt        DateTime?  // provider's own acceptance time
  evidenceDate      DateTime?  // the date that counts for the legal window
  deliveryChannel   String?    // EMAIL | MAIL | BUSINESS_MAILBOX | IN_PERSON_WRITTEN | TEXT_OR_APP
  deliveryEvidence  Json?      // hand delivery: { sentTo, note, date }
  claimToken        String?
  lastAttemptAt     DateTime?
  nextAttemptAt     DateTime?
  lastError         String?
  resolvedByUserId  String?
  resolvedAt        DateTime?
  resolution        String?    // owner's note when resolving UNCERTAIN / MISSED / FAILED
  @@index([status, nextAttemptAt])
}

model BusinessSettings {
  noticeCertifierRoles         String  @default("OWNER")  // "OWNER" | "OWNER_AND_ADMIN" (B2-17)
  mailNoticeTransitDays        Int     @default(3)        // B2-14
  monthToMonthChangeNoticeDays Int     @default(30)       // B2-10
  termsChangeNoticeText        String?                    // B2-10 wording; starting draft below
  annualReminderText           String?                    // B2-12 wording; starting draft below
}
```

**Migration SQL, in this order** (prove it on a scratch Postgres built from all migrations, as the Batch C spec did):

1. The enum values and new tables/columns above (Prisma-generated).
2. Seed month-to-month terms version 1 from the live settings, only if both values exist:
   ```sql
   INSERT INTO "MonthToMonthTermsVersion" ("id","version","noticeDays","termsText","publishedAt","publishedByUserId")
   SELECT 'mtm-terms-v1', 1, "earlyTerminationNoticeDays", "terminationTermsText", NOW(), NULL
   FROM "BusinessSettings"
   WHERE "id" = 'singleton' AND "earlyTerminationNoticeDays" IS NOT NULL AND "terminationTermsText" IS NOT NULL
   ON CONFLICT DO NOTHING;
   ```
3. Continuity backfill (recursive; roots are agreements with no `renewedFromAgreementId`):
   ```sql
   WITH RECURSIVE chain AS (
     SELECT "id", "id" AS root, "firstDeliveredOn" AS since FROM "RentalAgreement" WHERE "renewedFromAgreementId" IS NULL
     UNION ALL
     SELECT a."id", c.root, c.since FROM "RentalAgreement" a JOIN chain c ON a."renewedFromAgreementId" = c."id"
   )
   UPDATE "RentalAgreement" r SET "continuityRootId" = chain.root, "continuousSince" = chain.since
   FROM chain WHERE r."id" = chain."id" AND r."continuityRootId" IS NULL;
   ```
4. `monthToMonthTermsVersion = 1` for ACTIVE agreements with `"termMonths" IS NULL`, only when version 1 exists.
5. Starting drafts for the two wording settings (only where null). Text, verbatim (placeholders in double braces are
   filled by the composer functions in WU-B2-6/7; counsel reviews both, IN-21/IN-31):
   - `termsChangeNoticeText`: `Starting {{effectiveDate}}, these terms will apply to your month-to-month rental with {{businessName}}: {{terms}} You need at least {{noticeDays}} days' notice to end a month-to-month rental. Fixed-term leases (6 or 12 months) are not affected by this change. You can end your rental at any time from the "My rentals" page of your customer account, or by contacting us at {{businessPhone}} or {{businessEmail}}.`
   - `annualReminderText`: `Your month-to-month rental with {{businessName}} ({{items}}) continues automatically each month at {{monthlyTotal}} a month plus any sales tax. On {{boundaryDate}} it will have been rented continuously for {{years}} year(s). You don't need to do anything to keep it. To end it, use the "My rentals" page of your customer account or contact us at {{businessPhone}} or {{businessEmail}}; your rental then ends on the first billing date at least {{noticeDays}} days later.`

No backfill of `SubscriptionEndIntent`: rows are created on first recompute; WU-B2-3's audit sweep creates any missing
ones for live subscriptions. Old `subscription-term-…` and `subscription-termination-…` operations still PENDING,
FAILED or UNKNOWN are marked SUPERSEDED by the first reconciliation run (WU-B2-3), not by the migration.

Every new table goes into `BACKUP_MODEL_POLICY` (`src/domains/backup/manifest.ts`), the schema-health list
(`scripts/verify-schema-health.ts`), and `docs/DATABASE.md`. Every new settings column appears on its screen (WU-B2-5,
B2-7) with a plain-English explanation and a "restore recommended value" control (AGENTS.md "Owner-configurable").

---

## 3. Shared primitives

### 3.1 `src/domains/billing/subscription-end.ts` (new)

```ts
export type SubscriptionEnd =
  | { mode: "NO_END"; cancelAt: null; reason: SubscriptionEndReason; holderAgreementId: string }
  | { mode: "END_AT"; cancelAt: Date; reason: SubscriptionEndReason; holderAgreementId: string }
  | { mode: "CLOSED"; cancelAt: null; reason: "HOLDER_CLOSED" | "NO_HOLDER"; holderAgreementId: string };

export type SubscriptionEndReason =
  | "TERM_END" | "EARLY_ENDING" | "MONTH_TO_MONTH_ENDING" | "MONTH_TO_MONTH"
  | "RENEWAL_EXTENDS_FIXED" | "RENEWAL_EXTENDS_MONTHLY" | "HOLDER_CLOSED" | "NO_HOLDER";

/** Pure: the rules. Inputs are plain rows read by loadSubscriptionEndFacts. */
export function decideSubscriptionEnd(facts: SubscriptionEndFacts): SubscriptionEnd;

/** Reads the holder agreement (stripeSubscriptionId = id), its SCHEDULED successor, the auto-renew switch and the reminder check. No locks. */
export async function loadSubscriptionEndFacts(
  tx: Prisma.TransactionClient, stripeSubscriptionId: string,
): Promise<SubscriptionEndFacts>;

/** Lock (creating if absent) the intent row, derive, store; bumps version only when the answer changed. Call LAST in a transaction that already holds customer/agreement locks. */
export async function recomputeSubscriptionEndInTx(
  tx: Prisma.TransactionClient, stripeSubscriptionId: string,
): Promise<{ version: number; changed: boolean }>;

/** For callers that know an agreement, not a subscription: recompute for the subscription it (or its renewal source) holds; no-op when none. Returns the subscription ids touched. */
export async function recomputeForAgreementInTx(
  tx: Prisma.TransactionClient, agreementId: string,
): Promise<string[]>;

/** After commit: make Stripe match. Never throws; returns what happened. */
export async function applySubscriptionEnd(stripeSubscriptionId: string): Promise<
  "APPLIED" | "BUSY" | "RETRY" | "PAST_END" | "TAKEN_OVER" | "NO_INTENT"
>;

/** After commit helper: apply every id, ignore results (they are recorded on the row). */
export async function applySubscriptionEnds(ids: readonly string[]): Promise<void>;

/** Nightly: rows where appliedVersion < version and (nextAttemptAt is null or past) and the lease is free; oldest updatedAt first; at most `limit`. */
export async function applyDueSubscriptionEnds(limit?: number): Promise<{ applied: number; waiting: number }>;

/** Nightly audit: for up to `limit` ACTIVE agreements with a subscription, recompute in its own short transaction; a changed answer means a caller forgot to recompute — it is applied and reported as drift kind SUBSCRIPTION_END_STALE. */
export async function auditSubscriptionEnds(limit?: number): Promise<{ checked: number; stale: number }>;

/** Renewal start gate: is the applied state exactly what the renewal needs? */
export async function subscriptionEndCoversRenewal(
  tx: Prisma.TransactionClient,
  stripeSubscriptionId: string,
  renewal: { termMonths: number | null; endDate: Date | null },
): Promise<boolean>;
```

**`decideSubscriptionEnd` rules, applied in this order** (H = the agreement whose `stripeSubscriptionId` is this id):

| # | Condition | Answer |
|---|---|---|
| 1 | No H | `CLOSED`, `NO_HOLDER` |
| 2 | H.status is ENDED or CANCELLED | `CLOSED`, `HOLDER_CLOSED` |
| 3 | H.status is not ACTIVE (should not happen) | throw `Error("Subscription held by a non-active agreement")` — a stop-and-ask if it ever fires |
| 4 | own end = earliest of: fixed-term end (`cancelAtSecondsFor(H)` when `termMonths` and `endDate`), and `terminationEffectiveOn − 1 s` when set. `null` when neither applies. | (used below) |
| 5 | H.terminationRequestedAt is set | own end → `END_AT`, reason `EARLY_ENDING` (fixed) or `MONTH_TO_MONTH_ENDING` (month-to-month) |
| 6 | S = H's renewal with status SCHEDULED exists and S **may extend**: S was made by hand (`createdByAutoRenew = false`), or S is automatic and the switch is ON and H.renewalPreference = `AUTO_RENEW` and H.autoRenewConsentedAt is set and `checkReminderDelivered(… , S.startDate) === "OK"` | S.termMonths and S.endDate → `END_AT` at `cancelAtSecondsFor(S)`, `RENEWAL_EXTENDS_FIXED`; otherwise `NO_END`, `RENEWAL_EXTENDS_MONTHLY` |
| 7 | own end exists | `END_AT`, `TERM_END` |
| 8 | otherwise | `NO_END`, `MONTH_TO_MONTH` |

`cancelAt` is stored as a `Date` on a whole second; compare as seconds. The worker sends `cancel_at: seconds` for
`END_AT` and `cancel_at: ""` (clears it) for `NO_END`, exactly as `syncSubscriptionTerm` does today.

**`applySubscriptionEnd` algorithm** (literal; at most 5 rounds):

1. *Lease transaction.* `SELECT … FROM "SubscriptionEndIntent" WHERE id FOR UPDATE`. No row → `NO_INTENT`.
   `appliedVersion = version` → `APPLIED`. `leaseUntil > now` → `BUSY`. Otherwise set `leaseToken = randomUUID()`,
   `leaseUntil = now + PROVIDER_OPERATION_LEASE_MS`, re-derive with `loadSubscriptionEndFacts` + `decideSubscriptionEnd`;
   if the derived answer differs from the stored one, store it and `version += 1`. Remember `V = version` and the answer.
2. `CLOSED` → *fence transaction* (below) with success; return `APPLIED`.
3. Read Stripe: `stripe.subscriptions.retrieve(id)` inside `runProviderCall`. Failure → *fence* with failure; `RETRY`.
   Status `canceled` → *fence* with success and `appliedMode = CLOSED`; `APPLIED`.
4. `want` = seconds or null. If `want !== null && want <= nowSeconds + 60` → *fence* without applying,
   `lastError = "The end date has passed; ending the rental cancels billing."`, `nextAttemptAt = now + 1 day`; `PAST_END`.
5. If `subscription.cancel_at ?? null === want` → mark the operation for key `subscription-end-<id>-v<V>` SUCCEEDED
   if it exists; *fence* with success.
6. Otherwise claim `ProviderOperation` (kind `SUBSCRIPTION_UPDATE`, subjectType `"StripeSubscription"`, subjectId id,
   key `subscription-end-<id>-v<V>`) in its own transaction; when the existing row is UNKNOWN pass
   `reconcileUnknownAfterProviderEvidence: { expectedAttempts: row.attempts }` (step 3 is that evidence).
   `RetryLater` → release the lease; `BUSY`. Call `stripe.subscriptions.update(id, { cancel_at: want ?? "" },
   { idempotencyKey: await stripeKeyForAttempt(opId, key) })` through `runProviderCall`; `completeProviderOperation`.
7. *Fence transaction:* lock the row; if `leaseToken` ≠ ours → `TAKEN_OVER` (discard). On success: if `version = V`,
   set `appliedVersion = V`, `appliedMode`, `appliedCancelAt`, `appliedAt = now`, `attempts = 0`, `nextAttemptAt = null`,
   `lastError = null`, mark every other `ProviderOperation` with subjectType `"StripeSubscription"`, this subjectId,
   status in (PENDING, FAILED, UNKNOWN) and a different key as `SUPERSEDED`; release the lease; return `APPLIED`.
   If `version ≠ V` release the lease and go to round 1 again. On failure: `attempts += 1`,
   `nextAttemptAt = now + [15 min, 1 h, 6 h, 24 h][min(attempts − 1, 3)]`, `lastError = sanitizeProviderError(…)`,
   release; return `RETRY`.

`recomputeSubscriptionEndInTx` sets `nextAttemptAt = null` whenever it bumps the version (a new decision is tried at
once, not after an old backoff). It uses `INSERT … ON CONFLICT ("stripeSubscriptionId") DO NOTHING` followed by
`SELECT … FOR UPDATE`, the same pattern as `claimProviderOperation`.

**Lock order** (unchanged from `CHANGES-SINCE-DESIGN.md`, extended by one): customer ledger → agreements (id order)
→ … → `SubscriptionEndIntent` row **last**. The worker's lease transaction locks only the intent row and reads
agreements without locks, so it can never deadlock with a decision transaction.

### 3.2 `src/domains/notices/state.ts` (new, pure)

```ts
export type NoticeStatus = "PENDING" | "SENDING" | "SENT" | "UNCERTAIN" | "MISSED" | "FAILED" | "NOT_NEEDED";
export type NoticeKind = "RENEWAL_REMINDER" | "ANNUAL_REMINDER" | "TERMS_CHANGE";
export function noticeWindowState(n: { earliestAt: Date | null; deadlineAt: Date | null }, now: Date): "TOO_EARLY" | "OPEN" | "PAST_DEADLINE";
export function windowForRenewalStart(start: Date): { earliestAt: Date; deadlineAt: Date };  // start − 40 days (Colorado midnight) … end of the Colorado day start − 25 days
export function evidenceDateFor(input: { channel: DeliveryChannel; date: Date; mailTransitDays: number }): Date;  // MAIL adds transit days
export const NOTICE_MAX_REJECTIONS = 3;
export const NOTICE_UNCERTAIN_RETRY_HOURS = 23;
```

---

## 4. Notice transitions (the only allowed ones)

| From | To | When | Who |
|---|---|---|---|
| (new) | PENDING | created with its trigger in one transaction | system |
| PENDING | SENDING | claimed: due, window OPEN, need still exists, `claimToken` written, `sentToAddress` frozen on first claim | sender |
| PENDING | MISSED | window PAST_DEADLINE (checked before claiming) | sender / nightly |
| PENDING | NOT_NEEDED | trigger withdrawn (renewal cancelled, rental ended, switch OFF for renewal reminders) | the withdrawing transaction |
| SENDING | SENT | provider accepted (`providerMessageId`, `acceptedAt`, `evidenceDate`, channel EMAIL); token matches | sender |
| SENDING | PENDING | provider refused (REJECTED) and rejections < 3: `nextAttemptAt = now + 1 day` | sender |
| SENDING | FAILED | third refusal | sender |
| SENDING | UNCERTAIN | UNKNOWN twice in one run, or a stale claim older than 23 h | sender / nightly |
| SENDING | SENDING | stale claim (> 15 min, < 23 h): retried with the same key and frozen payload, new token | nightly |
| PENDING, UNCERTAIN, FAILED, MISSED | SENT | owner records hand delivery (B2-17) or confirms the email went out (with the date from the email service) | per `noticeCertifierRoles` |
| UNCERTAIN, FAILED | PENDING | owner records "it was not sent"; only while the window is not past | OWNER/ADMIN |
| MISSED | NOT_NEEDED | owner cancels the automatic renewal from the notice | OWNER/ADMIN |
| SENT | (none) | terminal; a wrong record is corrected only by an audited owner note (`resolution`), never by changing `evidenceDate` | — |

A `RENEWAL_REMINDER` with no SCHEDULED automatic renewal behind it is `NOT_NEEDED` **only** if it is PENDING; an
UNCERTAIN one stays UNCERTAIN (B2-15).

---

## 5. Work units (in order; one PR per group; each PR stacked on the previous)

**PR 1 — the billing-end contract (WU-B2-1 … B2-3)**

### WU-B2-1 — Migration, backup, health, docs
Section 2 in full. Tests: `tests/batch-b2-migration-integration.test.ts` (real Postgres): version 1 seeded only when
both values exist; continuity backfill gives a three-link chain one root and the root's `firstDeliveredOn`;
re-running the migration's data steps changes nothing; backup export contains the three new tables.

### WU-B2-2 — `subscription-end.ts` (section 3.1)
Files: `src/domains/billing/subscription-end.ts` (new), `tests/subscription-end-rules.test.ts` (new, pure),
`tests/subscription-end-integration.test.ts` (new, real Postgres + fake Stripe whose `update` can be paused).
Pure tests (one per table row): no holder; closed holder; fixed term; fixed term with early ending before the term
end; month-to-month; month-to-month ending; hand renewal fixed; hand renewal monthly; automatic renewal with switch
OFF (→ own end); automatic renewal with consent withdrawn; automatic renewal without delivered reminder; automatic
renewal with reminder delivered out of window; early ending plus waiting automatic renewal (→ early ending wins).
Integration tests (names fixed):
- `sub-end-extend-paused-then-optout-final-state-is-old-end` — pause the worker's Stripe call after it read version 1
  (extend), commit the opt-out (version 2), resume: final Stripe `cancel_at` is the old term end; `appliedVersion` 2.
- `sub-end-old-revert-retried-after-new-renewal-does-not-stop-billing` — renewal A cancelled with Stripe failing; new
  hand renewal B signed; run the sweep: Stripe ends at B's end; A's operation is SUPERSEDED.
- `sub-end-consent-withdrawn-while-cancel-step-fails` — final Stripe date is the old end; no extension survives.
- `sub-end-crash-after-decision-commit-recovered-by-sweep` — commit an opt-out, do not call apply (simulated crash),
  run `applyDueSubscriptionEnds` with a fresh module: exactly one Stripe update, correct date.
- `sub-end-two-workers-one-lease` — two concurrent `applySubscriptionEnd`: one `BUSY`, one Stripe call.
- `sub-end-stale-worker-result-discarded-after-takeover` — expire worker 1's lease mid-call, worker 2 applies; worker 1's
  fence returns `TAKEN_OVER` and changes nothing.
- `sub-end-unknown-resolved-by-read` — Stripe update throws a connection error after applying; next run reads the
  matching `cancel_at` and marks SUCCEEDED with no second update.
- `sub-end-past-end-never-sent` — an ending date in the past returns `PAST_END` and makes no Stripe call.
- `sub-end-renewal-start-moves-holder-no-stripe-call`.

### WU-B2-3 — Move every caller onto the contract; remove the old sync functions
Closes: R1, R2, A1's list.
Each change below: recompute inside the existing transaction (last), then after commit call
`applySubscriptionEnds(ids)`.
1. `auto-renew.ts` `createAutoRenewal`: `recomputeForAgreementInTx(tx, old.id)` after the notice is created; replace the
   post-commit `syncSubscriptionTerm(…,"extend")`.
2. `auto-renew.ts` `extendBillingForDeliveredAutoRenewals`: keep the name and the cron call; body becomes "for each
   SCHEDULED automatic renewal with a future start: short transaction `recomputeForAgreementInTx(tx, renewal.renewedFromAgreementId)`, then apply".
   Remove its early return on switch OFF (the derive already returns no extension when OFF).
3. Notices: wherever a notice becomes SENT (WU-B2-4 sender, WU-B2-5 hand delivery) and its kind is
   `RENEWAL_REMINDER`: `recomputeForAgreementInTx(tx, notice.agreementId)` in that transaction.
4. `agreements/index.ts` `closeAgreementInTx`: after the status update, `recomputeForAgreementInTx(tx, agreementId)`;
   when the closed agreement is a SCHEDULED renewal, also `recomputeForAgreementInTx(tx, agreement.renewedFromAgreementId)`.
   Return the touched ids in `CloseAgreementResult` (new field `subscriptionEndIds: string[]`, replacing
   `revertRenewalId`). `runCloseAgreementContinuation` applies them before its existing cancel step.
5. `term.ts` `requestEarlyTermination`: recompute inside its transaction; replace the post-commit `syncTerminationEnd`.
6. `agreements/index.ts` `signAgreement`: when the signed agreement becomes SCHEDULED (a renewal), recompute for
   `renewedFromAgreementId` in the same transaction; apply after commit.
7. `renewal-start.ts`: `startRenewalIfDue` recomputes (short tx) and applies before its start transaction;
   `startRenewalInTx` replaces the `termSyncKey(…,"extend")` check with `subscriptionEndCoversRenewal(tx, old.stripeSubscriptionId, renewal)`
   (same `BILLING_NOT_READY` failure) and recomputes after moving the subscription pointer.
8. `termination-execution.ts` `executeAgreedTermination`: delete the `syncTerminationEnd` call (the answer was applied
   when the ending was requested; `PAST_END` is expected here and harmless).
9. `setAutoRenewEnabled` (`src/domains/settings/auto-renew-switch.ts`, called from `src/app/desk/settings/actions.ts`):
   after its transaction commits, when turned ON call `extendBillingForDeliveredAutoRenewals()`; when OFF call
   `cancelWithdrawnAutoRenewals(userId)` if the action does not already (it recomputes through item 4).
10. `checkout.ts`: in the transaction that stores `stripeSubscriptionId` after creation, `recomputeSubscriptionEndInTx`;
    apply after commit (it reads Stripe, sees the matching `cancel_at`, marks applied — no update call).
11. `reconciliation-base.ts` `reconcileSubscriptionUpdate`: a `subscription-end-<id>-v<n>` key → `applySubscriptionEnd(id)`;
    an old `subscription-term-…` or `subscription-termination-…` key → recompute for that agreement, apply, then mark
    the old operation SUPERSEDED. Line-reduce keys unchanged. `finishPendingProviderOperations` then calls
    `applyDueSubscriptionEnds(50)` and `auditSubscriptionEnds(50)`.
12. `detectDrift`: add kind `SUBSCRIPTION_END_PENDING` (intent unapplied for more than 24 hours, or `PAST_END`, with
    `lastError`) and `SUBSCRIPTION_END_STALE` (from the audit). Today gets one bounded category for the first
    (`SUBSCRIPTION_END_PENDING`, HIGH, owner/admin, ≤ 50, true total, oldest first — the R17 pattern).
13. Delete `syncSubscriptionTerm`, `syncTerminationEnd`, `desiredSubscriptionTerm`, `desiredTerminationEnd`,
    `extendConfirmed`, `terminationEndConfirmed` from `subscription-term.ts`. Keep `cancelAtSecondsFor`,
    `cancelAtSecondsForAgreement`, `subscriptionStartSecondsFor`, `stripeKeyForAttempt`, `parseTermSyncKey`,
    `parseTerminationSyncKey`, `termSyncKey`, `terminationSyncKey` (still needed to recognise old keys).
Tests: every existing test that imports a deleted function is moved to the new contract in the same commit
(`grep -rln "syncSubscriptionTerm\|syncTerminationEnd\|desiredSubscriptionTerm\|extendConfirmed" tests`);
`agreements-auto-renew-and-termination-integration`, `agreements-scheduled-renewal-integration` and the renewal-start
tests stay green with the same expectations. New: `sub-end-old-format-ops-superseded`, `sub-end-audit-finds-missed-recompute`.
Done when: `grep -rn "syncSubscriptionTerm\|syncTerminationEnd" src` returns nothing.

**PR 2 — notices (WU-B2-4, B2-5)**

### WU-B2-4 — Notice sender rewrite (B2-13 … B2-16, B2-18)
Files: `src/lib/email.ts` (return `providerMessageId: data.id` on success; new
`getEmailAcceptedAt(id: string): Promise<Date | null>` using Resend `emails.get`, `null` on any error or in
non-production), `src/lib/customer-email.ts` (pass the new field through), `src/domains/notices/state.ts` (new),
`src/domains/notices/index.ts` (rewrite `sendPendingNotices`; `createNoticeInTx` takes `earliestAt`/`deadlineAt`;
`checkReminderDelivered` reads `evidenceDate ?? sentAt`), `src/domains/agreements/auto-renew.ts` (pass the window when
creating the reminder: `windowForRenewalStart(created.startDate)`), Desk → Notices page and actions (show states,
deadlines and the owner actions in section 4), `src/domains/exceptions/*` (categories `NOTICE_MISSED`,
`NOTICE_UNCERTAIN`, `NOTICE_FAILED`, all HIGH, owner/admin, bounded like R17; retire the old `NOTICE_WAITING`
"deadline missed" text for these states).
`sendPendingNotices(now)` literal flow, per due notice (max 50, `ORDER BY "deadlineAt" ASC NULLS LAST, "createdAt" ASC`):
window PAST_DEADLINE → MISSED (no send); TOO_EARLY → skip; need check (existing `noticeNeed`, extended for the new
kinds) GONE → NOT_NEEDED; PAUSED → skip; claim with a token; send through `sendCustomerEmail` with key
`customer-notice-<id>` to `sentToAddress`; on `UNKNOWN` retry once immediately with the identical input; map the
outcome per section 4; on SENT fetch `getEmailAcceptedAt` (fallback: the local time right after the response) and set
`evidenceDate` to it. Before the loop, sweep stale SENDING claims per B2-15.
Tests (`tests/notices-state-integration.test.ts`, real Postgres, fake email):
`notice-email-on-at-24-days-goes-missed-not-sent`, `notice-email-on-at-10-days-goes-missed-not-sent`,
`notice-email-on-after-renewal-start-goes-missed`, `notice-accepted-then-db-failure-recovered-same-key-no-second-email`,
`notice-lost-response-retried-once-same-key`, `notice-stale-claim-under-23h-retried-over-23h-uncertain`,
`notice-recipient-change-after-claim-uses-frozen-address`, `notice-cancelled-while-uncertain-stays-uncertain`,
`notice-stale-worker-completion-ignored-after-takeover`, `notice-201-with-200-failing-last-one-attempted-within-3-runs`,
`notice-third-rejection-failed`, `notice-evidence-date-is-provider-acceptance-time`; plus pure tests for
`noticeWindowState` at 41/40/25/24 Colorado days across the March and November daylight-saving changes.

### WU-B2-5 — Hand delivery evidence and owner resolutions (B2-17, B2-18)
Files: `src/domains/notices/index.ts` — replace `markNoticeDeliveredByHand` with
```ts
export async function recordNoticeDelivery(userId: string, noticeId: string, input: {
  channel: "MAIL" | "BUSINESS_MAILBOX" | "IN_PERSON_WRITTEN" | "TEXT_OR_APP";
  date: string;          // YYYY-MM-DD, Colorado; not in the future
  sentTo: string;        // address, email or number used (2–200 chars)
  note: string;          // 2–500 chars
}): Promise<void>;
export async function confirmEmailOutcome(userId: string, noticeId: string, input:
  { sent: true; acceptedOn: string /* YYYY-MM-DD from the email service */ } | { sent: false }): Promise<void>;
export async function resolveMissedRenewalReminder(userId: string, noticeId: string,
  choice: "CANCEL_AUTOMATIC_RENEWAL" | "KEEP_WAITING", note: string): Promise<void>;
```
Rules: actor re-checked inside the transaction with `assertActiveTeamActor` against `noticeCertifierRoles`;
`TEXT_OR_APP` refused unless `Customer.smsOptInAt` is set; `evidenceDate = evidenceDateFor(…)`; an evidence date
outside the notice window is saved as SENT but the renewal gate still refuses it (out of window) — the screen says so
before saving; `CANCEL_AUTOMATIC_RENEWAL` calls `closeAgreementInTx(…, "CANCELLED")` on the renewal in the same
transaction (which withdraws and recomputes). Settings → Ending and renewing rentals gains `noticeCertifierRoles`
(OWNER only can change it) and `mailNoticeTransitDays` (0–14), each explained on screen with "Restore recommended
value". Desk → Notices explains, in one sentence, why a phone call is not a delivery.
Tests: `tests/notices-hand-delivery-integration.test.ts`: admin refused when setting is OWNER; admin allowed when
OWNER_AND_ADMIN; text refused without opt-in; mail date + 3 transit days is the evidence date; future date refused;
missed → cancel renewal closes it, withdraws nothing else, recomputes the billing end (old end restored).

**PR 3 — month-to-month (WU-B2-6 … B2-8)**

### WU-B2-6 — Ending a month-to-month rental (B2-9, B2-11)
Files: `src/domains/agreements/month-to-month.ts` (new), `src/domains/agreements/renewal-data.ts` (copy
`continuityRootId`, `continuousSince`; set `monthToMonthTermsVersion` to the newest version when `termMonths` is
null), `completeJob` in `src/domains/jobs/completion.ts` where it sets `firstDeliveredOn` (the
`updateMany … where firstDeliveredOn: null` step: in the same update set `continuityRootId = agreement id` and
`continuousSince = serviceDate` for an agreement with no `renewedFromAgreementId` and no `continuityRootId`), `signAgreement` (a new month-to-month agreement starts on the newest version),
`src/app/account/rentals/*` (an "End my rental" section for ACTIVE month-to-month agreements: shows the quote, one
confirm button, then the confirmation), the desk agreement page (owner/admin form with the optional earlier
anniversary and reason).
```ts
export type MonthToMonthTerms = { version: number; noticeDays: number; termsText: string };
export async function effectiveMonthToMonthTerms(tx: Prisma.TransactionClient, agreementId: string, now: Date): Promise<MonthToMonthTerms | null>;
export type MonthToMonthEndQuote = { requestedOn: Date; effectiveOn: Date; lastBilledDay: Date; noticeDays: number; termsVersion: number; feeCents: 0 };
export function quoteMonthToMonthEnd(input: { nextBillingDate: Date; terms: MonthToMonthTerms }, requestedOn: Date): MonthToMonthEndQuote;
export async function getMonthToMonthEndQuote(agreementId: string, requestedOn?: Date): Promise<MonthToMonthEndQuote | null>;
export async function requestMonthToMonthEnd(actor: TermActor, agreementId: string, quote: MonthToMonthEndQuote,
  options?: { earlierEffectiveOn?: Date; reason?: string; now?: Date }): Promise<void>;
```
Quote: the first `billingPeriodFor(nextBillingDate, k).start` on or after `addBusinessDays(requestedOn, noticeDays)`.
`lastBilledDay` = the day before `effectiveOn`. Request: same structure as `requestEarlyTermination` (lock for actor,
ACTIVE, `termMonths` null, not already requested, a fresh quote must equal the shown one except its timestamp), writes
the four ending columns with fee 0 and `terminationPolicyVersion = "mtm-v<version>"`, a `ConsentRecord`
(`kind: "rental_end_request"`, details: quote, terms version, actor kind), an audit row, and recomputes the billing
end in the same transaction. `earlierEffectiveOn`: OWNER/ADMIN only, must be a billing anniversary between the next
one and the quoted date, `reason` 5–500 chars. Billing not started (`nextBillingDate` null) → the customer is told to
contact the business; the owner uses the existing cancel path. No equipment status changes; the customer is told to
expect a pickup visit to be arranged.
Tests (`tests/month-to-month-end-integration.test.ts`): fixed 12-month rolls to monthly through the real nightly start,
then the customer ends it from the portal action: ending columns set, consent recorded, Stripe `cancel_at` one second
before the effective date, nightly termination ends it on that date with no fee invoice;
`mtm-end-racing-rollover` (request and renewal start concurrently: one ordering wins, final state consistent);
`mtm-end-owner-earlier-anniversary-needs-reason`; `mtm-end-customer-cannot-end-another-customers-rental`;
`mtm-end-not-available-for-fixed-term` (that path stays the early-ending quote); DST: request on 2026-03-07 with 30
days' notice.

### WU-B2-7 — Month-to-month terms versions and the change notice (B2-10, IN-21 mechanism)
Files: `src/domains/agreements/month-to-month.ts` (`publishMonthToMonthTermsInTx`), `src/domains/settings/terms-policy.ts`
(save path: when notice days or wording changed, publish version N+1 and create notices), `src/domains/notices/terms-change.ts`
(new, pure `composeTermsChangeNotice` filling the placeholders), settings screen (show the current version, when each
customer moves to it, the notice wording field with its starting draft and "Restore recommended wording",
`monthToMonthChangeNoticeDays` 30–90).
Rules: notices are created for ACTIVE month-to-month agreements only, dedupe `terms-change-v<version>-<agreementId>`,
no window (`earliestAt`/`deadlineAt` null); a later version withdraws (`NOT_NEEDED`) the earlier PENDING change
notices for the same agreement. Fixed-term agreements are never touched.
Tests: `mtm-terms-change-creates-one-notice-per-monthly-rental-none-for-fixed`; `mtm-terms-apply-only-30-days-after-delivery`;
`mtm-terms-undelivered-customer-stays-on-old-version`; `mtm-terms-new-rental-starts-on-newest-version`.

### WU-B2-8 — Annual reminders (B2-12)
Files: `src/domains/notices/annual-reminder.ts` (new: pure `nextAnnualBoundary(continuousSince, now)`,
`composeAnnualReminder`, and `queueAnnualReminders(now)`), `src/app/api/cron/start-renewals/route.ts` (call it after
`runAutoRenewals`).
Rules: boundary k = `billingPeriodFor(continuousSince, 12k).start` for the smallest k ≥ 1 whose boundary is after
now; queue when `businessDaysBetween(now, boundary) ≤ 40`; if it is already fewer than 25 days, create it as MISSED at
once (never sent) so the owner sees it; window = `windowForRenewalStart(boundary)`;
dedupe `annual-reminder-<continuityRootId>-<k>`; skip when a SENT `RENEWAL_REMINDER` exists for a renewal of this
continuity whose start's Colorado date equals the boundary's.
Tests (named in the review): `annual-six-month-to-monthly-through-month-13`, `annual-twelve-month-to-monthly-months-25-and-37`
(month 13 covered by the fixed-term reminder), `annual-monthly-from-the-outset`, `annual-replacement-agreement-does-not-reset`,
`annual-missed-is-high-on-today-and-billing-continues`.

**PR 4 — pickup billing end (WU-B2-9, B2-10)**

### WU-B2-9 — Agreed-end fix, waiver, closing after full return (B2-7, B2-8; C-09)
Files: `src/domains/billing/pickup-billing-events.ts` (`agreedEndFor(agreement)` = earliest of `endDate` and
`terminationEffectiveOn − 1 s`; `recordLateReturnOnRemoval` uses it), `src/domains/billing/late-return-waiver.ts` (new),
`src/domains/billing/categories.ts` (`LATE_RETURN_WAIVER: "RENT"`), `src/domains/jobs/completion.ts` (REMOVAL branch:
after custody closes, call `closeIfFullyReturnedInTx`; run the close continuation after commit), job completion screen
and job page (owner/admin: "Who caused the delay?" with "Customer (default)" / "Us — waive the late days", note,
optional fewer days), `src/domains/agreements/returns.ts` (new), nightly `closeFullyReturnedAgreements` in the
start-renewals cron, exceptions category `RETURNED_STILL_BILLING` (HIGH, owner/admin, bounded).
```ts
export async function recordLateReturnWaiverInTx(tx: Prisma.TransactionClient, actor: { userId: string },
  input: { jobId: string; waivedDays: number | null; note: string }): Promise<{ waiverId: string; waivedCents: number; waivedTaxCents: number }>;
export async function recordLateReturnWaiver(userId: string, jobId: string,
  input: { waivedDays: number | null; note: string }): Promise<void>;
export function lateReturnWaiverCents(charge: { days: number; amountCents: number }, waivedDays: number): number;
  // waivedDays >= charge.days → charge.amountCents exactly; else round half up (amountCents * waivedDays / days)
export async function closeIfFullyReturnedInTx(tx: Prisma.TransactionClient, userId: string | null,
  input: { agreementId: string; jobId: string; pickupDate: Date }): Promise<
  { outcome: "CLOSED"; close: CloseAgreementResult } | { outcome: "WAITS_FOR_AGREED_END" | "NO_ENDING_RECORDED" | "RENEWAL_WAITING" | "NOT_FULLY_RETURNED" }>;
export async function closeFullyReturnedAgreements(now?: Date): Promise<{ closed: number }>;
```
Waiver rules: actor OWNER/ADMIN (`assertActiveTeamActor` inside the transaction); note 5–500 chars; the job's
late-return invoice is found through the `billing.late_return_invoiced` audit row for that job (its `entityId`); lock
order customer ledger → invoice (`SELECT … FOR UPDATE`); refuse when the invoice status is not OPEN or DELINQUENT or
any successful payment allocation exists; per item waive `min(waivedDays ?? item.days, item.days)` days; full waiver
negates each tax line exactly, partial waiver computes tax on the waived amounts with `sumTax` and negates it; update
subtotal/tax/amount due; amount due 0 → status PAID; one `LateReturnWaiver` row; audit `billing.late_return_waived`.
A second waiver for the same job is refused (unique `jobId`).
Close rules: "fully returned" = no open `ApplianceAssignment` on the agreement's lines whose appliance has an open
`ApplianceCustodyEpisode`. Agreed end ≤ end of the pickup's Colorado day → `closeAgreementInTx(tx, userId, id, "ENDED",
{ endedOn: agreedEnd })`; agreed end later → `WAITS_FOR_AGREED_END` (the nightly sweep closes it when the date passes;
agreements with an early ending are already closed by `runDueTerminations`); none → a HIGH task
(`createTaskInTx`, sourceKey `job:<jobId>:returned-no-ending`, note "Everything was picked up but no ending is
recorded, so billing continues. Record the ending (month-to-month ending or early-ending quote)."); a SCHEDULED renewal
→ HIGH task `job:<jobId>:returned-renewal-waiting` ("cancel the renewal or bring the equipment back"). Never closes
an agreement that is not ACTIVE.
Tests (`tests/pickup-billing-end-integration.test.ts`, real Postgres): `late-by-company-waives-all-days-invoice-zero-paid`,
`late-by-company-partial-days`, `late-by-customer-bills-daily-unchanged`, `waiver-refused-for-staff`,
`waiver-refused-after-payment`, `waiver-twice-refused`, `early-ending-pickup-after-effective-date-charged-from-effective-date`
(the A6 fix), `full-return-after-term-end-closes-agreement-on-term-end`, `full-return-before-agreed-end-waits-and-nightly-closes`,
`full-return-month-to-month-without-ending-makes-one-task`, `partial-return-leaves-agreement-open`,
`removal-completion-and-fee-invoice-race-both-finish` (existing lock-order case still green), DST: pickup on
2026-11-01 for an agreement ending 2026-10-31.

### WU-B2-10 — Docs and PR
`docs/BUSINESS-RULES.md` (the billing-end answer, month-to-month ending, terms versions, annual reminders, notice
states and evidence, waiver, closing after return), `docs/DATABASE.md`, `docs/ARCHITECTURE.md` (nightly passes and
their order), `docs/OWNER-GUIDE.md` (Desk → Notices, ending a month-to-month rental, recording "our delay"),
`docs/GO-LIVE-CHECKLIST.md` (lines in section 7 below), `docs/OWNER-INPUTS.md` (IN-21 mechanism built; IN-29, IN-30,
IN-31), `docs/designs/CHANGES-SINCE-DESIGN.md` (what D/E/F must now assume, section 8), `docs/DECISIONS.md` (one
dated entry), `docs/STATUS.md` (B and C marked complete only when every item above is merged with evidence; the
review findings R1–R7, D1, D2 each get a disposition line pointing at its tests).

---

## 6. Stop-and-ask points

1. Any section 0 row is false.
2. `decideSubscriptionEnd` rule 3 fires in a test or in data (a subscription held by a non-active agreement).
3. Production has customers or subscriptions (A9) — the backfills must be re-proved on a copy, and Chris told.
4. A test can only pass by changing a money amount, a fee, a status rule or who may do what.
5. Any wording that would go to customers is changed from the starting drafts in section 2 (owner/counsel decides).
6. A Stripe call outside `ProviderOperation`, or any call while a database row lock is held.
7. Resend's documented idempotency behaviour (24-hour retention, same-payload replay) is different from what B2-15
   assumes when you check the current docs — stop and report; do not invent another recovery rule.

## 7. Go-live lines to add (verbatim)

- `[ ] | Batch B2 merged (billing end dates, notices, month-to-month endings, pickup waiver) | Agent | Built in code | docs/STATUS.md shows B2 merged with CI evidence`
- `[ ] | Attorney reads: renewal reminder, annual reminder, month-to-month change notice wording, and the list of hand-delivery channels (IN-21, IN-31) | Owner | Starting drafts | Approval recorded in docs/OWNER-INPUTS.md`
- `[ ] | "Automatic renewals" may be turned ON only after the two lines above are done | Owner | Off | Desk → Settings → Ending and renewing rentals`

## 8. What later batches must assume (copy into `CHANGES-SINCE-DESIGN.md` when B2 merges)

Billing end dates are only changed through `recomputeSubscriptionEndInTx` + `applySubscriptionEnd`; customer
screens show `terminationEffectiveOn` for both fixed and month-to-month endings; notices have the states in section 4
and `evidenceDate` is the legal date; `CustomerNotice` stays the record of what a customer is owed (Batch E's message
ledger records transport, it does not replace notices); `LATE_RETURN_WAIVER` lines are negative RENT; continuity
columns identify one continuous rental across agreements.

## 9. Acceptance mapping

| Requirement | Evidence |
|---|---|
| R1 newest intent wins across competing/failed/ambiguous operations | WU-B2-2 integration tests (first three, plus takeover and unknown) |
| R2 decision and provider intent saved together; crash recovered | `sub-end-crash-after-decision-commit-recovered-by-sweep` |
| R3 customer can cancel online after rollover | WU-B2-6 integration flow; browser check of My rentals (extend `e2e/accessibility-authenticated.spec.ts` with the section) |
| R4 recurring reminders follow the continuous rental | WU-B2-8 tests |
| R5 no stale promises; missed is visible and actionable | `notice-email-on-at-*` tests; WU-B2-5 missed resolution test |
| R6 uncertain delivery, evidence, fencing | WU-B2-4 tests |
| R7 fairness | `notice-201-with-200-failing-…` |
| D1 approved design exists | this document, approved in `docs/designs/README.md` |
| D2 evidence rule | WU-B2-5 tests; counsel line in GO-LIVE |
| C-09 / IN-24 company-fault waiver and billing stop at return | WU-B2-9 tests |

## Amendments

(Dated entries only. Never edit a decision silently.)
