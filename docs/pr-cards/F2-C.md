# F2-C and F2-D — owner guide, review discharge, launch ledger and rollback (approved original subsections)
Source: docs/designs/BATCH-F.md (WU-F5 to WU-F9 and ENH-F), docs/MASTER-ROADMAP.md section 7, docs/PLAN.md Batch F; owner direction 2026-10-17: make a completion push and finish engineering quickly.
One coherent outcome: the launch evidence is finished as far as engineering goes (guide, screenshots, dispositions, ledger, rollback), so what remains is only Chris's decisions and real-provider acceptance.

## Frozen original complete acceptance
### F2-C
- docs/OWNER-GUIDE.md is rewritten as one current guide organized per screen (Today and To do, Leads, Customers, Rentals and agreements, Billing and deposits, Inventory and cleaning, Dispatch and visits, Taxes, Settings, Website editor, Notices and messages, Backup and restore, the customer portal, and the public site), in plain English, each section stating what the owner can change without code and what a failed save or automation looks like and what to do; the old dated change-note stack moves to docs/archive/ so the guide no longer carries superseded instructions.
- tests/owner-guide-coverage.test.ts passes: every top-level desk section that exists in the route inventory (pageRoutes() from scripts/check-route-inventory.mjs) is named in the guide, every image the guide embeds exists on disk, every required per-screen heading is present, and a negative case proves a guide missing a section or a picture is reported.
- e2e/owner-guide-screenshots.spec.ts exists, is registered in the lightest group of e2e/shards.json, skips unless OWNER_GUIDE_SHOTS=1, and when run signs in as the throwaway owner and writes one PNG per listed screen to docs/owner-guide/screenshots/; the committed PNGs come from a real local run of that spec and the guide embeds them with alt text.
### F2-D
- docs/reviews/dispositions/reconciliation-2026-10-01.json records one entry {findingId, status, evidence, pr} for every one of the 91 findings in docs/reviews/2026-10-01-review-reconciliation.md, status being fixed, already-fixed, superseded or open; each of the 42 findings that were Pending is checked against current code, tests or docs on main and given a concrete evidence string (file and test or doc named), and anything not actually resolved stays open and is listed in the ledger; the reconciliation table is updated to match, and tests/review-dispositions.test.ts proves every table row has exactly one valid disposition and no Pending row remains.
- scripts/launch-ledger.mjs generates docs/LAUNCH-LEDGER.md (committed) from the PLAN acceptance checklist, the 17 integrated scenarios, the review dispositions, the open GO-LIVE-CHECKLIST lines and the owner gates; an item without evidence renders OPEN, owner gates render as decisions for Chris, and the file ends with the explicit owner-gates list and a blank 'Owner authorization: ____' line that only Chris fills in; tests/launch-ledger.test.ts proves the OPEN rule, the decision rendering, the blank authorization line, and that the committed ledger equals a fresh generation.
- docs/runbooks/ROLLBACK.md gives numbered steps to revert the interface commit on failure without any destructive database rollback (additive tables stay), what to check afterwards from the scenarios and ledger, and a Drill section with a last-drilled date; it follows the shape of the existing runbooks.
- ENH-F: the post-commit notification path of estimate approval is inspected at its real error contract and proved by scenario 07 (and a targeted addition if a case is missing): a thrown sender after the durable approval, a disabled sender and a successful send each leave exactly one account and one agreement, a retry after the commit creates no second account or agreement, and the customer is told approval succeeded with the notice pending; if already proved the regression is cited with no duplicate implementation and no new outbox.

## Rules this work keeps
Nothing is claimed as real-provider, legal or accessibility acceptance; the ledger shows those as open decisions. A finding is marked fixed or already-fixed only with a named file, test or merged PR that a reader can open; if that cannot be shown it stays open. The guide describes only what exists on main. Screenshots come from the throwaway local database with synthetic data only.

## Excluded and deferred
No Stripe LIVE, customer email, SMS, spending or production data. The K batches follow F2-D per docs/MASTER-ROADMAP.md.

