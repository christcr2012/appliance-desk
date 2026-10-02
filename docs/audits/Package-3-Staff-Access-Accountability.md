# Package 3 Audit — Staff, Access & Accountability

**Audit date:** 2026-10-01  
**Repository:** `christcr2012/appliance-desk`  
**Audited branch:** `main`  
**Audited commit:** `851f31931f9b7cb3a300d4eaa580e78cb16d7dae`  
**Scope authority:** `docs/AUDIT_ROADMAP.md` Package 3  
**Status:** Audit complete; remediation not yet implemented by this report.

---

## Executive summary

Package 3 covers the system's staff-account lifecycle, role and record access boundaries, shared task workspace, exception inbox, staff-action accountability, concurrent task editing, and offboarding behavior.

The current implementation has several strong foundations. `requireSession()` rejects archived users, deactivation removes live session rows, STAFF financial data is separated into narrow operational DTOs, direct access to finance-bearing routes/functions is tested, and the shared task subsystem has unusually good concurrency discipline: actor rows are locked, inactive assignees are rejected, task versions are compare-and-set, repeated complete/reopen operations are idempotent, and task state plus audit writes share a database transaction.

The main risks are not basic role checks. They are at the edges of that model:

- a historical `JobAppliance` relationship can remain a durable authorization path for a STAFF user to mutate an appliance long after the job relationship should have stopped granting authority;
- account deactivation blocks future requests but does not transactionally fence every STAFF write that already passed `requireRole()` before deactivation;
- several STAFF-permitted operational mutations are missing audit entries or write business state separately from the audit row;
- staff creation/deactivation/reactivation can split access state from its audit trail or activation side effect;
- hard task deletion loses the immutable business-record linkage needed to reconstruct what was removed;
- the exception inbox performs broad, unbounded cross-domain queries and has a calendar-month arithmetic edge case.

### Overall assessment

**HIGH RISK until remediation.**

No Critical issue was assigned in this package. The current code already has substantial server-side authorization and concurrency protection, and the findings below do not justify inflating severity beyond their demonstrated impact.

| Severity | Findings |
| --- | ---: |
| Critical | 0 |
| High | 5 |
| Medium | 5 |
| **Total** | **10** |

---

# Audit scope

The audit followed Package 3 in `docs/AUDIT_ROADMAP.md` and reviewed the current implementation of:

- OWNER vs ADMIN vs STAFF access boundaries;
- server-side `requireRole()` / `requireSession()` enforcement;
- staff creation, invitation, deactivation, session revocation, and reactivation;
- STAFF operational record DTOs and finance isolation;
- task creation, assignment, edit, completion, reopen, deletion and views;
- task concurrency/version behavior;
- task record-link visibility;
- exception inbox scoping and query behavior;
- staff-visible activity/audit history;
- STAFF job/appliance operational actions;
- interaction between deactivation and in-flight mutations;
- tests proving or failing to prove the above.

Primary code reviewed included:

```text
src/domains/staff/
src/domains/desk-access/
src/domains/tasks/
src/domains/exceptions/
src/domains/activity/
src/domains/jobs/
src/domains/inventory/
src/app/desk/settings/
src/app/desk/tasks/
src/app/desk/jobs/
src/lib/session.ts
src/lib/auth.ts
src/proxy.ts
prisma/schema.prisma
tests/staff-accounts.test.ts
tests/desk-role-access.test.ts
tests/staff-job-origin.test.ts
tests/staff-job-persistence.test.ts
tests/task-interactions.test.tsx
tests/exceptions.test.ts
e2e/staff-security.spec.ts
```

---

# Critical findings

## No confirmed Critical findings

The audit did not identify a Package 3 issue that currently warrants Critical severity.

That does **not** mean Package 3 is production-complete. The High findings below can still produce unauthorized operational changes after the intended scope has ended, allow an in-flight mutation to commit after access removal, and leave staff actions without a reliable audit record.

The severity distinction is intentional: the reviewed implementation already has meaningful server-side role enforcement and no evidence was found of unrestricted anonymous/customer access to OWNER/ADMIN data through the Package 3 surfaces.

---

# High findings

## H1 — A historical job/appliance link can grant STAFF enduring appliance-status mutation authority

**Severity:** High  
**Primary files:**

```text
src/app/desk/jobs/actions.ts
src/domains/inventory/index.ts
src/domains/inventory/lifecycle.ts
tests/staff-job-origin.test.ts
tests/staff-job-persistence.test.ts
```

### Problem

`updateApplianceStatusFromJobAction()` permits OWNER/ADMIN/STAFF.

For STAFF, the additional authorization check is essentially:

```text
jobId was provided
AND
JobAppliance exists for (jobId, applianceId)
```

Once that link exists, the action delegates the requested target status to the normal inventory status function. The inventory domain then checks only whether the requested transition is globally legal from the appliance's current state.

The STAFF authorization check does **not** establish that:

