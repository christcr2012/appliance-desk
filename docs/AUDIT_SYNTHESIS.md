# Appliance Desk Audit Synthesis

**Date:** 2026-10-01  
**Repository:** `christcr2012/appliance-desk`  
**Audit baseline:** `main` at `851f31931f9b7cb3a300d4eaa580e78cb16d7dae`  
**Scope:** Packages 1–8, B01–B36 business audit, overhaul O-cards/batches, security/review backlog, and launch-readiness dependencies  
**Status:** **Audit synthesis complete — implementation not yet complete.**

---

## Executive summary

The eight independent package audits produced **117 confirmed findings: 8 Critical, 58 High, and 51 Medium**. Those numbers are useful as evidence of coverage, but they are **not** the implementation plan.

Many findings describe the same underlying failure pattern from different business surfaces. For example:

- estimate responses, maintenance transitions, agreement signing/cancellation, invoice write-offs and several staff/operational writes all fail for the same reason: **read-then-write state changes are not always claimed atomically**;
- Stripe Customer creation, subscription creation, referral credits, launch email delivery, billing reminders and close/cancel behavior all share the same distributed-systems problem: **an external provider side effect can succeed while local durable state does not**;
- reporting, refunds, overpayments, deposits, credits and profitability issues are mostly different manifestations of **unclear financial basis and ledger allocation semantics**;
- job completion, swaps, return inspection, maintenance links, staff job provenance and inventory assignment all share **physical-custody state that is not consistently tied to the real-world event that proves custody changed**;
- email/SMS automation findings repeatedly point to one missing platform primitive: **a durable, reconcilable message-attempt ledger**;
- owner-control and branding findings repeatedly point to one product contract: **business-operational capabilities must be controllable through Appliance Desk, while infrastructure secrets stay outside it**.

After deduplication, the 117 findings collapse into **12 cross-package root causes** and can be implemented in **six substantial remediation/product batches**, plus at most one dependency-driven Google Workspace follow-up if O32 prerequisites are still unavailable.

### Recommended implementation target

1. **Batch A — Critical integrity & platform safety**
2. **Batch B — Billing, provider reconciliation & financial ledger**
3. **Batch C — Rental-to-service operations, custody, inventory & purchasing**
4. **Batch D — Owner/customer control plane, website, evidence & privacy**
5. **Batch E — Communications, reporting, growth, branding & accessibility**
6. **Batch F — Integrated verification, recovery, owner handoff & launch ledger**
7. **Conditional O32 follow-up only if external Google prerequisites lag Batch E/F**

This is intentionally far smaller than one PR per audit finding, B-item, O-card, review comment, page, cron, migration, or integration.

---

# 1. Source-of-truth hierarchy

This synthesis reconciles the following project-control sources rather than replacing them silently:

1. `docs/AUDIT_ROADMAP.md` — completed eight-package audit program.
2. `docs/audits/Package-1-Independent-Audit-and-Action-Plan.md`.
3. `docs/audits/Package-2-Agreements-Pricing-Referrals.md`.
4. `docs/audits/Package-3-Staff-Access-Accountability.md`.
5. `docs/audits/Package-4-Growth-Marketing-Retention.md`.
6. `docs/audits/Package-5-Configuration-Reporting.md`.
7. `docs/audits/Package-6-Platform-Integrity.md`.
8. `docs/audits/Package-7-Product-Integration-Brand-Accessibility.md`.
9. `docs/audits/Package-8-Operational-Core-Residual-Risk.md`.
10. `docs/reviews/2026-10-01-business-logic-audit.md` — B01–B36.
11. `docs/archive/plans-overhaul/COMPLETION-PLAN.md` and `REMAINING-BATCHES.md` — O-card/product roadmap and owner batching instruction.
12. `docs/reviews/2026-10-01-review-reconciliation.md` — historical GitHub review inventory.
13. Current code/tests on the audited `main` commit.

When these sources conflict, this synthesis uses the following rule:

- **current owner intent + confirmed current-code safety evidence wins over stale planning prose**;
- a completed implementation is not re-opened merely because an older document still says “pending”;
- a deferred audit item is not treated as resolved;
- a severe current integrity defect is not intentionally built around merely to preserve an older sequencing sentence.

---

# 2. Sequencing reconciliation

The prior overhaul plan contains two competing historical instructions:

- finish the original roadmap before audit implementation;
- security P0 / valid review defects and launch blockers precede dependent new work.

The completed audits now provide enough evidence to resolve that tension.

## Synthesis sequencing rule

**Only prerequisite Critical integrity/security defects move ahead of dependent roadmap features.**

That means the eight Critical findings are addressed in Batch A/B before new work relies on those unsafe primitives. This is not a general license to abandon the roadmap and chase every Medium audit item first.

Examples:

- do not build renewal/early termination on top of race-unsafe agreement transitions;
- do not expand billing automation while local Stripe subscription/customer identity can drift;
- do not build more finance workflows on top of a manual-payment allocator that can lose an invoice-balance update;
- do not attach additional customer records to the auth model before public self-signup/pre-hijacking is closed;
- do not build new estimate conversion features on a non-atomic conversion primitive.

After those prerequisites are safe, the remaining roadmap and audit work are consolidated by domain into Batches B–F.

---

# 3. Eight-package severity inventory

