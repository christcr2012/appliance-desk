# Package 4 Audit — Growth, Marketing & Retention Signals

**Audit date:** 2026-10-01  
**Repository:** `christcr2012/appliance-desk`  
**Audited branch:** `main`  
**Audited commit:** `851f31931f9b7cb3a300d4eaa580e78cb16d7dae`  
**Scope authority:** `docs/AUDIT_ROADMAP.md` Package 4  
**Status:** Audit complete; remediation not yet implemented by this report.

---

## Executive summary

Package 4 covers the system's growth signals, launch-interest workflow, lead scoring and prioritization, churn/win-back logic, review/referral candidate selection, utilization signals, and desk-wide search.

The implementation already has several strong foundations. Growth rules are deliberately simple and explainable rather than opaque scoring. The Growth page itself is OWNER/ADMIN-only. Public launch signups are validated, normalized, rate-limited on a best-effort basis, deduplicated by normalized email, and preserve exact consent text/version. Launch emails are production-gated, use a durable subscriber-step claim, provider idempotency keys, a unique delivery row per subscriber/step, and a suppression recheck before sending. Global search authenticates before querying, returns intentionally narrow DTOs, caps each category, and short-circuits blank searches.

The main risks are correctness and recoverability at the edges of those good foundations:

- STAFF can use global search to receive lead names, emails and statuses even though lead pages and lead task linkage are OWNER/ADMIN-only;
- launch signup proves that a browser checked a consent box, but not that the entered mailbox belongs to that person, so an arbitrary third-party address can be subscribed to an automated marketing sequence;
- a launch send failure, process crash, or uncertain provider outcome can strand a subscriber in `deliveryBlocked=true` indefinitely, while the system stores too little provider evidence to reconcile and resume safely;
- win-back detection uses `Lead.updatedAt`, but adding a real contact note does not update that field, so a recently-contacted lead can still be labeled stale;
- utilization recommendations are based on lifetime assignment percentage rather than current or rolling demand, so “consider buying more” can be driven by old demand rather than today's fleet state;
- manually-created leads are scored with placeholder/default commercial inputs and currently have no supported path to fill those scoring inputs and recompute the score;
- several lower-severity date, candidate-deduplication, and search-relevance/scale issues can distort business decisions as data volume grows.

### Overall assessment

**HIGH RISK until remediation.**

No Package 4 issue was assigned Critical severity. The confirmed problems can expose lead PII to an over-broad role, cause false growth recommendations, or strand marketing automation, but the reviewed code does not show unrestricted anonymous access to owner data or an immediately catastrophic growth-domain failure.

| Severity | Findings |
| --- | ---: |
| Critical | 0 |
| High | 6 |
| Medium | 6 |
| **Total** | **12** |

---

# Audit scope

The audit followed Package 4 in `docs/AUDIT_ROADMAP.md` and reviewed:

- lead scoring and high-value classification;
- manual vs public lead creation and score persistence;
- win-back/stale-lead selection;
- churn-risk inputs and fixed-term date calculation;
- review/referral candidate selection;
- price-review timing;
- fleet shortage/underutilization signals;
- launch-interest signup validation and consent evidence;
- launch-email scheduling, claiming, deduplication, suppression and failure behavior;
- owner launch controls and recoverability;
- global search authorization, result shape, relevance and scale behavior;
- tests proving or failing to prove those behaviors.

Primary code reviewed included:

```text
src/domains/growth/index.ts
src/domains/growth/churn.ts
src/domains/growth/signals.ts
src/domains/launch/index.ts
src/domains/launch/schema.ts
src/domains/launch/messages.ts
src/domains/search/index.ts
src/domains/leads/index.ts
src/domains/leads/scoring.ts
src/domains/leads/schema.ts
src/domains/inventory/analytics.ts
src/app/desk/growth/page.tsx
src/app/desk/launch/page.tsx
src/app/desk/launch/actions.ts
src/app/desk/search/page.tsx
src/app/desk/leads/actions.ts
src/app/desk/leads/[id]/page.tsx
src/app/(public)/launch/actions.ts
src/app/api/cron/launch-emails/route.ts
src/lib/email.ts
src/lib/rate-limit.ts
prisma/schema.prisma
tests/growth.test.ts
tests/growth-signals.test.ts
tests/growth-churn.test.ts
tests/search.test.ts
tests/lead-scoring.test.ts
tests/launch-actions.test.ts
tests/launch-integration.test.ts
e2e/launch.spec.ts
```

