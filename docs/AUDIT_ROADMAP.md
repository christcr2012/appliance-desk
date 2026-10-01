# Complete Code Audit Roadmap

**Date:** October 1, 2026  
**Scope:** All business domains in `src/domains/*` + cross-cutting concerns  
**Purpose:** Identify performance issues, security gaps, business logic correctness, and scaling risks  
**Status:** Audit packages defined; sequential execution starting with Package 1

---

## Audit Packages (6 total)

This document outlines 6 audit packages covering ~19 interconnected domains. Each package groups logically related domains to keep recommendations connected instead of fragmented. Audits are executed sequentially; each produces a detailed markdown report linked below.

### Executive Summary: Risk-Prioritized Sequencing

| Priority | Package | Risk Profile | Key Domains |
|----------|---------|--------------|-------------|
| **1 (High)** | **Package 2: Agreements/Pricing/Referrals** | **Financial correctness, pricing leaks, referral payout bugs** | `agreements`, `pricing`, `referrals` |
| **2 (High)** | **Package 1: Customer Lifecycle & Portal** | **Data isolation, customer experience, retention** | `customers`, `portal`, `maintenance`, `estimates`, `activity` |
| **3 (High)** | **Package 3: Staff/Access/Accountability** | **Permission boundaries, audit trails, scaling** | `staff`, `desk-access`, `tasks`, `exceptions` |
| **4 (Med)** | **Package 6: Platform Integrity** | **Data safety, resilience, catastrophic failure** | `uploads`, `backup`, `auth`, `session` cross-cutting |
| **5 (Med)** | **Package 5: Config & Reporting** | **Operational visibility, business decisions** | `settings`, `reports`, `dashboard` |
| **6 (Low)** | **Package 4: Growth/Marketing/Retention** | **User acquisition & retention, churn signals** | `growth`, `launch`, `search` |

**Note:** Packages are listed in execution order (Package 1 first, Package 2 etc.) but have been **re-ranked above by risk** so you can prioritize if time is limited.

---

## Package 1: Customer Relationship & Lifecycle (Portal, Maintenance, Estimates, Activity)

**Domains:** `src/domains/customers`, `src/domains/portal`, `src/domains/maintenance`, `src/domains/estimates`, `src/domains/activity`

### Focus Areas
1. **Data Isolation & Security** — Is every query scoped by the logged-in user's own ID? Can customer A see B's records?
2. **Customer Portal Flows** — Self-service maintenance requests, contract visibility, billing self-service, account settings
3. **Maintenance Request Workflow** — State machine correctness (submitted → reviewing → scheduled → in_progress → resolved → closed), proper transitions
4. **Estimate/Quote Lifecycle** — Generation, status tracking, customer visibility, conversion to rental agreements
5. **Activity Timeline & Audit** — Is the activity feed correctly scoped per-customer? Proper audit logging of changes?
6. **Performance** — N+1 queries, missing indexes, pagination correctness (especially important as customer count grows)
7. **Error Handling** — Concurrent request handling, idempotency, retry logic

### Status
- ✅ **Data isolation tests exist:** `tests/customer-isolation.test.ts` proves customer A cannot read B's records (real database-backed)
- ✅ **Maintenance state machine defined:** `src/domains/maintenance/index.ts` has `ALLOWED_TRANSITIONS` + `canTransitionMaintenanceStatus()`
- ⚠️ **Estimates domain:** Search shows no results; may not exist yet or be minimal stub — needs investigation
- ⚠️ **Activity domain:** Architecture needs verification; cursor-based pagination in `timeline-page.ts` needs correctness check

### Report
- **Full Audit Report:** `docs/audits/Package-1-Customer-Lifecycle.md` (to be generated)
- **Key Files to Review:**
  - `src/domains/portal/index.ts` — customer portal entry points
  - `src/domains/maintenance/index.ts` — maintenance workflow logic
  - `src/domains/customers/workspace.ts` — staff customer context
  - `src/domains/customers/operational.ts` — operational queries with role guards
  - `src/domains/customers/timeline-page.ts` — activity timeline pagination
  - `tests/customer-isolation.test.ts` — data isolation proof (real DB)
  - `tests/maintenance.test.ts` — status transition rules

