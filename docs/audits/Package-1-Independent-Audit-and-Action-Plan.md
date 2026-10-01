# Package 1 Independent Audit & Codebase-Specific Action Plan

**Audit date:** 2026-10-01  
**Repository:** `christcr2012/appliance-desk`  
**Audited branch:** `main`  
**Audited commit:** `851f31931f9b7cb3a300d4eaa580e78cb16d7dae`  
**Package:** 1 — Customer Lifecycle  
**Scope authority:** `docs/AUDIT_ROADMAP.md` Package 1  
**Purpose:** Independent re-audit of Package 1 against the current codebase, followed by a concrete implementation plan tailored to Appliance Desk.

> This report intentionally does **not** replace `docs/audits/Package-1-Customer-Lifecycle.md`. The older report is preserved as historical comparison. This independent report is the newer current-code assessment.

---

## Executive Summary

This report independently re-audits Package 1 against the current `main` codebase rather than accepting the existing Package 1 report as authoritative.

The current Package 1 area is assessed as **HIGH RISK until remediation**.

### Findings by severity

| Severity | Count |
| --- | ---: |
| Critical | 2 |
| High | 7 |
| Medium | 8 |
| **Total** | **17** |

The most important difference from the original Package 1 audit is scope completeness. The master audit roadmap explicitly includes the **Estimate / Quote Lifecycle**, but the earlier report focused primarily on customers, portal, maintenance, and activity. That omission missed several of the most consequential correctness and concurrency defects in the current implementation.

The highest-priority issues are:

1. Estimate response state has real concurrency races.
2. Estimate-to-agreement conversion is neither atomic nor retry-idempotent.
3. Maintenance state transitions remain concurrency-unsafe.
4. Estimate send and follow-up workflows can report success without a successful email send.
5. Direct customer creation can leave orphan authentication state if customer creation fails.
6. Maintenance request submission can persist while the customer is told it failed.
7. Estimate expiration is displayed but not enforced during customer response processing.

---

# 1. Audit Scope

Package 1 was audited according to `docs/AUDIT_ROADMAP.md`, including:

- customer lifecycle;
- customer data isolation;
- customer portal flows;
- maintenance request lifecycle;
- estimate / quote lifecycle;
- customer activity / audit history;
- relevant server actions;
- related database relationships;
- pagination and query behavior;
- concurrency and idempotency;
- error handling;
- existing automated tests;
- missing adversarial tests;
- current merged roadmap behavior.

Primary code areas reviewed include:

```text
src/domains/customers/
src/domains/portal/
src/domains/maintenance/
src/domains/estimates/
src/domains/activity/
src/domains/leads/
src/domains/billing/
src/app/account/
src/app/estimate/
src/app/desk/customers/
src/app/desk/maintenance/
src/app/desk/estimates/
prisma/schema.prisma
tests/
e2e/
```

---

# 2. Critical Findings

## C1 — Estimate response state has real concurrency races

### Affected areas

- `src/domains/estimates/index.ts`
- `src/app/estimate/[id]/actions.ts`

### Problem

The estimate lifecycle uses read-then-write logic for public state transitions.

`getEstimateForApproval()` may read `SENT` and later unconditionally update to `VIEWED`. `approveEstimate()` and `requestEstimateChanges()` independently read `SENT`/`VIEWED` and then write a terminal response state.

Those writes do not atomically claim the state they previously observed.

### Failure modes

A view can overwrite an approval:

```text
Request A reads SENT
Request B reads SENT
Request B writes APPROVED
Request A writes VIEWED
```

Two customer tabs can also race:

```text
Tab A -> approve
Tab B -> request changes
```

Both may validate against the same old state and the last writer wins.

### Business impact

- customer decisions can be overwritten;
- approved pricing can later appear unapproved;
- deposit collection and downstream conversion can disagree with visible estimate state;
- auditability of customer consent becomes unreliable.

### Required remediation

Use database-level compare-and-set transitions.

For viewing:

```text
UPDATE Estimate
SET status = VIEWED, viewedAt = ...
WHERE id = ? AND status = SENT
```

