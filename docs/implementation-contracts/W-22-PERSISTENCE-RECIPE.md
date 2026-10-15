# W-22 persistence worked example — historical pattern, not next work

**Persistence and provider application were implemented through #423.** Use
`npm run work -- start` and the current [W-22 card](../pr-cards/W-22.md).
This baseline example is preserved for its pattern; never recreate its proposed
models/functions because they appear below. Actual code and current packet win
on engineering facts; approved design/owner inputs still govern semantics.

Baseline inspected: main `9d582f5e316052ef3a28e22492723f49fab411be`, #396.
Parent scope: `docs/pr-cards/W-22.md`; approved Amendment B §6.2; PLAN W-22;
OWNER-INPUTS IN-73/74/75/76/79/80; CHANGES-SINCE-DESIGN W-22A entry.
**Execution aid, not a pre-approved schema or a second card.** Next implementer
writes the current persistence slice JIT, checks actual prerequisites/reviews,
and reviews money/schema semantics under DRIFT-PROTOCOL before changing them.
W-22 remains PARTIAL. Persistence may proceed without activating collection;
IN-79 still blocks sending a charge-bearing agreement with undecided tax.

## Existing code and the missing integration

| Existing path + symbol | Present behavior | Next integration |
|---|---|---|
| `src/domains/billing/signing-charges.ts` `buildSigningChargePlan(SigningChargeInput)` | Pure integer-cent plan; returns per-address amounts, aggregate signing amount and tax-review flag | Build trusted inputs from stored order lines and addresses, persist reviewed version |
| `src/domains/settings/index.ts` defaults; BusinessSettings in `prisma/schema.prisma` | $45/5/business trigger/UNDECIDED configuration | Map settings to planner; later changes must not rewrite signed lines |
| `src/domains/estimates/index.ts` conversion wrapper; `index-base.ts` core | Converts estimate then attaches deposit provenance | Preserve transaction/idempotency boundaries and existing deposit provenance; per-property charge ownership needs review |
| `src/domains/agreements/index.ts` `createDraftAgreementInTx`, `sendForSignature` | Draft creation, tax gate, locked transition/signature + fixed-term terms snapshot | Freeze charge facts with actual signing evidence; do not mutate old signatures |
| `src/domains/billing/checkout.ts` `createCheckoutSessionForAgreement` | Deposit/waiver payment, or payment-method setup; recurring billing later | Subsequent payment slice consumes frozen charge version, not mutable settings |
| `src/domains/billing/webhooks-base.ts` `recordOneTimeSigningCharge` (private) | Mirrors deposit/waiver, Receipt/allocations and provider identity | Subsequent slice must map new charge kinds/settlement and prevent duplicate credit |
| `src/domains/billing/manual-payments.ts` `recordManualPayment` | Customer-scoped open-invoice allocation | Later create/use payable signing invoice; retain one receipt across properties |
| `src/domains/billing/applied-credit-lines.ts` | Mirrors account credits applied by Stripe | Not sufficient for first-invoice/per-agreement down-payment attribution |
| `src/app/sign/[id]/page.tsx`, `actions.ts`, `sign-form.tsx` | Existing public signing workflow | Show same frozen mandatory totals; redirect cannot assert payment |

Read those functions and `tests/signing-charge-plan-w22.test.ts` first. Do not read
the entire billing domain. Existing tax category handling starts at
`src/domains/billing/categories.ts`, `src/domains/tax/locations.ts` and
`src/domains/tax/engine.ts`; any new category/enum must reconcile every consumer.

## Proposed slice and interfaces — resolve in the JIT card

The draft persistence + frozen price presentation seam below is an internal
implementation step, not a required PR/bundle boundary. Use the current W-22FIN
packet and approved roadmap for remaining payment, first-invoice credit,
refund/cancellation and delivery scope; this older recipe does not reschedule them.
Related additive migrations may share the coherent outcome with explicit order
and upgrade/restore proof. No 800-line threshold or single-risk count requires a
split; record a concrete migration/dependency/safety/reviewability reason and keep
the parent acceptance/index incomplete until the whole outcome is proven.

Candidate new module (does not exist):
`src/domains/billing/signing-charge-persistence.ts`. Candidate API (not exported):
`prepareSigningChargesInTx(tx, actorId, orderId, expectedRevision)` returning a
versioned per-agreement charge plan or explicit review-required result. These names
are proposals; choose the actual existing order identity in the card. Do not assume
an order model exists or create a second truth beside estimate/agreement records.

The card must settle these semantics before migration/code:

- Immutable charge revision ownership: estimate/order → each address → resulting
  agreement; unique identity for a location/category/revision; no duplicates on retry.
- Exact timing of freezing: what the customer saw and signed, including month-to-month
  agreements (existing fixed-term terms snapshots alone do not cover every rental).
- Tax classification/rate evidence and all-in totals; UNDECIDED cannot send/collect.
- Down payment separate from deposit, recurring rent and setup revenue; each agreement's
  first-bill share retained. Account-wide credit cannot spill to another property's bill.
- Draft reprice/invalidation after owner changes; existing accepted/signed documents
  remain immutable. Checkout's provider key must follow the frozen revision later.
- Current lock order across estimate/agreement/customer ledger and actor checks;
  per-property conversion retries reuse durable results or roll back completely.

## Trusted input-to-record mapping