---

## Package 2: Agreements, Pricing & Referral Logic

**Domains:** `src/domains/agreements`, `src/domains/pricing`, `src/domains/referrals`

### Focus Areas
1. **Rental Agreement Lifecycle** — Creation, status transitions (DRAFT, ACTIVE, ENDED, TERMINATED), contract terms
2. **Pricing Rules & Calculations** — How monthly rent is computed, discounts applied, pricing history tracked
3. **Referral Program** — Code generation, eligibility, reward computation (pending → rewarded), payout timing
4. **Price Snapshots** — Are historical prices frozen at the moment the agreement was signed? Can a future price change rewrite past billing?
5. **Concurrent Agreement Creation** — Can two simultaneous API calls both create agreements for the same customer? Race conditions?
6. **Pricing Leaks** — Does any query expose pricing to someone who shouldn't see it (e.g., a STAFF account seeing customer pricing)?
7. **Referral Payout Edge Cases** — What happens if a referrer converts back to a lead? If a referred customer churn and then re-signs? Duplicate rewards?

### Status
- ✅ **Agreements have active-appliance queries:** `src/domains/agreements/active-appliances.ts` distinguishes customer-supplied ID vs. user-scoped lookup
- ⚠️ **Pricing domain unclear:** Search returned settings pricing but not a dedicated `src/domains/pricing` — may be within agreements or settings
- ⚠️ **Referral status tracked:** Schema shows `ReferralStatus` enum (PENDING, REWARDED) but reward logic needs verification
- ⚠️ **Concurrent draft safety:** HANDOFF.md mentions "concurrent draft saves create one agreement and audit" — needs full logic review

### Report
- **Full Audit Report:** `docs/audits/Package-2-Agreements-Pricing-Referrals.md` (to be generated)
- **Key Files to Review:**
  - `src/domains/agreements/*` — agreement lifecycle
  - `src/domains/pricing/*` (if exists) or pricing logic in `src/domains/agreements` or `src/domains/settings`
  - `src/domains/referrals/*` — referral reward logic
  - `prisma/schema.prisma` — Referral, RentalAgreement, PricingRule models

---

## Package 3: Staff, Access & Accountability (Permissions, Tasks, Exceptions)

**Domains:** `src/domains/staff`, `src/domains/desk-access`, `src/domains/tasks`, `src/domains/exceptions`

### Focus Areas
1. **Staff Role Permissions** — OWNER vs. ADMIN vs. STAFF role boundaries; what can STAFF see/do?
2. **Permission Enforcement** — Is `requireRole()` called on every sensitive operation? Can a STAFF account access owner-only data?
3. **Task Assignment & Visibility** — Who sees which tasks? Can one staff member see another's assigned tasks?
4. **Exception Inbox** — Alerts/flags requiring attention; proper scoping by user, team, or business-wide?
5. **Audit Trail for Staff Actions** — Every staff action logged? Can staff see audit logs? Proper role guard?
6. **Concurrent Task Updates** — Two staff members try to claim the same task — what happens?
7. **Offboarding Safety** — When a staff member is deactivated, are their sessions killed immediately? Can they still access data?

### Status
- ✅ **Staff role created:** Role-based access in schema; `src/domains/staff/index.ts` has `createStaffAccount()`, `deactivateStaffAccount()`
- ✅ **Deactivation safety:** `archivedAt` field rides along on session; `requireSession()` refuses archived accounts
- ⚠️ **Desk access domain:** Not yet explored — may be minimal or a UI router concern
- ⚠️ **Tasks & exceptions:** Need to verify scope boundaries and concurrent safety

### Report
- **Full Audit Report:** `docs/audits/Package-3-Staff-Access-Accountability.md` (to be generated)
- **Key Files to Review:**
  - `src/domains/staff/index.ts` — staff account lifecycle
  - `src/lib/session.ts` — role guards and session handling
  - `src/domains/tasks/*` (if exists) — task assignment and visibility
  - `src/domains/exceptions/*` (if exists) — exception/alert system
  - Middleware in `src/app` for route-level access control

---

## Package 4: Growth, Marketing & Retention Signals

**Domains:** `src/domains/growth`, `src/domains/launch`, `src/domains/search`

