# Complete Code Audit Roadmap

**Date:** October 1, 2026  
**Scope:** Appliance Desk business domains, user surfaces, infrastructure boundaries, and cross-cutting production concerns  
**Purpose:** Identify confirmed security, financial, operational, product-integration, accessibility, reliability, scaling, and launch-readiness risks  
**Status:** **Audit discovery complete — Packages 1–8 performed. Cross-package synthesis is next.**

---

## Audit program closeout

The audit program began as six packages. During execution, two material scope extensions were required:

- **Package 7** was added to audit the finished product as an integrated whole: backend capability ↔ frontend management coverage, workflow seams, brand consistency, and accessibility.
- **Package 8** was added as the final catch-all after audit oversight found that several substantial operational domains — especially `billing`, `inventory`, `jobs`, and `purchasing` — had never been assigned as primary domains in the original six-package map.

The eight completed independent reports contain **117 findings total: 8 Critical, 58 High, and 51 Medium**. These are audit findings, not 117 independent implementation tasks. The synthesis must deduplicate shared root causes and reconcile overlaps with B01–B36, the overhaul roadmap, security reviews, and historical GitHub review findings.

---

## Completed packages

| Package | Scope | Critical | High | Medium | Total | Report |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| **1 — Customer Lifecycle** | customers, portal, maintenance, estimates, activity | 2 | 7 | 8 | 17 | `docs/audits/Package-1-Independent-Audit-and-Action-Plan.md` |
| **2 — Agreements / Pricing / Referrals** | agreements, pricing, referrals | 4 | 8 | 5 | 17 | `docs/audits/Package-2-Agreements-Pricing-Referrals.md` |
| **3 — Staff / Access / Accountability** | staff, desk access, tasks, exceptions | 0 | 5 | 5 | 10 | `docs/audits/Package-3-Staff-Access-Accountability.md` |
| **4 — Growth / Marketing / Retention** | growth, launch, leads/search signals | 0 | 6 | 6 | 12 | `docs/audits/Package-4-Growth-Marketing-Retention.md` |
| **5 — Configuration / Reporting** | settings, reporting, dashboard, accounting semantics | 0 | 7 | 5 | 12 | `docs/audits/Package-5-Configuration-Reporting.md` |
| **6 — Platform Integrity** | auth/session, uploads/media, backup/recovery, privacy/consent/security boundaries | 1 | 7 | 6 | 14 | `docs/audits/Package-6-Platform-Integrity.md` |
| **7 — Product Integration / Brand / Accessibility** | backend↔frontend coverage, workflow integration, owner self-sufficiency, Evergreen implementation, accessibility | 0 | 7 | 9 | 16 | `docs/audits/Package-7-Product-Integration-Brand-Accessibility.md` |
| **8 — Operational Core / Residual Risk** | billing, inventory/fleet, jobs/dispatch, purchasing, concurrency, business time, audit atomicity, residual launch seams | 1 | 11 | 7 | 19 | `docs/audits/Package-8-Operational-Core-Residual-Risk.md` |
| **Total** |  | **8** | **58** | **51** | **117** |  |

---

# Package scope summary

## Package 1 — Customer Relationship & Lifecycle

Primary questions:

- customer isolation and portal scoping;
- maintenance lifecycle correctness;
- estimate/quote lifecycle and conversion;
- customer-facing activity/history;
- concurrency, pagination, and failure behavior around those flows.

## Package 2 — Agreements, Pricing & Referral Logic

Primary questions:

- rental agreement lifecycle and frozen contract terms;
- pricing/discount correctness and historical snapshots;
- inventory reservation implications at agreement boundaries;
- referral eligibility, reward timing, and duplicate/retry behavior;
- concurrent agreement/pricing mutations.

## Package 3 — Staff, Access & Accountability

Primary questions:

- OWNER / ADMIN / STAFF authorization boundaries;
- deactivation and session lifetime;
- task assignment/visibility/concurrency;
- exception-inbox correctness and scale;
- staff mutation accountability and audit safety.

## Package 4 — Growth, Marketing & Retention

Primary questions:

- lead qualification/scoring and source semantics;
- launch-list consent and delivery behavior;
- role-aware global search;
- growth/utilization/retention signals;
- scale and truthfulness of marketing/operational metrics.

## Package 5 — Business Configuration & Reporting

Primary questions:

- settings persistence, validation, and audit behavior;
- financial/reporting semantics;
- gross vs. net collections, refunds, deposits, tax, credits, and payment dates;
- accounting-export completeness;
- dashboard/report scaling and historical correctness.

## Package 6 — Platform Integrity

Primary questions:

- authentication/session/account-recovery boundaries;
- file upload and private-media authorization;
- backup completeness and practical restore capability;
- provider/logging secret and PII boundaries;
- privacy/consent alignment and production hardening.

