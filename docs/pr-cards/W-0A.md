# W-0A — Purchase use tax can actually be calculated, recalculated and filed

Status: **MERGED (#342)** [planned PR state; merge only after exact-head CI/review/preview] · Baseline inspected: `aea29ba3` (2026-10-09, #335).
Batch: W (`docs/designs/BATCH-W.md` §1 "Broken today", D-W2, D-W3 row 1, PR table W-0a) · Prerequisites: none (fixes
merged T code; runs ahead of COM-L by Chris's approval, IN-48).
Base: latest `main`. Migration: **none**. Sizing estimate: ~380 production lines, ≤12 files, risk area: money (tax).

## Read only these

Read AGENTS, STATUS and this card first. Use `rg -n "<name>" <file>` then read ≤150 lines around it.
1. `src/domains/tax/locations.ts` — `locateBusinessTaxAddress` (~503), `confirmAddressLocation` (~547), `Target`,
   `replaceCurrentLocation`, `currentLocation`, `lockTarget`.
2. `src/domains/tax/acquisition.ts` — whole file (207 lines): `equivalentChoice` (~92), `recordApplianceAcquisitionTaxInTx`.
3. `src/domains/tax/use-tax.ts` — `recordUseTaxForPurchase` (~35), `PurchaseTaxContextPendingError`, period lookup (~133).
4. `src/domains/tax/setup.ts` — business location save (~45–85).
5. `src/app/desk/sales-tax/setup/page.tsx`, `forms.tsx`, `actions.ts` — business address form.
6. `src/domains/tax/acquisition-attention.ts` — whole file (89 lines).
7. `src/domains/tax/workspace-overview.ts` — the setup checklist items (~136–162).
8. `src/domains/automation/health.ts` (`AUTOMATION_RULES`) and `src/app/api/cron/tax-address-recheck/route.ts`.

## Drift check — every implementation

Follow `docs/implementation-contracts/DRIFT-PROTOCOL.md`. Confirm on latest `main`: no screen calls
`locateBusinessTaxAddress` or confirms the business location (`rg -n "locateBusinessTaxAddress|forBusinessLocation" src/app`);
`equivalentChoice` still short-circuits an UNKNOWN appliance re-saved with the same answer; DUE `PurchaseUseTax` rows can
still have `filingPeriodId = null`. If any is already fixed, drop that part and record it in the PR.

## Build contract

1. **Confirm the business tax address.** In `locations.ts` add
   `confirmBusinessTaxAddress(actorUserId: string, input: { jurisdictionIds: string[] }): Promise<void>` — same shape as
   `confirmAddressLocation` but for target `{ kind: "BUSINESS" }`: `assertActiveTeamActor(tx, actorUserId, ["OWNER","ADMIN"])`,
   lock the target, require ≥1 existing jurisdiction, `replaceCurrentLocation(... status "VERIFIED", source "MANUAL",
   confirmedByUserId ...)`, AuditLog `tax.business_address.confirm` with old/new jurisdiction ids.
   Setup page "Your business address (for tax on things you buy)" card shows the saved address, its status in words
   ("Confirmed: Colorado, Weld County, Greeley" / "Not confirmed yet"), a **"Look up tax areas"** button
   (server action → `locateBusinessTaxAddress({ force: true })`) and a **"Confirm these tax areas"** form (checkboxes of
   known jurisdictions, prefilled from the lookup's current location when present). Saving a changed address keeps the
   existing NEEDS_REVIEW behavior; the card then says "Look up and confirm again".
2. **Re-saving recalculates.** In `acquisition.ts`, the equivalent-choice early return must not apply when the appliance
   is `UNKNOWN` and the choice is `SELLER_CHARGED` or `NONE_CHARGED` (that state means the calculation could not run, not
   that it is done). Keep every other equivalence case.
3. **Catch-up without a person.** New `src/domains/tax/purchase-tax-catch-up.ts`:
   `recalculatePendingPurchaseTax(now: Date, limit: number): Promise<{ checked: number; calculated: number; stillPending: number }>`.
   Selects appliances with `acquisitionTaxStatus = "UNKNOWN"`, `acquisitionTaxChoice IN ("SELLER_CHARGED","NONE_CHARGED")`,
   `acquisitionTaxRecordedAt` not null, oldest first, `limit`; for each, in its own transaction, re-runs the existing
   calculation path with the stored answer (`vendorTaxCents = acquisitionTaxPaidCents ?? 0`, same note/photo) as the
   original recorder `acquisitionTaxRecordedByUserId` **if that user is still an active OWNER/ADMIN**, otherwise as the
   active OWNER (first by createdAt); if neither exists, skip and count as stillPending. It never throws for one appliance
   (log and continue). Runs: (a) right after `confirmBusinessTaxAddress`, the election save, and a jurisdiction rate review
   save succeed (call after commit, `limit` 200); (b) daily as automation `tax-address-recheck:purchase-tax-catch-up`
   inside the existing `tax-address-recheck` cron route (add the `AUTOMATION_RULES` entry, `expectedEveryHours: 24`,
   label "Purchase tax catch-up", explanation "Calculates use tax for appliances that were waiting on tax setup.").
4. **No tax owed with nowhere to file it.** When `recordUseTaxForPurchase` writes a DUE row whose jurisdiction has no
   `useTaxFilingAccountId`, nothing changes in the write; instead `acquisition-attention.ts` adds a Today item (category
   `PURCHASE_USE_TAX_DUE`, severity high): title "Use tax owed with nowhere to file it — <area names>", detail "Link
   <area> to a use-tax filing account so this tax lands on a return with a due date.", href
   `/desk/sales-tax/setup/accounts` (verify the exact accounts route on main). `workspace-overview.ts` adds the checklist
   item "Use-tax filing accounts linked" (done when every jurisdiction on the business location has
   `useTaxFilingAccountId`). When an account is linked, call the existing `assignDueUseTaxRowsToPeriod` for its open
   period so earlier rows attach.
5. **Say why it's unknown.** New `explainPendingPurchaseTax(tx, applianceId): Promise<{ reason: AcquisitionTaxResult["attentionReason"] | "ANSWER_LATER" | null; fixHref: string | null; fixLabel: string | null }>`
   computed from current state (no new column): LATER → "ANSWER_LATER" (fix: the appliance page), missing date/cost →
   appliance page, election undecided → Setup election, business address not VERIFIED → Setup business address card,
   rates unreviewed → `/desk/sales-tax/areas#rates`. The Today item "N appliances need purchase-tax review" groups by
   reason: e.g. "3 appliances are waiting for your business address to be confirmed — [Confirm it]". The appliance
   page tax panel shows the same sentence and button instead of raw status text.

Permissions: OWNER/ADMIN for every action above (R13 pattern); STAFF unchanged. No customer messages, no money moves.

## Required tests

- `tests/business-tax-address-confirm-integration.test.ts` (real Postgres): "owner confirms business tax areas";
  "staff cannot confirm"; "unknown jurisdiction rejected"; "changing the address returns it to needs review".
- `tests/purchase-tax-recalculate-integration.test.ts`: "re-saving the same no-tax answer after setup calculates use tax";
  "catch-up calculates every waiting appliance once (second run changes nothing)"; "catch-up skips when no active
  owner/admin exists"; "confirming the business address triggers catch-up"; "filed rows are never rewritten by catch-up".
- `tests/use-tax-unlinked-account-integration.test.ts`: "DUE row with no use-tax account raises the high Today item";
  "linking the account attaches earlier rows to the open period".
- `tests/purchase-tax-explain.test.ts`: one case per reason with the expected fix link.
- Existing acquisition/use-tax tests stay green; update fakes in the same commit if a domain call changes.

## Finishing commands

`set -o pipefail` before piping.
- `timeout 600 npm run typecheck 2>&1 | tail -40`
- `timeout 600 npm run lint 2>&1 | tail -40`
- `timeout 600 npx vitest run tests/business-tax-address-confirm-integration.test.ts tests/purchase-tax-recalculate-integration.test.ts tests/use-tax-unlinked-account-integration.test.ts tests/purchase-tax-explain.test.ts 2>&1 | tail -80`

## Stop conditions and completion

Stop for: a needed schema change (this card has none), a change to how much tax is computed (only *whether* it runs
changes here), or more than 800 production lines. Done when every named case passes, an owner can go Setup → confirm
business address → see waiting appliances calculated, exact-head CI/preview/review gates pass, and STATUS/
CHANGES-SINCE-DESIGN record the new functions. Successor W-0B inherits nothing from this card.

## Drift and handoff (2026-10-09, PR #342; synchronized main 540799c)

- Checked `main` at `1722f2c` against inspected baseline `aea29ba3`; no tax-domain/schema changes.
- Predecessor #337 approved W scope and installed quick gate; no code findings carried to W-0A.
- Mechanical route correction: `/desk/sales-tax/setup/accounts` has no index page.
  Filing-account instructions link to the existing `/desk/sales-tax/setup#accounts` section instead.
- Business GIS lookups are advisory; only owner/admin manual confirmation marks a business address VERIFIED.
- No schema or provider change; next W-0B owns pending RDF resolution page and dead-link coverage.
- Verification: tests/business-tax-address-confirm-integration.test.ts,
  tests/purchase-tax-recalculate-integration.test.ts,
  tests/use-tax-unlinked-account-integration.test.ts,
  tests/purchase-tax-explain.test.ts, tests/appliance-acquisition-tax-integration.test.ts,
  tests/tax-locations-integration.test.ts; exact-head CI and preview required for merge.