| Package | Critical | High | Medium | Total |
| --- | ---: | ---: | ---: | ---: |
| P1 Customer Lifecycle | 2 | 7 | 8 | 17 |
| P2 Agreements/Pricing/Referrals | 4 | 8 | 5 | 17 |
| P3 Staff/Access/Accountability | 0 | 5 | 5 | 10 |
| P4 Growth/Marketing/Retention | 0 | 6 | 6 | 12 |
| P5 Configuration/Reporting | 0 | 7 | 5 | 12 |
| P6 Platform Integrity | 1 | 7 | 6 | 14 |
| P7 Product Integration/Brand/Accessibility | 0 | 7 | 9 | 16 |
| P8 Operational Core/Residual Risk | 1 | 11 | 7 | 19 |
| **Total** | **8** | **58** | **51** | **117** |

All eight Critical findings are explicit launch blockers until fixed with the required evidence:

- **P1 C1** estimate response concurrency;
- **P1 C2** estimate → agreement conversion atomicity/idempotency;
- **P2 C1** agreement lifecycle atomic state claims;
- **P2 C2** durable Stripe subscription identity/reconciliation;
- **P2 C3** referral reward external/local idempotency;
- **P2 C4** canonical Stripe Customer creation;
- **P6 C1** public signup/customer pre-hijacking path;
- **P8 C1** concurrent manual-payment ledger divergence.

---

# 4. Deduplicated root causes

## RC1 — State-machine mutations do not use one uniform atomic claim pattern

**Primary packages:** P1, P2, P3, P8  
**Also supports:** B04, B05, B10, B11, B28, B34–B36

### Repeated symptoms

- estimate VIEWED/APPROVED/CHANGES races;
- maintenance status race;
- agreement add/remove/send/sign/cancel/end races;
- reservation extension races;
- write-off vs payment races;
- some in-flight STAFF writes outliving offboarding;
- some inventory/job/settings mutations separate validation from commit.

### One remediation pattern

Create/reuse domain-level guarded commands using one of:

- conditional `updateMany` / compare-and-set on expected state/version;
- row lock (`FOR UPDATE` / appropriate lock mode) inside one transaction;
- serializable transaction with bounded retry where aggregate allocation requires it.

For local-only state changes, the state mutation and required audit row commit together.

Do **not** solve each screen with an independent bespoke race workaround.

---

## RC2 — External-provider side effects lack a universal durable claim/reconciliation contract

**Primary packages:** P1, P2, P4, P6, P8  
**Also supports:** B01, B03, B06, B09, B12, B13, B18, B22, B28, B31, B34–B36

### Repeated symptoms

- Stripe Customer can be created twice;
- Stripe subscription ID is not durably persisted/recoverable;
- referral credit can partially succeed externally and replay;
- agreement close can stop Stripe billing before local close commits;
- launch email can be accepted while local state remains blocked/SENDING;
- reminders send before the local dedupe marker is committed;
- refund/reconciliation workflows are incomplete;
- provider “unknown outcome” is often treated as success/failure rather than an explicit state.

### One remediation pattern

Every externally mutating operation gets:

1. a durable local operation/attempt identity;
2. deterministic provider idempotency identity where supported;
3. explicit states such as `PENDING`, `CLAIMED`, `SENT/REQUESTED`, `CONFIRMED`, `FAILED`, `UNKNOWN`, `RECONCILED`;
4. provider object/message IDs persisted when available;
5. safe retry that resumes rather than replays confirmed work;
6. reconciliation for provider-success/local-failure and timeout ambiguity;
7. owner-visible exception/workbench for states that cannot be auto-resolved.

This contract should be shared by Stripe and communications rather than reimplemented per cron.

---

## RC3 — Financial truth is split across projections without one allocation/receipt model

**Primary packages:** P2, P5, P8  
**Also supports:** B03, B06, B09, B13, B18, B22, B28, B31, B35

### Repeated symptoms

- manual payment concurrency can diverge Payment rows from invoice balances;
- manual overpayment cash is partly represented as Payment and partly only as CustomerCredit;
- “actual vs estimated” compares rent-rate accrual against gross invoice cash containing deposits/tax/fees;
- refunds do not reduce some “actually collected” views;
- CustomerCredit can represent value already applied in Stripe and still appear locally available;
- financial dates can mean record-created time rather than settlement/received time;
- deposits/refunds/disputes lack one owner liability/reconciliation surface.

### One remediation pattern

Define financial primitives explicitly:

- **Receipt** — money actually received, with source/method/effective date/provider identity.
- **Allocation** — how receipt value is applied to invoices/charge categories.
- **Refund/outflow** — money returned, linked to source receipt/charge where known.
- **Credit** — value available to apply later vs already provider-applied/consumed.
- **Deposit liability** — collected refundable liability, deductions and refund decisions.

Reports become projections of those primitives rather than competing sources of truth.

Do not rewrite immutable historical payment/refund evidence to make a report easier.

---

## RC4 — Physical custody is sometimes inferred from planned workflow rather than proven real-world handoff

**Primary packages:** P2, P3, P8  
**Also supports:** B02, B04, B05, B10, B14, B16, B25, B26, B29, B33

### Repeated symptoms