## Package 7 — Product Integration, UI Coverage & Brand Accessibility

Primary questions:

- does every owner-operable backend capability have an appropriate frontend control?
- does the customer/owner UI expose the correct workflow state without leaking internal data?
- do workflows connect cleanly end-to-end rather than terminating in dead ends?
- is Evergreen v2.0 implemented consistently across public, authenticated, dark, print/document, and communication surfaces?
- is accessibility adaptive and evidence-based rather than achieved by replacing the normal brand with generic gray?
- does automated/manual accessibility acceptance cover the actual current route/state surface?

Brand policy established by Package 7:

1. **Evergreen is the normal light/dark presentation.**
2. Semantic status colors remain distinct from decorative brand colors and never carry meaning alone.
3. Accessibility preferences adapt presentation when requested (`prefers-reduced-motion`, `prefers-contrast`, `forced-colors`, keyboard/focus/zoom/reflow/screen-reader semantics).
4. A screen reader by itself is not a reason to replace the visual brand.

## Package 8 — Operational Core & Residual Risk

Package 8 closes the primary-domain omission in the original roadmap.

Primary domains:

```text
src/domains/billing/*
src/domains/inventory/*
src/domains/jobs/*
src/domains/purchasing/*
```

Residual cross-cutting questions:

- money and provider concurrency;
- physical-custody/lifecycle correctness;
- dispatch and America/Denver calendar semantics;
- local mutation ↔ audit atomicity;
- scheduled automation idempotency/reconciliation;
- inventory/part/purchase/job-cost consistency;
- operational list scaling;
- release-policy seams not cleanly owned by Packages 1–7.

The package found one new Critical financial-integrity race in concurrent manual-payment allocation plus eleven High and seven Medium findings.

---

# Audit methodology and evidence standard

A finding is included only when it can be tied to concrete repository behavior, data flow, schema behavior, or missing acceptance evidence. The package reports distinguish:

- **confirmed defect/risk** from a suggested future enhancement;
- **underlying record correctness** from presentation/reporting correctness;
- **automated evidence** from manual acceptance still required;
- **intentional infrastructure-only controls** from genuine missing owner UI;
- **historical findings already fixed** from findings still present on the audited commit.

The reports preserve overlaps explicitly so the synthesis can collapse them rather than implement the same fix repeatedly.

---

# Audit completion criteria

Audit **discovery** is complete because:

- [x] customer lifecycle, agreements/pricing, staff/access, growth, configuration/reporting, and platform integrity were independently audited;
- [x] backend↔frontend coverage and full-product integration were independently audited;
- [x] branding and accessibility implementation were independently audited;
- [x] previously unowned operational-core domains — billing, inventory, jobs, purchasing — received direct audit coverage;
- [x] a final residual sweep covered concurrency, time, automation, auditability, cost integrity, scaling, and launch-policy seams;
- [x] each report contains concrete findings, remediation direction, and acceptance evidence;
- [x] overlap with existing B01–B36 / roadmap / historical review work is explicitly acknowledged rather than silently discarded.

Audit discovery being complete **does not mean the product is launch-ready**. Critical/High remediation, integrated acceptance, owner walkthrough, production configuration, legal/business approvals, and explicit release authorization remain separate gates.

---

# Next artifact — cross-package synthesis

Create `docs/AUDIT_SYNTHESIS.md` from all eight reports plus the existing project-control sources.

The synthesis must:

1. **Deduplicate root causes.** Do not turn 117 findings into 117 tickets.
2. **Reconcile existing work.** Map each root cause to B01–B36, O-cards/remaining batches, historical code-review findings, security reviews, and already-landed fixes.
3. **Prioritize by consequence and dependency.** Critical financial/security/data-integrity invariants first; then High operational/launch blockers; then Medium hardening/scaling.
4. **Build a small number of large remediation batches.** The owner has explicitly required far fewer substantial PRs because full CI is expensive.
5. **Define acceptance evidence before implementation.** Each batch must identify the exact tests, integration scenarios, preview checks, migration proof, provider reconciliation, accessibility/manual acceptance, or owner decision needed to call it complete.
6. **Preserve explicit owner decisions.** Do not invent fee amounts, legal policy, activation approvals, spending, destructive real-data changes, or production provider actions.
7. **End with one launch-readiness ledger.** Every Critical/High finding must be fixed, explicitly accepted/deferred by the owner where appropriate, or mapped to a still-open release blocker. No issue may disappear merely because it overlaps another document.

---

## Historical note

The older `docs/audits/Package-1-Customer-Lifecycle.md` is intentionally retained for comparison. The eight independent reports listed above are the audit-program deliverables used for synthesis.

**Next step:** build the cross-package synthesis and convert the deduplicated remediation scope into the smallest practical number of high-quality implementation batches.