---

# Critical findings

## No confirmed Critical findings

The audit did not identify a Package 4 issue that currently warrants Critical severity.

The lack of a Critical rating should not be interpreted as launch readiness. The High findings below include a real role-scoping leak in search, unverified marketing-list ownership, unrecoverable launch-delivery states, and growth signals that can confidently recommend the wrong action from stale or incomplete data.

---

# High findings

## H1 — Global search exposes OWNER/ADMIN-only lead information to STAFF

**Severity:** High  
**Primary files:**

```text
src/domains/search/index.ts
src/app/desk/search/page.tsx
src/app/desk/leads/[id]/page.tsx
src/domains/tasks/index.ts
tests/search.test.ts
```

### Problem

`searchAll()` authorizes `OWNER`, `ADMIN`, and `STAFF`, then searches Leads by contact name, email, and company name and returns each matched lead's `contactName`, `email`, `status`, and ID.

That is inconsistent with the rest of the current authorization model:

- `/desk/leads/[id]` explicitly requires OWNER/ADMIN;
- lead server actions require OWNER/ADMIN;
- Package 3's task code intentionally prevents STAFF from linking tasks to leads;
- task workspace selection intentionally suppresses lead relations for STAFF.

Therefore STAFF cannot open/manage a lead through the normal lead workflow, but global search can still disclose lead PII and pipeline status to that role.

### Why this matters

Search is itself a data-access surface. Hiding the destination page does not undo the disclosure in the search response.

### Required remediation

Make search categories role-aware. OWNER/ADMIN may search customers, appliances and leads. STAFF should search only operational record categories currently allowed by policy; do not query the Lead table at all for STAFF.

### Required tests

- STAFF search never calls `prisma.lead.findMany`.
- STAFF results contain no lead IDs, names, emails or statuses.
- OWNER/ADMIN retain lead search.
- Unauthorized callers still fail before all database reads.

---

## H2 — Launch signup does not prove control of the email address before automated marketing begins

**Severity:** High  
**Primary files:**

```text
src/app/(public)/launch/actions.ts
src/domains/launch/schema.ts
src/domains/launch/index.ts
src/lib/rate-limit.ts
```

### Problem

The public launch form validates email syntax, a checked consent box, honeypot state, and a best-effort per-IP rate limit. `joinLaunchList()` then stores the address as subscribed and the daily cron can send the three-message marketing sequence.

Nothing proves the submitting browser controls the mailbox. A user or bot can enter another person's valid email address, check consent, and cause automated marketing to be sent to that third party.

The stored consent text/version proves what the form said, but not mailbox ownership.

### Required remediation

Use confirmed opt-in:

1. public signup creates a pending-confirmation subscriber;
2. generate a single-use confirmation token;
3. send a confirmation message;
4. only confirmed addresses become marketing-sequence eligible;
5. preserve original form consent and confirmation timestamp separately;
6. never clear an existing unsubscribe merely because the public form was resubmitted.

### Required tests

- unconfirmed addresses never enter launch sequence eligibility;
- confirmation is idempotent/single-use;
- repeated signup does not reactivate an unsubscribe;
- concurrent confirmations cannot duplicate the welcome send.

---

## H3 — Launch delivery failures and crash states can block a subscriber indefinitely with no safe recovery workflow

**Severity:** High  
**Primary files:**

```text
src/domains/launch/index.ts
src/app/desk/launch/page.tsx
src/app/desk/launch/actions.ts
src/lib/email.ts
prisma/schema.prisma
tests/launch-integration.test.ts
```