- a job can accept appliance IDs outside its agreement/customer lifecycle;
- a completed job can silently fail an expected appliance transition;
- a swap closes/open assignments when the swap is scheduled/started, not when physical handoff occurs;
- historical JobAppliance linkage can remain STAFF mutation authority forever;
- inspection can pass with empty/unchecked evidence;
- SCHEDULED maintenance does not yet require all correct linked records;
- partial/no-show/reschedule workflows are incomplete.

### One remediation pattern

Use explicit staged intent vs completed custody:

- planned job/replacement does not rewrite physical assignment history;
- completion is the custody event;
- completion validates current customer/property/agreement/appliance relationship;
- mandatory lifecycle consequence either commits atomically or creates a durable reconciliation exception;
- cancellation/reschedule preserves actual custody;
- inspection/checklist evidence gates return to rentable stock;
- STAFF permission derives from the **current operational action**, not permanent historical membership.

---

## RC5 — Business mutation and accountability are not uniformly atomic

**Primary packages:** P1, P3, P5, P8  
**Also supports:** B06, B11, B20, B23, B33

### Repeated symptoms

- some create/update/photo/job/purchasing writes commit before audit;
- supplier create/update is not audited;
- staff lifecycle and activation can split from audit/notification evidence;
- hard task deletion can destroy linked-record context not present in the audit snapshot;
- job checklist correction is mutable and unattributed;
- activity feed omits some action types.

### One remediation pattern

For local mutations:

```text
validate → transaction → business write + immutable audit evidence → commit
```

Audit payloads must contain enough immutable business context to remain useful after later deletion/archival.

For external effects, audit the local request/decision atomically and reconcile provider outcome separately under RC2.

---

## RC6 — Communications need one durable message ledger and consent/recovery model

**Primary packages:** P1, P4, P6, P7, P8  
**Also supports:** B01, B07, B20, B29, B31, O24–O28, O32

### Repeated symptoms

- estimate marked SENT despite `{ sent:false }`;
- estimate follow-ups can duplicate or disappear;
- launch subscriber can remain permanently blocked after uncertain delivery;
- billing/job reminders use send-then-mark dedupe;
- Twilio STOP is not synchronized into application consent state;
- email ownership is not confirmed before marketing sequence begins;
- automation health/history/retry controls are incomplete.

### One remediation pattern

Build one bounded message/automation ledger that records:

- recipient/customer/subscriber context;
- consent/suppression basis;
- message type/template/version;
- idempotency key;
- provider ID;
- attempt state and timestamps;
- retry/reconciliation state;
- owner-visible resolution when provider outcome is unknown.

Then route estimate, launch, billing, job and future Google/email workflows through it in stages.

---

## RC7 — Identity/privacy/private-data controls have isolated gaps despite strong baseline authorization

**Primary package:** P6  
**Also intersects:** P1, P3, P4, P7; B07, B15, B20, B21, B24, B30, B31

### Repeated symptoms

- Better Auth public sign-up conflicts with server-created-account design and enables pre-hijacking;
- customer/job/appliance evidence photos are publicly readable by URL;
- password reset leaves prior sessions alive;
- privacy-request workflow is not implemented;
- fallback provider logging can expose PII/content;
- backup export is not one consistent database snapshot, has no proven JSON restore path and excludes media bytes/auth recovery state;
- legal/privacy claims can exceed current product capability.

### One remediation pattern

- disable self-signup and harden adoption of pre-existing unattached users;
- separate public marketing media from private operational evidence storage/access;
- revoke sessions on credential recovery where appropriate;
- implement privacy-request intake/verification/owner fulfillment without destructive auto-delete;
- redact operational logs;
- convert backup export into a tested recovery procedure with explicit exclusions and media strategy;
- keep destructive privacy/delete/recovery operations behind explicit owner approval.

---

## RC8 — Owner-manageability contract is incomplete

**Primary package:** P7  
**Also supports:** P4, P5; B08, B23, B24, B25, B26, O22–O28

### Repeated symptoms

- `SiteContent` exists without a real editor/publish/rollback surface;
- inspection checklist is live backend policy but not editable in Settings;
- BusinessSettings contains dormant/phantom configuration;
- automation recovery/history is incomplete;
- manual lead qualification/rescoring is incomplete;
- some operational policies still require code/database access.

### One remediation pattern

Classify every capability as:

- **A — business-operational:** must be owner-manageable in Appliance Desk;
- **B — infrastructure secret:** status may be visible, raw secret remains in provider/Vercel;
- **C — exceptional recovery/engineering:** documented runbook/provider/CLI is acceptable.

Every persisted BusinessSettings/SiteContent field gets a documented owner, consumer, UI path or deprecation decision.

---

## RC9 — Reports and growth signals need explicit semantic contracts before scale optimization

**Primary packages:** P4, P5  
**Also supports:** P7, P8; B03, B08, B09, B11, B26

### Repeated symptoms

- rent estimate compared with unlike gross cash categories;
- refunds omitted from net-looking metrics;
- 30-day proration used where anniversary billing is the real contract;
- stale lead detection ignores real contact-note activity;
- lifetime utilization drives present-day purchase guidance;
- manual leads use placeholder qualification inputs;
- repair-missing-cost query disagrees with fleet analytics;
- lead-source/growth/search/report queries contain ambiguous definitions.

### One remediation pattern

Every business metric declares:

1. source records;
2. population/filter;
3. time basis/timezone;
4. gross/net/estimated/actual semantics;
5. exclusions;
6. pagination/bounding;
7. drill-through records that prove the number.

