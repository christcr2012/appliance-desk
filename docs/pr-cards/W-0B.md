# W-0B — No Today item leads nowhere; delivery-fee records get a page to resolve them

Status: **MERGED (#343)** [planned PR state; merge gated on CI, review and preview] · Baseline inspected: W-0A PR #342 (2026-10-09; verify merge SHA at next checklist A).
Batch: W (`docs/designs/BATCH-W.md` §1, D-W1 last sentence, PR table W-0b) · Prerequisites: none (independent of W-0A;
either may merge first).
Base: latest `main`. Migration: **none**. Sizing estimate: ~250 production lines, ≤8 files, risk area: screens.

## Read only these

1. `src/domains/tax/acquisition-attention.ts` — the `RETAIL_DELIVERY_FEE` block (~70–89; href `/desk/tax`).
2. `src/domains/tax/rdf-records.ts` — `resolvePendingRdfRecords` (~279) and the record statuses.
3. `src/app/desk/sales-tax/layout.tsx` (tabs) and `src/app/desk/sales-tax/setup/page.tsx` (delivery-fee decision and rate
   entry sections — find their element ids or add stable ones).
4. `src/domains/exceptions/rules.ts` — `ExceptionItem`; every rule's `href`.
5. The route inventory test (`rg -n "route inventory" tests | head`).

## Drift check — every implementation

Follow `docs/implementation-contracts/DRIFT-PROTOCOL.md`. Confirm `/desk/tax` still has no `page.tsx` and the RDF Today item
still links there. If another PR already fixed it, keep only the href-coverage test.

## Build contract

1. New page **`/desk/sales-tax/delivery-fees`** (OWNER/ADMIN; linked from the Sales tax Overview "Tax attention" block,
   not a new tab): heading "Retail delivery fees waiting on you"; one line explaining "Colorado charges a small fee on
   deliveries. These deliveries are recorded but the fee can't be finished until you answer below." Two groups:
   - **Waiting for your decision** (status `PENDING_DECISION`): count, oldest date, and the button "Decide how you handle
     the delivery fee" → Setup delivery-fee decision anchor.
   - **Waiting for this year's fee amount** (status `PENDING_RATE`): count, the sale dates, and "Enter the fee amount" →
     Setup rate entry anchor.
   Each group lists records (customer name, delivery date, sale date) with the phone stacked-card layout
   (`components/ui/data-list.tsx`). A **"Check again now"** button (server action, OWNER/ADMIN) calls
   `resolvePendingRdfRecords(new Date(), 200)` and shows how many were completed. Empty state: "Nothing waiting."
2. Change the RDF Today item href from `/desk/tax` to `/desk/sales-tax/delivery-fees`.
3. **No dead links, ever:** new test walks every exception rule's possible `href` patterns (build one item per rule with
   fixture ids) and asserts each path matches a real route in the app's route inventory.

## Required tests

- `tests/today-href-routes.test.ts`: "every Today item links to a page that exists".
- `tests/rdf-pending-page-integration.test.ts` (real Postgres): "lists records waiting for a decision and for a rate";
  "check again completes records once a rate exists"; "staff cannot open the page".
- `e2e/sales-tax.spec.ts` (existing file): "delivery fees waiting page loads and passes axe" (keep its shard).

## Finishing commands

`set -o pipefail` before piping.
- `timeout 600 npm run typecheck 2>&1 | tail -40`
- `timeout 600 npm run lint 2>&1 | tail -40`
- `timeout 600 npx vitest run tests/today-href-routes.test.ts tests/rdf-pending-page-integration.test.ts 2>&1 | tail -80`

## Stop conditions and completion

Stop if resolving a record would need new money behavior (this page only links to existing decision/rate entry and
re-runs the existing resolver). Done when the named cases pass, the Today item opens the new page, exact-head CI/
preview/review gates pass, and STATUS is updated.

## W-0A predecessor handoff (2026-10-09)

W-0A updates `src/domains/tax/acquisition-attention.ts` to add purchase-tax
reason grouping and a high-priority unlinked use-tax filing alert. The RDF
block still points to the dead `/desk/tax` route; replace just its href in W-0B.
The owner setup location/actions have also changed, but RDF statuses and
`resolvePendingRdfRecords` are unchanged. Review W-0A PR #342 diff/CI before merge.
No inherited code-review finding has been waived here yet.