### Problem

Before the network call, `sendLaunchSequence()` compare-and-sets `deliveryBlocked=true`, which is a good concurrent-send claim. But several paths can leave that flag true indefinitely:

1. `sendEmail()` returns `{ sent: false }` — the delivery becomes `FAILED`, but the subscriber stays blocked.
2. A process dies after the claim but before `LaunchDelivery` creation — blocked with no attempt row.
3. A process dies after provider acceptance but before the local `SENT` transaction — blocked with a `SENDING` row.

The owner desk recognizes blocked subscribers and tells the owner to check Resend, but the only supported subscriber action is **Stop emails**. There is no safe “resolved as accepted,” “confirmed unsent / retry,” or “resume” workflow.

The integration test explicitly proves a provider failure leaves `deliveryBlocked=true` and subsequent cron runs do not retry.

`sendEmail()` also discards the accepted provider message ID and collapses provider errors/transport uncertainty into `{ sent: false }`, so the local `LaunchDelivery` record lacks deterministic reconciliation evidence.

### Required remediation

Add recoverable delivery states and provider evidence, ideally through the broader O26 durable communication-ledger work. Persist provider/message ID, logical idempotency key, attempt timestamps, safe error classification and status such as `SENT_ACCEPTED`, `FAILED_RETRYABLE`, and `UNCERTAIN_REVIEW`.

Add OWNER/ADMIN-only audited reconciliation actions: mark accepted, retry confirmed-unsent step, or suppress. Use compare-and-set against the exact current step/attempt.

### Required tests

Cover crash-after-claim, crash-after-attempt-row, definitive failure and approved retry, provider acceptance followed by local crash, concurrent recovery, and unsubscribe-vs-recovery.

---

## H4 — Win-back detection can label a recently-contacted lead as stale because notes do not update `Lead.updatedAt`

**Severity:** High  
**Primary files:**

```text
src/domains/growth/index.ts
src/domains/growth/signals.ts
src/domains/leads/index.ts
src/app/desk/leads/actions.ts
```

### Problem

`getWinBackLeads()` uses `Lead.updatedAt` as the activity timestamp. `addLeadNote()` inserts a `LeadNote` row without updating the parent Lead.

A lead whose row was last edited 20 days ago but who was called and had a note recorded today can still be labeled “No update in 20 days.”

### Required remediation

Define a canonical lead `lastActivityAt`/`lastContactAt` fact, either persisted transactionally or computed from the relevant activity sources. Document exactly which events count.

### Required tests

A fresh lead note/contact action must reset win-back staleness; old LOST leads must still become eligible after the intended revisit window; converted leads must never appear.

---

## H5 — Fleet shortage/underutilized recommendations use lifetime utilization, not current or rolling demand

**Severity:** High  
**Primary files:**

```text
src/domains/growth/index.ts
src/domains/growth/signals.ts
src/domains/inventory/analytics.ts
src/app/desk/growth/page.tsx
```

### Problem

The Growth page describes a type as “running near-fully-rented,” but `getUtilizationFlags()` uses `computeUtilizationFraction()` from each unit's `createdAt` through today across all assignment history, then averages those lifetime fractions.

That is lifetime utilization, not current or bounded-recent demand. A type that was fully rented for a year and has sat idle recently can still look like a shortage; a newly acquired type can look underutilized before demand has had a fair window.

### Required remediation

Keep lifetime utilization for analytics, but use a rolling/current demand metric for growth guidance. Combine recent rented-days with current rentable/Rented/Reserved/Available counts and display the evidence behind the recommendation.

### Required tests

Historically busy/recently idle must not flag current shortage; historically idle/recently full can flag only with enough bounded recent evidence; newly-added units must not trigger misleading immediate underutilization.

---

## H6 — Manually-created leads are scored from placeholder commercial inputs and have no supported score-recomputation path

**Severity:** High  
**Primary files:**