For a terminal response:

```text
UPDATE Estimate
SET status = APPROVED ...
WHERE id = ? AND status IN (SENT, VIEWED)
```

Require exactly one claimed row. Do not assume that merely wrapping a read and unconditional update in a normal read-committed transaction solves the race.

### Required tests

Real Postgres concurrency tests must prove:

- `SENT -> VIEWED` cannot overwrite `APPROVED`;
- approve and request-changes cannot both succeed;
- two simultaneous approvals produce one effective response;
- stale tabs return deterministic conflict/already-responded behavior;
- deposit checkout starts only from the winning approval.

---

## C2 — Estimate-to-agreement conversion is not atomic or retry-idempotent

### Affected areas

- `src/domains/estimates/index.ts`
- `src/domains/agreements/index.ts`
- `prisma/schema.prisma`

### Problem

`convertEstimateToAgreements()` performs a multi-step business transaction across one or more properties:

1. read approved estimate;
2. resolve service address(es);
3. create agreement;
4. link `sourceEstimateId`;
5. optionally mirror deposit state;
6. repeat for each property;
7. mark estimate `CONVERTED`;
8. write conversion audit.

Those steps do not currently form one atomic operation and do not have a robust retry identity.

### Failure modes

A multi-property conversion can partially create agreements and then fail. A retry can then create duplicates. Failures while linking the estimate, creating deposit state, marking `CONVERTED`, or writing audit can also leave contradictory partial state.

### Required remediation

Refactor conversion into one transactional command with an explicit idempotency claim.

Recommended approach:

- create a transaction-capable internal agreement-creation primitive;
- create all converted agreements in one transaction;
- create dependent deposit records in that transaction;
- set `sourceEstimateId` at creation time;
- mark the estimate converted in the same transaction;
- write the conversion audit in the same transaction;
- on retry after success, return already-created agreement IDs rather than creating more.

If business rules guarantee one converted agreement per property, a deterministic uniqueness rule such as `(sourceEstimateId, serviceAddressId)` can help. Otherwise use a dedicated conversion/idempotency record.

### Required tests

- concurrent conversion attempts;
- failure after the first agreement in a multi-property conversion;
- retry after rollback;
- retry after success;
- prepaid deposit creation exactly once;
- audit record exactly once;
- no partial agreements after failure.

---

# 3. High Findings

## H1 — Maintenance status transitions remain concurrency-unsafe

### Affected areas

- `src/domains/maintenance/index.ts`
- `src/app/desk/maintenance/actions.ts`

### Problem

The current transition flow reads status, validates the transition, updates, then writes audit. Two requests can validate the same old status before either commits.

### Required remediation

Use a conditional status claim inside a transaction and write the audit in the same transaction. If the claim count is zero, reload current state and return a conflict/already-changed result.

### Tests

- competing valid transitions;
- duplicate transition request;
- audit rollback on failure;
- exactly one audit for the winning transition.

---

## H2 — An estimate can be marked SENT when no email was accepted

### Affected areas

- `src/domains/estimates/index.ts`
- `src/lib/email.ts`
- `src/app/desk/estimates/actions.ts`

### Problem

`sendEstimate()` updates the estimate to `SENT` and writes audit before delivery. `sendEmail()` commonly reports provider failure as `{ sent: false }` rather than throwing, and `sendEstimate()` ignores that result.

The application can therefore report success and lock the estimate into a sent-state workflow even though the provider did not accept the email.

### Required remediation

Separate estimate lifecycle state from notification delivery state. Record delivery attempt/acceptance explicitly, check `sendEmail(...).sent`, and make failure retryable. A narrow transactional outbox/notification model is preferable if reused elsewhere.

### Tests

- `{ sent:false }`;
- thrown provider error;
- success;
- repeated send;
- database failure after provider acceptance;
- clear retryable owner-facing status.

---

## H3 — Estimate follow-ups can be silently lost or duplicated

### Affected areas