- the job is still current;
- the job is in a state where a follow-up appliance transition is expected;
- the requested target state is the one justified by that job type;
- the appliance still belongs to the business context represented by that job;
- the link was the recorded incoming/outgoing intent for the specific guided workflow, except where UI/read logic happens to identify such intent separately;
- the job relationship has not become purely historical.

`JobAppliance` rows are durable history. That means a historical job can continue to satisfy the authorization predicate indefinitely.

The current integration test actually demonstrates that a **COMPLETED** SWAP job can be used as the STAFF provenance for an appliance update. That may be valid immediately after a swap, but the authorization rule has no expiry or current-work check; the same row remains valid later.

### Why this matters

The global appliance transition table is intentionally broad for OWNER/ADMIN inventory management. Examples include transitions such as:

```text
AVAILABLE -> RESERVED
AVAILABLE -> RENTED
AVAILABLE -> MAINTENANCE
AVAILABLE -> RETIRED
RESERVED -> AVAILABLE / RENTED / MAINTENANCE / RETIRED
```

Those broad owner-capable transitions should not automatically become STAFF authority merely because the appliance once appeared on a job.

A STAFF user who can call the server action with an old valid `jobId`/`applianceId` pair may therefore change an appliance in ways unrelated to the old job, as long as the global lifecycle transition itself is legal.

### Required remediation

Do not use historical `JobAppliance` membership as a permanent authorization token.

For STAFF calls, load and validate the **current job + job-appliance intent** server-side and derive the allowed transition from that context.

Recommended pattern:

1. Load the job and linked appliance in one authorization query.
2. Verify the job is in an allowed state for the follow-up action.
3. Verify the appliance is the correct side of the workflow when direction matters, e.g. the recorded incoming replacement on a SWAP.
4. Derive the allowed target status from job type/current status rather than accepting any globally valid target from the client.
5. Reject historical jobs once their operational follow-up window/state is complete.
6. Keep OWNER/ADMIN manual inventory authority separate if the broader lifecycle controls are intentional for them.

### Required tests

Add adversarial tests proving:

- a historical completed job cannot be reused later as general appliance authority;
- an unrelated target state is denied even when globally legal;
- SWAP incoming-unit intent is enforced;
- the returned/outgoing unit cannot be manipulated using the incoming-unit shortcut;
- DELIVERY/INSTALLATION/REMOVAL follow-ups only permit the job-appropriate transition;
- OWNER/ADMIN retain the intended broader authority;
- direct STAFF calls cannot bypass the UI's suggested-action constraints.

---

## H2 — Deactivation does not transactionally fence every already-authorized STAFF mutation

**Severity:** High  
**Primary files:**

```text
src/lib/session.ts
src/domains/staff/index.ts
src/domains/tasks/index.ts
src/app/desk/jobs/actions.ts
src/domains/jobs/index.ts
src/domains/inventory/index.ts
```

### Problem

The normal offboarding flow is good for **future requests**:

- `deactivateStaffAccount()` sets `User.archivedAt`;
- it deletes the user's live Session rows in the same transaction;
- `requireSession()` rejects archived accounts;
- future protected requests therefore fail.

However, `requireRole()` is evaluated at the start of a server request. A request can pass that check while the staff member is still active, then continue executing after the owner removes access.

Example:

```text
STAFF request: requireRole() succeeds
OWNER: deactivates staff, archives user, deletes sessions, commits
STAFF request: continues and writes job/appliance state
```

The task subsystem explicitly recognizes this race and solves it: `activeStaff(tx, userId)` locks the User row with `FOR SHARE` and verifies `archivedAt IS NULL` inside the same transaction as the task write.

The same protection is not consistently applied to other STAFF-permitted writes such as job checklist/photo/status and the job-origin appliance status shortcut.

### Why this matters

The UI says “Remove access,” and session revocation strongly implies a hard administrative boundary. A mutation that commits after that boundary undermines the meaning of offboarding and can be difficult to explain during an incident review.

This is most relevant for long-running/slow requests, mobile connections, retries, or requests already in flight when access is removed.

### Required remediation

Extract the task subsystem's proven actor-validation pattern into a narrow reusable helper, for example:

```text
assertActiveTeamActor(tx, userId)
```

For every STAFF-permitted database mutation:

1. enter a database transaction;
2. lock/read the actor identity row;
3. require `archivedAt = null` and an allowed role;
4. perform the business mutation;
5. create the audit row in the same transaction.

The locking model should ensure deactivation and a staff mutation serialize predictably:

- either the staff mutation commits while the account is still active and deactivation waits;
- or deactivation commits first and the mutation fails.

Do not depend solely on an earlier session check for this boundary.

### Required tests

Use real Postgres concurrency tests, not mocks, to prove:

- task write vs deactivation behaves deterministically;
- job status write vs deactivation behaves deterministically;
- checklist write vs deactivation behaves deterministically;
- photo-row creation vs deactivation behaves deterministically;
- appliance follow-up write vs deactivation behaves deterministically;
- after deactivation commits, no subsequent STAFF mutation can commit under the old session/request identity.

---

## H3 — Staff account lifecycle state, audit records, and invitation side effects can split