```text
src/domains/leads/index.ts
src/domains/leads/scoring.ts
src/app/desk/leads/actions.ts
src/app/desk/leads/[id]/page.tsx
```

### Problem

Public leads are scored from real desired term, quantity, business and property-manager fields. Manual phone/walk-in leads call `scoreLead()` with `desiredTerm: null` and `quantity: 1`, even if the real opportunity later proves larger.

The current lead actions allow status changes, notes, conversion and adding a missing email, but there is no supported general qualification edit that fills desired term/quantity/requested appliances and recomputes `score`, `scoreReasons`, and `isHighValue`. Repository search shows `scoreLead()` is only called at public and manual creation.

### Required remediation

Add an OWNER/ADMIN lead qualification edit workflow. Validate score-bearing fields, update them transactionally, recompute via canonical `scoreLead()`, audit old/new qualification state, and add stale-edit protection.

### Required tests

A manual lead can later be fully qualified and become high-value; score/reasons update atomically; public/manual leads use the same scoring function once inputs are known.

---

# Medium findings

## M1 — “Good review/referral candidate” can include a customer with recent failed payments or active churn signals

**Severity:** Medium  
**Primary files:** `src/domains/growth/index.ts`, `src/domains/growth/signals.ts`, `src/app/desk/growth/page.tsx`

The UI says candidates are “billing cleanly,” but eligibility only checks active billing age and absence of a currently past-due invoice. It does not exclude the recent failed-payment signal already used by churn detection, or other negative experience signals such as repeat recent maintenance.

A customer can therefore appear as both churn-risk and a positive review/referral candidate.

**Fix:** create one canonical positive-outreach eligibility predicate that excludes active negative signals. Add a test where recent failed payment excludes the customer despite no past-due invoice.

---

## M2 — Review/referral candidates are agreement rows, not customer-level outreach records, and there is no “already asked” state

**Severity:** Medium  
**Primary files:** `src/domains/growth/index.ts`, `src/app/desk/growth/page.tsx`, `prisma/schema.prisma`

A property manager with several eligible active agreements can appear multiple times. There is also no persisted record that the owner already asked for a review/referral, so the same eligible customer reappears indefinitely.

**Fix:** dedupe to customer-level eligibility and persist outreach kind/time/channel/actor/outcome with a documented cooldown.

---

## M3 — Fixed-term churn calculations can produce the wrong end date for month-end starts

**Severity:** Medium  
**Primary file:** `src/domains/growth/index.ts`

`addMonthsUtc()` constructs a date with the original day-of-month in the target month. JavaScript rolls invalid dates forward, so month-end starts such as January 31 can produce an early-March result for “+1 month” instead of an end-of-February calendar result.

**Fix:** use a shared calendar-month helper that clamps to the target month's final valid day. Reuse it with agreement renewal/term logic from Package 2 and test month-end/leap-year cases.

---

## M4 — A “12-month” price review is implemented as 360 elapsed days, not a calendar-year anniversary

**Severity:** Medium  
**Primary files:** `src/domains/growth/signals.ts`, `src/domains/growth/index.ts`, `src/app/desk/growth/page.tsx`

`isPriceReviewDue()` and `monthsSince()` use 30-day months. The UI says “Active for a year or more,” but 12 × 30 = 360 days.

**Fix:** use calendar-month comparison/difference, or rename the business rule/UI to 360 days if that is intentionally the policy.

---

## M5 — Global substring search will degrade into broad scans as data grows

**Severity:** Medium  
**Primary files:** `src/domains/search/index.ts`, `prisma/schema.prisma`, `prisma/migrations/*`

Search runs case-insensitive `contains` across customer/user, appliance, and lead text fields. The repository has no `pg_trgm` setup/supporting trigram indexes. `take: 8` limits returned rows, not rows PostgreSQL must inspect.

**Fix:** stage exact identifier matches first, prefix matches next, and only then substring/fuzzy matching. Measure representative query plans; add targeted trigram indexes only where contains search is genuinely required.

