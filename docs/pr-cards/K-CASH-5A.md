# K-CASH-5A + K-CASH-5B — finished source-backed cash planning and owner budgeting

**Approved original units, not new work:** K-CASH-5A and K-CASH-5B, after merged #508 K-CASH-4A/B. Design: `docs/designs/BATCH-K-CASH.md` §§5–6, 7–10; `docs/designs/BATCH-K.md` and current K forecast. **This is a frozen original criteria plan, not proof of implementation or release.**

## K-CASH-5A — full original acceptance
1. Implement OWNER-managed exact/estimated one-time, monthly, quarterly and annual cost plans with valid source identity, active/inactive versioning, recorded change reason and strictly positive whole-cent amounts; do not charge or book a plan as an expense.
2. Generate bounded, paged, resumable visible-horizon occurrences without duplicates using Denver business dates and month-end anchor clamping, including January 31, quarterly short months and February 29 annual transitions; do not rewrite paid history.
3. Correct future unpaid occurrences when a plan is revised, preserve settled/partly settled provenance and canceled evidence, and enforce unique plan/date plus permission and stale-version checks under concurrent edits.
4. Link existing approved recurring expense templates and purchase-order commitments as one deduplicated cost source; treat draft expenses as drafts, receiving as nonpayment and posted source evidence as authoritative. Tax periods are read-only protected obligations, not discretionary savings plans.
5. Settle occurrences only through verified unique posted expense/source references, allow multiple bounded partial source settlements, refuse overpayment and duplicate source claims, and reverse/refund once with immutable inverse records and ledger audit.
6. Implement OWNER-managed unique active envelope targets MONTHLY_SPEND, SAVE_BY_DATE and MAINTAIN_BALANCE with validated amount/due/repeat rules and historical target versions; no funds move on target edit.
7. Calculate exact whole-cent remaining-to-fund and suggested monthly savings, including carryover, net monthly spending, annual cycle rollovers, past/current deadlines and 1000-over-three-month ceiling; show no invented money.
8. Deduplicate target need versus unpaid upcoming bills per envelope using max rather than sum, preserve exact/estimate/source/shortage labels and consistent business-date calculations.
9. Produce OWNER-only deterministic funding plan preview ordered by overspent envelopes, protected shortfalls, earliest bills, date targets, monthly goals and maintain-balance goals; clamp every leg to verified Ready, revalidate source/revision/locks at commit and never auto-pay.
10. Extend the existing K-8 cash forecast and METRICS (not a second engine) with confirmed-cash/no-new-collections and separately estimated collections, source-deduplicated posted/planned costs, excluded unsettled Stripe/payout overlap, tax uncertainty, first shortfall and incomplete source warnings.
11. Exercise all planning, partial settlement/reversal, concurrent/replay, unknown and role-denial paths in real disposable PostgreSQL plus deterministic pure recurrence/target tests; maintain migration/restore evidence and all financial release activation fences.

## K-CASH-5B — full original acceptance
1. Build the approved Desk > Money > Budget My money / Plan ahead / Review / Bank checks / Setup navigation by reusing existing K-CASH-4B source/protection and finance screens, with safe routing, mobile cards, dark/light/keyboard/axe support.
2. Show bank source as-of and READY/UNKNOWN truth, protected shortfalls, Ready to assign, saved/needed/upcoming per envelope, transaction history and clear explanations that an allocation never moves money at the bank; do not expose sensitive totals to STAFF/CUSTOMER.
3. Provide OWNER-only preview/confirm of Save now, Move money and Fund upcoming bills with before/after source-linked funding, unmet obligations, stale-revision refusal, protected-debt boundaries and no silent auto-assignment.
4. Provide Plan ahead 30/90-day upcoming exact/estimate cost view, due/repeat/target editor, partial/paid filters, source links and an explicit linked-source record-payment path rather than initiating external payment.
5. Embed a shared role-shaped BudgetContextCard into expense, purchasing, appliance/replacement and tax screens; show projected remaining capacity without authorizing posting/receipt, expose only allowed staff envelope labels.
6. Integrate missing bank lines, stale source proof, protected shortfalls, overspending and due goals into existing Today/exception paths with deduped source keys, no private descriptions, and recoverable links.
7. Expose source/as-of/incomplete states through the existing METRICS registry and K forecast; do not create a competing P&L or misstate expected rentals as bank cash.
8. Prove owner/admin read versus OWNER-only mutation, staff/customer data isolation across page, server actions and shared DTOs, stale preview denial, phone widths, keyboard/dark/light and axe on the actual screens with registered browser shards.
9. Document plain-English weekly/monthly owner planning, provider-off operation, preserved immutable paid financial history and remaining real bank/CPA/release acceptance without treating synthetic test data as business approval.

