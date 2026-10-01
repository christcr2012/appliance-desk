# Package 8 Audit — Operational Core & Residual Risk

**Audit date:** 2026-10-01  
**Repository:** `christcr2012/appliance-desk`  
**Audited branch:** `main`  
**Audited commit:** `851f31931f9b7cb3a300d4eaa580e78cb16d7dae`  
**Scope authority:** Owner-requested final catch-all audit after Packages 1–7  
**Status:** Audit complete; remediation not yet implemented by this report.

---

## Executive summary

Package 8 exists because the original six-package audit roadmap claimed to cover all business domains, but several of the application’s most consequential operational domains were never assigned as a primary audit scope:

- `src/domains/billing/*`
- `src/domains/inventory/*`
- `src/domains/jobs/*`
- `src/domains/purchasing/*`

Those domains were touched indirectly by prior packages — for example, Package 5 reviewed billing as a reporting input and Package 7 reviewed operational workflows from an integration/UI perspective — but neither is a substitute for a direct correctness audit of the operational core itself.

This final catch-all also performs a bounded residual sweep around those domains: concurrency, audit atomicity, business-time handling, scheduled automations, lifecycle consistency, purchasing provenance, repair-cost integrity, large-list behavior and public launch-policy seams. It intentionally does **not** re-audit Packages 1–7 or duplicate their findings merely to inflate the count.

The review found several issues important enough that the audit series should not have been considered closed without this package.

The most serious is in manual payment application. `recordManualPayment()` reads invoice balances before entering its transaction, then creates `Payment` rows and updates invoice balances from those stale values. Two simultaneous manual-payment attempts can therefore both record real incoming money while one balance update overwrites the other. The result can be a ledger that says $100 was received while the invoice says only $50 was paid. This is a direct financial-integrity failure and is the only new Critical finding in Package 8.

Other High findings include:

- write-off racing a legitimate payment;
- duplicate Stripe Customer creation on concurrent first billing;
- concurrent late-fee runs creating duplicate fee line items while totals reflect only one fee;
- jobs accepting appliance IDs that are not proven to belong to the job’s agreement/customer lifecycle;
- completed jobs silently tolerating failed appliance lifecycle transitions;
- day-of SMS reminders using the server’s calendar day rather than the business’s Colorado day;
- swap initiation rewriting appliance assignment history before the physical swap happens;
- non-atomic inventory creation with a race-prone human asset-number allocator;
- business mutations and their audit records not always being atomic, with supplier edits not audited at all;
- part usage silently clamping impossible stock consumption to zero;
- an appliance inspection being allowed to pass with an empty or unchecked checklist.

The remaining Medium findings cover negative repair costs, mutable unaudited job checklists, inconsistent business-day semantics, send-then-mark reminder duplication, unbounded operational lists, disconnected parts/purchase/job-cost accounting, and publicly indexable draft legal pages.

### Overall assessment

**HIGH OPERATIONAL-INTEGRITY RISK until Package 8 Critical/High findings are remediated or explicitly accepted.**

The system has many strong race-safe patterns already — conditional status transitions, transactional guided actions, webhook deduplication and explicit business-time utilities among them. The concern is inconsistency: those good patterns are not yet applied uniformly across the remaining operational core.

| Severity | Findings |
| --- | ---: |
| Critical | 1 |
| High | 11 |
| Medium | 7 |
| **Total** | **19** |

---

# Why Package 8 was necessary

The original `docs/AUDIT_ROADMAP.md` assigned primary ownership as follows:

| Package | Primary domains |
| --- | --- |
| 1 | customers, portal, maintenance, estimates, activity |
| 2 | agreements, pricing, referrals |
| 3 | staff, desk-access, tasks, exceptions |
| 4 | growth, launch, search |
| 5 | settings, reports, dashboard |
| 6 | uploads, backup, auth/session cross-cutting |

Yet current `main` also contains substantial billing, inventory, jobs and purchasing domains. Billing alone includes checkout, recurring billing, webhooks, reminders, late fees, manual payments, statements, invoice detail and revenue projections. Inventory and jobs jointly own the physical custody lifecycle of every rented asset. Purchasing owns part inventory and purchase-order receiving.