---

## M6 — Search has no deterministic relevance ordering before `take: 8`

**Severity:** Medium  
**Primary files:** `src/domains/search/index.ts`, `tests/search.test.ts`

Each category uses `take: 8` with no `orderBy` or relevance ranking. When more than eight rows contain a token, an exact match is not guaranteed to appear and the returned subset can depend on database plan/storage order.

**Fix:** rank exact matches first, then prefix, then contains, with stable name/identifier/ID tie-breakers. Add >8-match tests where the exact match is deliberately not first in insertion order.

---

# Verified strengths / non-findings

1. `/desk/growth` has an explicit OWNER/ADMIN server gate.
2. Growth/lead scoring is intentionally explainable and returns plain-language reasons.
3. Launch emails are production-gated by prelaunch mode, email-enabled state, identity fields, production deployment, provider credentials, and canonical production URL.
4. Launch duplicate-send prevention is strong: normalized unique email, signup race dedupe, compare-and-set claim, unique subscriber/step delivery, provider idempotency key, suppression recheck, and no blind retry of uncertain outcomes.
5. Ordinary repeat public signup does not clear `unsubscribedAt`; the integration test proves suppression persists.
6. Launch cron requires a configured Bearer secret.
7. Search authenticates before querying, short-circuits blank input, caps each category, and returns narrow DTOs.
8. Existing search tests prove unauthorized rejection before DB access, blank-query short circuit, non-archived customer filtering, and DTO mapping.

---

# Cross-package overlaps

## Package 3 overlap — role-boundary consistency

H1 is the Package 4 search-surface manifestation of the broader Package 3 principle that every query surface must enforce the same category policy as the destination/detail surface. Fix it in search, but do not double-count it in synthesis.

## Package 2 overlap — agreement calendar math

M3 touches fixed-term agreement dates. If Package 2 remediation creates a canonical term-end/renewal helper, Package 4 churn logic should use it rather than create a second implementation.

## Package 4 / Package 6 overlap — anti-abuse and marketing consent

H2 and the known in-memory rate-limit limitation overlap Package 6 public-form/compliance review. Package 4 owns the marketing consequence; Package 6 should count only distinct additional security/compliance impacts.

## Roadmap O26 overlap — durable communication ledger

H3 aligns directly with durable communication-ledger/provider-reconciliation work. Prefer a reusable ledger over a launch-only provider-attempt design.

---

# Codebase-specific remediation plan

The findings can be resolved in **three substantial implementation packages**, avoiding one expensive CI run per tiny fix.

## Remediation Package A — Growth signal truth and lead qualification

**Findings:** H4, H5, H6, M1, M2, M3, M4

Build canonical facts for lead activity/contact time, agreement calendar term end, calendar months since start, recent/current utilization, and positive-outreach eligibility. Add lead qualification editing and score recomputation. Separate lifetime utilization analytics from current/rolling growth guidance. Add customer-level outreach history/cooldown. Reuse one tested calendar-month helper.

### Acceptance

- recent lead notes reset stale/win-back behavior;
- manual leads can become correctly high-value after qualification;
- current/rolling utilization drives growth flags;
- month-end term dates are correct;
- price-review timing matches “12 months / year” wording;
- positive outreach excludes active negative signals;
- one customer appears once and outreach history prevents repetitive asks.

## Remediation Package B — Launch consent and recoverable delivery state

**Findings:** H2, H3

Add confirmed opt-in. Align delivery attempts with O26 if available. Persist provider/message identifiers, logical message key, attempt status/timestamps and safe error classification. Add audited owner reconciliation actions and stuck-claim detection.

### Acceptance

- unconfirmed addresses receive no marketing sequence;
- confirmed consent is durable/auditable;
- provider evidence supports deterministic reconciliation;
- failed/uncertain attempts can be resolved without DB surgery;
- no recovery path can send after unsubscribe;
- cron/recovery remain at-most-once per logical step.

## Remediation Package C — Search permission, relevance and scale

