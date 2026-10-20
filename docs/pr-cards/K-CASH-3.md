# K-CASH-3 — Bank matching, statement reconciliation, cash readiness

Original approved roadmap subsection from `docs/designs/BATCH-K-CASH.md` §§3.2–3.3, 4.1–4.2, 6, 7–10. Owner engineering approval October 19, 2026. This is **one entire original subsection**, not twelve invented ones. Existing bank-evidence schema is K-CASH-1/2; envelopes and funding moves begin with K-CASH-4A/B. Development does not authorize actual bank onboarding, provider spend, production data, LIVE payments, messages or manual releases.

## Acceptance (all mandatory)

1. Suggest candidate matches only from the same registered bank account, exact signed cents/direction and persisted owner-editable 0–30-day Denver match window; suggestions never confirm or post a journal.
2. Confirm exact-sum many-to-many bank observation and journal bank-line groups atomically with account→observation→line lock order, signed direction and account guards, active uniqueness, idempotent retry, version checks and OWNER/ADMIN live role verification.
3. Void only unreconciled match groups with an actor and reason; retain original matching evidence, reject stale/double claims and never delete journals or a completed statement's frozen match.
4. Guide unsupported/unmatched outflow to existing expense before K expense posting; inflow to existing payout/receipt and appropriate typed sources; never fabricate income or support unapproved loan/payroll/merchant adjustment postings.
5. Create owner-reviewed per-account statement DRAFT with validated Colorado start/end days, explicit entered beginning/ending cents and optional private evidence; first statement requires independently confirmed book opening/outstanding evidence and each later statement must adjoin prior completed statement without gaps/overlap.
6. Complete a statement only with zero bank equation difference and independent signed matched journal tie, with every observation matched or explicitly justified IGNORED only for valid duplicate/non-account evidence; list unresolved items and outstanding book lines, never plug the difference.
7. Freeze completed reconciliation rows and reproducible SHA-256 snapshot of exact included source IDs, dates, amounts and match groups plus actor/time/version; prohibit retroactive edit/supersession of completed source evidence.
8. OWNER-only reasoned reopen creates a new current revision and retains prior completed hash/evidence/history; enforce reverse chronological reopening of later periods, latest-version concurrency, and invalidate dependent verified-cash states without reversing book journals.
9. Compute conservative account-by-account cash eligibility at a reconciled cutoff: ending bank balance, cleared later inflows, all later book outflows, pre-cutoff unpresented book outflows and unreleased holds, counted once; unmatched transfer inflow and Stripe/undeposited/pending money cannot be funded.
10. Show protected K liability obligations separately (customer deposits/credits/unapplied, sales/use/RDF tax, card payable), source-backed or UNKNOWN; refuse safe/assignable label for stale or incomplete bank-through confirmation, unknown debt, discrepancy, unresolved sources, negative account or missing setup, and preserve negative shortages without invented balances.
11. Provide private, keyboard-operable, mobile/light/dark owner Bank checks screens for imports, matches, unmatched entries, statement setup/proof, reopen/void, freshness and cash evidence, with ADMIN review/match but OWNER-only reconciliation and no STAFF/CUSTOMER leakage.
12. Verify all above using focused pure/real disposable PostgreSQL tests for roles, idempotency, concurrent double submissions, many-to-many/mixed direction, statement gaps/DST/reopen/history, cash/hold/tax/transfer edge cases, populated backup/privacy, and browser/axe bank-check flows; update owner/finance/release evidence separately.