Package 8 therefore treats these domains as first-class audit subjects instead of assuming indirect review was sufficient.

---

# Critical findings

## C1 — Concurrent manual payments can make `Payment` records disagree with the invoice balance

**Severity:** Critical  
**Primary file:** `src/domains/billing/manual-payments.ts`

### Problem

`recordManualPayment()` performs its invoice read before the transaction:

```text
prisma.invoice.findMany(...)
```

It then enters a transaction and, for each stale invoice object:

1. computes the outstanding amount from the previously read `amountPaidCents`;
2. creates a new succeeded `Payment` row;
3. computes `newAmountPaidCents = oldAmountPaidCents + appliedCents`;
4. unconditionally updates the invoice to that value.

The read and write are therefore not one serialized operation.

### Failure example

An invoice is $100 due with $0 paid.

Two owner tabs record $50 at nearly the same time:

```text
Request A reads amountPaid = $0
Request B reads amountPaid = $0

A creates Payment($50)
B creates Payment($50)

A writes invoice.amountPaid = $50
B writes invoice.amountPaid = $50
```

Final state:

```text
Payment rows received: $100
Invoice amountPaid:      $50
Invoice balance:          $50
```

Both payment rows are individually legitimate. The invoice projection is wrong.

### Why this is Critical

This is not a cosmetic reporting issue. It can cause the product to pursue money that was already received, misstate customer balances, produce incorrect statements, and diverge from physical cash/check records.

### Required remediation

Choose one serialized allocation model:

- lock the target invoice rows inside the transaction (`FOR UPDATE`) before calculating allocations; or
- use serializable isolation with bounded retry; or
- use compare-and-swap updates whose `where` clause includes the prior balance/status and retry on conflict.

The payment receipt/allocation redesign already recommended by Package 5 can be implemented at the same time, but C1 must not wait for a broad accounting redesign if that delays the concurrency fix.

### Required tests

Use real Postgres integration tests, not mocks:

- two simultaneous payments against one invoice;
- simultaneous payments large enough to overpay;
- one payment spread across several invoices while another payment arrives;
- manual payment racing a Stripe webhook payment;
- verify `sum(succeeded Payment allocations)` reconciles exactly to invoice paid state and unapplied credit;
- retry behavior must never duplicate a real receipt.

---

# High findings

## H1 — An invoice can be written off after it was paid by a racing request

**Severity:** High  
**Primary file:** `src/domains/billing/manual-payments.ts`

### Problem

`writeOffInvoice()` reads and validates the invoice before opening its transaction. The transaction then unconditionally writes `WRITTEN_OFF`.

A successful Stripe webhook or manual payment can change the invoice between those two steps. The stale write-off request can then overwrite the now-paid status.

### Required remediation

Perform the eligibility check and write under one transaction/lock or conditional update. A write-off claim should fail if the invoice status/balance changed after the owner loaded it.

### Required tests

- write-off vs. final payment race;
- write-off vs. partial payment race;
- duplicate write-off requests;
- a paid invoice can never end in `WRITTEN_OFF` due solely to request ordering.

---

## H2 — Concurrent first billing can create duplicate Stripe Customers

**Severity:** High  
**Primary file:** `src/domains/billing/checkout.ts`

### Problem

`ensureStripeCustomer()` does:

1. read local customer;
2. if `stripeCustomerId` is null, call `stripe.customers.create()`;
3. write the returned id locally.

Two concurrent first-billing flows can both observe null and both create a Stripe Customer. The local database can retain only one id, while the other provider object remains orphaned and a concurrent downstream Checkout Session can be attached to the losing id.

### Required remediation

Use a durable provider-creation claim/idempotency strategy. Options include a deterministic Stripe idempotency key tied to the Appliance Desk customer id plus a conditional local claim, followed by reconciliation if a provider request succeeds but the local update fails.

### Required tests