**Severity:** High  
**Primary files:**

```text
src/domains/staff/index.ts
src/app/desk/settings/actions.ts
tests/staff-accounts.test.ts
```

### Problem

Staff account creation crosses several state boundaries:

1. Better Auth creates the account;
2. the User row is changed to STAFF / verified;
3. a setup/reset-password invitation is attempted;
4. a `staff.create` audit row is created.

The audit is not part of the same atomic database boundary as the account state, and the invitation is an external side effect.

A failure late in this process can therefore leave a real STAFF account while the caller receives an error or while no `staff.create` audit exists.

Deactivation is better: archive + session deletion are together in a Prisma transaction. But its `staff.deactivate` audit is written afterward. If audit creation fails, access has already been removed while the action can fail and the accountability record is missing.

Reactivation similarly clears `archivedAt` before writing its audit.

The current staff-account tests are mock-based and verify calls were made; their mocked `$transaction` is effectively `Promise.all`. They do not prove rollback semantics against the real schema or failure boundaries.

### Why this matters

Staff access changes are security/accountability events. The system should be able to answer reliably:

- who created the account;
- when it gained access;
- whether invitation delivery succeeded;
- who removed access;
- when sessions were revoked;
- who restored access.

An access state without its corresponding audit event is a meaningful accountability gap.

### Required remediation

Split staff-account lifecycle into a **transactional access-state core** and **recoverable notification side effect**.

Recommended design:

#### Creation

Within one database transaction, create/prepare the auth/user identity using the same underlying transaction-safe pattern already used by hardened customer/lead account creation, then:

- set role STAFF;
- set verification state as intended;
- write `staff.create` audit;
- optionally create a durable invitation/outbox row.

After commit, send the setup email. If delivery fails:

- the account remains real;
- the UI clearly reports “account created, invitation pending/failed”;
- resend is safe and targets that account ID;
- no duplicate staff account is created.

#### Deactivation

Archive the user, delete sessions, and write `staff.deactivate` audit in one transaction.

#### Reactivation

Clear `archivedAt` and write `staff.reactivate` audit in one transaction.

### Required tests

Add real database tests for:

- audit failure during creation rolls back the local access state;
- invitation failure does not roll back a successfully committed account;
- deactivation audit failure cannot leave an un-audited access-state change;
- archive + session deletion + audit are atomic;
- reactivation + audit are atomic;
- retry after invitation failure does not create another account.

---

## H4 — STAFF operational audit coverage is incomplete and several audit writes are non-atomic

**Severity:** High  
**Primary files:**

```text
src/domains/jobs/index.ts
src/domains/inventory/index.ts
src/domains/activity/index.ts
src/app/desk/jobs/actions.ts
```

### Problem

The project describes `AuditLog` as the record of who changed what and when, and staff accountability is a core Package 3 concern. Several STAFF-permitted mutations do not satisfy that standard consistently.

Examples:

### Job checklist

`updateJobChecklistAction()` allows STAFF, but `updateJobChecklist()` performs a plain `prisma.job.update()` and does not receive an actor ID or create any audit record.

`STAFF_ACTIVITY_ACTIONS` nevertheless includes `job.checklist`, which suggests the activity layer expects such an event even though the mutation path does not emit it.

### Job photo

`addJobPhoto()` creates the Photo row, then creates the audit row separately. If audit creation fails, the photo remains but accountability is missing.

### Appliance status

`updateApplianceStatus()` uses good optimistic concurrency for the appliance row, but the status update and subsequent audit insert are not one transaction. An audit failure can leave the appliance changed without the corresponding audit record.

### Why this matters

These are exactly the kinds of actions a business may later need to reconstruct:

- who marked a field checklist item complete;
- who changed a unit's lifecycle status;
- who attached a condition photo;
- whether the action happened before or after a disputed delivery/return.

A partial audit implementation gives a false sense that `/desk/activity` is comprehensive.

### Required remediation

For database-only operational mutations:

- accept/derive actor identity explicitly;
- validate the actor inside the transaction where needed for H2;
- write business state and `AuditLog` in the same transaction.

For job checklist changes, create a dedicated audit event such as `job.checklist` with a bounded old/new summary rather than dumping arbitrarily large JSON if the checklist grows.

For uploaded media, the external blob upload cannot be rolled back transactionally with Postgres, but the **database Photo row + audit row** can and should be atomic once the upload reference is accepted.

### Required tests

Prove:

- checklist changes create actor-attributed audit rows;
- failed audit insert rolls back checklist DB change;
- failed audit insert rolls back Photo row creation;
- failed audit insert rolls back appliance status change;
- STAFF activity shows the emitted operational event;
- OWNER/ADMIN activity remains complete.

---

## H5 — Hard task deletion loses the business-record linkage needed to reconstruct the deleted task

**Severity:** High  
**Primary files:**

```text
src/domains/tasks/index.ts
prisma/schema.prisma
src/app/desk/tasks/task-row.tsx
```

### Problem