<!-- bundle-plan:start -->
```json
{
  "workKind": "ENGINEERING",
  "baseRevision": "78b3de99cc6484a97498327865649ecde0fd3d50",
  "outcome": "Complete first-party bank matching, immutable statement reconciliation, and conservative source-evidenced cash readiness with private owner Bank checks; never move funds or invent bank clearance.",
  "integrationBoundary": "Build on merged K-CASH-1/2 CashAccount/BankObservation/BankMatchGroup/BankMatchItem/BankReconciliation/CashHold, existing K journal/ledger/payment/obligation and private source evidence. K-CASH-4A/B own budget persistence/envelopes and actual assignment; K-CASH-3 must not pretend those exist.",
  "newEngineering": "Original K-CASH-3 match and statement transaction services, conservative bank readiness adapter, server actions and owner/admin mobile Bank checks UI, durable audit and real Postgres/browser regression evidence; no bank feed/Stripe LIVE/production data.",
  "estimatedProductionLines": 1450,
  "relatedWorkDecision": "One whole original K-CASH-3 subsection is necessarily substantial and uniquely risk-bearing, following merged K-CASH-1/2. Later K-CASH-4A/B cannot be counted until their complete approved budget schema/movement outcome.",
  "subsections": [
    {
      "id": "K-CASH-3",
      "acceptance": [
        "Suggest candidate matches only from the same registered bank account, exact signed cents/direction and persisted owner-editable 0–30-day Denver match window; suggestions never confirm or post a journal.",
        "Confirm exact-sum many-to-many bank observation and journal bank-line groups atomically with account→observation→line lock order, signed direction and account guards, active uniqueness, idempotent retry, version checks and OWNER/ADMIN live role verification.",
        "Void only unreconciled match groups with an actor and reason; retain original matching evidence, reject stale/double claims and never delete journals or a completed statement's frozen match.",
        "Guide unsupported/unmatched outflow to existing expense before K expense posting; inflow to existing payout/receipt and appropriate typed sources; never fabricate income or support unapproved loan/payroll/merchant adjustment postings.",
        "Create owner-reviewed per-account statement DRAFT with validated Colorado start/end days, explicit entered beginning/ending cents and optional private evidence; first statement requires independently confirmed book opening/outstanding evidence and each later statement must adjoin prior completed statement without gaps/overlap.",
        "Complete a statement only with zero bank equation difference and independent signed matched journal tie, with every observation matched or explicitly justified IGNORED only for valid duplicate/non-account evidence; list unresolved items and outstanding book lines, never plug the difference.",
        "Freeze completed reconciliation rows and reproducible SHA-256 snapshot of exact included source IDs, dates, amounts and match groups plus actor/time/version; prohibit retroactive edit/supersession of completed source evidence.",
        "OWNER-only reasoned reopen creates a new current revision and retains prior completed hash/evidence/history; enforce reverse chronological reopening of later periods, latest-version concurrency, and invalidate dependent verified-cash states without reversing book journals.",
        "Compute conservative account-by-account cash eligibility at a reconciled cutoff: ending bank balance, cleared later inflows, all later book outflows, pre-cutoff unpresented book outflows and unreleased holds, counted once; unmatched transfer inflow and Stripe/undeposited/pending money cannot be funded.",
        "Show protected K liability obligations separately (customer deposits/credits/unapplied, sales/use/RDF tax, card payable), source-backed or UNKNOWN; refuse safe/assignable label for stale or incomplete bank-through confirmation, unknown debt, discrepancy, unresolved sources, negative account or missing setup, and preserve negative shortages without invented balances.",
        "Provide private, keyboard-operable, mobile/light/dark owner Bank checks screens for imports, matches, unmatched entries, statement setup/proof, reopen/void, freshness and cash evidence, with ADMIN review/match but OWNER-only reconciliation and no STAFF/CUSTOMER leakage.",
        "Verify all above using focused pure/real disposable PostgreSQL tests for roles, idempotency, concurrent double submissions, many-to-many/mixed direction, statement gaps/DST/reopen/history, cash/hold/tax/transfer edge cases, populated backup/privacy, and browser/axe bank-check flows; update owner/finance/release evidence separately."
      ],
      "remainingEngineering": [
        "Suggest candidate matches only from the same registered bank account, exact signed cents/direction and persisted owner-editable 0–30-day Denver match window; suggestions never confirm or post a journal.",
        "Confirm exact-sum many-to-many bank observation and journal bank-line groups atomically with account→observation→line lock order, signed direction and account guards, active uniqueness, idempotent retry, version checks and OWNER/ADMIN live role verification.",
        "Void only unreconciled match groups with an actor and reason; retain original matching evidence, reject stale/double claims and never delete journals or a completed statement's frozen match.",
        "Guide unsupported/unmatched outflow to existing expense before K expense posting; inflow to existing payout/receipt and appropriate typed sources; never fabricate income or support unapproved loan/payroll/merchant adjustment postings.",
        "Create owner-reviewed per-account statement DRAFT with validated Colorado start/end days, explicit entered beginning/ending cents and optional private evidence; first statement requires independently confirmed book opening/outstanding evidence and each later statement must adjoin prior completed statement without gaps/overlap.",
        "Complete a statement only with zero bank equation difference and independent signed matched journal tie, with every observation matched or explicitly justified IGNORED only for valid duplicate/non-account evidence; list unresolved items and outstanding book lines, never plug the difference.",
        "Freeze completed reconciliation rows and reproducible SHA-256 snapshot of exact included source IDs, dates, amounts and match groups plus actor/time/version; prohibit retroactive edit/supersession of completed source evidence.",
        "OWNER-only reasoned reopen creates a new current revision and retains prior completed hash/evidence/history; enforce reverse chronological reopening of later periods, latest-version concurrency, and invalidate dependent verified-cash states without reversing book journals.",
        "Compute conservative account-by-account cash eligibility at a reconciled cutoff: ending bank balance, cleared later inflows, all later book outflows, pre-cutoff unpresented book outflows and unreleased holds, counted once; unmatched transfer inflow and Stripe/undeposited/pending money cannot be funded.",
        "Show protected K liability obligations separately (customer deposits/credits/unapplied, sales/use/RDF tax, card payable), source-backed or UNKNOWN; refuse safe/assignable label for stale or incomplete bank-through confirmation, unknown debt, discrepancy, unresolved sources, negative account or missing setup, and preserve negative shortages without invented balances.",
        "Provide private, keyboard-operable, mobile/light/dark owner Bank checks screens for imports, matches, unmatched entries, statement setup/proof, reopen/void, freshness and cash evidence, with ADMIN review/match but OWNER-only reconciliation and no STAFF/CUSTOMER leakage.",
        "Verify all above using focused pure/real disposable PostgreSQL tests for roles, idempotency, concurrent double submissions, many-to-many/mixed direction, statement gaps/DST/reopen/history, cash/hold/tax/transfer edge cases, populated backup/privacy, and browser/axe bank-check flows; update owner/finance/release evidence separately."
      ]
    }
  ]
}
```
<!-- bundle-plan:end -->

## Evidence and delivery state

**PLAN FROZEN — implementation not yet authored or verified.** Planning commit is an independent docs-only checkpoint; delivery must preserve these criteria verbatim. Local shell/Node/Postgres availability and CI must be evaluated separately. The 22 historic release-acceptance tasks are not credited to this plan.
