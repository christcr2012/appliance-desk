# K-CASH-5A/5B same-bundle recovery checkpoint — 2026-10-21

Base: main `a1174bb33b500feeb7ce3e4e35cdf76084eb1e45`.
Frozen plan: `ae5eeaf1b6f60b4916e862dfc30f329da8ff0846` (never rewrite acceptance).
Branch: `ai/gpt6/kcash-5ab-plan-budget`.
Latest checkpoint: replace this resume SHA with actual branch head as observed (GitHub ref); the new plan, code and tests were committed in order.
No PR; zero whole completed subsections; no typecheck, local DB, CI or review claim.

Implemented but **unverified** seams:
- planning-math recurrence, target and prioritized funding preview; pure Vitest specs.
- planning.ts versioned cost plans, Denver-horizon occurrences, target CRUD, posted Expense settlement and inverse, private owner source snapshot; synthetic PostgreSQL specs.
- budget?tab=plan read, proposed funding confirmation through existing atomic moves, pending bills and target forms; browser staff/owner axe specs in existing browser-b shard.

Outstanding implementation in exact original bundle:
1. Reconcile source recurring expense and purchase-order commitments across create/edit/post/void and sourced tax/com costs; tighten source settlement/refund/correction and multi-source partial payments.
2. Reuse K-8 `cashForecast` and METRICS with no new collections versus expected, no double counting, source/date/as-of, first shortfall and unknown warnings.
3. Complete the whole approved tabs/navigation/context/Today/Review/METRICS/owner guidance; one source calculation, role-aware DTOs and source links.
4. Run `npm run session:prepare`, `npm run work -- check`, focused pure `npx vitest run tests/budget-planning.test.ts`, one disposable Postgres test `npm run test:db -- tests/budget-planning-integration.test.ts`, browser-b, typecheck, full `npm run check:quick && npm run bundle:preflight`; fix all failures without weakening tests.
5. Add full original acceptance evidence to scorecard, update STATUS/GO-LIVE/OWNER-GUIDE/DATABASE/DECISIONS/roadmap as real work progresses; only then PR/full exact-head CI/review/merge. Preserve 22 external rows pending.

**Known seam to inspect first:** BudgetCostSettlement immutable original uniqueness means a reversed posted expense link cannot simply be reused; ensure legitimate correction/reclassification safety with permanent original evidence. Cost plan source identity must not double-post K expense or bank money. Unit spec is newly authored and has not been executed. No production mutations/provider actions are authorized.

Additional implementation checkpoint: cash forecast source dedupe and two tracks, role-scoped context in Expenses/Purchases/Tax/Inventory, Today budget reminder block, schedule refresh and linked template choices are authored but unverified. Same existing original acceptance remains unfinished; this is not a new roadmap subsection.

Candidate phase: proposed scorecard source references cover original acceptance lines, but are **not yet evidence of passing CI**. Run exact-head tests before finalizing either completed whole subsection; rollback candidate claims if actual gaps emerge. No independent provider acceptance implied.