Task mutation concurrency itself is strong. The issue is deletion accountability.

`StaffTask` can be linked to:

- a Lead;
- a Customer;
- a Job.

On delete, the task row is hard-deleted and a `task.delete` audit entry is created in the same transaction.

However, the audit `snapshot()` only preserves:

```text
note
dueDate
priority
assigneeUserId
version
completedAt
```

It does **not** preserve:

```text
leadId
customerId
jobId
createdByUserId
```

After the StaffTask row is deleted, `AuditLog.entityId` points to an entity that no longer exists, and the audit payload cannot answer which customer/job/lead the removed follow-up concerned.

### Why this matters

A deleted operational follow-up is often most important precisely when someone later asks:

- “Was there a task to call this customer?”
- “Was this task tied to that delivery?”
- “Who originally created it?”
- “Why did it disappear from the customer record?”

The current delete audit can prove that *a task ID* was deleted, but not fully reconstruct its business context.

### Required remediation

At minimum, expand the immutable audit snapshot to include:

```text
createdByUserId
assigneeUserId
leadId
customerId
jobId
note
dueDate
priority
completedAt
version
```

Prefer preserving the linkage IDs in every task create/update/delete audit snapshot, even if edits cannot change them, because that makes each event independently intelligible.

Consider whether a `deletedAt` soft-delete is preferable to hard deletion for operational follow-ups. If hard deletion is retained, the audit payload must be sufficient to reconstruct the deleted record's context without joining to StaffTask.

### Required tests

- delete a customer-linked task and prove the audit retains `customerId` after the task row is gone;
- same for job and lead linkage;
- audit retains original creator and assignee;
- STAFF still cannot create/link lead tasks;
- concurrent delete/edit behavior remains version-safe.

---

# Medium findings

## M1 — Offboarding leaves open work assigned to an inactive staff member without an explicit requeue decision

**Severity:** Medium  
**Primary files:**

```text
src/domains/staff/index.ts
src/domains/tasks/workspace.ts
src/app/desk/tasks/task-row.tsx
```

### Problem

When a staff user is deactivated, the user row remains for history and open tasks continue pointing to that user.

The task UI does correctly label that assignee as `(inactive)`, and team-wide/due views still surface the task. This prevents the issue from being High severity.

However:

- the former staff member's `Mine` view is no longer accessible to them;
- the task is not `Unassigned`;
- there is no explicit offboarding workflow requiring the owner/admin to reassign or unassign their open work.

Operationally, an open task can therefore remain owned by someone who can no longer perform it.

### Required remediation

Make offboarding handle open task ownership deliberately.

Reasonable options:

1. during deactivation, atomically unassign open tasks and audit that requeue;
2. require OWNER/ADMIN to choose a replacement assignee before completing deactivation;
3. provide an explicit offboarding review showing open tasks and allowing bulk reassignment.

Preserve completed tasks' historical assignee rather than rewriting old work history.

### Required tests

- completed historical tasks keep their assignee;
- open tasks follow the chosen offboarding policy;
- deactivation cannot silently strand hidden work;
- the reassignment/unassignment is audited.

---

## M2 — STAFF activity omits task edits/deletions and task activity is grouped as “Other”

**Severity:** Medium  
**Primary file:**

```text
src/domains/activity/index.ts
```

### Problem

The STAFF audit allowlist contains:

```text
task.create
task.complete
task.reopen
```

but current task mutations also emit:

```text
task.update
task.delete
```

Those legitimate STAFF-permitted actions are therefore hidden from the STAFF activity view.

Separately, `getActivitySummary()` has category prefixes for leads, estimates, agreements, jobs, billing, maintenance, customers, inventory, parts, pricing and settings, but no `task.` prefix. Task activity therefore falls into `Other` rather than a Task activity category.

Package 1 independently identified the missing `task.update` allowlist entry. Package 3 broadens the accountability impact to deletion and summary categorization; final remediation planning should deduplicate the overlap rather than treating them as separate implementation work.

### Required remediation

- add `task.update` and `task.delete` to the STAFF-safe allowlist if shared team task edits/deletions are intended STAFF capabilities;
- add `task.` -> `Tasks` to the activity summary category map;
- add plain-English labels for task events;
- regression-test the allowlist against every STAFF-permitted task mutation.

---

## M3 — “Resend setup email” accepts an arbitrary email instead of a verified STAFF account ID

**Severity:** Medium  
**Primary files:**

```text
src/app/desk/settings/actions.ts
src/app/desk/settings/staff-accounts-section.tsx
src/domains/staff/index.ts
```

### Problem

The UI presents “Resend setup email” on a STAFF account row and passes that row's email address.

The server action, however, accepts a raw `email: string`, verifies only that the caller is OWNER/ADMIN, and sends the password-reset/setup invitation to that email. It does not load a User and prove the target is a STAFF account.

A direct server-action call could therefore ask this staff-management endpoint to send a password-reset/setup message to another account type if its email is known.

This is not privilege escalation by itself—OWNER/ADMIN already has high trust—but it violates the stated scope of the operation and creates avoidable account-management ambiguity.

