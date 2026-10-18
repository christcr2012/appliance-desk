# K-2A + K-2B — posting and owner books workflow
Source: docs/designs/BATCH-K.md D-K2/D-K6/D-K12 sections 3.3, 4; docs/MASTER-ROADMAP.md K stage (approved 2026-10-06).
One coherent outcome: the owner establishes books once, safely records source-derived double-entry journals, inspects them and controls closed months.

## Frozen original complete acceptance
### K-2A
- Owner-initialized books start date gates all posting; sources stay unchanged and nonfinancial states are skipped or reported as problems.
- Journal poster processes pending eligible historical invoice, receipt, payment, credit, refund, deposit, expense, use-tax, Stripe and opening evidence in bounded chronological transactions, each with stable source/event idempotency keys and account-resolved balanced integer-cent lines.
- Concurrent/repeated posting is single-effect; failed or incomplete source is reported and never silently marked posted, with no partial entries.
- Closed accounting months never mutate: historical events land in first open month with original business date and late-entry memo; closure/reopening requires authorized owner and audit evidence.
### K-2B
- OWNER can set the accounting start date and initial bank/card/Stripe balances once, with a checked entry and revision-safe saves; ADMIN can inspect and post but not silently reset the starting figures.
- OWNER can rename accounts, configure export mappings and create approved expense/payment accounts without changing system-role/type or deleting used accounts; STAFF and CUSTOMER cannot inspect company books.
- OWNER/ADMIN Books screen offers bounded journal browser, date filters, source/late-entry labels, account balances, owner month closure and reopen-with-reason, and a guarded Bring the books up to date command; navigation and responsive/keyboard checks apply.

## Controls
Source records never mutated; role checks inside actions and domains; every money write transactional/unique, closed periods protected, no Stripe LIVE or emails/SMS, all tests on disposable local Postgres.

## Explicitly out of scope
K-3 real Stripe balance sync, K-4 expense capture forms, K-5 export formats, K-6 asset retirement gain/loss, K-7/K-8 reports; real CPA/prod activation separately accepted.

<!-- bundle-plan:start -->
```json
{
  "workKind": "ENGINEERING",
  "baseRevision": "b17151021f03a58be62fa58870b107d80c40cf1d",
  "outcome": "Usable, permission-gated owner accounting books: backfill and inspect balanced journal entries, configure start/accounts, and safely close months.",
  "integrationBoundary": "src/domains/books/post.ts and management.ts, src/app/desk/books pages/actions, existing chart and Prisma schema, route/menu/backup consistency and disposable Postgres/browser tests",
  "newEngineering": "Create bounded source adapters, transactional unique journal writer, closed-month shifted posting, owner setup and bank balances, account management, journal explorer and role-scoped actions.",
  "estimatedProductionLines": 1050,
  "relatedWorkDecision": "K-2A poster and K-2B owner books management are directly coupled; shipping journal writes without the journal browser, start setup or closure controls would be incomplete.",
  "subsections": [
    {
      "id": "K-2A",
      "acceptance": [
        "Owner-initialized books start date gates all posting; sources stay unchanged and nonfinancial states are skipped or reported as problems.",
        "Journal poster processes pending eligible historical invoice, receipt, payment, credit, refund, deposit, expense, use-tax, Stripe and opening evidence in bounded chronological transactions, each with stable source/event idempotency keys and account-resolved balanced integer-cent lines.",
        "Concurrent/repeated posting is single-effect; failed or incomplete source is reported and never silently marked posted, with no partial entries.",
        "Closed accounting months never mutate: historical events land in first open month with original business date and late-entry memo; closure/reopening requires authorized owner and audit evidence."
      ],
      "remainingEngineering": [
        "Owner-initialized books start date gates all posting; sources stay unchanged and nonfinancial states are skipped or reported as problems.",
        "Journal poster processes pending eligible historical invoice, receipt, payment, credit, refund, deposit, expense, use-tax, Stripe and opening evidence in bounded chronological transactions, each with stable source/event idempotency keys and account-resolved balanced integer-cent lines.",
        "Concurrent/repeated posting is single-effect; failed or incomplete source is reported and never silently marked posted, with no partial entries.",
        "Closed accounting months never mutate: historical events land in first open month with original business date and late-entry memo; closure/reopening requires authorized owner and audit evidence."
      ]
    },
    {
      "id": "K-2B",
      "acceptance": [
        "OWNER can set the accounting start date and initial bank/card/Stripe balances once, with a checked entry and revision-safe saves; ADMIN can inspect and post but not silently reset the starting figures.",
        "OWNER can rename accounts, configure export mappings and create approved expense/payment accounts without changing system-role/type or deleting used accounts; STAFF and CUSTOMER cannot inspect company books.",
        "OWNER/ADMIN Books screen offers bounded journal browser, date filters, source/late-entry labels, account balances, owner month closure and reopen-with-reason, and a guarded Bring the books up to date command; navigation and responsive/keyboard checks apply."
      ],
      "remainingEngineering": [
        "OWNER can set the accounting start date and initial bank/card/Stripe balances once, with a checked entry and revision-safe saves; ADMIN can inspect and post but not silently reset the starting figures.",
        "OWNER can rename accounts, configure export mappings and create approved expense/payment accounts without changing system-role/type or deleting used accounts; STAFF and CUSTOMER cannot inspect company books.",
        "OWNER/ADMIN Books screen offers bounded journal browser, date filters, source/late-entry labels, account balances, owner month closure and reopen-with-reason, and a guarded Bring the books up to date command; navigation and responsive/keyboard checks apply."
      ]
    }
  ]
}
```
<!-- bundle-plan:end -->

## Delivery evidence (the frozen plan above is unchanged)
- Posting source adapters, unique journals, source anti-join, closed-month placement: src/domains/books/post.ts.
- Owner/ADMIN management and review screens: src/domains/books/management.ts, src/app/desk/books.
- Seven disposable PostgreSQL tests passed in development: tests/books-poster-integration.test.ts.
- Browser spec e2e/books-workspace.spec.ts is in browser-b; exact-head browser/CI and review still pending.
- Typed SystemIssue category migration preserves prior allowed issue types; no real data changed.
- Automatic scheduling, K-3 live Stripe sync, K-5 formal exports and K-6 retirement gain/loss still not implemented.