- concurrent `ensureStripeCustomer()` calls;
- provider success followed by local DB failure;
- retry after timeout where provider may already have created the customer;
- exactly one durable local/provider customer mapping remains authoritative.

---

## H3 — Concurrent late-fee runs can create duplicate fee line items while invoice totals reflect only one

**Severity:** High  
**Primary file:** `src/domains/billing/late-fees.ts`

### Problem

`applyLateFees()` first queries every candidate with `lateFeeCents = 0`. Each candidate is later processed in its own transaction that creates a `LATE_FEE` line item and updates the invoice.

Two overlapping cron executions can both select the same zero-fee invoice before either commits.

Each can then create its own fee line item. Both calculate the same `newAmountDueCents` from the same stale amount, so the final invoice total may reflect one fee even though two fee line items exist.

### Required remediation

Claim the invoice conditionally inside the transaction before creating the line item, or introduce a unique fee identity per invoice/cycle that the database enforces. The line-item insertion and invoice projection must remain one atomic unit.

### Required tests

- two simultaneous late-fee jobs;
- cron retry after failure between claim and line creation;
- no duplicate `LATE_FEE` lines;
- invoice totals always equal immutable line-item arithmetic.

---

## H4 — Job creation does not prove selected appliances belong to the job’s customer/agreement workflow

**Severity:** High  
**Primary files:**

```text
src/domains/jobs/index.ts
src/app/desk/jobs/actions.ts
```

### Problem

`createJob()` carefully checks that:

- a selected service address belongs to the selected customer;
- an agreement belongs to that customer/property;
- a maintenance request belongs to that customer.

But `applianceIds` are inserted directly into `JobAppliance` without equivalent ownership/lifecycle validation.

A delivery job for Agreement A can therefore be created with a RESERVED appliance that is actually reserved for Agreement B. When the job is completed, `applyJobCompletionToAppliances()` can move that listed asset to `RENTED` because the completion code trusts the job-appliance link.

### Required remediation

Validate appliance scope based on job type:

- DELIVERY/INSTALLATION: each appliance must be an active assignment for that agreement and in an allowed pre-delivery state;
- REMOVAL: each appliance must belong to that agreement/current customer custody;
- MAINTENANCE_VISIT: asset must belong to the linked customer/agreement when those links are present;
- SWAP: use the dedicated staged swap contract rather than arbitrary selections.

Reject cross-agreement/customer assets at the domain boundary even if the UI picker already filters them.

### Required tests

- appliance assigned to another agreement;
- appliance for another customer/property;
- unassigned AVAILABLE appliance incorrectly attached to removal;
- valid multi-appliance delivery;
- direct server-action tampering must be rejected.

---

## H5 — A completed job can silently fail to move its appliance lifecycle

**Severity:** High  
**Primary file:** `src/domains/jobs/index.ts`

### Problem

During job completion, appliance moves use a conditional `updateMany`. If a move loses a race, the code does:

```text
if (moved.count !== 1) continue;
```

The job still commits as `COMPLETED`.

That creates a dangerous semantic mismatch: the operational event says the delivery/removal completed, while the physical asset can remain in its prior lifecycle state. No durable exception is created to tell the owner that reconciliation is required.

### Required remediation

For lifecycle transitions that are mandatory consequences of completion, either:

- fail/roll back the job completion and ask the operator to reconcile; or
- complete the job but atomically create a durable high-priority exception/task naming the asset and expected transition.

Do not silently continue.

### Required tests

- appliance status changes between job read and completion;
- one conflict in a multi-appliance delivery;
- removal conflict;
- any accepted partial completion must surface a durable reconciliation item.

---

## H6 — Day-of SMS reminders use the server calendar day, not the Colorado business day

**Severity:** High  
**Primary files:**

```text
src/domains/jobs/day-of-reminders.ts
src/lib/business-date.ts
```

### Problem

The application already defines the business timezone as `America/Denver` and provides DST-aware `businessDayBounds()`.

The job-reminder code instead builds “today” with:

```text
new Date(now.getFullYear(), now.getMonth(), now.getDate())
end = start + 24 hours
```