Do not optimize a metric whose business definition is still ambiguous.

---

## RC10 — Calendar/date semantics are not fully centralized

**Primary packages:** P4, P5, P8  
**Also supports:** B01, B10, B12, B25, B28

### Repeated symptoms

- job SMS “today” uses runtime-local date instead of America/Denver;
- billing grace/reminder date arithmetic uses fixed 24-hour math/implicit locale in places;
- financial exports truncate timestamps to UTC dates;
- month arithmetic has edge cases.

### One remediation pattern

Use explicit types/conventions:

- business calendar date (`YYYY-MM-DD`, America/Denver semantics);
- provider/financial instant (`DateTime`, UTC instant plus source effective date when needed);
- anniversary/month arithmetic helper;
- date-only task deadlines stay date-only.

No bare `new Date(y,m,d)` / implicit `toLocaleDateString()` in business rules.

---

## RC11 — Historical evidence/archival/document lifecycle is incomplete

**Primary packages:** P2, P3, P6, P8  
**Also supports:** B11, B17, B19, B21, B24, B30, B33

### Repeated symptoms

- rental-line removal conflicts with assignment history;
- hard deletion can erase business linkage;
- supplier/part archival is missing;
- signed agreement/invoice artifact preservation is incomplete;
- legal retention/export/deletion policy is not defined;
- uploaded operational evidence is not in tested DR;
- mutable checklist/history corrections can rewrite evidence.

### One remediation pattern

Prefer archival/versioning/effective-date models over destructive deletion for records that participate in contracts, custody, money, consent, purchasing or audit.

Historical evidence should remain interpretable after current configuration changes.

---

## RC12 — Product acceptance is fragmented across UI, brand, accessibility and whole-flow proof

**Primary package:** P7  
**Also supports:** every package; O30/O31

### Repeated symptoms

- owner desk/portal/auth rely on generic Tailwind grays plus retint overrides rather than Evergreen semantic tokens;
- accessibility automation covers only a subset of current routes/states;
- WCAG target/documentation is inconsistent;
- backend features can exist without complete frontend control;
- no single accepted scenario proves lead → rental → service → return → billing/recovery as one product.

### One remediation pattern

- Evergreen semantic tokens are the normal light/dark UI;
- status colors remain semantic and non-color cues are required;
- `prefers-reduced-motion`, `prefers-contrast`, `forced-colors`, keyboard/focus, zoom/reflow and screen-reader semantics are explicit acceptance dimensions;
- automated axe is regression evidence, not blanket legal certification;
- O30/O31 whole-flow/manual acceptance is the final integration gate.

---

# 5. Critical/High finding disposition map

This table ensures no Critical/High finding disappears merely because it shares a root cause.

| Audit source | Findings | Primary implementation batch |
| --- | --- | --- |
| **P1** | C1, C2, H1–H7 | A for state/conversion/customer atomicity; E for notification/portal-scale items |
| **P2** | C1–C4, H1–H8 | A for lifecycle/FK prerequisites; B for Stripe/referral/billing; D for policy/default/disclosure surfaces |
| **P3** | H1–H5 | A for offboarding/write fencing; C for job-scoped staff authority; D/E for task/accountability/activity surfaces |
| **P4** | H1–H6 | E for search/growth/launch messaging; A only where role boundary must be closed before broader search work |
| **P5** | H1–H7 | B for ledger/accounting basis; E for report definitions/scale/config completeness |
| **P6** | C1, H1–H7 | A for auth/private-data/session safety; F for restore proof where it requires recovery drill; E for consent/logging surface where applicable |
| **P7** | H1–H7 | D for owner control/CMS/settings; E for brand/accessibility/automation UX; F for full integrated acceptance |
| **P8** | C1, H1–H11 | A for local financial/write guards; B for provider/late-fee money; C for job/custody/inventory/purchasing |

Every Medium finding remains in scope. Medium work is implemented opportunistically inside the batch that already changes the relevant primitive; it does not justify a separate PR unless a dependency or owner policy decision blocks it.

---

# 6. B01–B36 reconciliation

The B-items are business outcomes, not a second defect taxonomy. They map into the same six batches.

