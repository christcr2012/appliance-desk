# W-22FIN — concrete remaining integration contract

Source baseline: main `905a0fb8` (PR #464), checked 2026-10-15. Read after the existing
[active packet](../pr-cards/execution/W-22FIN.json) and
[owner engineering contract](../designs/OWNER-DECISIONS-2026-10-13-ENGINEERING.md).
This supplies missing implementation detail within W-22; it creates no new
countable batch subsections, approvals, runtime policies or completion claims.
Apply [researched consequences R1–R9](../research/2026-10-15-owner-decision-follow-through.md),
especially acquisition-dependent rental tax and conditional RDF.

## 0. Why this milestone has stalled; one completion path

The source still has a setup/advance-only contract, while owner policy now
contains additional mandatory amounts. `assessEstimateQuoteCategories` in
`src/domains/estimates/preapproval-quote.ts` explicitly rejects deposits,
service fees, waiver and nonexempt RDF. `FrozenSigningEvidence` and the builder,
verifier, checkout plan and obligation all require V1 with only setup + setup
tax + rent advance. `signing-dispatch-readiness.ts` also requires version 1.
This is an unimplemented cross-domain extension, not an external CPA/Stripe
blocker. Warning/readback/policy PRs cannot make the complete path work.

Documentation previously led with 160+ lines of older session reports, an old
baseline and an already-merged PR described as open. The active card now starts
with current source and a finite five-row remaining matrix; previous reports
are archived. This diagnosis describes repository evidence, not hidden model
reasoning. Already existing finish-first rules did not supply this consumer map.

Implement §2A and the existing §5 matrix, then close the same five packet rows.
Do not start another discovery/design session, create D19/D20 IDs or add new
completion gates. Use the current approved owner choices; ask only a specific
unanswered business choice, while continuing independent implementation.

## 1. Preserve merged work; reconcile the concurrent branch once

Main has audited mandatory policy versions, private estimate diagnostics,
frozen per-agreement setup/down-payment/tax evidence, settlement/recovery guards,
customer/owner readback and signed delivery handoff. None proves a complete
preapproval quote for every mandatory charge.

PR #459 is merged: real agreements are prepared before approval and adopted
under exact viewed quote identity. #462/#463 repaired cancellation/collection
serialization and signed classification/window evidence. #464 added audited
per-location commercial reserve and service/tax/RDF review. Preserve these;
they are prerequisites, not work to rebuild or standalone completion evidence.

| Verified main seam | Remaining integration responsibility |
|---|---|
| `src/domains/estimates/all-in-preview.ts` / `previewEstimateAllInCharges` | Always REVIEW_REQUIRED diagnostics; extend through a separately verified complete projection, never flip eligibility based on a subtotal |
| `src/domains/billing/signing-charge-preview.ts` / `getDraftSigningChargePreview` | Existing package counts and per-location setup/advance; consume stored line identities and approved classifications |
| `src/domains/billing/signing-charge-snapshot.ts` / `prepareDraftSigningChargeSnapshots` | Existing versioned setup/advance snapshot, not complete reserve/delivery/RDF storage |
| `src/domains/billing/signing-order-draft-contract.ts` / `assembleSigningOrderDraft`; `signing-frozen-evidence.ts` / `buildFrozenSigningEvidence` | Existing setup + setup tax + advance envelope; nonzero additional charges need a versioned compatible extension and matching validators |
| `src/domains/estimates/index-base.ts` / `sendEstimate`, `approveEstimate`, `convertEstimateToAgreements` | All entry points must validate the same reviewed revision, customer ownership and complete preparation; reuse transaction-aware cores |
| `src/domains/agreements/index.ts` / `lockRentalAgreementInTx`, `sendForSignature` | Freeze exact reviewed scope; preserve existing signed terms/evidence |
| `src/domains/billing/signing-payment-attempts.ts` / `prepareSigningPaymentAttempt`; `signing-payment-settlement.ts` / `processSigningCheckoutEvent` | Exactly one authoritative obligation/receipt effect; uncertain provider result cannot create a fresh attempt |
| `src/domains/billing/signing-first-invoice-application.ts` / `signingFirstInvoiceItem`, `verifySigningFirstInvoiceCredit` | Only rent advance applies once to that agreement's first delivery invoice; exclude reserve/setup/delivery/official fees |
| `src/domains/agreements/pre-delivery-cancellation.ts` / `calculatePreDeliveryCancellationAmounts`, `approvePreDeliveryCancellation` | Extend reviewed cancellation evidence for added categories, prepaid large orders and partial multi-location delivery |
| `src/domains/agreements/signed-delivery.ts` / `ensureSignedDeliveryDraftInTx`; `src/domains/jobs/index.ts` | Keep unscheduled/scheduled/dispatched/delivered distinct; payment dispatch checks remain mandatory |

Paths after a semicolon in the same row share the named directory. Refresh symbols
against the actual implementation base. No migration/table name is pre-approved
by this read map. Existing evidence `schemaVersion: 1` cannot silently change its
meaning; retain legacy read support and reject unsupported new payloads.

## 2. Trusted input → evidence → public projection

Customer POST submits token-scoped estimate ID and expected reviewed fingerprint,
not trusted cents, customer IDs, policy approvals, tax rates or arbitrary addresses.
Owner change inputs are parsed/authorized and resolved to stored customer-scoped
records. Load actual package component quantities; a set is two machines, not one.

One complete projection identifies each location/agreement/item and separates:

- Normal machine rent, pair/term discounts, resulting recurring amount and period.
- One-time setup decision and reason, delivery/other mandatory items and their basis.
- Each jurisdiction's taxable/exempt basis, rounded tax, reviewed treatment/rate ID.
- RDF applicability/election/event/rate and allocation; verified zero/exempt evidence.
- Rent advance and exactly which first-invoice coverage it prepays.
- Negotiated refundable reserve and its signed liability terms; no household deposit.
- Due-at-signing total, future recurring total, already prepaid coverage and any
  incompleteness reasons. Do not add a first month's rent twice.

Reuse authoritative persisted money/evidence; do not create a competing invoice
ledger in JSX/JSON. Added money categories require storage, frozen evidence,
checkout/receipt, cancellation, account and first-invoice consumers in the same
integration. If a category is absent, prove NOT_APPLICABLE with evidence; a hardcoded
zero does not complete it. Unknown classification hides binding totals/actions.

The fingerprint covers canonical stable-ID-sorted items and quantities, customer
and location identity, quoted cents, setup override identity/reason, package and
term revisions, tax jurisdiction/rate/treatment evidence, mandatory-charge policy,
delivery basis, reserve terms, advance coverage and reviewed legal revision.
Store actor/time/version with review. A hash alone is neither approval nor money
evidence. Sort arrays before hashing; include explicit schema/version semantics.

Owner/customer estimate, sign, agreement and account views consume the same
authorized projection with context-appropriate labels. Never expose other
customers' addresses, provider IDs, staff-only notes or review internals.

## 2A. Concrete evidence extension and mandatory consumer cutover

This is engineering design inside the approved all-in outcome. Implement a
new explicitly discriminated evidence version (V2); retain exact V1 verification,
canonical digest and immutable historical signed/payment semantics. Do not cast
V2 as V1, reinterpret old JSON or relax `version === 1` guards globally. Reuse
`AgreementSigningCharge.frozenChargeEvidence` and the existing obligation/payment
models; no second quote ledger or new generic financial framework.

### Representation and reconciliation

Use stable component IDs and a closed category union covering administrative
setup, delivery, installation, removal, agreed damage waiver, rent advance,
refundable commercial reserve and assessed retail-delivery fee. Each component
has integer cents, source/revision identity and applicable location/coverage;
category-specific evidence includes override reason, reserve terms revision,
waiver consent and reviewed RDF event/handling/rate. Preserve explicit reviewed
NOT_APPLICABLE/EXEMPT evidence; missing is never zero. UNKNOWN forbids binding.
Recurring or future contingent fees are disclosed with period/trigger and stay
outside due-now unless the approved owner terms actually make them due now.
Do not silently turn recurring waiver or future removal into a signing charge.

Tax lines reference component IDs plus category, jurisdiction and effective rule/
rate evidence. Setup tax stays distinct from other service/rent tax. Compute
with existing tax/allocation functions; sum rounded line cents exactly. Totals
separate signing charges, tax, reserve liability, rent advance and future rent;
due-now is the sum of due-now components and their tax, not monthly rent again.
The synthetic §3 fixture must remain A=28631, B=16975, combined=45606.

Sort locations/components/tax evidence by stable IDs before canonical hashing;
include version, customer/agreement/address identity and reviewed source/terms
revisions. Independently rebuild and verify against stored authoritative facts,
not a checksum over caller JSON. Preserve the existing V1 canonical field order.
Reviewed owner fees and reserve currently marked provisional remain provisional
until the independent existing business-use evidence is verified. The new format
cannot itself upgrade that status or bypass an unresolved professional gate.

### Storage and SQL compatibility

Audit the original migrations `20261015110000_w22_signing_charge_snapshots`,
`20261015130000_w22_frozen_signing_evidence`,
`20261015150000_w22_signing_payment_obligation`,
`20261015170000_w22_signing_test_settlement` and
`20261015180000_w22_down_payment_entitlement`, plus #463/#464 immutability
triggers before adding ordered forward migrations. The old obligation formula
cannot describe new categories. Persist the versioned obligation's complete
component evidence/amounts on the existing model and enforce total/source/
signature reconciliation for its version. Keep legacy scalar meanings exact;
never put reserve or delivery inside `downPaymentCents` or `setupFeeCents`.
Keep old signatures/receipts readable without manufactured new approvals.

An existing frozen V1 draft must not be rewritten in place. Preserve existing
invalidation/refreeze rules; if no safe transition exists, deny with a concrete
owner reprepare action and implement an audited unsigned-only replacement with
no signature, receipt or in-flight attempt. Signed V1 remains immutable. Prove
fresh migrations and a disposable V1 signed/payment fixture upgraded to V2-
capable schema, plus restore/rollback behavior under the existing recipe.

### Update together: producer and every version-sensitive consumer

All paths below are existing files; prefixes abbreviate `src/domains/`.
These are internal integration steps, not countable new roadmap subsections.

| Consumer boundary | Required change in the same connected implementation |
|---|---|
| `billing/signing-charge-snapshot.ts`, `signing-charge-tax-review.ts`, `signing-order-draft-contract.ts` | Load existing `mandatoryChargeReviewVersions`/`commercialReservePolicyVersions`, verify current source/customer and complete classifications, construct full draft without inventing policy |
| `billing/signing-frozen-evidence.ts`, `signing-charge-freeze.ts`, `signing-frozen-verify.ts` | Discriminated V1/V2 construction, durable freeze and independent amount/provenance/digest verification |
| `estimates/preapproval-quote.ts`, `preapproval-agreements.ts`, `index-base.ts` | Replace unsupported-category denials only after complete V2 verification; same projection/fingerprint at review/send/approve/convert, preserve viewed-revision and atomic-adoption guards |
| `agreements/signing-offer-proof.ts`, `agreements/index.ts` | Exact accepted version/amount/identity at send/sign, immutable signature and one obligation; no weaker side entry point |
| `billing/signing-order-readback.ts`, estimate/sign/account/owner DTOs and components | Same category/period/amount semantics everywhere; no independent UI sums or exposure of private review fields |
| `billing/signing-payment-obligation.ts`, `signing-checkout-plan.ts`, `signing-payment-readiness.ts`, `signing-payment-checkout.ts` | Versioned obligation and complete checkout lines; exact existing provider operation identity/currency/source checks |
| `billing/signing-payment-settlement.ts`, `signing-payment-manual.ts`, `signing-payment-recovery.ts` | One exact settled receipt with auditable category allocation, reserve held only after settlement; provider uncertainty cannot create new money or held liability |
| `agreements/pre-delivery-cancellation.ts`, `signed-cancellation-policy.ts` | Use original signed policy and components; partial-location reconciliation, independent refund approval, no fabricated settlement or blanket statutory-fee reversal |
| `billing/signing-dispatch-readiness.ts`, `signing-first-invoice-application.ts`, existing delivery billing/credit callers | Recognize verified V2 without dropping signature/payment checks; only settled rent advance applies once to its own first coverage/invoice; reserve/setup/services/RDF never become rent credit |
| Existing PostgreSQL constraints/triggers and Prisma models | Version-aware exact sum/immutable evidence/unique settlement protections, not application-only validation |

### Execution and finite finish proof

1. Extend the closest existing frozen-evidence/checkout tests with the nonzero
   §3 fixture; establish the current rejection as the failure to fix. Include
   tampered component, duplicate tax/ID, overflow and unsupported version cases.
2. Implement the representation, compatible storage, complete preparation/freeze
   and verifier; connect preapproval and all payment/signature consumers above.
   Run focused tests while editing; no full-suite cycle after every helper.
3. Connect receipt/reserve, signed cancellation, dispatch and first-invoice
   allocation. Keep real provider calls mocked in disposable source acceptance;
   real Stripe TEST is a separate existing acceptance requirement.
4. Complete the same owner → customer estimate → accept → sign → settlement →
   real scheduled/delivered job → first invoice flow in disposable PostgreSQL and
   browser, including the §5 denial/race/replay/partial-location cases. Extend
   existing suites where possible; proposed packet filenames are not mandatory
   additional test suites if equivalent complete coverage is already present.
5. Use required exact-head CI/review on the assembled changes, then record each
   original packet criterion with its actual test/result/merge evidence. Once
   complete, close engineering and move to W-23 without waiting for external
   activation; retain the existing release/owner/professional/provider queue.

If a split is needed, record its concrete compatibility/migration/review reason
and the remaining connected acceptance on the same card. A passing intermediate
PR is a checkpoint, not permission to end an otherwise executable milestone.
Do not leave the next agent to rediscover which V1 consumers still reject V2.

## 3. Deterministic money fixture — proposed tests, no real tax policy

Use **synthetic** rates/classifications below in disposable tests only. This
fixture deliberately exercises nonzero delivery, reserve and RDF that the current
setup-only frozen envelope cannot represent. It does not assert the real business
owes RDF or that rental/reserve tax is zero. Exactly one assessed RDF event is
explicitly provided; do not infer multi-address RDF law from this fixture.

| Integer cents | New location A | New location B | Combined |
|---|---:|---:|---:|
| Separate machines / net monthly rent | 2 / 6000 | 3 / 9500 | 5 / 15500 |
| Setup decision | FULL 4500 | PARTIAL 2250 with reason | 6750 |
| Mandatory route delivery | 7500 | 0, verified not applicable | 7500 |
| Synthetic setup tax | 225 (5%) | 225 (10%) | 450 |
| Synthetic delivery tax | 375 (5%) | 0 | 375 |
| RDF, one reviewed event allocated to A | 31 | 0 | 31 |
| First-month rent advance | 6000 | 9500 | 15500 |
| Negotiated commercial refundable reserve | 10000 | 5000 | 15000 |
| **Due at signing** | **28631** | **16975** | **45606** |

A's 6000 rent is 3500 + 3500 − 1000 pair discount, with distinct machine identities
and 3000 paid-price allocation per machine. B is a 6000 pair plus one 3500 machine.
Five machines triggers advance even if customer is not flagged business; a
one-machine business/property manager also triggers it. Prepaid rent never gets
an additional rent advance for the same coverage.

For this fixture, A's first full-coverage rent invoice is 6000, less one 6000
advance application = 0; B independently 9500 − 9500 = 0. Its configured synthetic
rent tax is zero. Replaying invoice generation creates no extra credit. Setup,
delivery, their tax, RDF and reserve never become rent credit. Subsequent months
have no repeated setup/advance/RDF. Deliver A only: do not invoice/start recurring
rent or consume B's advance. A reschedule does not authorize new fees.

Additional fixtures: ordinary two-machine household (no reserve/advance), live
address add-on (no second setup), explicit waiver matching a later baseline
(override identity retained), annual prepaid pair return, taxable/exempt mixed
assets, unknown jurisdiction, and one-cent rounding remainder. Use existing
reviewed tax rounding/allocation helpers; never float dollars or a new independent
rounding formula. Sum location/line rounded cents exactly; never round the combined
total again. If actual contractual proration yields a different first-invoice
coverage amount, prove its explicit remaining balance/credit policy separately;
do not silently force a zero balance or consume another location's funds.

## 4. Transaction and external continuation contract

Use the existing estimate lock as aggregate serialization for its competing
prepare/edit/approve/convert paths. Reauthorize team mutations with the existing
active-team checks; customer mutations recheck their scoped token/session and
customer authority, never a team-role assertion or submitted customer ID.
Write the actual existing cross-domain lock order in the implementation card;
do not introduce reverse order relative to sign/webhook/manual-payment paths.
Acquire sibling agreement locks in stable ID order before rechecking sources;
retain current obligation/ledger locks where money changes. Provider calls stay
outside transactions. Prove every new multi-lock order with real races.

1. **Prepare/review:** trusted inputs → current source fingerprint → complete
   projection → owner review evidence. No signatures, collection, booking or
   outbound message. Incomplete quote remains editable and visibly incomplete.
2. **Accept/convert:** re-read all sources under locks; compare submitted reviewed
   fingerprint, ownership, gate scope and lifecycle; atomically bind acceptance
   and reuse prepared agreements. Rollback restores all statuses, links and audits.
   Concurrent approve/edit has one legal outcome; stale acceptance cannot succeed.
   Preserve existing customer-acceptance versus individual agreement-signature
   distinction; one property signature does not sign sibling agreements.
3. **Sign/payment:** freeze the accepted scope and prepare/reuse its durable
   obligation/attempt. Checkout uses immutable attempt/payload identity. After
   timeout, reconcile the same provider operation; never start a new one because
   the redirect disappeared. No provider success label without verified evidence.
4. **Settle/recover:** verify customer/account/currency/exact cents and source;
   one receipt/effect per obligation, event replay safe. Partial/foreign receipts
   or SUCCEEDED-without-local-receipt go to reconciliation, not manual recollection.
   Provider uncertainty stays PENDING. A definitively FAILED attempt may retry
   only through existing authoritative recovery rules.
5. **Delivery/invoice:** sign creates unscheduled owner task; staff records real
   appointment. Dispatch rechecks signed payment. Actual location delivery is
   the recurring-billing trigger; one verified advance application per first
   invoice. Failure after remote invoice acceptance reuses reconciliation identity.

## 5. Finite acceptance matrix — implement as one connected outcome

These rows are internal proof obligations, **not** additional roadmap subsections.
Adapt the closest existing tests; the three new integration test paths in the
active packet are proposals, not assumed files or passing evidence.

| Trigger | Required durable result and visible behavior |
|---|---|
| Complete synthetic fixture | Owner/customer agree on 28631/16975/45606 and every component; later invoice/credit sums reconcile |
| Missing tax, reserve terms, delivery evidence or professional gate | Private reasons remain actionable; real send/approve/sign/checkout denied without durable binding/money writes |
| Owner edits one line/rate/policy after review | Old fingerprint denied at all binding entry points; zero partial conversion; new review needed |
| Policy changes after signature | Historical signed cents/evidence unchanged; only eligible future quotes use new revision |
| Two simultaneous accept/convert calls; injected final-write failure | One agreement set/acceptance, or complete rollback; no orphan snapshot/audit/receipt |
| Foreign customer/address/package/token or deactivated actor | Denied at query/domain boundary; no foreign financial/PII read or write |
| Success redirect but pending/timeout/late failure | No paid label, dispatch or extra attempt; To do links to real reconciliation |
| Duplicate/out-of-order provider callback and manual-receipt race | Exactly one legal settlement effect; terminal success does not regress |
| One location signs/pays/delivers; sibling remains pending | Correct location tasks/invoice only; no cross-location credit, signature or invented appointment |
| Cancellation before delivery | Household full refund; large account <=72 elapsed hours full refund, later reviewed retention only; approval is not provider refund settlement |
| Large prepaid order has zero advance | Classify from frozen machine/customer policy, not `downPaymentCents > 0`; preserve existing large-order decision explicitly |
| Cancel sibling after another location delivered | Reconcile only eligible undelivered obligations; never close delivered sibling or refund its used credit; unresolved allocations require finance review |
| Midterm prepaid single-machine return | Credit unused actual discounted paid share; no past clawback; future unpaid single pricing only; independent money-out approval |
| Browser owner → estimate → accept → sign → payment status → schedule → deliver → first invoice | Same amounts/fingerprint throughout; mobile/desktop/axe; second customer denied; email/SMS/providers remain test doubles |

PR #463 now freezes machine/customer classification and original refund window;
do not reimplement that repaired large-order detection. Reconcile the calculator
and evidence with added reserve/delivery/RDF categories and partial locations;
these remain **required integration gaps**, not already supported behavior. Terms
and professional review decide real retention/tax adjustment; no blanket refund
or automatic statutory-fee reversal. An approved cancellation can create a
PENDING_EXTERNAL_REFUND follow-up without pretending money moved.

## 6. Completion evidence and next work

Use existing unit, disposable Postgres and browser fixtures from the packet,
plus the new complete-flow tests when authored. Assert actual row counts,
receipt/allocation/liability sums, frozen digests and forbidden writes, including
rollback/race cases. A pure calculator test or warning-only screen is insufficient.
Run focused preflight at integration seams, required exact-head CI/review on the
assembled PR, and update the active card's single remaining checklist from actual
results. Do not rerun broad CI after every helper or create a new PR per matrix row.

W-22FIN engineering finishes when the complete owner/customer quote-to-first-
invoice path and failure cases work, not when a guard merges. Then resume W-23.
Real Stripe TEST, checked deployed revision and owner/CPA/counsel acceptance remain
separately evidenced under existing gates; none is claimed by synthetic fixtures
or this design-only maintenance. Future W-23–W-26 contracts remain in the owner
engineering addendum; use the matching research R6–R8 without authoring distant
execution cards or promoting proposed K-CASH/BP.
