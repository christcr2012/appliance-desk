# K-4A + K-4B — Expense lifecycle, private receipts, phone workflow and recurring drafts

**Scope:** complete approved K-4A and K-4B together as one coherent expense provider/screen bundle. Start from merged K-3 at `7ee4d2de5d40e2c78d8a7bf84ebf0096fa714dd7`; governed by `AGENTS.md`, `docs/AGENT-QUICKSTART.md`, `docs/MASTER-ROADMAP.md`, Batch K D-K8/D-K11 §3.5, owner privacy/storage rules. Original subsection IDs and acceptance retained.

## K-4A complete acceptance
1. All expense mutations validate USD integer cents, dates, seller tax ≤ amount, vendor/category/payment source and optional appliance/job/purchase references. STAFF can submit own expense; OWNER/ADMIN may create POSTED or DRAFT. No Stripe/provider money moves.
2. Posting requires live OWNER/ADMIN identity checked transactionally, a row lock and matching expected version; double submits and concurrent/replayed post calls yield exactly one immutable balanced journal. POSTED cannot be edited or deleted.
3. Voiding requires live OWNER/ADMIN, matching expected version and a non-empty reason; it preserves original Expense and audit trail, creates one balanced reversal via K-2, never deletes media or overwrites closed months.
4. Capitalized acquisition sets appliance acquisitionCostCents only if empty or identical; conflicting cost fails closed without partial journal. Eligible expense purchases integrate the existing use-tax service and preserve filed-period rules.
5. Private receipt attachment uses verified existing private photo Blob store, new expense-only path and a verified source-owned Photo. Upload token mint, attachment, readback and unauthorized photo IDs fail closed for strangers/other STAFF/CUSTOMER, without public URL leakage or production fixture data.
6. Real PostgreSQL integration regressions cover status and role boundaries, money cent validation, wrong-category/paid-from, concurrent/double post, void/reversal, acquisition conflict, use tax behavior, receipt ownership and recovery. Focused browser/CI tests remain independently required.

## K-4B complete acceptance
1. OWNER/ADMIN see a phone-first Expenses workspace within Books and can filter DRAFT/SUBMITTED/POSTED/VOID; STAFF see and submit only their own expense records with no journal, balances or other staff expenses; CUSTOMER cannot access.
2. Accessible responsive form presents date, amount, vendor, category, paid-from and optional memo/receipt/record links; clear role-specific Save draft / Submit / Post / Void and error feedback, without client-only authorization.
3. OWNER/ADMIN can create, edit/deactivate and inspect recurring expense templates with safe day 1–28; a bounded daily scheduler creates at most one DRAFT per enabled template and Colorado month, never auto-posts or sends money.
4. Recurring creation is idempotent under parallel runs, survives partial failure, does not mutate prior drafts, and records durable run/checkpoint evidence; disabled templates do nothing. It is independently scheduled without activating Stripe sync.
5. Owner Guide, sidebar/route inventory, operational status/roadmap and database notes explain submitted versus posted, private receipt access, recurring drafts, and outstanding owner/real-world acceptance accurately.
6. Disposable PostgreSQL concurrency/permission tests, unit forms and route/browser/accessibility checks prove privacy, save/post/void actions, recurrence and no duplicate billing. Exact-head CI and review must pass before merge; private storage provider acceptance is separate.

## Architecture and boundaries
- Finance source: existing `Expense`, `ExpenseCategory`, `RecurringExpense`, `JournalEntry`, `Photo` and `AuditLog` records. Reuse `expensePosted/expenseVoided` pure plans and K-2 poster. No expense-money operation causes a Stripe charge, transfer, payout, refund or notification.
- Permissions: live transactional `assertActiveTeamActor` for OWNER/ADMIN financial mutations and STAFF-owned submissions. Receipt read/upload scopes enforced on the server; never share a storage-provider URL as access control.
- Private evidence: reuse `getPrivatePhotoStore`, `canUploadPhoto`, `/api/uploads/photo`, `/api/photos/[id]`. Extend their path allowlist only for ID-scoped expenses. Token/store mismatch fails closed; no public fallback.
- Recurrence: reusable `RecurringExpense.lastCreatedFor` plus a transaction/lock, Colorado month key, scheduled independently of the gated Stripe import. Drafts require human confirmation and retain audit provenance.
- Scope limits: live production activation, customer notification, Stripe money writes and production fixture changes remain separately approval-gated. The development safety controls are not permanently imposed on end-user finance functionality.