## Explicit separate owner/provider gates
Real business-bank selected/opening/card/tax/deposit evidence, owner-set budget activation, CPA/filing advice, customer permissions, release of 4A/B/5A/B and production readback; no customer email/SMS, bank transfer, payment, live Stripe, professional sign-off, production records or unscheduled release is authorized by this code work. All 22 existing release-acceptance checks remain distinct until independently exercised.

<!-- bundle-plan:start -->
```json
{
  "baseRevision": "a1174bb33b500feeb7ce3e4e35cdf76084eb1e45",
  "workKind": "ENGINEERING",
  "outcome": "Complete original K-CASH-5A cost schedules, targets, source-linked settlements and corrected K forecast together with K-CASH-5B owner My money/Plan ahead/Today/context workspace, using K-CASH-4A/B budget evidence without enabling external payments.",
  "integrationBoundary": "Reuse BudgetState/Envelope/Target/CostPlan/Occurrence/Settlement schema, K-3/4B owner-scoped bank source and atomic money locks, K-8 cashForecast and METRICS, K expense/purchasing/inventory/T tax/Today; preserve separate owner, protected liabilities and provider boundaries.",
  "newEngineering": "Original K-CASH-5A recurrence/target/settlement/forecast and K-CASH-5B owner surfaces/context/Today integration, with pure, disposable PostgreSQL and browser acceptance.",
  "estimatedProductionLines": 1100,
  "relatedWorkDecision": "Whole K-CASH-5A and K-CASH-5B are adjacent approved subsections sharing target/occurrence and source-aware owner UI; deliver them as one coherent reviewable bundle rather than partial helper PRs. No change to financial activation/release permissions.",
  "subsections": [
    {
      "id": "K-CASH-5A",
      "acceptance": [
        "Implement OWNER-managed exact/estimated one-time, monthly, quarterly and annual cost plans with valid source identity, active/inactive versioning, recorded change reason and strictly positive whole-cent amounts; do not charge or book a plan as an expense.",
        "Generate bounded, paged, resumable visible-horizon occurrences without duplicates using Denver business dates and month-end anchor clamping, including January 31, quarterly short months and February 29 annual transitions; do not rewrite paid history.",
        "Correct future unpaid occurrences when a plan is revised, preserve settled/partly settled provenance and canceled evidence, and enforce unique plan/date plus permission and stale-version checks under concurrent edits.",
        "Link existing approved recurring expense templates and purchase-order commitments as one deduplicated cost source; treat draft expenses as drafts, receiving as nonpayment and posted source evidence as authoritative. Tax periods are read-only protected obligations, not discretionary savings plans.",
        "Settle occurrences only through verified unique posted expense/source references, allow multiple bounded partial source settlements, refuse overpayment and duplicate source claims, and reverse/refund once with immutable inverse records and ledger audit.",
        "Implement OWNER-managed unique active envelope targets MONTHLY_SPEND, SAVE_BY_DATE and MAINTAIN_BALANCE with validated amount/due/repeat rules and historical target versions; no funds move on target edit.",
        "Calculate exact whole-cent remaining-to-fund and suggested monthly savings, including carryover, net monthly spending, annual cycle rollovers, past/current deadlines and 1000-over-three-month ceiling; show no invented money.",
        "Deduplicate target need versus unpaid upcoming bills per envelope using max rather than sum, preserve exact/estimate/source/shortage labels and consistent business-date calculations.",
        "Produce OWNER-only deterministic funding plan preview ordered by overspent envelopes, protected shortfalls, earliest bills, date targets, monthly goals and maintain-balance goals; clamp every leg to verified Ready, revalidate source/revision/locks at commit and never auto-pay.",
        "Extend the existing K-8 cash forecast and METRICS (not a second engine) with confirmed-cash/no-new-collections and separately estimated collections, source-deduplicated posted/planned costs, excluded unsettled Stripe/payout overlap, tax uncertainty, first shortfall and incomplete source warnings.",
        "Exercise all planning, partial settlement/reversal, concurrent/replay, unknown and role-denial paths in real disposable PostgreSQL plus deterministic pure recurrence/target tests; maintain migration/restore evidence and all financial release activation fences."
      ],
      "remainingEngineering": [
        "Implement end-to-end source-linked cost plan and target service, immutable settlements and reversals",
        "Integrate deterministic verified Ready funding preview and K-8 forecast sources",
        "Prove all original criteria with pure, real PostgreSQL, regression and failure tests"
      ]
    },
    {
      "id": "K-CASH-5B",
      "acceptance": [
        "Build the approved Desk > Money > Budget My money / Plan ahead / Review / Bank checks / Setup navigation by reusing existing K-CASH-4B source/protection and finance screens, with safe routing, mobile cards, dark/light/keyboard/axe support.",
        "Show bank source as-of and READY/UNKNOWN truth, protected shortfalls, Ready to assign, saved/needed/upcoming per envelope, transaction history and clear explanations that an allocation never moves money at the bank; do not expose sensitive totals to STAFF/CUSTOMER.",
        "Provide OWNER-only preview/confirm of Save now, Move money and Fund upcoming bills with before/after source-linked funding, unmet obligations, stale-revision refusal, protected-debt boundaries and no silent auto-assignment.",
        "Provide Plan ahead 30/90-day upcoming exact/estimate cost view, due/repeat/target editor, partial/paid filters, source links and an explicit linked-source record-payment path rather than initiating external payment.",
        "Embed a shared role-shaped BudgetContextCard into expense, purchasing, appliance/replacement and tax screens; show projected remaining capacity without authorizing posting/receipt, expose only allowed staff envelope labels.",
        "Integrate missing bank lines, stale source proof, protected shortfalls, overspending and due goals into existing Today/exception paths with deduped source keys, no private descriptions, and recoverable links.",
        "Expose source/as-of/incomplete states through the existing METRICS registry and K forecast; do not create a competing P&L or misstate expected rentals as bank cash.",
        "Prove owner/admin read versus OWNER-only mutation, staff/customer data isolation across page, server actions and shared DTOs, stale preview denial, phone widths, keyboard/dark/light and axe on the actual screens with registered browser shards.",
        "Document plain-English weekly/monthly owner planning, provider-off operation, preserved immutable paid financial history and remaining real bank/CPA/release acceptance without treating synthetic test data as business approval."
      ],
      "remainingEngineering": [
        "Build real owner Budget workspace and role-shaped contextual cards, Today/metrics",
        "Test OWNER-only actions, staff/customer denial, keyboard/phone/dark/light/axe and integration",
        "Update handoff, scorecard, go-live state and pass full exact-head CI/review"
      ]
    }
  ]
}
```
<!-- bundle-plan:end -->

## Planning checkpoint
Plan on a new branch from reviewed main `a1174bb33b500feeb7ce3e4e35cdf76084eb1e45` before any code edits; retain this block and source/criteria unchanged. Execute in one related bundle with focused pure/DB tests and full exact-head CI on final candidate. A future result must show actual production lines, original criteria evidence and remaining engineering without retroactively changing acceptance.
