# K-4B — Expense phone workflow and recurring drafts

This is the second full approved subsection bundled with K-4A under the **frozen** K-4A plan (`docs/pr-cards/K-4A.md`). Its six independent acceptance lines are reproduced in the K-4A plan for mechanical scorecard checks; keep this card as the navigator to the paired unit.

1. OWNER/ADMIN see a phone-first Expenses workspace within Books and can filter DRAFT/SUBMITTED/POSTED/VOID; STAFF see and submit only their own expense records with no journal, balances or other staff expenses; CUSTOMER cannot access.
2. Accessible responsive form presents date, amount, vendor, category, paid-from and optional memo/receipt/record links; clear role-specific Save draft / Submit / Post / Void and error feedback, without client-only authorization.
3. OWNER/ADMIN can create, edit/deactivate and inspect recurring expense templates with safe day 1–28; a bounded daily scheduler creates at most one DRAFT per enabled template and Colorado month, never auto-posts or sends money.
4. Recurring creation is idempotent under parallel runs, survives partial failure, does not mutate prior drafts, and records durable run/checkpoint evidence; disabled templates do nothing. It is independently scheduled without activating Stripe sync.
5. Owner Guide, sidebar/route inventory, operational status/roadmap and database notes explain submitted versus posted, private receipt access, recurring drafts, and outstanding owner/real-world acceptance accurately.
6. Disposable PostgreSQL concurrency/permission tests, unit forms and route/browser/accessibility checks prove privacy, save/post/void actions, recurrence and no duplicate billing. Exact-head CI and review must pass before merge; private storage provider acceptance is separate.

Status at planning freeze: NOT IMPLEMENTED. The K-4B screen/drafts must ship and pass the same exact-head CI as K-4A, not be split into a helper-only PR.
