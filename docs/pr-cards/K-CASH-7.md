# K-CASH-7 — published monthly plans, trends, variance and month-end review

Next original approved unit after **MERGED PR #511** QBO delivery (main 555aa42efd9a1651ca49b4df3717a89a779f6a3e). Authoritative design `docs/designs/BATCH-K-CASH.md` §§6.1, 8–10 and existing K reports policy. Full original unit across one migration and shared budget/Books reports contract, not a helper. No actual bank/provider or production activation.

## Frozen original acceptance (engineering and proofs)

1. Create one additive/restorable migration for immutable BudgetPlanVersion and BudgetReviewSnapshot with monthly Denver period key, unique month/version and commandKey, source/budget revision watermarks, owner provenance, sha256, schema version, supersession and on-delete Restrict; no inserted defaults for populated or new businesses.
2. Allow OWNER-only draft preview and publish under BudgetState then BooksPostingRevision shared lock/revision, with commandKey idempotency, concurrency/stale-conflict, original first version and reasoned immutable revisions; ADMIN read-only, STAFF/CUSTOMER/revoked actors denied.
3. Validate typed cents and explicit period, envelope ID/name snapshots, planned spending/funding, opening saved balances, due occurrence source IDs/quality, optional labelled forecast revenue; schedule costs seed spending and targets funding (never expenses/cash). Editable unscheduled estimates require explicit owner review; absent plan is Unplanned not zero.
4. Produce signed K-ledger business trend measures: recognized revenue, operating costs and depreciation separate, net profit; handle refunds/contra/reversals, capital/deposits/tax/owner transfers excluded, actual accounting basis and unclosed/incomplete period warnings, default 12 and max 60 monthly buckets.
5. Produce signed bank cash movement independently of P&L: selected active cash-account debit/credit, per-account and consolidated opening/closing, transfer cancellation, tax/deposit/owner/Stripe classification and fees/clearing bridge; missing source proof is Unknown, not fabricated money.
6. Produce report for selected published month and version with planned spend vs actual net budget SPEND/REVERSAL, funding assignments minus releases, carryover, unpaid remaining commitments, unclassified outflows and signed variance; positive over/under labels, zero/missing denominator an em dash with reason.
7. Provide operating spending category/vendor share trend and known recurring-versus-oneoff split, unknown vendor/unclassified row preserved; upcoming due cost/coverage 30/90 days, protected tax/deposit/card reserve readiness and unresolved bank/QBO delivery evidence, without guessed projections.
8. Provide Denver month, quarter, year, YTD, bounded custom day 366, previous-period and prior-year same-elapsed-day comparisons (including leap day and partial periods), unavailable reasons for empty/uninitialized history; report filters never leak or convert K accounting to budget expenses.
9. Give every source-backed report total a deterministic date/id paginated drilldown whose complete source sum ties to displayed total at different page sizes; provide private owner/admin formula-escaped current-filter report CSV carrying source/basis/version/as-of metadata, distinctly labelled Report export not QBO journal import.
10. Provide an accessible, responsive owner finance report screen integrated into existing Reports hub and Budget Review navigation/tab, with chart-equivalent tables, keyboard/light/dark/axe and explicit accounting vs cash vs allocation labels; avoid duplicate journal aggregation logic or phantom ledger posting.
11. Month-end checklist derives bank-statement completion, unmatched/unclassified, expense/source posting, reserves, published plan and QBO confirmation from authoritative facts, with unresolved/unknown separate; publishing plan is not Books accounting close and saving review does not file tax.
12. Owner-only save immutable month-end report snapshot including selected plan version, filters, source and budget revision watermarks, totals and readiness facts, SHA256 and private actor/time; repeated saves create new artefact, prior evidence remains readable and stale after source changes, SQL restoration/upgrade safe.
13. Tests prove real-database duplicate/replay/race/role denial/immutability + existing populated upgrade/backup/restore, missing plan vs zero, partial settlements/reversals, refund/cash movement and transfer, journal P&L signed classifications, late source revision staleness, 60 bucket/paging/CSV formula and accessibility navigation; run one complete exact-head CI without disabling tests.
14. Keep source-based ledger, bank and forecast authority separate, funding OFF by default, no QBO provider connection, customer messages, live payment, bank transfer or production data writes; 22 external provider/owner/CPA acceptance items remain explicitly pending.

## Explicit excluded external acceptance (still open)

The 22 original owner/provider/CPA gates (actual QBO company/edition import, source statement reconciliation, owner opening composition, reserve/financial legal positions, paid providers and normal approved release) stay PENDING; no live Stripe/customer communication, bank transfer, QBO API, production financial changes or unscheduled deployment is authorized. Cash budgeting remains OFF. K-CASH-7 synthetic evidence must never be reinterpreted as real money availability or accountant approval.

