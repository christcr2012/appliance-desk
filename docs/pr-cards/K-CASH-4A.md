# K-CASH-4A + K-CASH-4B — verified budget envelope foundation and money movement

Two whole original approved subsections in **one** coherent owner-approved engineering bundle. Source: `docs/designs/BATCH-K-CASH.md` §§1–2, 4.1–4.3, 7–10, table 8. They depend on merged K-CASH-3 PR #507 and K journals. The two subsections retain their ORIGINAL IDs; individual lines below are acceptance tests, not new units.

No developer permission to select a bank, post real money, activate LIVE providers, spend money, send messages, change production data or conduct a manual release. Bank provider/account/CPA setup and full-freshness evidence remain real-world gate criteria. End-user rights may be delegated under product policy after full supported evidence.

## K-CASH-4A full acceptance — schema, evidence and restore

1. Add only the approved additive BudgetState singleton, BudgetEnvelope, BudgetMove, BudgetSpendSplit, BudgetTarget, BudgetCostPlan, BudgetCostOccurrence and BudgetCostSettlement Prisma/PostgreSQL models, all exact FK Restrict, bounded amounts, unique keys, status semantics, needed indexes, approved enum/string values and source evidence fields; do not invent deposits or account balances.
2. Enforce SQL nonzero/positive safe cents, allowed enum/kind, immutable/reversal histories, nullable source uniqueness, FK/account lock and unique command/split/occurrence/settlement constraints in the intended batch_k_cash_budget migration; no cascading deletion of journals or history.
3. Add initial owner-configurable cashBudgetStartOn, cashBudgetEnabled default OFF, bankEvidenceMaxAgeDays 7, budgetPlanningHorizonDays 90, budgetUpcomingWindowDays 30 and budgetReminderLeadDays 7 with approved ranges/Denver dates, no hidden activation or arbitrary tax percentage; use existing BusinessSettings rather than competing configuration.
4. Seed only the approved editable discretionary envelope LABELS, with zero entries or invented funding prohibited; protected customer/tax/card obligations derive from K journal liabilities, never from mutable envelopes.
5. Preserve edit/archive/name/order/version metadata and restore without deleting nonzero envelope balances; all writes require active OWNER inside transactions and never expose protected bank/reserve data to STAFF/CUSTOMER.
6. Model typed target and cost-plan/occurrence/settlement identities and amount-quality semantics for later K-CASH-5A services without inventing planning, settlement or funding functionality in the schema bundle; do not mark an unimplemented 5A outcome completed.
7. Include the complete eight-model new schema family in persisted backup/restore manifest, FK history restoration ordering, schema-health checks, populated upgrade, and no newly required production fixture/env changes.
8. Verify an existing populated database migrates safely with all existing journal/bank/expense data preserved, defaults OFF, no phantom balances; test SQL checks, concurrent uniqueness, immutable financial history and create/restore again using actual disposable Postgres.
9. Document data retention/privacy, schema relationship and owner activation boundaries; no bank API, bank creds, provider money transfers, Stripe LIVE, direct QBO sync or production data modifications.

## K-CASH-4B full acceptance — protected reserves, atomic movements

1. Compute one source-backed per-bank cash eligibility at completed owner-attested statement cutoffs with latest source/revision, optional fresh confirmed bank-through proof, matched pending deposits only when truly cleared, all book outflows and unreleased holds; account-level stale, negative, gap and unknown conditions fail closed.
2. Derive protected obligations separately from K journal per customer deposits, unapplied receipts/credits, sales and use tax, RDF and card payable; prevent cross-group offset of negative liabilities, classify missing debt and pending refunds as UNKNOWN, and present protected shortage and real source drilldowns.
3. Compute Ready = eligibleCash - protected obligations - sum positive discretionary envelope balances without counting monthly carryover, transfers or outstanding expenses a second time; preserve negative shortages, clear deficits before other allocations, exclude unpaid rentals/pending Stripe funds/unknown or personal balances.
4. Apply audited OWNER-only assign/release/transfer funding using stable command ID, payload hash, expected BudgetState revision and fresh BooksPostingRevision source watermark; recheck full bank/protected/hold state under BudgetState -> Books revision -> sorted account/envelope locks, fail on stale evidence and never overfund across concurrent assignments.
5. Identical retries return the original result, reused key with different payload conflicts, and concurrent approvals/unsorted split/order edge cases commit once or fail atomically with no partial BudgetMove; failed money action never calls external provider.
6. Handle discretionary journalLineId-linked spend splits once, prevent repeat recognition from matched bank imports or expense repost, preserve full signed negative overspending/unassigned-spend attention, and allow recording real expenses even when budget lacks funds.
7. Protected tax/deposit/card payments reduce bank and corresponding liability once, not a discretionary envelope again; owner draw consumes Owner pay but is never operating expense; source-linked supplier refunds return only original discretionary consumption.
8. Reasoned corrections write inverse immutable BudgetMoves and maintain exact source/event version uniqueness; do not delete/silently mutate old moves or treat transfer as bank transfer; release cannot exceed positive envelope balance or touch legally protected reserves.
9. Budget snapshot/preview is private OWNER/ADMIN read-only, with clear incomplete reasons and source timestamp; only OWNER moves money, confirms budget start/settings and initial account selection. STAFF/CUSTOMER never see balances/totals even by action/route/API.
10. Provide safe owner-facing budget controls, source-backed protected rows, preview of before/after balances, unmet obligations, shortages and visible UNKNOWN; correct mobile/light/dark/keyboard/axe, no green spendable status without proven complete bank/card/debt facts.
11. Real disposable PostgreSQL acceptance must cover double-submit, version/idempotency races, unknown obligations, negative accounts, stale statement/holds, transfer-in-flight, exact protected liability funding, tax/card double counting, spending/reversal/undo, populated backup restore and browser auth/accessibility.
12. Do not activate budgeting or permit positive assignment until owner-reconciled opening composition and full real bank-through and debt evidence are complete; no bank transfers, real customer communication, LIVE payment or manual release without separate approval.