| B IDs | Consolidated outcome | Batch |
| --- | --- | --- |
| B01 | unbilled-after-delivery/signed recovery, reminders, honest billing exception | B/E |
| B02 | reservation inactivity/expiry/release policy and owner snooze | C/D |
| B03 | deposit liability/reconciliation/dispute aging | B/D |
| B04 | no premature delivery/swap custody changes; pending-job checks | C |
| B05 | maintenance scheduling requires correct job/customer/appliance links | C |
| B06 | refund approval, actor/reason/provider recovery | B/D |
| B07 | distributed public-form abuse protection | A/E |
| B08 | owner-configurable lead scoring and version/rescore policy | D/E |
| B09 | multi-property statement/balance; optional pay-all only with allocation rules | B/D |
| B10 | failed/partial/no-show delivery and rescheduling | C |
| B11 | structured ending/cancellation reasons and churn history | C/E |
| B12 | idempotent late fees and owner run result | B/E |
| B13 | general dispute/credit/refund workflow | B/D |
| B14 | linked delivery/installation dependencies | C |
| B15 | isolated preview/training environment and file storage proof | F; preserve already-landed isolation evidence |
| B16 | phone workflow/checklist/connectivity recovery | C/F |
| B17 | supplier/part archival and preserved PO history | C |
| B18 | Stripe/local drift detection/reconciliation workbench | B |
| B19 | immutable signed-agreement/invoice artifacts | D/F |
| B20 | SMS consent provenance and opt-out synchronization | E |
| B21 | privacy export/deletion request + owner-controlled fulfillment | D/A |
| B22 | tax precision/boundary/provider-contract verification | B |
| B23 | granular roles/permissions if required beyond current role model | A/C/D |
| B24 | retention/archive policy and recoverability | D/F |
| B25 | dispatch map/travel estimates/route suggestions only with owner/provider approval | C; paid provider remains gated |
| B26 | explainable 30/60/90 inventory demand forecast | E/C |
| B27 | bulk import | **Conditional/deferred until real authorized dataset exists** |
| B28 | unused-term refund/credit/retain policy | B/D; owner/legal policy required |
| B29 | broken-before-delivery replacement + communication | C/E |
| B30 | signing disclosure/evidence/provider decision | D/F; legal/provider approval separate |
| B31 | provider outage recovery/manual collection fallback | B/E/F |
| B32 | stock shortage/discrepancy behavior/history | C |
| B33 | appliance condition history with actor/reason | C/D |
| B34 | renewal | B/D after agreement lifecycle prerequisites in A |
| B35 | early termination + disclosed fee workflow | B/D after owner policy; no invented fee |
| B36 | optional auto-renewal with explicit consent/notices/opt-out | B/D/E after owner policy |

### Owner-policy items that implementation must not invent

- early-termination fee formula/caps/exceptions/notice period;
- unused-term refund/credit/retain policy;
- automatic reservation release timing/activity definition;
- paid mapping/signature/communications providers;
- live payment/message activation;
- legal retention periods/deletion obligations;
- auto-renewal terms/notices;
- tax precision/rate policy where current representation is insufficient;
- destructive production cleanup/reconciliation.

The UI may support versioned policy configuration, but it must not fabricate the business/legal policy itself.

---

# 7. Original O-roadmap reconciliation

The earlier five-batch roadmap remains useful as a product outcome map, but its implementation boundaries are updated by this synthesis.

## Already-landed foundation

Preserve the work already merged for:

- preview/runtime/provider safety and hosted isolation evidence;
- assigned/prioritized/versioned tasks and property context;
- role boundaries and narrow STAFF operational DTOs;
- rental builder/progress, revenue/fleet foundations and other merged O-card subwork.

Do not rebuild completed capabilities merely because this synthesis reorganizes future PRs.

## Remaining O-card placement

| Original scope | Synthesis placement |
| --- | --- |
| remaining O12, O13–O17 | Batch C (with audit custody/inventory corrections) |
| O18–O21 | Batch D/E depending money vs customer workspace |
| O22/O23 | Batch D |
| O24–O28 | Batch E |
| O29 | conditional only when real dataset exists |
| O30/O31 | Batch F |
| O32 | Batch E/F if prerequisites ready; otherwise one conditional follow-up |

This avoids implementing a roadmap feature and then immediately reopening the same domain to fix an audit-found invariant.

---

# 8. Historical GitHub review reconciliation

The historical review ledger remains authoritative evidence that merged/closed/outdated status is not proof of resolution.

The synthesis rule is:

1. each still-valid historical finding maps to one of RC1–RC12 and the corresponding implementation batch;
2. if a current package audit already confirms the same root cause, fix the invariant once and use the resulting test/evidence to discharge both records;
3. if the historical concern is already verified fixed on current main, do not reimplement it;
4. thread resolution occurs only after the implementing PR's exact-head/full-CI/applicable preview evidence passes;
5. review-only documentation corrections may be closed with exact source verification without creating a dedicated code PR.

Examples of clear overlaps already visible in the ledger:

- recurring-receipt-vs-all-payments and anniversary estimation → RC3/RC9 / Batch B/E;
- delivery send-result handling → RC6 / Batch E;
- Blob cleanup/trusted photo URLs → RC7/RC11 / Batch A/D;
- appliance history transitions → RC5/RC11 / Batch C/D;
- settings/history/documentation gaps → RC5/RC8/RC11;
- dispatch timezone issues already repaired should remain closed, while Package 8's job-reminder timezone defect is a distinct caller that still needs the shared RC10 helper.

No historical thread gets its own PR merely because it has its own review URL.

---

# 9. Six implementation batches

## Batch A — Critical integrity & platform safety

### Purpose

Make the application safe to continue building on.

### Includes

- P1 C1 estimate response CAS;
- P1 C2 atomic/idempotent estimate conversion;
- P2 C1 agreement lifecycle claim/version discipline;
- P6 C1 disable public signup + harden unattached-user adoption;
- P8 C1 serialized manual-payment allocation;
- maintenance transition claim/audit atomicity where required by P1 H1;
- write-off/payment guard prerequisites;
- in-flight STAFF mutation fencing pattern;
- local mutation + audit atomicity for touched critical paths;
- private evidence-media access control where current public-read behavior exposes customer/operational evidence;
- password-reset/session-revocation hardening where directly related to identity recovery;
- distributed/public abuse protection foundation if needed by the auth/public-form boundary.

### Why these belong together

They establish the trusted local state-transition and identity primitives used by every later batch.

### Required acceptance

