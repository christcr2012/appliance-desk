## October 21 — K-CASH-5AB exact-head 558d91f7 test confirmation and lint recovery

On `558d91f74e6642d62680d67c6c38a712e7b3cc94`, all four browser shards succeeded, including the full owner-workflow schedule and staff-budget denial; all three real-database/unit shards succeeded, including a regression re-forecasting a bill linked to a now-VOID expense. Typecheck, capacity baseline, classification, secret scan and release policy succeeded. Lint alone failed: synchronous `setHydrated(true)` inside `useEffect` is prohibited. The code uses `useSyncExternalStore` to expose a stable SSR false and client true hydration snapshot and keep date input and submit button disabled before hydration. No test was skipped, weakened or quarantined. **The final revised head is not yet verified**; all original acceptance lines and 22 separate release checks remain pending until exact-head proof and merge.

## Recovery after rebased exact-head CI `c1d1506bd744701a45dab77f8921c025537a8048` — 2026-10-21
Main Sol 5.6 owner identity-guidance merge is in this branch; PR #509 is mergeable but DRAFT. On this exact head, all three unit/real-PostgreSQL shards, typecheck/lint, capacity, secret scan, release policy and browser-c/d passed. Browser-b failed because a streamed Next.js role-denial redirect had HTTP 200 instead of the asserted 3xx; the test must assert the resulting URL and denied private DOM, not the wire status. Browser-a owner workflow failed because an unhydrated controlled delivery time input was reset before save, leaving visible `Choose a date and time` alert in Playwright's error snapshot. Fix the interactive input hydration guard; do not skip or weaken the workflow test. Separate self-review found that K-8 forecast counted an immutable settlement from a now-VOID Books expense as still paid; recheck authoritative posted status and add disposable real-Postgres regression. Corrective code is a CANDIDATE and requires a fresh exact-head run; all original K-CASH-5A/5B acceptance and 22 external checks remain pending until independently verified.

# K-CASH-5A/5B same-bundle recovery checkpoint — 2026-10-21

Base: main `a1174bb33b500feeb7ce3e4e35cdf76084eb1e45`.
Frozen plan: `ae5eeaf1b6f60b4916e862dfc30f329da8ff0846` (never rewrite acceptance).
Branch: `ai/gpt6/kcash-5ab-plan-budget`.
First candidate head: `4fc9f7d6b771f15fb5eaab87a2c475e293215ac6`; draft PR #509 is open. Frozen plan, source and tests were committed in order. First exact-head CI FAILED on formatting lint, one stale-correction assertion and three browser checks; capacity baseline is a separate advisory failure. No whole subsections are accepted or merged. Typecheck passed on that first head; other required proof remains pending.

Recovery diagnosis: fix shared-money-format rule in expense budget field; distinguish stale-revision denial from a fresh one-time inverse denial with separate real-Postgres assertions; label the new BudgetContextCard aside landmark; show Unknown forecast tracks when Books source initialization is missing rather than inventing cash; ensure the staff denial browser test waits on an actual server response instead of a redirect race. Corrective candidate still needs all new exact-head gates, updated-base reconciliation and review; no local clone or disposable Postgres was available in this sandbox.

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