## Gate and delivery record
Plan and both acceptance lists committed **before runtime edits**. Implement whole data+domain+upload+screen+automation bundle; typecheck; write focused real-Postgres permission/money/concurrency tests; then full exact-head CI and independent review, address all findings, merge only when green. Update K-3 merged history, work index, status, owner guide, database/storage notes and routes. Do not mark real-provider receipt acceptance as passed without actual owner-authorized evidence.

<!-- bundle-plan:start -->
```json
{
  "workKind": "ENGINEERING",
  "baseRevision": "7ee4d2de5d40e2c78d8a7bf84ebf0096fa714dd7",
  "outcome": "Owner and staff can safely record, review, post, void and recover purchase expenses with private evidence and recurring drafts in one mobile-first workflow.",
  "integrationBoundary": "Existing Prisma Expense/ExpenseCategory/RecurringExpense and Photo; account poster, team actor and audit, verified private Vercel Blob, Desk Books and new mobile Expenses, guarded daily automation.",
  "newEngineering": "Expense lifecycle domain and private receipt authorization, phone-first owner/staff Expense screens, recurring draft generator and independently guarded nightly runner, role/finance/database/browser regression coverage.",
  "estimatedProductionLines": 800,
  "relatedWorkDecision": "K-4A and K-4B share the same expense, upload, posting and screen boundary and are one PR. K-5 exports is a different export/integration surface and follows separately.",
  "subsections": [
    {
      "id": "K-4A",
      "acceptance": [
        "All expense mutations validate USD integer cents, dates, seller tax ≤ amount, vendor/category/payment source and optional appliance/job/purchase references. STAFF can submit own expense; OWNER/ADMIN may create POSTED or DRAFT. No Stripe/provider money moves.",
        "Posting requires live OWNER/ADMIN identity checked transactionally, a row lock and matching expected version; double submits and concurrent/replayed post calls yield exactly one immutable balanced journal. POSTED cannot be edited or deleted.",
        "Voiding requires live OWNER/ADMIN, matching expected version and a non-empty reason; it preserves original Expense and audit trail, creates one balanced reversal via K-2, never deletes media or overwrites closed months.",
        "Capitalized acquisition sets appliance acquisitionCostCents only if empty or identical; conflicting cost fails closed without partial journal. Eligible expense purchases integrate the existing use-tax service and preserve filed-period rules.",
        "Private receipt attachment uses verified existing private photo Blob store, new expense-only path and a verified source-owned Photo. Upload token mint, attachment, readback and unauthorized photo IDs fail closed for strangers/other STAFF/CUSTOMER, without public URL leakage or production fixture data.",
        "Real PostgreSQL integration regressions cover status and role boundaries, money cent validation, wrong-category/paid-from, concurrent/double post, void/reversal, acquisition conflict, use tax behavior, receipt ownership and recovery. Focused browser/CI tests remain independently required."
      ],
      "remainingEngineering": [
        "All expense mutations validate USD integer cents, dates, seller tax ≤ amount, vendor/category/payment source and optional appliance/job/purchase references. STAFF can submit own expense; OWNER/ADMIN may create POSTED or DRAFT. No Stripe/provider money moves.",
        "Posting requires live OWNER/ADMIN identity checked transactionally, a row lock and matching expected version; double submits and concurrent/replayed post calls yield exactly one immutable balanced journal. POSTED cannot be edited or deleted.",
        "Voiding requires live OWNER/ADMIN, matching expected version and a non-empty reason; it preserves original Expense and audit trail, creates one balanced reversal via K-2, never deletes media or overwrites closed months.",
        "Capitalized acquisition sets appliance acquisitionCostCents only if empty or identical; conflicting cost fails closed without partial journal. Eligible expense purchases integrate the existing use-tax service and preserve filed-period rules.",
        "Private receipt attachment uses verified existing private photo Blob store, new expense-only path and a verified source-owned Photo. Upload token mint, attachment, readback and unauthorized photo IDs fail closed for strangers/other STAFF/CUSTOMER, without public URL leakage or production fixture data.",
        "Real PostgreSQL integration regressions cover status and role boundaries, money cent validation, wrong-category/paid-from, concurrent/double post, void/reversal, acquisition conflict, use tax behavior, receipt ownership and recovery. Focused browser/CI tests remain independently required."
      ]
    },
    {
      "id": "K-4B",
      "acceptance": [
        "OWNER/ADMIN see a phone-first Expenses workspace within Books and can filter DRAFT/SUBMITTED/POSTED/VOID; STAFF see and submit only their own expense records with no journal, balances or other staff expenses; CUSTOMER cannot access.",
        "Accessible responsive form presents date, amount, vendor, category, paid-from and optional memo/receipt/record links; clear role-specific Save draft / Submit / Post / Void and error feedback, without client-only authorization.",
        "OWNER/ADMIN can create, edit/deactivate and inspect recurring expense templates with safe day 1–28; a bounded daily scheduler creates at most one DRAFT per enabled template and Colorado month, never auto-posts or sends money.",
        "Recurring creation is idempotent under parallel runs, survives partial failure, does not mutate prior drafts, and records durable run/checkpoint evidence; disabled templates do nothing. It is independently scheduled without activating Stripe sync.",
        "Owner Guide, sidebar/route inventory, operational status/roadmap and database notes explain submitted versus posted, private receipt access, recurring drafts, and outstanding owner/real-world acceptance accurately.",
        "Disposable PostgreSQL concurrency/permission tests, unit forms and route/browser/accessibility checks prove privacy, save/post/void actions, recurrence and no duplicate billing. Exact-head CI and review must pass before merge; private storage provider acceptance is separate."
      ],
      "remainingEngineering": [
        "OWNER/ADMIN see a phone-first Expenses workspace within Books and can filter DRAFT/SUBMITTED/POSTED/VOID; STAFF see and submit only their own expense records with no journal, balances or other staff expenses; CUSTOMER cannot access.",
        "Accessible responsive form presents date, amount, vendor, category, paid-from and optional memo/receipt/record links; clear role-specific Save draft / Submit / Post / Void and error feedback, without client-only authorization.",
        "OWNER/ADMIN can create, edit/deactivate and inspect recurring expense templates with safe day 1–28; a bounded daily scheduler creates at most one DRAFT per enabled template and Colorado month, never auto-posts or sends money.",
        "Recurring creation is idempotent under parallel runs, survives partial failure, does not mutate prior drafts, and records durable run/checkpoint evidence; disabled templates do nothing. It is independently scheduled without activating Stripe sync.",
        "Owner Guide, sidebar/route inventory, operational status/roadmap and database notes explain submitted versus posted, private receipt access, recurring drafts, and outstanding owner/real-world acceptance accurately.",
        "Disposable PostgreSQL concurrency/permission tests, unit forms and route/browser/accessibility checks prove privacy, save/post/void actions, recurrence and no duplicate billing. Exact-head CI and review must pass before merge; private storage provider acceptance is separate."
      ]
    }
  ]
}
```
<!-- bundle-plan:end -->

## Verified evidence
NOT YET IMPLEMENTED. Freeze here; append dated proof without changing the frozen acceptance block.