On Vercel, the runtime calendar is generally UTC, not Colorado time. The fixed 24-hour window also cannot represent Colorado’s 23- and 25-hour DST transition days.

### Consequence

A customer can receive a “scheduled today” reminder on the wrong Colorado date, or fail to receive one for an evening job because UTC has already rolled to the next day.

### Required remediation

Use `businessDayBounds(now)` for all business-day selections. Keep the cron schedule in UTC if desired, but make the data window explicitly business-local.

### Required tests

- MDT and MST ordinary days;
- spring-forward day;
- fall-back day;
- jobs near Colorado midnight;
- test the actual scheduled cron execution time against the intended local day.

---

## H7 — Starting a swap rewrites assignment history before the physical swap occurs

**Severity:** High  
**Primary file:** `src/domains/inventory/guided-actions.ts`

### Problem

`startSwapForAppliance()` immediately:

1. closes the old appliance assignment;
2. creates the replacement assignment;
3. moves the old appliance to `MAINTENANCE`;
4. moves the replacement to `RESERVED`;
5. creates a SWAP job.

But the customer still physically has the old machine until the field visit happens.

The assignment history therefore records custody changes that have not yet happened. If the swap is cancelled, rescheduled or never completed, the rental-line assignment history is already wrong.

### Required remediation

Stage the proposed replacement without changing historical custody. On SWAP job completion, atomically:

- close the old assignment at the real swap time;
- open the new assignment;
- update both physical statuses;
- record the audit trail.

Cancellation must leave the original assignment intact.

### Required tests

- start then cancel swap;
- start then complete swap;
- replacement becomes unavailable before completion;
- concurrent swap attempts;
- revenue/utilization history uses the actual physical handoff timestamp.

---

## H8 — Batch appliance creation is non-atomic and its asset-number allocator races

**Severity:** High  
**Primary file:** `src/domains/inventory/index.ts`

### Problem

`createApplianceUnits()` finds the next human asset number by repeatedly querying whether `PREFIX-0001`, `PREFIX-0002`, etc. exists. It then creates each unit and its audit row sequentially, outside one encompassing transaction.

Two simultaneous additions can select the same next asset number. A unique constraint will protect the database from a duplicate, but one request can fail halfway through after some earlier units have already been created.

Likewise, an audit insertion can fail after the appliance row already committed.

### Required remediation

Use a concurrency-safe sequence/allocation strategy and define batch semantics explicitly:

- preferably all requested units and their audits commit atomically;
- use a database sequence/counter, advisory lock or bounded unique-conflict retry rather than scan-from-1 allocation;
- never return a generic “failed” result after silently creating a partial batch unless partial success is explicitly shown to the owner.

### Required tests

- two concurrent creates of the same appliance type;
- quantity > 1 with collision on a later unit;
- audit failure mid-batch;
- monotonically unique human asset numbers under concurrency.

---

## H9 — Operational business writes and audit records are not consistently atomic; supplier edits are unaudited

**Severity:** High  
**Primary files:**

```text
src/domains/inventory/index.ts
src/domains/jobs/index.ts
src/domains/purchasing/index.ts
```

### Confirmed examples

- `createJob()` creates the job, then separately creates its `AuditLog` row.
- appliance detail/status/photo mutations perform the business write and audit as separate operations in several paths.
- `createPurchaseOrder()` creates the order, then separately creates its audit record.
- `updatePartStockSettings()` updates inventory, then separately audits it.
- `createSupplier()` and `updateSupplier()` have no acting-user parameter and no audit entry at all.

If the business write succeeds and the audit write fails, the operational record changes with no accountability trail. Supplier contact/history changes are invisible to activity history by design today.

### Required remediation

Adopt a common mutation contract:

```text
validate → transaction → guarded business mutation + audit row → commit
```

Use provider calls outside DB transactions, but local mutation/audit pairs should normally be atomic.

### Required tests

Inject audit-write failures and prove the business mutation rolls back for local-only operations. Verify supplier create/update and financially relevant inventory changes produce meaningful history entries.

---

## H10 — Recording more part usage than exists silently erases the discrepancy