- real Postgres concurrent estimate/maintenance/agreement/manual-payment tests;
- sign vs cancel, edit vs send, approve vs changes;
- multi-property estimate conversion rollback/retry;
- manual payment vs manual payment and manual vs webhook allocation;
- anonymous Better Auth sign-up fails and creates no User;
- pre-existing unattached CUSTOMER user cannot be silently adopted;
- archived/deactivated STAFF cannot complete an in-flight guarded mutation after removal;
- private evidence URLs require authorized read path;
- local business mutation rolls back if required audit row fails;
- migration/upgrade/empty-schema proof if schema changes are introduced;
- full PR CI once at consolidated batch head.

### Explicit exclusions

No live payment, customer cleanup, destructive User reconciliation, provider activation or deletion of production media without separate approval.

---

## Batch B — Billing, provider reconciliation & financial ledger

### Purpose

Make money/provider state durable, reconcilable and reportable from one coherent ledger model.

### Includes

- P2 C2 durable Stripe subscription ID and recovery;
- P2 C3 idempotent per-side referral reward ledger;
- P2 C4 canonical Stripe Customer creation;
- P2/P8 late-fee concurrency;
- provider/local close/cancel reconciliation;
- durable Stripe product/object identity where needed;
- P5/P8 receipt/allocation/overpayment/report basis corrections;
- refunds, credits and deposit liability/decision workflows;
- B03/B06/B09/B12/B13/B18/B22/B28/B31;
- fixed-term billing boundary and provider contract required for B34–B36;
- B34 renewal, B35 early termination and B36 auto-renew **financial/provider contracts**, after owner policy inputs are available;
- financial effective-date/business-calendar semantics;
- read-only drift workbench before any automatic repair;
- customer/owner statements and reports consume the corrected financial primitives.

### Required acceptance

- provider-success/local-failure reconciliation tests;
- no duplicate Stripe Customer/subscription/referral credit under concurrency/retry;
- webhook/out-of-order/unknown-state scenarios;
- late fee exactly once under concurrent cron runs;
- write-off cannot override a racing paid invoice;
- gross/net/refund/deposit/tax/credit line-category tests;
- manual overpayment receipt is fully represented without double-spendable credit;
- customer statements reconcile to invoice/payment/refund/credit detail;
- fixed-term end, renewal, cancellation and auto-renew scenarios do not overlap subscriptions or double-charge deposit;
- Stripe test mode only unless separately authorized;
- full PR CI once at batch head.

### Owner inputs/gates

Termination fee, unused-term policy, auto-renew terms/notices, tax precision policy, live reconciliation/collection approval.

---

## Batch C — Rental-to-service operations, custody, inventory & purchasing

### Purpose

Make the physical operation match the database: scheduled intent, real custody, service work, return, inspection and parts usage.

### Includes

- remaining O12/O13–O17 operational work;
- job assignee/duration/conflict/dispatch contract;
- P8 job/appliance scope validation;
- no silent lifecycle-transition conflict at job completion;
- stage swap intent until physical completion;
- maintenance scheduling requires correct linked job/request/appliance/customer/property;
- partial/no-show/reschedule workflow;
- STAFF job-scoped appliance authority tied to current action, not historical link;
- enforce inspection checklist pass evidence/version;
- terminal checklist correction history;
- appliance-line removal/history model repair;
- asset-number concurrency/batch atomicity;
- supplier/part archival and auditability;
- part over-consumption discrepancy policy;
- JobPartUsage/cost provenance to remove duplicate manual truths;
- B02/B04/B05/B10/B14/B16/B17/B25/B29/B32/B33;
- demand inputs needed later by B26.

### Required acceptance

One real-DB/browser scenario covers:

```text
lead/customer
→ agreement/reservation
→ schedule delivery
→ deliver
→ billing-ready handoff
→ maintenance request
→ maintenance visit or swap
→ removal
→ inspection
→ available/maintenance disposition
```

Additional tests:

- cross-customer/agreement appliance tampering denied;
- cancelled/rescheduled swap leaves original custody intact;
- concurrent swap/replacement unavailability;
- job lifecycle conflict creates no silent contradiction;
- exact inventory assignment history reflects physical handoff time;
- concurrent inventory creation yields unique human asset numbers with defined batch semantics;
- receiving/usage/discrepancy and job cost reconcile;
- phone/keyboard/axe acceptance on field surfaces;
- America/Denver dispatch/reminder boundaries including DST;
- full PR CI once at batch head.

---

## Batch D — Owner/customer control plane, website, evidence & privacy

### Purpose

Make business-operational capabilities manageable without code/database access, while preserving historical/legal evidence.

### Includes

- remaining O18–O23 owner/customer workspaces;
- SiteContent revision/editor/preview/publish/rollback;
- BusinessSettings coverage/deprecation matrix;
- inspection checklist editor/publishing/versioning;
- owner-manageable hours/closures/social/logo/banner where retained;
- customer renewal/cancellation/auto-renew **interaction and consent surfaces** using Batch B contracts;
- deposit/refund/dispute owner decision UI;
- signed agreement/invoice artifact preservation/download;
- supplier/part/archive/history frontend where Batch C requires it;
- privacy export/deletion request intake, identity verification and owner fulfillment workflow;
- retention/legal-hold configuration/runbook boundaries;
- legal-page production/indexing gate;
- signing disclosure/evidence export;
- granular role UI only to the extent an approved permission model is defined;
- B03/B06/B08/B09/B13/B19/B21/B23/B24/B28/B30/B34–B36 frontend portions.