<!-- bundle-plan:start -->
```json
{
  "workKind": "ENGINEERING",
  "baseRevision": "aa575887ce1800e8354841270942b0c9365b34bf",
  "outcome": "Deliver the combined original K-CASH-4A budget schema and K-CASH-4B protected reserve/atomic envelope funding outcome with full persisted evidence, transactions, guarded owner experience and real-database/browser proof, without enabling unsupported spending.",
  "integrationBoundary": "Build directly on merged K-CASH-3 cash account, completed bank statements, cash readiness, K immutable journals/BooksPostingRevision and existing owner expense/tax/customer sources. Use approved K-CASH models; K-CASH-5A/5B own recurrence/target math and integrated budgeting experience. No outside provider integration.",
  "newEngineering": "Add additive Prisma migration, SQL constraints, backup/restore, finance locks and source adapters, protected snapshots, idempotent assignment/consumption, private forms/screens and disposable PostgreSQL/browser acceptance; no real production setup.",
  "estimatedProductionLines": 1650,
  "relatedWorkDecision": "K-CASH-4A (schema) and K-CASH-4B (funding logic) are two complete ORIGINAL adjacent roadmap subsections sharing every database lock, ledger/source, owner screen and regression boundary; deliver in one coherent PR instead of fragmenting financial integrity across helper PRs.",
  "subsections": [
    {
      "id": "K-CASH-4A",
      "acceptance": [
        "Add only the approved additive BudgetState singleton, BudgetEnvelope, BudgetMove, BudgetSpendSplit, BudgetTarget, BudgetCostPlan, BudgetCostOccurrence and BudgetCostSettlement Prisma/PostgreSQL models, all exact FK Restrict, bounded amounts, unique keys, status semantics, needed indexes, approved enum/string values and source evidence fields; do not invent deposits or account balances.",
        "Enforce SQL nonzero/positive safe cents, allowed enum/kind, immutable/reversal histories, nullable source uniqueness, FK/account lock and unique command/split/occurrence/settlement constraints in the intended batch_k_cash_budget migration; no cascading deletion of journals or history.",
        "Add initial owner-configurable cashBudgetStartOn, cashBudgetEnabled default OFF, bankEvidenceMaxAgeDays 7, budgetPlanningHorizonDays 90, budgetUpcomingWindowDays 30 and budgetReminderLeadDays 7 with approved ranges/Denver dates, no hidden activation or arbitrary tax percentage; use existing BusinessSettings rather than competing configuration.",
        "Seed only the approved editable discretionary envelope LABELS, with zero entries or invented funding prohibited; protected customer/tax/card obligations derive from K journal liabilities, never from mutable envelopes.",
        "Preserve edit/archive/name/order/version metadata and restore without deleting nonzero envelope balances; all writes require active OWNER inside transactions and never expose protected bank/reserve data to STAFF/CUSTOMER.",
        "Model typed target and cost-plan/occurrence/settlement identities and amount-quality semantics for later K-CASH-5A services without inventing planning, settlement or funding functionality in the schema bundle; do not mark an unimplemented 5A outcome completed.",
        "Include the complete eight-model new schema family in persisted backup/restore manifest, FK history restoration ordering, schema-health checks, populated upgrade, and no newly required production fixture/env changes.",
        "Verify an existing populated database migrates safely with all existing journal/bank/expense data preserved, defaults OFF, no phantom balances; test SQL checks, concurrent uniqueness, immutable financial history and create/restore again using actual disposable Postgres.",
        "Document data retention/privacy, schema relationship and owner activation boundaries; no bank API, bank creds, provider money transfers, Stripe LIVE, direct QBO sync or production data modifications."
      ],
      "remainingEngineering": [
        "Add only the approved additive BudgetState singleton, BudgetEnvelope, BudgetMove, BudgetSpendSplit, BudgetTarget, BudgetCostPlan, BudgetCostOccurrence and BudgetCostSettlement Prisma/PostgreSQL models, all exact FK Restrict, bounded amounts, unique keys, status semantics, needed indexes, approved enum/string values and source evidence fields; do not invent deposits or account balances.",
        "Enforce SQL nonzero/positive safe cents, allowed enum/kind, immutable/reversal histories, nullable source uniqueness, FK/account lock and unique command/split/occurrence/settlement constraints in the intended batch_k_cash_budget migration; no cascading deletion of journals or history.",
        "Add initial owner-configurable cashBudgetStartOn, cashBudgetEnabled default OFF, bankEvidenceMaxAgeDays 7, budgetPlanningHorizonDays 90, budgetUpcomingWindowDays 30 and budgetReminderLeadDays 7 with approved ranges/Denver dates, no hidden activation or arbitrary tax percentage; use existing BusinessSettings rather than competing configuration.",
        "Seed only the approved editable discretionary envelope LABELS, with zero entries or invented funding prohibited; protected customer/tax/card obligations derive from K journal liabilities, never from mutable envelopes.",
        "Preserve edit/archive/name/order/version metadata and restore without deleting nonzero envelope balances; all writes require active OWNER inside transactions and never expose protected bank/reserve data to STAFF/CUSTOMER.",
        "Model typed target and cost-plan/occurrence/settlement identities and amount-quality semantics for later K-CASH-5A services without inventing planning, settlement or funding functionality in the schema bundle; do not mark an unimplemented 5A outcome completed.",
        "Include the complete eight-model new schema family in persisted backup/restore manifest, FK history restoration ordering, schema-health checks, populated upgrade, and no newly required production fixture/env changes.",
        "Verify an existing populated database migrates safely with all existing journal/bank/expense data preserved, defaults OFF, no phantom balances; test SQL checks, concurrent uniqueness, immutable financial history and create/restore again using actual disposable Postgres.",
        "Document data retention/privacy, schema relationship and owner activation boundaries; no bank API, bank creds, provider money transfers, Stripe LIVE, direct QBO sync or production data modifications."
      ]
    },
    {
      "id": "K-CASH-4B",
      "acceptance": [
        "Compute one source-backed per-bank cash eligibility at completed owner-attested statement cutoffs with latest source/revision, optional fresh confirmed bank-through proof, matched pending deposits only when truly cleared, all book outflows and unreleased holds; account-level stale, negative, gap and unknown conditions fail closed.",
        "Derive protected obligations separately from K journal per customer deposits, unapplied receipts/credits, sales and use tax, RDF and card payable; prevent cross-group offset of negative liabilities, classify missing debt and pending refunds as UNKNOWN, and present protected shortage and real source drilldowns.",
        "Compute Ready = eligibleCash - protected obligations - sum positive discretionary envelope balances without counting monthly carryover, transfers or outstanding expenses a second time; preserve negative shortages, clear deficits before other allocations, exclude unpaid rentals/pending Stripe funds/unknown or personal balances.",
        "Apply audited OWNER-only assign/release/transfer funding using stable command ID, payload hash, expected BudgetState revision and fresh BooksPostingRevision source watermark; recheck full bank/protected/hold state under BudgetState -> Books revision -> sorted account/envelope locks, fail on stale evidence and never overfund across concurrent assignments.",
        "Identical retries return the original result, reused key with different payload conflicts, and concurrent approvals/unsorted split/order edge cases commit once or fail atomically with no partial BudgetMove; failed money action never calls external provider.",
        "Handle discretionary journalLineId-linked spend splits once, prevent repeat recognition from matched bank imports or expense repost, preserve full signed negative overspending/unassigned-spend attention, and allow recording real expenses even when budget lacks funds.",
        "Protected tax/deposit/card payments reduce bank and corresponding liability once, not a discretionary envelope again; owner draw consumes Owner pay but is never operating expense; source-linked supplier refunds return only original discretionary consumption.",
        "Reasoned corrections write inverse immutable BudgetMoves and maintain exact source/event version uniqueness; do not delete/silently mutate old moves or treat transfer as bank transfer; release cannot exceed positive envelope balance or touch legally protected reserves.",
        "Budget snapshot/preview is private OWNER/ADMIN read-only, with clear incomplete reasons and source timestamp; only OWNER moves money, confirms budget start/settings and initial account selection. STAFF/CUSTOMER never see balances/totals even by action/route/API.",
        "Provide safe owner-facing budget controls, source-backed protected rows, preview of before/after balances, unmet obligations, shortages and visible UNKNOWN; correct mobile/light/dark/keyboard/axe, no green spendable status without proven complete bank/card/debt facts.",
        "Real disposable PostgreSQL acceptance must cover double-submit, version/idempotency races, unknown obligations, negative accounts, stale statement/holds, transfer-in-flight, exact protected liability funding, tax/card double counting, spending/reversal/undo, populated backup restore and browser auth/accessibility.",
        "Do not activate budgeting or permit positive assignment until owner-reconciled opening composition and full real bank-through and debt evidence are complete; no bank transfers, real customer communication, LIVE payment or manual release without separate approval."
      ],
      "remainingEngineering": [
        "Compute one source-backed per-bank cash eligibility at completed owner-attested statement cutoffs with latest source/revision, optional fresh confirmed bank-through proof, matched pending deposits only when truly cleared, all book outflows and unreleased holds; account-level stale, negative, gap and unknown conditions fail closed.",
        "Derive protected obligations separately from K journal per customer deposits, unapplied receipts/credits, sales and use tax, RDF and card payable; prevent cross-group offset of negative liabilities, classify missing debt and pending refunds as UNKNOWN, and present protected shortage and real source drilldowns.",
        "Compute Ready = eligibleCash - protected obligations - sum positive discretionary envelope balances without counting monthly carryover, transfers or outstanding expenses a second time; preserve negative shortages, clear deficits before other allocations, exclude unpaid rentals/pending Stripe funds/unknown or personal balances.",
        "Apply audited OWNER-only assign/release/transfer funding using stable command ID, payload hash, expected BudgetState revision and fresh BooksPostingRevision source watermark; recheck full bank/protected/hold state under BudgetState -> Books revision -> sorted account/envelope locks, fail on stale evidence and never overfund across concurrent assignments.",
        "Identical retries return the original result, reused key with different payload conflicts, and concurrent approvals/unsorted split/order edge cases commit once or fail atomically with no partial BudgetMove; failed money action never calls external provider.",
        "Handle discretionary journalLineId-linked spend splits once, prevent repeat recognition from matched bank imports or expense repost, preserve full signed negative overspending/unassigned-spend attention, and allow recording real expenses even when budget lacks funds.",
        "Protected tax/deposit/card payments reduce bank and corresponding liability once, not a discretionary envelope again; owner draw consumes Owner pay but is never operating expense; source-linked supplier refunds return only original discretionary consumption.",
        "Reasoned corrections write inverse immutable BudgetMoves and maintain exact source/event version uniqueness; do not delete/silently mutate old moves or treat transfer as bank transfer; release cannot exceed positive envelope balance or touch legally protected reserves.",
        "Budget snapshot/preview is private OWNER/ADMIN read-only, with clear incomplete reasons and source timestamp; only OWNER moves money, confirms budget start/settings and initial account selection. STAFF/CUSTOMER never see balances/totals even by action/route/API.",
        "Provide safe owner-facing budget controls, source-backed protected rows, preview of before/after balances, unmet obligations, shortages and visible UNKNOWN; correct mobile/light/dark/keyboard/axe, no green spendable status without proven complete bank/card/debt facts.",
        "Real disposable PostgreSQL acceptance must cover double-submit, version/idempotency races, unknown obligations, negative accounts, stale statement/holds, transfer-in-flight, exact protected liability funding, tax/card double counting, spending/reversal/undo, populated backup restore and browser auth/accessibility.",
        "Do not activate budgeting or permit positive assignment until owner-reconciled opening composition and full real bank-through and debt evidence are complete; no bank transfers, real customer communication, LIVE payment or manual release without separate approval."
      ]
    }
  ]
}
```
<!-- bundle-plan:end -->

## Frozen-plan / engineering status

**PLAN FROZEN BEFORE SOURCE IMPLEMENTATION.** Read the existing K-CASH-3 source and migration/backup tests, check the stable lock order and independent K obligations, then implement BOTH originals and test every criterion. The scorecard counts neither subsection complete until exact-head CI, real Postgres, full browser and allowed review/disposition. `live` remains K-7; the 22 pre-existing release acceptance checks remain separately pending.