**Severity:** High  
**Primary file:** `src/domains/purchasing/index.ts`

### Problem

`recordPartUsage()` correctly row-locks the part, but computes:

```text
newQuantity = max(0, onHand - quantity)
```

If there are 2 parts on hand and the owner records that 10 were used, the system stores 0 and logs `usedQuantity: 10`.

The missing 8 parts disappear into an implicit discrepancy. The owner cannot tell whether:

- stock was previously wrong;
- the usage quantity was mistyped;
- parts were consumed before being received;
- an unrecorded purchase occurred.

### Required remediation

Do not silently clamp. Either reject usage above on-hand quantity with a corrective-stock workflow, or explicitly model/record the discrepancy with a reason and preserve the before/after delta.

### Required tests

- exact depletion;
- attempted over-consumption;
- concurrent receiving and usage;
- inventory correction path preserves an auditable explanation.

---

## H11 — An appliance can pass inspection with an empty or unchecked checklist

**Severity:** High  
**Primary files:**

```text
src/domains/inventory/guided-actions.ts
src/app/desk/inventory/actions.ts
```

### Problem

The server accepts `passed: boolean` independently from the submitted checklist. The checklist can be an arbitrary array and the domain does not require configured items to be present or checked before a pass moves the appliance from `AWAITING_INSPECTION` to `AVAILABLE`.

A direct/malformed request can therefore record:

```text
passed = true
checklist = []
```

and return the machine to rentable inventory.

### Required remediation

Define one explicit policy:

- normal pass is derived from all required checklist items being completed; or
- allow an override only for OWNER/ADMIN with a required reason.

Snapshot the checklist definition/version used for each inspection so later settings changes do not rewrite what “passed” meant historically.

### Required tests

- pass with missing item;
- pass with unchecked required item;
- modified/extra item injection;
- valid complete pass;
- explicit override, if supported, must be auditable.

---

# Medium findings

## M1 — Repair costs can be negative

**Severity:** Medium  
**Primary files:**

```text
src/app/desk/jobs/actions.ts
src/domains/jobs/index.ts
```

`repairCostSchema` accepts strings, and `dollarsToCentsOrNull()` checks only that `Number(raw)` is finite. Negative numbers pass through and are written directly to `partsCostCents` / `laborCostCents`.

Negative repair costs can artificially improve fleet profitability and ROI.

**Remediation:** enforce nonnegative, bounded money values in both the action schema and domain invariant; add negative/overflow tests.

---

## M2 — Job checklists remain editable after terminal status and are not attributed in audit history

**Severity:** Medium  
**Primary files:**

```text
src/app/desk/jobs/actions.ts
src/domains/jobs/index.ts
```

The checklist save explicitly has no status check. `updateJobChecklist()` receives no actor id and performs a plain update.

A completed or cancelled job’s field checklist can therefore be rewritten later without an audit entry explaining who changed it or why.

**Remediation:** either freeze terminal checklists, or preserve revisions with actor/timestamp/reason. If post-completion correction is allowed, make it visibly a correction rather than silently rewriting operational evidence.

---

## M3 — Billing/grace-period date calculations do not consistently use the business-calendar abstraction

**Severity:** Medium  
**Primary files:**

```text
src/domains/billing/late-fees.ts
src/domains/billing/reminders.ts
src/lib/business-date.ts
```

The app has a DST-aware `America/Denver` business-time layer, but:

- late-fee grace uses fixed `24h × days` arithmetic;
- billing reminder labels use `toLocaleDateString()` without the explicit business timezone.

These can shift the effective local date/hour around DST or UTC boundaries.

**Remediation:** define whether billing due/grace dates are instants or Colorado calendar dates and use one helper everywhere. Test month-end/DST boundaries.

---

## M4 — Customer reminders use a send-then-mark pattern that permits duplicate delivery

**Severity:** Medium  
**Primary files:**

```text
src/domains/billing/reminders.ts
src/domains/jobs/day-of-reminders.ts
```