<!-- bundle-plan:start -->
```json
{
  "baseRevision": "555aa42efd9a1651ca49b4df3717a89a779f6a3e",
  "workKind": "ENGINEERING",
  "outcome": "Deliver original K-CASH-7 immutable published monthly budgets, authoritative signed finance and budget reports, verified source drilldowns, month-end snapshot review and private downloads without live/provider changes.",
  "integrationBoundary": "Shared K ledger reports and BudgetState/BooksPostingRevision; migrations restricted to two immutable artefacts; reuse existing BudgetPlan, Spend, Envelope, Report hub and audit; K-CASH-6 provider boundary already merged #511. Later inventory M and other T/S work separate.",
  "newEngineering": "One additive schema migration, owner publish/revision/preview, ledger & envelope report service with filter/pagination/CSV, bank movement and protected-balance readiness, finance reports and review UI, immutable month-end snapshot with staleness and real Postgres/browser proof.",
  "estimatedProductionLines": 1100,
  "relatedWorkDecision": "K-CASH-7 is the next whole approved roadmap unit, including its three interlocked engineering facets in one coherent PR. No contrived helper-level split; a substantial single-subsection exception warranted by single migration and shared time/basis contracts.",
  "subsections": [
    {
      "id": "K-CASH-7",
      "acceptance": [
        "Create one additive/restorable migration for immutable BudgetPlanVersion and BudgetReviewSnapshot with monthly Denver period key, unique month/version and commandKey, source/budget revision watermarks, owner provenance, sha256, schema version, supersession and on-delete Restrict; no inserted defaults for populated or new businesses.",
        "Allow OWNER-only draft preview and publish under BudgetState then BooksPostingRevision shared lock/revision, with commandKey idempotency, concurrency/stale-conflict, original first version and reasoned immutable revisions; ADMIN read-only, STAFF/CUSTOMER/revoked actors denied.",
        "Validate typed cents and explicit period, envelope ID/name snapshots, planned spending/funding, opening saved balances, due occurrence source IDs/quality, optional labelled forecast revenue; schedule costs seed spending and targets funding (never expenses/cash). Editable unscheduled estimates require explicit owner review; absent plan is Unplanned not zero.",
        "Produce signed K-ledger business trend measures: recognized revenue, operating costs and depreciation separate, net profit; handle refunds/contra/reversals, capital/deposits/tax/owner transfers excluded, actual accounting basis and unclosed/incomplete period warnings, default 12 and max 60 monthly buckets.",
        "Produce signed bank cash movement independently of P&L: selected active cash-account debit/credit, per-account and consolidated opening/closing, transfer cancellation, tax/deposit/owner/Stripe classification and fees/clearing bridge; missing source proof is Unknown, not fabricated money.",
        "Produce report for selected published month and version with planned spend vs actual net budget SPEND/REVERSAL, funding assignments minus releases, carryover, unpaid remaining commitments, unclassified outflows and signed variance; positive over/under labels, zero/missing denominator an em dash with reason.",
        "Provide operating spending category/vendor share trend and known recurring-versus-oneoff split, unknown vendor/unclassified row preserved; upcoming due cost/coverage 30/90 days, protected tax/deposit/card reserve readiness and unresolved bank/QBO delivery evidence, without guessed projections.",
        "Provide Denver month, quarter, year, YTD, bounded custom day 366, previous-period and prior-year same-elapsed-day comparisons (including leap day and partial periods), unavailable reasons for empty/uninitialized history; report filters never leak or convert K accounting to budget expenses.",
        "Give every source-backed report total a deterministic date/id paginated drilldown whose complete source sum ties to displayed total at different page sizes; provide private owner/admin formula-escaped current-filter report CSV carrying source/basis/version/as-of metadata, distinctly labelled Report export not QBO journal import.",
        "Provide an accessible, responsive owner finance report screen integrated into existing Reports hub and Budget Review navigation/tab, with chart-equivalent tables, keyboard/light/dark/axe and explicit accounting vs cash vs allocation labels; avoid duplicate journal aggregation logic or phantom ledger posting.",
        "Month-end checklist derives bank-statement completion, unmatched/unclassified, expense/source posting, reserves, published plan and QBO confirmation from authoritative facts, with unresolved/unknown separate; publishing plan is not Books accounting close and saving review does not file tax.",
        "Owner-only save immutable month-end report snapshot including selected plan version, filters, source and budget revision watermarks, totals and readiness facts, SHA256 and private actor/time; repeated saves create new artefact, prior evidence remains readable and stale after source changes, SQL restoration/upgrade safe.",
        "Tests prove real-database duplicate/replay/race/role denial/immutability + existing populated upgrade/backup/restore, missing plan vs zero, partial settlements/reversals, refund/cash movement and transfer, journal P&L signed classifications, late source revision staleness, 60 bucket/paging/CSV formula and accessibility navigation; run one complete exact-head CI without disabling tests.",
        "Keep source-based ledger, bank and forecast authority separate, funding OFF by default, no QBO provider connection, customer messages, live payment, bank transfer or production data writes; 22 external provider/owner/CPA acceptance items remain explicitly pending."
      ],
      "remainingEngineering": [
        "Migrate original/revised immutable plans and private review snapshots without touching old data",
        "Implement owner-only publish/read and report source aggregation/CSV/snapshot/checks",
        "Integrate Budget Review and Reports hub and accessibility, prove disposable database, browser and exact-head CI"
      ]
    }
  ]
}
```
<!-- bundle-plan:end -->

Frozen baseline main `555aa42efd9a1651ca49b4df3717a89a779f6a3e`, after verified PR #511 merger. This card's docs-only planning commit must precede all K-CASH-7 source and migration files. Data-contract authors refer to existing `prisma/schema.prisma` `BudgetMove`/`JournalLine`, `src/domains/books/reports.ts` and `src/domains/budget/` with K §6.1 exact signed-cent definitions.