- estimate follow-up domain logic;
- estimate follow-up cron route;
- `src/lib/email.ts`.

### Problem

A provider rejection represented as `{ sent:false }` can still be followed by marking the follow-up cycle complete. Overlapping cron executions can also both observe the reminder as unsent and both send.

### Required remediation

Use an atomic reminder claim or outbox record. A reminder should be considered complete only after provider acceptance is recorded. Failed/ambiguous sends must remain recoverable rather than being silently suppressed.

### Tests

- `{sent:false}` does not complete the reminder;
- overlapping cron runs produce one send;
- retry after failure succeeds;
- a revised/re-sent estimate starts a new follow-up cycle.

---

## H4 — Direct customer creation can leave orphan authentication state

### Affected areas

- `src/domains/customers/index.ts`
- hardened lead-conversion path used as comparison.

### Problem

The direct customer path creates/changes authentication state and can send activation before the transaction that creates the Customer, service addresses and audit record commits.

A later business-data failure can leave an auth account without a Customer record, and the person may already have received activation.

### Required remediation

Bring direct creation in line with the hardened lead-conversion design:

1. transactionally create/reuse auth DB rows where possible;
2. create Customer;
3. create service addresses;
4. create audit;
5. commit;
6. only then send activation.

Provider activation failure should not roll back an already-valid customer; it should remain resendable.

---

## H5 — Maintenance submission can persist while the customer is told it failed

### Affected areas

- `src/domains/portal/index.ts`
- `src/app/account/maintenance/actions.ts`

### Problem

The request can be created before audit/settings/notification operations. A later failure may bubble back as a failed submission even though the request exists, encouraging duplicate retries.

### Required remediation

Make request + photos + audit one transaction. Notification should happen only after commit and must not retroactively change the submission result. A transactional outbox is the strongest reusable design.

### Tests

- audit failure rolls back request;
- photo failure rolls back request;
- email failure still returns successful submission;
- retry after email failure does not create a duplicate due to misleading status.

---

## H6 — Estimate expiration is displayed but not enforced

### Affected areas

- `src/domains/estimates/index.ts`
- public estimate page/actions.

### Problem

`validUntil` is stored/displayed and `EXPIRED` exists, but response processing currently relies mainly on status and does not consistently reject approval/change responses after the expiration date.

### Required remediation

Create one shared `isEstimateRespondable(estimate, now)` rule requiring both an eligible state and an unexpired date. Use a conditional update when lazily marking expired state and/or a reconciliation job.

### Tests

- approval before expiration succeeds;
- approval after expiration fails;
- changes request after expiration fails;
- page shows expired state;
- expiration vs approval race has a deterministic winner.

---

## H7 — Legacy portal loader scales with the customer's entire lifetime history

### Affected areas

- `src/domains/portal/index.ts`
- account settings, billing, rentals, maintenance, and invoice flows using the broad DTO.

### Problem

`getPortalData()` eagerly loads broad nested customer history even when a page needs only a small subset. Simply adding `take: 50` would hide legitimate historical data and is not an acceptable fix.

### Required remediation

Replace broad usage with page-specific read models such as:

```text
getPortalAccountSettings()
getPortalRentalsPage()
getPortalMaintenancePage()
getPortalBillingSummary()
getPortalInvoiceAccessContext()
```

Use real pagination for historical lists and preserve customer-isolation guarantees.

---

# 4. Medium Findings

## M1 — Estimate line-item property IDs are not validated against the estimate customer

When `serviceAddressId` is provided, the domain should verify it belongs to the estimate's customer. Do not rely on the UI dropdown. Otherwise an operator mistake or manipulated request can expose another customer's property address on the public proposal.

---

## M2 — Maintenance photo submission trusts arbitrary URLs

The customer submission path should validate that photo references came through the authorized upload workflow rather than accepting any syntactically valid URL. Prefer opaque upload tokens/records or, at minimum, strict approved host/path and ownership/session validation.

---

## M3 — Portal “next visit” can actually be an overdue visit