### Required acceptance

- owner can change all Class-A business settings without code access;
- public site reads published content only;
- preview/publish/rollback preserve exact version and actor;
- current contract/settings changes never rewrite historical signed evidence;
- customer cannot operate on another customer's agreement/privacy request/document;
- signed artifacts are private, reproducible/downloadable and backed up according to approved policy;
- privacy deletion never indiscriminately destroys required financial/signature/audit evidence;
- raw provider secrets are never exposed as editable app values;
- full PR CI once at batch head.

---

## Batch E — Communications, reporting, growth, branding & accessibility

### Purpose

Make automated communication recoverable, business signals trustworthy, and the entire UI visibly/semantically one Evergreen product.

### Includes

- O24–O28 automation run history/health;
- durable message ledger rollout to estimate, launch, billing and job reminders;
- confirmed launch-list email ownership before marketing eligibility;
- Twilio STOP/suppression synchronization;
- role-aware global search;
- lead qualification/rescoring and win-back “last real contact” semantics;
- current/rolling utilization and explainable demand/growth signals;
- B01 reminder surface, B07 public abuse protection, B20 consent, B26 demand forecast, B29 customer communication, B31 outage messaging;
- P5 report/accounting projection fixes and bounded queries not already resolved in Batch B;
- stable pagination/index/query cleanup;
- Evergreen semantic-token migration across desk/portal/auth;
- dark theme uses Evergreen dark tokens, not generic slate override architecture;
- semantic status colors remain separate and never communicate meaning alone;
- `prefers-reduced-motion`, `prefers-contrast`, `forced-colors`, focus/keyboard/zoom/reflow/screen-reader acceptance;
- expand axe route/state coverage to current owner/customer surface;
- update accessibility engineering target to WCAG 2.2 AA baseline;
- O32 Google work may be included only if prerequisites are ready.

### Required acceptance

- provider send false/timeout/crash/retry scenarios reconcile without silent loss/duplicate send;
- launch opt-in remains pending until confirmed mailbox ownership;
- STOP immediately suppresses future app sends and records consent event;
- STAFF search never queries/returns OWNER-only lead PII;
- each report metric has source/population/time/gross-net definitions and drill-through;
- large-list/query tests are measured, not guessed;
- every current top-level route appears in accessibility coverage or has documented manual-only rationale;
- brand screenshots across representative light/dark/mobile/desktop/print surfaces are reviewed against Evergreen tokens;
- forced-colors/high-contrast/reduced-motion/manual keyboard checks pass;
- no blanket claim of legal accessibility certification is made from axe alone;
- full PR CI once at batch head.

### Conditional Google follow-up

If OAuth/folder/identity/walkthrough prerequisites are not ready, ship Batch E without pretending O32 is complete. One later O32 PR is allowed; do not split Calendar/Drive/Gmail into separate tiny PRs.

---

## Batch F — Integrated verification, recovery, owner handoff & launch ledger

### Purpose

Prove the finished product survives real workflows, scale, provider/recovery failure and owner operation.

### Includes

- O30/O31;
- cross-domain business scenarios;
- backup snapshot consistency/restore procedure/media recovery;
- recovery runbooks for provider outage, unknown Stripe state, message delivery, auth/account recovery and storage;
- large-account/fleet/invoice/job/report capacity checks;
- owner guide and operational runbook;
- remaining historical review thread discharge/evidence;
- final B01–B36 acceptance ledger;
- production configuration/input register;
- legal/policy/provider approval register;
- launch/no-launch release checklist.

### Required integrated scenarios

At minimum:

1. new lead → customer → estimate → approval → agreement → signature → delivery → recurring billing;
2. same flow with provider failure/timeout and safe retry;
3. maintenance request → linked visit → repair/swap → return/removal → inspection;
4. manual/offline payment + overpayment + refund/credit + statement/report reconciliation;
5. fixed-term end → renew / early terminate / auto-renew decisions according to approved policy;
6. staff activation → permitted field work → deactivation while requests are in flight;
7. launch/estimate/billing/job communication send failure and reconciliation;
8. privacy request/export with legal-retention-preserving fulfillment;
9. database restore to isolated environment plus private media recovery/verification;
10. representative owner workflow without code/DB assistance.

### Human/owner gates that remain explicit

- final visual/brand acceptance;
- screen-reader/manual accessibility walkthrough;
- legal/privacy/terms/signing/termination/renewal policy approval;
- live Stripe/Twilio/Resend/Google activation;
- paid provider/spending decisions;
- production destructive cleanup/reconciliation;
- actual launch authorization.

The system must not convert any of those into an implied approval because automated tests pass.

---

# 10. CI and PR discipline

The owner has explicitly required fewer, larger PRs because full CI is expensive.

For Batches A–F:

1. use focused unit/integration/real-DB tests during implementation;
2. consolidate schema + domain + actions + UI + recovery + docs before pushing a review-ready batch;
3. run broad local validation once near batch completion;
4. run the full required PR CI once per substantial ready head;
5. if CI fails, diagnose and consolidate fixes locally before another push;
6. do not weaken test coverage to make a large PR pass;
7. use exact-head inspection and applicable preview evidence before merge;
8. merge sequential dependency batches with expected head SHA;
9. no standalone tiny PR for each audit finding, review thread, test, migration, documentation sentence, cron or page.