Both flows send through the external provider first, then mark the database as sent. If the provider succeeds but the local update fails — or two cron invocations overlap — the same message can be sent again.

This overlaps Package 7’s broader durable-message-ledger recommendation; Package 8 confirms the concrete operational instances.

**Remediation:** implement the durable send-attempt/claim/reconciliation design once and route both automations through it.

---

## M5 — Several operational owner lists remain unbounded

**Severity:** Medium  
**Primary files:**

```text
src/domains/purchasing/index.ts
src/domains/inventory/index.ts
```

Examples include all suppliers, all purchase orders with lines, a supplier with all historical orders/lines, low-stock selection followed by in-memory filtering, and unpaginated inventory queries used by broad pickers.

These are reasonable at tiny scale but accumulate with the business.

**Remediation:** add bounded queries/pagination or search-backed pickers before volume requires loading the entire history into one request.

---

## M6 — Physical part stock, purchase cost and repair-cost profitability are separate manual truths

**Severity:** Medium  
**Primary files:**

```text
src/domains/purchasing/index.ts
src/domains/jobs/index.ts
src/domains/inventory/analytics.ts
```

Today:

- receiving a PO increases `PartRecord.quantityOnHand`;
- recording part usage decreases it through a separate manual action;
- the job’s `partsCostCents` is typed independently;
- purchase-order unit cost does not become a durable job-part usage cost record.

That means profitability can be wrong even when both the stock and purchase records are individually correct.

**Remediation:** introduce a lightweight `JobPartUsage` / cost-allocation record tying quantity consumed to the job and the cost basis used. Keep owner correction possible, but stop requiring the same real-world event to be retyped into unrelated records.

---

## M7 — Draft legal pages are publicly indexable while explicitly marked pending legal review

**Severity:** Medium  
**Primary files:**

```text
src/app/(public)/privacy/page.tsx
src/app/(public)/terms/page.tsx
src/components/site/draft-notice.tsx
```

Both Privacy and Terms set:

```text
robots: index, follow
```

while the rendered notice says the content is a draft pending lawyer review and is not final legal advice.

### Required remediation

Until legal approval is recorded:

- set draft legal pages to `noindex` or block production launch/indexing through the release gate;
- track approval/version/date as a launch prerequisite;
- remove the draft notice only after the approved wording is installed.

This is not a substitute for legal counsel; it is a product-release consistency issue.

---

# Verified strengths / non-findings

Package 8 also confirmed patterns worth preserving:

1. **Stripe Checkout and recurring subscription creation already use deterministic idempotency keys** for agreement checkout, estimate deposits and subscription creation. The problem in H2 is specifically Customer object creation, which lacks an equivalent guarantee.
2. **Webhook atomicity was materially strengthened before this audit.** Package 8 does not reopen already-remediated webhook dedupe merely because billing is now a primary audit domain.
3. **Job status changes use compare-and-swap semantics** and write their status audit inside the same transaction.
4. **Purchasing receive/cancel transitions use conditional status claims inside transactions**, preventing double-receiving of stock.
5. **`recordPartUsage()` already locks the part row**, so H10 is about business semantics of over-consumption, not a missing concurrency lock.
6. **Inventory lifecycle rules are centralized in a pure shared module**, avoiding server/UI transition-rule drift.
7. **Colorado business-day helpers explicitly handle 23/25-hour DST days.** Package 8’s timezone finding is that not all operational automations use the helper yet.
8. **Provider secrets are not exposed through owner settings.** Package 8 does not recommend turning infrastructure-secret management into an ordinary frontend feature.

---

# Overlap reconciliation — do not double-count during synthesis

Package 8 intentionally records the following overlaps so the synthesis can merge root causes instead of creating duplicate implementation work:

- **Package 5:** manual cash-receipt/accounting model, report semantics and effective financial dates. C1 is a new concurrency failure in that same subsystem, not a second request to redesign reports.
- **Package 7:** durable communications/history and full workflow integration. M4 is a concrete implementation instance of the Package 7 messaging architecture gap.
- **B01–B36 business audit:** supplier/part archival and Stripe/local reconciliation are already tracked as remaining launch work. Package 8 does not assign them new finding numbers merely to repeat them.
- **Historical operations audit:** parts usage/purchase/job-cost disconnection was previously observed. M6 confirms it remains present on audited `main` and ensures it is not lost when the old audit is reconciled.
- **Historical GitHub review backlog:** fixes should satisfy the actual invariant once; do not create parallel tasks because two reviews found the same root cause.

---

# Remediation program

Package 8 findings should be implemented as a few coherent changes, not nineteen tiny PRs.

## Group A — Financial serialization and provider identity

Covers:

```text
C1, H1, H2, H3, M3
```

Goals:

- serialize manual payment allocation;
- guard write-offs against racing payments;
- make Stripe Customer creation provider-idempotent/reconcilable;
- make late-fee application an atomic claim;
- standardize billing date/calendar semantics.

Acceptance requires concurrent real-Postgres tests and provider-mock tests that explicitly simulate retries/timeouts.

## Group B — Field-job and physical-custody invariants

Covers:

```text
H4, H5, H6, H7, H11, M2
```

Goals:

- validate job/appliance scope;
- never silently complete a lifecycle consequence that failed;
- use Colorado day bounds for customer reminders;
- stage swaps until physical completion;
- make inspection evidence enforceable;
- make terminal checklist corrections accountable.

Acceptance should include one end-to-end rental → delivery → maintenance/swap → removal → inspection scenario.

## Group C — Inventory/purchasing integrity and auditability

Covers:

```text
H8, H9, H10, M1, M5, M6
```

Goals:

- concurrency-safe asset numbering and atomic batch creation;
- atomic mutation/audit contract;
- auditable supplier history;
- explicit stock discrepancy handling;
- reject impossible negative repair costs;
- connect job part usage to inventory and cost basis;
- bound growing lists.

## Group D — Communications/release hygiene

Covers:

```text
M4, M7
```

Goals:

- route automations through durable send-attempt history/reconciliation;
- keep unapproved legal drafts out of search/release acceptance.

---

# Package 8 acceptance evidence

Package 8 is not considered remediated until evidence proves at least:

### Financial

- concurrent manual payments reconcile exactly;
- payment/write-off race cannot corrupt status;
- concurrent Stripe Customer initialization resolves to one authoritative provider identity;
- concurrent late-fee runs create one fee;
- invoice projections reconcile to their ledger records.

### Jobs / inventory

- a job cannot operate on another agreement/customer’s asset;
- lifecycle conflicts cannot disappear silently;
- SWAP assignment timestamps reflect real completion, not planning time;
- job reminders select the correct America/Denver calendar day across DST;
- an inspection cannot clear a unit without satisfying the chosen policy.

### Purchasing / fleet

- concurrent asset creation yields unique deterministic asset numbers without partial hidden success;
- local operational mutations cannot commit without their required audit entry;
- supplier changes appear in history;
- impossible stock usage is rejected or explicitly recorded as a discrepancy;
- negative repair costs are rejected;
- job/part cost evidence reconciles to stock/purchasing records where applicable.

### Release

- public legal pages are approved/versioned before indexable production launch;
- automated messages have durable attempt/outcome history and retry semantics;
- no Package 8 Critical or High finding is hidden behind a roadmap item marked “done.”

---

# Final Package 8 conclusion

Yes — the prior audit plan missed material scope.

The largest oversight was not an obscure edge case. It was that **billing, physical inventory, jobs/dispatch and purchasing were never first-class domains in the original package ownership map**, despite being core to whether a rental company receives the correct money, sends the correct machine, knows where that machine is, and knows what it costs to maintain.

Packages 1–7 remain valuable and largely complementary. Package 8 closes the domain-ownership gap and catches several concrete correctness failures that a cross-package synthesis should now treat as implementation inputs.

After this report, the audit-discovery phase can reasonably close. The next artifact should be the cross-package synthesis: deduplicate all eight packages plus B01–B36 and the historical review backlog into root causes, then convert them into a small number of large remediation batches with explicit acceptance evidence.