### Focus Areas
1. **Lead Scoring & Qualification** — Is lead scoring correct? High-value flagging working?
2. **Churn Detection & Win-Back Signals** — Any proactive alerts for at-risk customers?
3. **Launch/Interest List** — Pre-launch interest capture; follow-up automation
4. **Global Search Performance** — Case-insensitive "contains" search across customers, appliances, leads; is it fast enough?
5. **Search Result Scoping** — Does search respect role permissions (e.g., STAFF can't see customer billing info)?
6. **Fleet Utilization Metrics** — Are there signals/dashboards for "how many appliances are AVAILABLE vs. RENTED"?

### Status
- ✅ **Lead scoring exists:** `src/domains/leads/scoring.ts` computes score + reasons
- ⚠️ **Growth/launch/search:** Minimal exploration so far; packages exist but scale/correctness unclear
- ⚠️ **Search performance:** `searchAll()` in `src/domains/search/index.ts` uses `Promise.all()` for parallel queries; needs limit verification

### Report
- **Full Audit Report:** `docs/audits/Package-4-Growth-Marketing-Retention.md` (to be generated)
- **Key Files to Review:**
  - `src/domains/leads/scoring.ts` — lead scoring logic
  - `src/domains/search/index.ts` — search implementation
  - `src/domains/growth/*` (if exists) — growth metrics
  - `src/domains/launch/*` (if exists) — launch feature

---

## Package 5: Business Configuration & Reporting

**Domains:** `src/domains/settings`, `src/domains/reports`, `src/domains/dashboard`

### Focus Areas
1. **Business Settings Persistence** — Service area (zip codes, cities), pricing defaults, business rules; are changes audited?
2. **Configuration Validation** — Can a bad setting break the system? (e.g., empty service area, zero pricing)
3. **Dashboard Correctness** — Revenue, customer count, open tasks, churn indicators; are queries correct?
4. **Reporting Accuracy** — Revenue reporting (Phase 6B, Stripe integration); are refunds counted? Partial refunds? Tax handling?
5. **Export Completeness** — CSV exports (accounting, work orders); are all required fields included? Properly escaped?
6. **Performance on Large Datasets** — Can reporting queries handle thousands of invoices/jobs efficiently?
7. **Historical Data Integrity** — When a pricing rule changes, do old invoices still show the correct price? PricingRule snapshots work?

### Status
- ✅ **Settings domain exists:** `src/domains/settings/index.ts` has business config; pricing updates create audit + `PricingRule` snapshots
- ✅ **CSV export safety:** HANDOFF.md notes CSV formulas are neutralized; numeric values stay numeric
- ✅ **Print media:** Desk chrome hidden when printing; proper layout
- ⚠️ **Dashboard domain:** Needs verification; likely queries multiple tables
- ⚠️ **Reporting pagination:** Used in billing; needs correctness check

### Report
- **Full Audit Report:** `docs/audits/Package-5-Configuration-Reporting.md` (to be generated)
- **Key Files to Review:**
  - `src/domains/settings/index.ts` — business config lifecycle
  - `src/domains/reports/*` — reporting logic
  - `src/app/desk/dashboard/*` — dashboard page + data fetching
  - `src/domains/billing/revenue-records.ts` — revenue report queries
  - Schema: `PricingRule`, `BusinessSettings` models

---

## Package 6: Platform Integrity — Auth, Uploads, Backup, Compliance

**Domains:** `src/domains/uploads`, `src/domains/backup`, plus cross-cutting `src/lib/auth.ts`, `src/lib/session.ts`, `proxy.ts`

### Focus Areas
1. **File Upload Security** — MIME type validation, size limits, path traversal protection; stored where?
2. **File Access Control** — Can customer A download customer B's uploaded file? URL guessing?
3. **Backup Completeness & Restore Testing** — Full database backups? Appliance photos? Uploaded docs? Can restore be tested regularly?
4. **Session Security** — Session timeout, concurrent session limits, token rotation, CSRF protection
5. **Authentication Flow** — Better Auth integration; email verification; password reset; account recovery
6. **Email Compliance** — Unsubscribe links, TCPA consent (SMS opt-in), data privacy responses
7. **Sensitive Data in Logs** — Are passwords, tokens, API keys ever logged? Proper masking?
8. **Onboarding Data Leaks** — Can a new user sign up, see past customers' data, delete their account, leaving orphan records?

### Status
- ⚠️ **Uploads domain:** Not yet explored in detail; HANDOFF.md mentions photo URLs (Vercel Blob storage) but security unclear
- ⚠️ **Backup domain:** May be infrastructure rather than app code; needs clarification
- ✅ **Session security:** `archivedAt` field prevents archived user access; sessions deleted on deactivation
- ✅ **Email compliance:** Consent tracking via `ConsentRecord` model (kind: lead_form_privacy, sms_opt_in)
- ⚠️ **Better Auth integration:** In use; review for edge cases in activation flow, callback handling

### Report
- **Full Audit Report:** `docs/audits/Package-6-Platform-Integrity.md` (to be generated)
- **Key Files to Review:**
  - `src/domains/uploads/*` (if exists) or file handling in relevant domains
  - `src/lib/auth.ts` — auth helpers
  - `src/lib/session.ts` — session middleware + requireRole/requireSession
  - `src/middleware.ts` — global middleware
  - `docs/DECISIONS.md` — auth/session decisions
  - `tests/customer-isolation.test.ts` — real DB test with concurrent patterns
  - Schema: `ConsentRecord`, `User`, `Session`, `Account` models

---

## Audit Execution Plan

### Schedule
1. **Package 1 (Customer Lifecycle)** — Run first
2. **Package 2 (Agreements/Pricing)** — Run second (depends on understanding Package 1's domain interactions)
3. **Package 3 (Staff/Access)** — Run third
4. **Package 4 (Growth/Marketing)** — Run fourth
5. **Package 5 (Config/Reporting)** — Run fifth
6. **Package 6 (Platform Integrity)** — Run sixth (can run in parallel with others if needed)

### Expected Deliverables
- **Per-package markdown report** in `docs/audits/` with:
  - **Executive summary** (findings by severity)
  - **Critical issues** (security, data loss, business logic failure)
  - **High-risk patterns** (performance, scalability, maintainability)
  - **Recommended fixes** with file paths, line numbers, and implementation notes
  - **Test coverage notes** (what's proven, what needs testing)

- **Synthesis document** (`docs/AUDIT_SYNTHESIS.md`) after all 6 packages:
  - **Cross-package issues** (e.g., a query pattern used everywhere)
  - **Architectural recommendations** (refactoring priorities, new patterns to adopt)
  - **Rollout plan** (which fixes first, which can wait)

### Success Criteria
- ✅ All 6 packages audited
- ✅ Each report includes at least 5–10 specific findings (critical, high, medium-risk)
- ✅ Every finding references a file path + ideally a line number
- ✅ Recommendations are actionable (not "make it faster" but "index `rentalAgreements.customerId` because query X scans 10k rows")
- ✅ No false positives (every flagged issue is confirmed, not speculative)
- ✅ Synthesis doc prioritizes which fixes to start with

---

## How to Use This Document

1. **For prioritization:** Consult the "Risk-Prioritized Sequencing" table above to focus on highest-risk packages first
2. **For implementation:** Each package report will include a "Fix Priority" section; tackle CRITICAL first, then HIGH
3. **For tracking:** Link each issue to a GitHub issue or PR as it's fixed
4. **For handoff:** New audits after features are added should reference this roadmap to stay consistent

---

## Notes

- **Estimates domain:** Search yielded no results; may be minimal stub, in schema but not yet wired, or named differently
- **Growth/Launch domains:** Minimal exploration; details will emerge in Package 4 audit
- **Cursor-based pagination:** `src/domains/customers/timeline-page.ts` uses cursors; verify correctness vs. offset pagination elsewhere
- **Real DB tests:** `tests/customer-isolation.test.ts` and `tests/jobs-pagination-integration.test.ts` run against real Postgres; these are valuable proof points
- **Performance baseline:** No benchmarks yet; Package 1 and 2 audits will establish baseline queries and identify N+1 patterns

---

**Next Step:** Run Package 1 audit. See `docs/audits/Package-1-Customer-Lifecycle.md` when complete.