A batch may contain ordered commits internally so reviewers can understand contracts/migrations before dependent UI, but it remains one coherent PR.

---

# 11. Launch-readiness ledger

## Gate 1 — Critical findings

- [ ] P1 C1 resolved with concurrent DB evidence.
- [ ] P1 C2 resolved with atomic/retry conversion evidence.
- [ ] P2 C1 resolved across all agreement lifecycle commands.
- [ ] P2 C2 durable Stripe subscription identity and reconciliation proven.
- [ ] P2 C3 referral reward cannot duplicate/partially replay.
- [ ] P2 C4 one canonical Stripe Customer per local Customer under concurrency.
- [ ] P6 C1 public signup/pre-hijacking path closed and production unattached-user inventory reviewed safely.
- [ ] P8 C1 concurrent manual-payment allocation reconciles exactly.

**Launch rule:** all eight must be closed. No owner “accept risk” shortcut for a known Critical that can corrupt identity or money without a deliberate documented scope change and reclassification based on changed evidence.

## Gate 2 — High findings

- [ ] P1 H1–H7 fixed or explicitly mapped to verified replacement behavior.
- [ ] P2 H1–H8 fixed or explicitly mapped to verified replacement behavior.
- [ ] P3 H1–H5 fixed or explicitly mapped to verified replacement behavior.
- [ ] P4 H1–H6 fixed or explicitly mapped to verified replacement behavior.
- [ ] P5 H1–H7 fixed or explicitly mapped to verified replacement behavior.
- [ ] P6 H1–H7 fixed or explicitly mapped to verified replacement behavior.
- [ ] P7 H1–H7 fixed or explicitly mapped to verified replacement behavior.
- [ ] P8 H1–H11 fixed or explicitly mapped to verified replacement behavior.

High items may be deferred only by an explicit owner decision **when the affected capability itself is also disabled/out of launch scope** and the deferral does not contradict a legal/security/financial invariant. A label alone is not a mitigation.

## Gate 3 — Medium findings

- [ ] every Medium is assigned to A–F or explicitly documented as post-launch hardening with rationale and no hidden Critical/High dependency.

Medium findings should generally ride with the batch already modifying their underlying primitive.

## Gate 4 — B01–B36

- [ ] each B-item has implementation/behavior evidence and owner acceptance, or an explicit owner-approved scope change/deferment.
- [ ] B27 remains conditional until a real authorized import dataset exists.
- [ ] policy-dependent items have actual approved policy; implementation does not invent terms.

## Gate 5 — Historical reviews

- [ ] every remaining valid historical review thread is mapped to a batch/result.
- [ ] fixed threads are resolved only after exact-head/full-CI/applicable preview evidence.
- [ ] obsolete/false findings carry a documented disposition rather than silent closure.

## Gate 6 — Recovery and platform evidence

- [ ] isolated database restore proven.
- [ ] private operational media recovery/access model proven.
- [ ] provider unknown-outcome reconciliation proven.
- [ ] account recovery/session behavior proven.
- [ ] cron/message run history/retry evidence proven.

## Gate 7 — Accessibility/brand/product acceptance

- [ ] Evergreen semantic token migration accepted.
- [ ] light/dark/mobile/desktop representative visual review accepted.
- [ ] WCAG 2.2 AA engineering checks across current route/state inventory.
- [ ] forced-colors/high-contrast/reduced-motion/keyboard/zoom manual checks.
- [ ] screen-reader walkthrough completed where required.
- [ ] full business lifecycle completed through actual user surfaces.

## Gate 8 — Owner/legal/provider release inputs

- [ ] public contact/company information confirmed.
- [ ] legal/privacy/terms and agreement policy approved.
- [ ] renewal/termination/auto-renew rules approved.
- [ ] tax policy/precision decisions approved where required.
- [ ] live provider credentials/configuration verified.
- [ ] spending/paid-provider decisions explicitly approved.
- [ ] destructive production operations separately approved.
- [ ] owner explicitly authorizes production launch.

---

# 12. Definition of audit-program completion

The **audit discovery and synthesis** are complete when this document and `docs/AUDIT_ROADMAP.md` are merged with Packages 1–8.

That means:

- the product surface has audit ownership;
- known findings are preserved;
- overlaps are deduplicated into root causes;
- the remediation program is ordered;
- no Critical/High finding disappears into a second document;
- policy/approval dependencies are explicit;
- the remaining work is implementable in a small number of substantial PRs.

It does **not** mean:

- the 117 findings are fixed;
- B01–B36 are accepted;
- historical review threads are all resolved;
- the product is legally certified;
- provider integrations are live;
- production cleanup is authorized;
- Appliance Desk is launch-ready.

Those claims become valid only as the launch-readiness ledger is discharged by Batches A–F and explicit owner approvals.

---

# 13. Immediate next step after this audit PR merges

Start **Batch A — Critical integrity & platform safety**.

Before coding that batch, refresh current `main` and the review ledger so already-landed fixes are not duplicated. Then implement the shared state-claim/transaction/audit primitives and the identity protections first, with focused tests during development and one full consolidated CI run at the ready PR head.

Do not create separate PRs for the eight Critical findings unless a hard dependency makes one unsafe to combine. The purpose of this synthesis is to eliminate that fragmentation.