### Required remediation

Change the action contract to accept `staffUserId`, then server-side:

1. load User by ID;
2. require `role === STAFF`;
3. use the canonical stored email;
4. optionally reject archived users unless the desired restore/invite policy explicitly permits it;
5. audit resend attempts if account-invitation history is considered operationally important.

Never trust a client-supplied email as the identity of the staff account being managed.

---

## M4 — Exception inbox performs broad, unbounded aggregation on a core daily workspace

**Severity:** Medium  
**Primary files:**

```text
src/domains/exceptions/index.ts
src/app/desk/today/page.tsx
```

### Problem

`getExceptions()` runs a large `Promise.all()` across roughly nine categories and returns every matching row before sorting the combined result in memory.

Depending on role, this can include all:

- billing-blocked agreements;
- stale reservations;
- past-due invoices;
- overdue jobs;
- old unreviewed maintenance requests;
- uninspected appliances;
- completed repair jobs missing cost entries;
- active fixed-term agreements;
- rented appliances.

The rented-appliance query also loads **all completed maintenance-visit job histories for every rented appliance**, then sorts each appliance's dates in JavaScript to determine the latest completed maintenance visit.

This is on `/desk/today`, a page intended to be opened frequently as the daily operating workspace.

### Risk

As jobs, invoices, rentals and maintenance history accumulate, a page whose purpose is “show me what needs attention now” can become proportional to lifetime business history.

The issue is not today's data volume; it is the query shape at scale.

### Required remediation

Keep the exception inbox deliberately bounded.

Recommended approach:

- query only enough rows per category to render the first page/summary;
- return category counts separately where useful;
- add a “view all” route/filter for categories with more items;
- for maintenance-due calculation, ask Postgres for the latest relevant maintenance completion rather than materializing all maintenance visits in application memory;
- prefer indexed `orderBy ... take: 1`, aggregate/subquery, or a dedicated last-maintenance timestamp/materialized fact if query plans justify it;
- preserve STAFF finance exclusions in both counts and rows.

### Required tests

Add scale fixtures proving `/desk/today` remains bounded with:

```text
1000+ jobs
1000+ invoices
hundreds of active/rented appliances
large per-appliance maintenance histories
```

The acceptance test should verify query/result bounds, not only rendered correctness.

---

## M5 — Fixed-term exception dates use month arithmetic that can overflow at month end

**Severity:** Medium  
**Primary file:**

```text
src/domains/exceptions/index.ts
```

### Problem

The exception inbox calculates a fixed-term end using roughly:

```ts
const result = new Date(date);
result.setMonth(result.getMonth() + months);
```

JavaScript's `Date.setMonth()` preserves the day number by overflow rather than automatically clamping to the last day of the target month.

For dates near month end, that can push the computed term end into the following month. A rental beginning on a 29th/30th/31st can therefore have its “term expired” exception appear later than the intended calendar-month anniversary.

The existing exception tests verify the pure display builder, not the database wrapper's month-end date calculation.

### Required remediation

Use a shared calendar-month helper with an explicit business rule for month-end clamping.

For example, if the intended rule is “same day-of-month, or last day when unavailable”:

```text
Aug 31 + 6 months -> Feb 28/29
Jan 31 + 1 month -> Feb 28/29
Feb 29 + 12 months -> Feb 28 in non-leap year
```

Use the same helper for any future renewal/term-boundary calculations so Package 2's renewal work and Package 3's exception warnings cannot disagree.

### Required tests

Cover:

- 31st -> shorter month;
- leap day + 12 months;
- six-month terms crossing February;
- year boundary;
- Mountain Time display/date semantics around DST where relevant.

---

# Verified strengths / non-findings

A high-quality audit should explicitly preserve what is already correct.

## 1. Server-side role enforcement is real, not only hidden navigation

`requireSession()` rejects malformed/archived sessions and `requireRole()` is used as the server gate. The coarse `src/proxy.ts` cookie check is explicitly documented as insufficient by itself.

Sensitive settings/staff-management actions require OWNER/ADMIN.

## 2. Deactivation blocks future requests and revokes existing session rows

`deactivateStaffAccount()` archives the STAFF user and deletes their Session rows together in one database transaction. `requireSession()` rejects archived identities. H2 concerns the narrower race with a request that already passed authorization before deactivation; it does not negate the future-request protection.

## 3. STAFF finance isolation has strong dedicated DTOs and tests

The desk-access layer uses narrow STAFF selections rather than returning full financial records and hiding values in React.

Existing tests verify that STAFF cannot directly access finance-bearing agreement/customer/inventory/fleet functions and E2E coverage checks operational payloads for restricted values.

This is a meaningful positive control and should not be replaced with broad `include` queries during future feature work.

## 4. Shared team task visibility is intentional

The current task workspace explicitly describes itself as shared team follow-up work and the overhaul plan says to preserve team-shared visibility unless a future product decision changes it.

Therefore this audit does **not** treat “STAFF can see another team member's task” as a defect.