| Planner field | Trusted source / check | Persistence evidence to design |
|---|---|---|
| `settings.setupFeeCents` | `BusinessSettings.administrativeSetupFeeCents` | Frozen fee amount + settings/revision provenance |
| Remaining settings | Same-named settings; tax string validated into union | Frozen threshold, trigger, treatment/decision evidence |
| `serviceAddressId` | Customer-owned address from stored quote/agreement | FK/source linkage; never trust arbitrary submitted address |
| `machineCount` | Actual machines, two for a set; total across order | Order-level trigger + location allocation |
| `firstMonthRentCents` | Existing authoritative price/discount calculations | Each agreement's share; not UI count × list price |
| New/active/delivery flags | Persisted active rentals and order purpose | Exemption explanation and source facts |
| Business/property-manager flags | Current approved customer classification | Trigger evidence; do not accept client-supplied boolean |
| Paid-in-full | Existing recorded prepayment evidence | No duplicate down-payment allocation |
| Override cents/reason | Authorized owner, dollar parser, 5–500 chars when amount changes | Actor/time/reason + recommended/final amounts |
| Plan totals/tax-review flag | `buildSigningChargePlan` output, checked tax computation | Frozen sum of mandatory amounts, separate tax/government lines |

Proposed tables/fields are deliberately not named as existing. Validate actual
schema, constraints, backups and category DTOs before selecting them. No migration
should rewrite existing paid invoices or signed agreements to fill this feature.

## Ordered implementation and before/after proof

1. Fetch main; inspect parent/prerequisite reviews; fill drift table with the paths
   above. Record no remaining open PR collision before editing card/status.
2. Write current card with the resolved interfaces/invariants above, planned new
   test paths and production-line budget. Mark outstanding recommendations as such.
3. Write fixture/assertion skeleton for persistence, revision, failure and isolation;
   record initial charge/signature/audit/invoice/payment/provider-operation counts.
4. Add the required ordered additive migrations after reviewing ownership/uniques; record upgrade/restore proof. Update backup
   manifest, schema health, DATABASE and child-first teardown with it.
5. Implement tx-aware preparation: load trusted facts under agreed locks, reauthorize,
   calculate, persist version + per-location/per-agreement lines + audit atomically.
6. Connect draft/send/sign presentation to that same version; tax review fails closed
   before sending. Use W-18 Money/InfoTip. No payment provider call in this slice.
7. Run named unit/DB tests and relevant existing regressions; add mobile signing
   browser acceptance when its UI changes. Fix failures before a single publication.
8. Checklist B: parent remains PARTIAL; work-index keeps W-22 incomplete; record exact
   exports/constraints/snapshot boundary in CHANGES-SINCE-DESIGN for payment successor.

## Concrete fixtures and assertions

Pure fixtures may specify confirmed non-taxable treatment only as **test data**;
that is not CPA approval. Values below exclude sales tax unless explicitly listed.

| Fixture | Exact expected plan / durable assertion |
|---|---|
| Consumer, 1 new address, 1 machine, rent 3500 | Setup 4500; down payment 0; signing 4500; ordinary first rent later |
| Consumer, 1 address, 4 machines | Setup 4500 once; no down payment below 5 |
| Consumer, 3 new addresses, 1 machine each | Setup 13500 total; one location line each |
| Consumer, addresses A/B, machines 2/3, authoritative rents 6000/9000 | Setup 9000; down payment 15000; signing 24000; shares 6000/9000 (set discounts preserved) |
| Business, 1 address, rent 3500 | Setup 4500; down payment 3500; signing 8000 |
| Same business paid fully in advance | Down payment 0; setup still follows independent fee/prepayment rules |
| Active location / repair purpose | No automatic setup; preserve existing planner exclusions |
| Override 0, reason `Owner approved welcome offer` | Zero fee with recorded actor/reason; missing reason refuses and writes nothing |
| UNDECIDED with positive setup | `requiresTaxReview=true`; send/collection denied; no signature/provider operation |
| Repeat prepare / two concurrent prepares | One legal durable revision/effect per reviewed key; no doubled amounts/audits |
| Fail final audit/write | No partial lines/revision/transition survives rollback |
| Change settings after signing | Original charge facts and shown signed total unchanged |
| Customer B address submitted for customer A | Denied before writes; no foreign detail leaked |
| Revoked OWNER, ADMIN/STAFF where owner-only | Denied according to actual card role boundary, including direct action call |

Proposed tests (not present yet): `tests/signing-charge-persistence-integration.test.ts`
and `tests/signing-charge-snapshot.test.ts`. Reuse disposable fixtures from
`tests/signing-charge-settings-integration.test.ts`; register any new singleton writer
in SHARED_SETTINGS_TESTS. Extend existing checkout-mode/idempotency tests only when
checkout behavior actually changes. Do not assert provider credits in a persistence-only PR.

## Focused commands and successor contract

Existing checks to run after the slice creates its proposed tests:

```bash
python3 docs/pr-cards/validate-index.py
npm run preflight -- --plan --unit tests/signing-charge-plan-w22.test.ts --db tests/signing-charge-persistence-integration.test.ts
# In project's Vercel Sandbox; this executes the proposed file only after it exists:
timeout 600 npm run preflight -- --unit tests/signing-charge-plan-w22.test.ts --db tests/signing-charge-persistence-integration.test.ts --db tests/agreement-estimate-concurrency-integration.test.ts
npm run check:quick
```

Select snapshot/unit and the actual affected browser file too; related imports and
registry checks remain automatic. CI `ci` at exact head remains required. This
recipe's documentation PR runs only documentation checks; these commands are future
implementation instructions, not claimed execution evidence.

Successor receives: exact durable charge-version lookup, customer/agreement/address
ownership, frozen amount/tax/category DTO, repeat behavior and tests. It must still
implement/review hosted + manual payment, ACH failure/pending, verified settlement,
first-invoice credit exactly once per agreement, refunds through existing owner
path, installation evidence per machine and end-to-end acceptance. No automatic
scheduling (W-24), public price restoration (MKT-2 owner hide remains), live collection,
provider activation, refund execution or owner/CPA approval is implied by this slice.