<!-- bundle-plan:start -->
```json
{
  "workKind": "ENGINEERING",
  "baseRevision": "ef8af2cdd2e7dcd1322ff0163b32ca6ab34c42fe",
  "outcome": "The launch evidence is finished as far as engineering goes: Chris has a current plain-English owner guide with real screenshots that a test keeps complete, every old review finding has an honest evidence-backed status, one generated launch ledger shows exactly what is proven and what still needs his decision, and a rollback plan says how to back out safely.",
  "integrationBoundary": "Documentation, one Playwright screenshot spec, two new tests, one ledger generator script and generated ledger, JSON disposition records, a runbook, and a targeted test addition to scenario 07 only if the ENH-F proof is missing a case. Production code changes only if checking a Pending finding proves a real defect that is small enough to fix with its own regression test; otherwise it stays open and is listed. No schema, price, permission or status change.",
  "newEngineering": "The owner guide rewrite and archive move, the screenshot spec and real PNGs, the guide coverage test, 42 finding checks with dispositions and their validating test, the ledger generator, generated ledger and its test, the rollback runbook, the ENH-F proof, shard registration and the docs that record the evidence.",
  "estimatedProductionLines": 220,
  "relatedWorkDecision": "F2-C and F2-D ship together on the owner's request (2026-10-17) to finish engineering quickly: the ledger links to the guide and the scenarios, the guide's failure sections point at the runbooks, and the dispositions feed the ledger, so they are one documentation-and-evidence outcome; each subsection keeps its own acceptance list and tests.",
  "subsections": [
    {
      "id": "F2-C",
      "acceptance": [
        "docs/OWNER-GUIDE.md is rewritten as one current guide organized per screen (Today and To do, Leads, Customers, Rentals and agreements, Billing and deposits, Inventory and cleaning, Dispatch and visits, Taxes, Settings, Website editor, Notices and messages, Backup and restore, the customer portal, and the public site), in plain English, each section stating what the owner can change without code and what a failed save or automation looks like and what to do; the old dated change-note stack moves to docs/archive/ so the guide no longer carries superseded instructions.",
        "tests/owner-guide-coverage.test.ts passes: every top-level desk section that exists in the route inventory (pageRoutes() from scripts/check-route-inventory.mjs) is named in the guide, every image the guide embeds exists on disk, every required per-screen heading is present, and a negative case proves a guide missing a section or a picture is reported.",
        "e2e/owner-guide-screenshots.spec.ts exists, is registered in the lightest group of e2e/shards.json, skips unless OWNER_GUIDE_SHOTS=1, and when run signs in as the throwaway owner and writes one PNG per listed screen to docs/owner-guide/screenshots/; the committed PNGs come from a real local run of that spec and the guide embeds them with alt text."
      ],
      "remainingEngineering": [
        "Guide rewrite, archive move, screenshot spec, real screenshots, coverage test, shard registration"
      ]
    },
    {
      "id": "F2-D",
      "acceptance": [
        "docs/reviews/dispositions/reconciliation-2026-10-01.json records one entry {findingId, status, evidence, pr} for every one of the 91 findings in docs/reviews/2026-10-01-review-reconciliation.md, status being fixed, already-fixed, superseded or open; each of the 42 findings that were Pending is checked against current code, tests or docs on main and given a concrete evidence string (file and test or doc named), and anything not actually resolved stays open and is listed in the ledger; the reconciliation table is updated to match, and tests/review-dispositions.test.ts proves every table row has exactly one valid disposition and no Pending row remains.",
        "scripts/launch-ledger.mjs generates docs/LAUNCH-LEDGER.md (committed) from the PLAN acceptance checklist, the 17 integrated scenarios, the review dispositions, the open GO-LIVE-CHECKLIST lines and the owner gates; an item without evidence renders OPEN, owner gates render as decisions for Chris, and the file ends with the explicit owner-gates list and a blank 'Owner authorization: ____' line that only Chris fills in; tests/launch-ledger.test.ts proves the OPEN rule, the decision rendering, the blank authorization line, and that the committed ledger equals a fresh generation.",
        "docs/runbooks/ROLLBACK.md gives numbered steps to revert the interface commit on failure without any destructive database rollback (additive tables stay), what to check afterwards from the scenarios and ledger, and a Drill section with a last-drilled date; it follows the shape of the existing runbooks.",
        "ENH-F: the post-commit notification path of estimate approval is inspected at its real error contract and proved by scenario 07 (and a targeted addition if a case is missing): a thrown sender after the durable approval, a disabled sender and a successful send each leave exactly one account and one agreement, a retry after the commit creates no second account or agreement, and the customer is told approval succeeded with the notice pending; if already proved the regression is cited with no duplicate implementation and no new outbox."
      ],
      "remainingEngineering": [
        "Forty-two finding checks, dispositions and test, ledger generator and test, rollback runbook, ENH-F proof, docs"
      ]
    }
  ]
}
```
<!-- bundle-plan:end -->