If private tasks or department scopes are desired later, that should be a deliberate product model, not retroactively inferred as a security requirement.

## 5. Task concurrency and mutation atomicity are strong

The task subsystem is one of the best implementations reviewed in this package:

- actor identity is revalidated inside the transaction;
- actor User row is locked against deactivation races;
- assignee must be active;
- STAFF cannot link tasks to leads;
- record links are immutable on edit;
- `version` provides optimistic concurrency;
- update/delete use compare-and-set behavior;
- repeated complete/reopen is idempotent;
- task state and its audit event are committed in the same transaction.

This should be used as the codebase pattern for H2/H4 rather than rewritten unnecessarily.

## 6. Task workspace ordering is deterministic and indexed for primary filters

The workspace uses priority, due date, created time and ID as ordering keys. The schema includes indexes for completed/due filtering and assignee/completed filtering. No generic “task list is unindexed” finding is warranted.

## 7. Exception inbox finance scoping is role-aware

For STAFF, the exception query suppresses finance-bearing categories such as billing-blocked agreements, past-due invoices and missing repair costs. Operational categories remain visible. This matches the current one-STAFF-role product decision.

## 8. Exception rules are intentionally simple and explainable

The 2-day unreviewed-maintenance, 3-day uninspected-return and 180-day maintenance-due thresholds are documented workflow rules, not hidden scoring. This audit does not reclassify those owner-workflow thresholds as defects simply because they may eventually become configurable.

---

# Cross-package overlaps and deduplication notes

The six-package audit program will naturally discover some issues from multiple angles. Final implementation planning must deduplicate these rather than counting them twice.

## Package 1 overlap

Package 1 independently identified that STAFF activity omitted `task.update`. Package 3 M2 covers the same defect in its broader accountability context and adds `task.delete` plus task-summary categorization. Implement once.

Package 1 also identified unstable timestamp-only pagination in the general activity feed. That remains valid but is not counted again in Package 3.

## Package 2 overlap

Package 2 covers fixed-term renewal/auto-renew/termination behavior and identified the risk of billing past a fixed term. Package 3 M5 is narrower: the **exception warning's term-date arithmetic** can be wrong at month-end. Do not treat those as the same fix, but use one shared term-boundary date helper so the two packages agree.

## Future workflow overlap

The roadmap's job/dispatch buildout may add assignees/durations/conflict handling. H1/H2 should be addressed in the underlying authorization/mutation layer so future job assignment does not have to rediscover these safeguards in each UI component.

---

# Codebase-specific remediation plan

To respect the project's reduced-PR strategy, Package 3 should not create ten separate PRs. The findings group naturally into three substantial remediation packages.

---

## Remediation Package P3-A — Permission & offboarding integrity

**Priority:** Immediate  
**Addresses:** H1, H2, M3

### A1. Introduce a reusable active-team-actor transaction guard

Extract the proven pattern from `src/domains/tasks/index.ts` into a server-only helper, for example:

```text
src/domains/access/active-team-actor.ts
```

Responsibilities:

- lock User identity row for the transaction;
- require `archivedAt = null`;
- require one of the explicitly allowed roles;
- return a narrow `{id, role}` actor object.

Do not put page redirection behavior in this helper. It is a domain mutation invariant, separate from `requireRole()` routing/session UX.

### A2. Apply the guard to STAFF-permitted mutations

At minimum review and convert:

```text
updateJobStatus
addJobPhoto
updateJobChecklist
updateApplianceStatusFromJobAction / underlying scoped mutation
other direct STAFF mutation paths discovered during implementation
```

Business state + audit should share the transaction wherever both are Postgres writes.

### A3. Replace historical JobAppliance membership authorization

Create a domain-level command for STAFF appliance follow-up rather than passing arbitrary status through a generic inventory mutation.

Example conceptual API:

```text
applyStaffJobApplianceFollowUp(actorId, jobId, applianceId, operation)
```

Server decides the status transition from current job context.

For SWAP, use the recorded incoming-unit intent already available to the codebase rather than trusting any linked unit.

### A4. Harden setup-email resend identity

Change the server action from:

```text
resendStaffActivationEmailAction(email)
```

to:

```text
resendStaffActivationEmailAction(staffUserId)
```

Resolve canonical email server-side and validate role STAFF.

### A5. Real concurrency/permission tests

Add real Postgres tests for:

- deactivation vs job status update;
- deactivation vs checklist save;
- deactivation vs appliance follow-up;
- historical job cannot authorize a fresh inventory mutation;
- STAFF cannot request arbitrary global status transitions via a job;
- OWNER/ADMIN intended manual authority remains intact.

### Acceptance criteria

- no STAFF write can commit after deactivation has committed;
- a historical job link alone is insufficient authorization;
- allowed STAFF appliance follow-up is derived from current workflow state;
- staff-account resend targets a verified STAFF User ID only.

---

## Remediation Package P3-B — Staff lifecycle & audit integrity

**Priority:** High  
**Addresses:** H3, H4, H5, M1, M2