The customer home query should require `scheduledAt >= now` for a “next visit.” Overdue/in-progress jobs can be represented separately. Inject `now` for deterministic tests.

---

## M4 — Customer timeline pagination is stable, but scope construction does not scale well

The timeline query loads every agreement/job/maintenance ID merely to build an audit `IN (...)` scope for a small page. Add direct indexed customer context to customer-related audit rows, use a relation/scope table, or otherwise avoid ever-growing ID fan-out.

---

## M5 — Customer timeline omits estimate history

Customer activity should include estimate creation/sending/response/conversion events that belong to that customer. This becomes simpler if M4 adds direct customer context to audit rows.

---

## M6 — STAFF activity omits `task.update`

Batch 1 writes `task.update` audit events, but STAFF activity filtering does not expose them. If shared-task edits are intended to be visible to STAFF, add `task.update` and regression coverage for the full permitted task-action set.

---

## M7 — Specific indexes/related-record bounds are still missing

Review actual query plans for candidates including:

```text
MaintenanceRequest(customerId)
Photo(maintenanceRequestId)
Photo(jobId)
Photo(applianceId)
AuditLog(customerId, createdAt)   # if customer audit context is added
```

Do not apply a blanket “index every foreign key” rule; validate actual access paths and cardinality. Maintenance detail also needs a deliberate strategy for very large photo/job history.

---

## M8 — Some offset-paginated screens lack deterministic tie-break ordering

Maintenance/global activity ordering based on a timestamp alone can be unstable when timestamps tie. Use timestamp + ID ordering or cursor pagination where write volume justifies it.

---

# 5. Findings Intentionally Rejected or Reclassified

A strong audit should remove false positives rather than accumulate them.

## OWNER/ADMIN customer workspace “missing data scoping”

**Not a current cross-customer vulnerability.** The current functions explicitly deny STAFF where appropriate and tests verify the denial. This could become a future design question if permissions expand, but it is not a present vulnerability.

## Maintenance detail described as an N+1 query

**Reclassified.** There is overfetching and there are concrete index/bounding concerns, but a Prisma nested `include` is not automatically an N+1 problem.

## Customer timeline cursor correctness “needs verification”

**No longer a finding.** Current code has explicit cursor/tie behavior and regression coverage for a large equal-timestamp data set.

## Cursor implementation “opaque” because a search did not show it

**Rejected.** An audit should read the implementation before declaring it unknown.

## Broad foreign-key indexing concern

**Reclassified.** Several indexes already exist. Only concrete missing indexes tied to real query patterns should be reported.

---

# 6. Positive Findings / Areas With Strong Evidence

The following areas should not be unnecessarily reworked:

- customer-to-customer portal isolation has real database-backed proof;
- customer timeline cursor/tie logic has meaningful regression coverage;
- newer owner customer-workspace pagination is stable and STAFF-restricted;
- maintenance state-machine rules themselves are clear; the defect is concurrency around applying them;
- portal home property filtering is restricted to the signed-in customer's own service addresses.

The goal of the audit is not to maximize finding count. It is to distinguish real operational/data-integrity failures from hypothetical or already-resolved concerns.

---

# 7. Codebase-Specific Remediation Plan

Package 1 fixes should be implemented in a small number of substantial changes rather than one PR per finding.

## P1-A — Transaction & concurrency safety

**Addresses:** C1, C2, H1, transactional portion of H5.

### Work

- establish a documented compare-and-set pattern for Estimate and MaintenanceRequest lifecycle transitions;
- make `SENT -> VIEWED` conditional;
- make estimate approval/change mutually exclusive;
- create a transaction-capable internal agreement creation primitive;
- make estimate conversion one atomic/idempotent command;
- make maintenance status update + audit atomic;
- make maintenance request + photo + audit creation atomic.

### Required tests

Add real Postgres integration/concurrency coverage for estimate response races, conversion rollback/retry, maintenance transition races, and maintenance submission rollback.

---

## P1-B — Reliable notification delivery semantics

**Addresses:** H2, H3, notification portion of H5.

### Recommended architecture