**Findings:** H1, M5, M6

Build search categories from the validated role, bound/normalize input, layer exact/prefix/contains behavior, add only measured indexes, and make relevance deterministic.

### Acceptance

- STAFF cannot query or receive leads;
- OWNER/ADMIN lead search remains available;
- exact asset/email matches are first;
- >8 candidate fixtures produce deterministic results;
- seeded-scale query plans support the intended hot search paths.

---

# Recommended implementation priority

1. **H1 search lead exposure** — access boundary, small/high-confidence correction.
2. **H3 launch delivery recovery/provider reconciliation** — prevent silently stranded automation; coordinate with O26.
3. **H2 confirmed launch opt-in** — protect consent quality/sender reputation.
4. **H4/H5 growth-signal truth** — avoid owner decisions based on stale/misnamed signals.
5. **H6 manual lead qualification/re-score**.
6. **M1/M2 positive outreach integrity**.
7. **M3/M4 shared calendar-date correction**.
8. **M5/M6 measured search scale/relevance improvements**.

---

# Test coverage notes

## Existing coverage worth keeping

```text
tests/growth-churn.test.ts
tests/growth-signals.test.ts
tests/growth.test.ts
tests/search.test.ts
tests/lead-scoring.test.ts
tests/launch-integration.test.ts
tests/launch-actions.test.ts
e2e/launch.spec.ts
```

## Important missing proofs

```text
STAFF global search cannot read lead data
search relevance with >8 matches
seeded-scale search query plan/performance
recent LeadNote resets stale-lead signal
manual lead qualification triggers atomic score recomputation
rolling/current utilization scenarios
month-end term arithmetic
calendar-year price-review boundary
recent failed-payment customer excluded from positive outreach
multi-agreement customer deduped from review candidates
outreach cooldown/history
unconfirmed launch address never receives marketing
stuck launch claim recovery
provider accepted + local crash reconciliation
owner-approved retry of confirmed-unsent delivery
unsubscribe vs recovery concurrency
```

---

# Completion criteria for Package 4 remediation

- [ ] STAFF global search cannot query or return lead records under current role policy.
- [ ] Launch marketing requires confirmed mailbox ownership.
- [ ] Launch attempts persist enough provider evidence to reconcile accepted/failed/uncertain outcomes.
- [ ] Blocked launch subscribers have safe OWNER/ADMIN recovery actions; no DB surgery required.
- [ ] Recovery/cron concurrency cannot duplicate a logical message.
- [ ] Unsubscribe remains authoritative over cron and recovery paths.
- [ ] Lead win-back uses real contact/activity truth, not generic `Lead.updatedAt` alone.
- [ ] Manual leads can be qualified and rescored through the application.
- [ ] Growth utilization guidance uses current or bounded-recent demand.
- [ ] Positive review/referral outreach excludes active negative signals.
- [ ] Positive outreach is customer-level, deduplicated and cooldown-aware.
- [ ] Fixed-term month arithmetic handles month-end/leap-year cases.
- [ ] Price-review timing matches owner-facing calendar-month language.
- [ ] Search exact matches are deterministically prioritized.
- [ ] Search performance has measured evidence and appropriate indexes for the chosen matching strategy.
- [ ] New tests prove the above without weakening current launch concurrency/dedupe safeguards.

---

# Final Package 4 assessment

Package 4 is not a placeholder subsystem. It has real lead scoring, real growth recommendations, real launch-list persistence, a thoughtfully conservative at-most-once launch email mechanism, and a useful global search surface.

The core conclusion is that the foundation is stronger than the early roadmap notes suggested, but several owner-facing recommendations currently overstate what their underlying data proves.

The most important corrections are to make search permissions match the destination policy, prove launch consent at the mailbox level and make blocked delivery states recoverable, base growth recommendations on the business event they claim to represent, give manually-entered leads a real qualification/re-scoring lifecycle, and make search relevance/scaling deliberate before data volume makes the current substring scans painful.