### B1. Make staff access-state changes and audits atomic

Refactor create/deactivate/reactivate so database access state and its audit event share a transaction.

Creation should reuse the project's hardened auth-row/account-creation pattern rather than adding another fragile account lifecycle.

### B2. Make invitation delivery recoverable

Treat email as a post-commit side effect:

- committed staff account can exist with invitation state `pending/failed`;
- setup-email failure must not make the UI suggest creating another account;
- resend is idempotent and account-ID based;
- optionally use the same durable notification/outbox pattern recommended by Package 1.

### B3. Audit all STAFF operational writes

Add actor-aware transactional auditing for:

```text
job.checklist
job.photo.add
appliance.unit.status
```

and inspect every other STAFF-permitted mutation while touching this layer.

Do not add an allowlist entry without an actual emitter.

### B4. Preserve task deletion context

Expand task audit snapshots with immutable business link and creator fields.

Evaluate soft-delete vs hard-delete. If hard-delete stays, audit must be self-contained.

### B5. Add explicit offboarding task handling

Choose one policy before implementation:

- automatically unassign open tasks;
- force reassignment during deactivation; or
- present a required open-work review.

Do not rewrite historical completed-task assignees.

### B6. Align activity feed with actual task actions

Update:

- STAFF allowlist;
- `describeAuditAction()` labels;
- activity summary category mapping;
- regression tests enumerating every shared-task mutation.

### Acceptance criteria

- staff create/deactivate/reactivate cannot commit without their audit event;
- invitation failure is recoverable without duplicate account creation;
- every STAFF business mutation that should be accountable emits an actor-attributed audit;
- task delete audit can be understood after StaffTask is gone;
- open tasks cannot remain silently stranded on a deactivated user under the chosen policy;
- `/desk/activity` consistently represents STAFF task work.

---

## Remediation Package P3-C — Exception inbox correctness & scale

**Priority:** Medium before scale/launch acceptance  
**Addresses:** M4, M5

### C1. Create a shared calendar-term helper

Add one tested utility for contract-month arithmetic. Use it from exception logic and future renewal/end-of-term behavior.

Document the month-end policy explicitly.

### C2. Bound exception queries

Replace “load every matching record” with a summary/page contract.

Suggested return shape:

```text
{
  items: first N highest-priority exceptions,
  countsByCategory,
  hasMore
}
```

or category-specific sections if that maps better to the Today UI.

### C3. Stop materializing full appliance maintenance histories

For each rented appliance, retrieve only the latest completed maintenance visit or maintain a dedicated last-maintenance fact if query-plan evidence supports it.

### C4. Preserve role-specific finance filtering

The optimized query must continue to ensure STAFF does not query/receive financial exception details merely because the UI later hides them.

### C5. Scale test

Add realistic high-volume fixtures and measure/query-bound behavior for `/desk/today`.

### Acceptance criteria

- month-end term dates are correct;
- `/desk/today` work is bounded by current attention needs rather than lifetime row count;
- latest-maintenance lookup does not load every historical visit;
- finance exclusions remain enforced at query level for STAFF.

---

# Recommended implementation order

Use this order:

```text
P3-A Permission & offboarding integrity
P3-B Staff lifecycle & audit integrity
P3-C Exception inbox correctness & scale
```

P3-A and P3-B can potentially be one substantial security/accountability PR if the diff remains reviewable. P3-C is sufficiently independent to remain separate.

Do not create one PR per audit finding.

---

# Test plan

Package 3 remediation should add targeted tests before one full CI run per substantial PR.

## Authorization

- CUSTOMER cannot invoke desk operational commands.
- STAFF cannot invoke OWNER/ADMIN finance/settings commands.
- STAFF job-scoped appliance actions validate current workflow context.
- historical JobAppliance rows do not grant indefinite mutation authority.
- setup-email resend requires a STAFF target.

## Offboarding concurrency

Use real Postgres concurrent transactions for:

```text
staff mutation starts -> deactivation races

deactivation commits first -> staff mutation rejected
staff mutation commits first -> deactivation completes afterward
```

Cover tasks and at least one job/inventory mutation.

## Audit atomicity

Inject database failure around audit creation and prove rollback for:

- staff deactivate/reactivate;
- job checklist;
- Photo row creation;
- appliance status;
- task deletion context remains available.

## Task concurrency

Retain existing tests for:

- stale version conflict;
- draft text preservation;
- repeated completion/reopen idempotency;
- active assignee validation;
- deactivation actor lock.

Add only the missing deletion-context/offboarding cases; do not rewrite working concurrency logic.

## Exception correctness

- Jan 31 + 1 month;
- Aug 31 + 6 months;
- Feb 29 + 12 months;
- business timezone rendering;
- role-specific exception visibility;
- large data set produces bounded result/query shape.

## Activity accountability

Enumerate every STAFF-permitted task/job/inventory mutation and verify the expected audit event appears or is intentionally documented as non-audited.

---

# Definition of done for Package 3

Package 3 remediation is complete only when all of the following are true:

- [ ] Historical job links cannot be reused as indefinite STAFF inventory authority.
- [ ] STAFF appliance follow-up transitions are derived from current job/workflow context.
- [ ] All STAFF-permitted writes revalidate active actor state at the transactional mutation boundary where needed.
- [ ] A deactivation that has committed prevents any later STAFF mutation from committing under the old identity/session.
- [ ] Staff create/deactivate/reactivate access state and audit events are atomic.
- [ ] Staff invitation delivery failure is recoverable without creating duplicate accounts.
- [ ] Resend setup email accepts a verified staff account ID rather than arbitrary target email.
- [ ] Job checklist changes are actor-attributed and audited.
- [ ] Job Photo row + audit are atomic once the upload reference is accepted.
- [ ] Appliance status change + audit are atomic.
- [ ] Task deletion audit preserves lead/customer/job linkage and creator context after hard deletion, or tasks use an approved soft-delete design.
- [ ] Offboarding has an explicit policy for open tasks assigned to the departing/inactive user.
- [ ] STAFF activity includes intended `task.update` / `task.delete` events and task summary categorization.
- [ ] Exception inbox queries are bounded for realistic scale.
- [ ] Latest maintenance state is not calculated by loading every maintenance job for every rented unit.
- [ ] Fixed-term month arithmetic has explicit tested month-end behavior.
- [ ] Existing STAFF financial-data isolation tests continue to pass.
- [ ] Existing task concurrency/idempotency tests continue to pass.
- [ ] Real Postgres concurrency/rollback tests cover the new security/accountability invariants.
- [ ] Full CI is run once per substantial remediation PR, not after each small edit.

---

# Suggested implementation ownership by code area

This section is intentionally concrete so a future coding agent can work directly from the report.

## `src/domains/tasks/`

Keep the current transaction/version design. Change only what Package 3 requires:

- export/reuse actor-lock pattern if appropriate;
- expand audit snapshot context;
- apply chosen task offboarding policy through a dedicated service, not ad hoc UI updates.

## `src/domains/staff/`

Refactor lifecycle into transaction-safe commands:

```text
createStaffAccount
resendStaffActivationEmail
deactivateStaffAccount
reactivateStaffAccount
```

Keep all target-role validation in the domain, not only in the settings UI.

## `src/domains/jobs/`

- accept actor in checklist update;
- transactionally audit checklist/photo changes;
- use active actor guard for STAFF-capable writes.

## `src/domains/inventory/`

- make status + audit atomic;
- keep existing optimistic concurrency;
- do not put STAFF job-scope authorization into the generic owner-capable inventory function unless the API clearly distinguishes scope.

## `src/app/desk/jobs/actions.ts`

Keep server actions thin. For STAFF appliance follow-up, delegate to a domain command that validates job context rather than performing a shallow `JobAppliance.findFirst()` then calling generic status mutation.

## `src/domains/activity/`

Update allowlist/categories/labels from the actual set of emitted STAFF events and add consistency tests.

## `src/domains/exceptions/`

- use shared contract-month arithmetic;
- introduce bounded reads/counts;
- push latest-maintenance selection into the database.

---

# Findings intentionally rejected or not promoted

## “STAFF can see team tasks”

**Not a defect.** Shared team visibility is the explicit current product decision and the task page says so. Private/team visibility can be revisited as a future feature, but this audit does not reinterpret an intentional shared workspace as a data leak.

## “Task updates are concurrency unsafe”

**Rejected.** Current task mutation code uses a version check plus conditional update/delete, and audit writes share the transaction. This is substantially better than a read-then-write implementation.

## “Deactivation does not work because old sessions exist”

**Rejected as stated.** Deactivation deletes Session rows and archived identities are rejected by `requireSession()`. H2 is specifically about an already-running request that passed the session check before deactivation.

## “STAFF can read all financial fields and UI merely hides them”

**Rejected.** The current desk-access implementation has STAFF-specific server selects and dedicated tests checking that restricted finance values are not present in payloads.

## “Exception inbox exposes finance to STAFF”

**Rejected.** Finance-bearing exception categories are gated out of the STAFF query path. Performance/term-date correctness are separate findings.

## “Inactive assignee on a task is an authorization vulnerability”

**Not by itself.** The task remains team-visible and the assignee is clearly labeled inactive. The operational issue is the lack of an explicit requeue/reassignment policy, rated Medium as M1.

---

# Final assessment

Package 3 is more mature than the audit roadmap's older notes imply. In particular, the current task subsystem and STAFF financial read isolation should be preserved as patterns for the rest of the codebase.

The remaining risk is concentrated in **authorization lifetime and accountability boundaries**:

> A role check at request start is not enough when access can be revoked concurrently, and a historical record relationship should not become permanent mutation authority.

The preferred remediation is therefore not a new permissions framework. It is to extend the codebase's already-successful task pattern—transactional active-actor validation, compare-and-set behavior, and atomic audit writes—to every STAFF mutation that needs the same guarantees, while making the exception inbox bounded and calendar-correct.