Add a narrow transactional notification/outbox model, for example:

```text
NotificationOutbox
- id
- kind
- recipient
- payload/template data
- dedupeKey UNIQUE
- status: PENDING | SENDING | SENT | FAILED
- providerMessageId?
- attemptCount
- lastAttemptAt?
- sentAt?
- lastError?
- createdAt
- updatedAt
```

Use it at minimum for estimate initial send, estimate follow-up, and maintenance owner notification. If an outbox is deferred, callers must still check `{ sent }` and use atomic reminder claims.

### Acceptance

- no UI says “sent” solely because a function did not throw;
- reminder dedupe works under overlapping cron runs;
- provider failure cannot permanently suppress a reminder;
- notification failure never turns an already-committed customer request into a false submission failure.

---

## P1-C — Customer creation consistency

**Addresses:** H4.

Refactor shared auth/customer creation behavior so direct creation and lead conversion use the same safe lifecycle. Activation occurs only after the customer transaction commits. Provider activation failure remains recoverable/resendable.

---

## P1-D — Estimate business-rule completeness

**Addresses:** H6, M1.

- add one shared estimate respondability rule;
- validate estimate line-item property ownership in the domain;
- consider explicit audit events for public estimate view/approve/changes/expire, with nullable system/public actor identity where appropriate.

---

## P1-E — Portal query decomposition & timeline scaling

**Addresses:** H7, M3, M4, M5, M8.

- retire broad `getPortalData()` usage page by page;
- fix future-only “next visit” semantics;
- add direct customer context to customer-related audit writes or an equivalent scalable relationship;
- include estimate activity in the customer timeline;
- stabilize remaining pagination.

Scale fixtures should include >100 rentals/jobs/maintenance/timeline entries, equal timestamps, multiple addresses and multi-property estimates.

---

## P1-F — Schema & query performance cleanup

**Addresses:** M7.

Validate actual query plans before adding indexes. Add bounded/history navigation rather than silently truncating records.

---

## P1-G — Activity permission consistency

**Addresses:** M6.

Add `task.update` to STAFF activity visibility if intended and test all STAFF-permitted task mutations against the activity filter.

---

# 8. Suggested PR Consolidation

To reduce CI cost, Package 1 remediation should be grouped into approximately **three substantial PRs**, not seventeen small ones.

## PR 1 — Lifecycle Integrity

Include:

```text
C1
C2
H1
H5 transactional core
H6
M1
```

Theme: atomic lifecycle transitions and idempotent business commands.

## PR 2 — Notifications & Customer Creation

Include:

```text
H2
H3
H4
H5 notification behavior
```

Theme: reliable side effects and no orphan account/message state.

## PR 3 — Portal & Scale Hardening

Include:

```text
H7
M2
M3
M4
M5
M6
M7
M8
```

Theme: bounded reads, customer activity completeness, permission consistency and query hardening.

If estimate conversion refactoring becomes unusually large because it substantially changes agreement internals, split it into its own substantial PR rather than fragmenting every finding.

---

# 9. Test Plan

Package 1 should not be considered remediated until CI proves:

## Concurrency

- estimate view vs approval;
- estimate approval vs change request;
- concurrent estimate conversions;
- competing maintenance transitions;
- overlapping reminder cron runs.

## Idempotency

- repeated estimate approval;
- repeated conversion;
- repeated notification worker execution;
- retry after provider failure;
- repeated maintenance status action.

## Transaction rollback

- failure during agreement creation;
- failure during deposit creation;
- audit-log failure;
- photo creation failure;
- customer-address creation failure.

## Isolation

Customer A cannot retrieve or attach Customer B's rentals, invoices, maintenance records, appliances, properties or uploaded-photo associations.

## Scale

Use realistic fixtures with at least:

```text
100+ rentals for one customer
100+ jobs
100+ maintenance requests
100+ timeline/audit entries
equal-timestamp records
multiple service addresses
multi-property estimates
```

## Provider failure semantics

Test both:

```ts
throw new Error(...)
```

and:

```ts
return { sent: false }
```

because `src/lib/email.ts` intentionally converts many provider failures into the latter.

---

# 10. Definition of Done for Package 1

Package 1 is complete only when:

- [ ] estimate state transitions are concurrency-safe;
- [ ] estimate conversion is atomic;
- [ ] estimate conversion is retry-idempotent;
- [ ] maintenance transitions are concurrency-safe;
- [ ] business mutations and required audit rows share transactions;
- [ ] provider rejection is not treated as successful email delivery;
- [ ] estimate reminders cannot duplicate under overlapping cron execution;
- [ ] failed reminders remain retryable;
- [ ] direct customer creation cannot leave orphan auth state;
- [ ] maintenance notification failure cannot cause false submission failure;
- [ ] estimate expiration is enforced;
- [ ] estimate service-address ownership is validated server-side;
- [ ] portal reads are bounded/paginated;
- [ ] customer timeline includes estimate history;
- [ ] timeline scope no longer requires loading every related entity ID at scale, or the chosen design has measured evidence;
- [ ] photo references are validated against the authorized upload path;
- [ ] portal next-visit excludes overdue appointments from “next” semantics;
- [ ] STAFF activity includes intended shared-task actions;
- [ ] remaining offset pagination has deterministic ordering;
- [ ] targeted indexes are added based on query evidence;
- [ ] real Postgres concurrency/rollback tests pass;
- [ ] existing customer-isolation tests remain green;
- [ ] no finding is closed solely because a mocked unit test passes where the bug depends on DB/provider behavior.

---

# 11. Comparison With the Existing Package 1 Audit

The original Package 1 report remains useful as historical evidence but should no longer be treated as the authoritative current-code audit.

### Correct/valuable original findings

- maintenance concurrency risk;
- oversized legacy portal loading;
- need for performance/index review;
- need for stable lifecycle behavior.

### Findings that are now overstated or obsolete

- current OWNER/ADMIN workspace STAFF scoping is not a present cross-customer vulnerability;
- timeline cursor correctness now has meaningful regression evidence;
- “N+1” was not the precise maintenance-detail diagnosis;
- a generic “missing foreign-key indexes” statement is less useful than concrete query-specific findings.

### Major omission in the original audit

The Estimate / Quote Lifecycle is explicitly within Package 1 but was not adequately audited. That omission hid:

- public estimate response races;
- non-atomic conversion;
- retry duplication risk;
- false-success send semantics;
- reminder dedupe/failure behavior;
- unenforced expiration;
- property ownership validation gaps.

---

# 12. Audit Method Standard for Packages 2–6

Use this independent Package 1 audit as the quality standard for the remaining packages.

Each audit should:

1. start from `docs/AUDIT_ROADMAP.md` scope;
2. enumerate every current code domain implementing that scope;
3. read implementation, not only search snippets;
4. trace state transitions end-to-end;
5. identify transaction boundaries;
6. identify external side effects and failure semantics;
7. check concurrency and retry behavior;
8. review schema constraints/indexes against actual queries;
9. inspect existing tests and state what they do **not** prove;
10. verify whether historical findings are still current;
11. reject false positives and hypothetical future-only concerns;
12. produce codebase-specific remediation steps;
13. group fixes into substantial implementation batches to reduce CI overhead;
14. define measurable acceptance criteria for every Critical/High finding.

The goal is not to maximize the number of findings. The goal is to identify failures that can actually damage operations, customer trust, billing integrity, security or future scale—and provide an implementation path that can be executed directly in this repository.

---

## Final Assessment

Package 1 already contains substantial functionality and meaningful regression coverage, particularly around customer isolation and newer customer-workspace pagination.

However, the current implementation still has **2 Critical, 7 High and 8 Medium** current-code findings. The Critical and High findings should be remediated before this package is considered production-complete.

The central engineering principle for Package 1 remediation is:

> **A business state change, its audit record, its retry behavior, and any dependent external side effect must have explicitly defined atomicity and idempotency semantics.**

That same principle should guide Packages 2–6.