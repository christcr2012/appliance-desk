# Batch BP business offers operations and partnerships

**Status:** PROPOSED architecture and implementation plan, written at the owner's request on 2026-10-07. No runtime changes in this documentation PR. Business prices, terms and live activation are not approved by this document.

**Baseline:** `main` at `7da67620851c7ca98cc67d6de3716c38a3983dc1` (#285). T remains in progress; K, M and O are designed but not implemented at this baseline. Read by section. Business source and every disposition: [source trace](../business/SOURCE-DISPOSITION.md).

**Implementation gate:** obtain design acceptance and create the relevant bounded PR card after its prerequisites merge. Each card must include literal Prisma changes, existing-domain call sites and exact tests against the then-current code. This document supplies the architecture, data contracts, behavior and boundaries; it must not be mistaken for already approved cards or implemented functionality. Do not stop ongoing T work for this proposal.

## 0. Intent and scope

Turn the consultant's useful commercial ideas into a reliable, owner-operated appliance business. Preserve Robinson Appliance Rentals, the current app and its existing financial/custody/renewal foundations. Add configurable offers, permission and installation evidence, commercial master documents, measured acquisition economics and referral partner accounting. No separate CRM, generic marketplace, new billing engine or forced rename.

Business documents live in `docs/business/`. Signed records and personal data stay in private application storage. The Markdown folder is not a public website publishing source and is not a replacement for the app's legal-document approval flow.

## 1. Existing implementation and gaps

| Area | Evidence inspected at baseline | Design consequence |
|---|---|---|
| Pricing | `ApplianceType`, `PricingRule`, `BusinessSettings`; `src/domains/pricing/prepay-discount.ts`; BUSINESS-RULES Pricing | Extend shared server pricing; a $60 final six-month offer cannot accidentally receive another legacy discount |
| Leads | `Lead.howHeard`, `referredByCode`, `desiredTerm`; `src/domains/leads/index.ts` | Add typed campaign/promo fields; keep human source and customer-referral semantics |
| Customer referrals | `Referral` pays a one-time customer reward; `src/domains/referrals/` | Do not overload this record with recurring business commissions |
| Property portfolio | `Customer.isPropertyManager`, `ServiceAddress`, customer contacts, statements | Reuse payer/customer and address hierarchy; no second Customer_Leases table |
| Agreements | `RentalAgreement`, `RentalLine`, signed terms/price snapshots | Attach offer/master/partner metadata to these records; keep money here |
| Renewal continuity | `renewedFromAgreementId`, `continuityRootId`, `continuousSince`; `renewal-start.ts` | Fresh signatures do not erase continuity or reset statutory notice/tax history |
| Inventory | `Appliance` plus assignments, inspection and custody episodes | First-use qualification supplements existing states; no replacement inventory status enum |
| Job completion | `completeJob` locks ledger/agreement/job; idempotent completion and billing handoffs | Safety/permission checks run inside existing completion transaction, before positive installation results |
| Checklist | `src/domains/jobs/checklist.ts` and `Job.checklist` explicitly advisory | A real required evidence gate is new work; do not claim current ticks already enforce it |
| Tax | `src/domains/tax/`, `InvoiceTaxLine`; T Amendment D proposed | Reuse jurisdiction evidence, acquisition tax and readiness; do not create taxPaidUpfront → globallyExempt logic |
| Documents | `DocumentArtifact` has customer scope/version/hash; `SignatureRecord` is rental-specific | Extend artifact kinds; new authorization signature evidence cannot impersonate a rental signature |
| Reporting | `src/domains/reports/definitions.ts`, inventory analytics; K section 3.8 proposed | Extend METRICS and books instead of a second income/cost ledger |

Before each implementation card, verify these assumptions, inspect CHANGES-SINCE-DESIGN and relevant predecessor reviews. If T/K/M/O changes a referenced field, amend the card/design before code. Old schema comments that say billing does not exist are historical and are not design authority.

## 2. Product decisions

### D-BP1 Offers and prices are versioned commercial facts

An offer describes equipment qualification, term, final monthly rate, upfront fees, deposit policy, service eligibility, included service and any replacement promise. Published versions are immutable. Draft editing creates a new revision; retiring an offer prevents new quotes and preserves old evidence.

Two pricing modes: `LEGACY_RULES` uses current rules unchanged; `OFFER_FINAL` uses the offer's final monthly amounts with no automatic legacy term discount. Keep the existing 12-month prepayment bonus disabled for an OFFER_FINAL offer unless explicitly included in its snapshot. The owner sees the full discount stack and minimum-term customer cost.

Month-to-month and 3-, 6- and 12-month terms are suggested presets, not a hard-coded business menu. Store an editable list of allowed fixed-term month counts and an independent month-to-month choice on each offer/template; persist month-to-month as the existing `termMonths=null`. Initially support positive whole-month terms within the reviewed tax engine’s supported duration range; any unsupported duration is visibly rejected, never silently shortened. Every selected duration needs an explicit price and compatible template. Remove fixed 3/6/12-only validation from intake, builder, quotation, signing and renewal together; test both a 3-month preset and an owner-added 9-month term. No fallback to six months or an invented discount.

A renewal derives its prices from the predecessor's signed facts and a versioned renewal offer, not today's public catalog. Rate lock duration and permitted changes are explicit. Moves or extra appliances require a reviewed quote. Retain B2 deposit transfer, subscription transition and cancellation behavior.

### D-BP2 Zones are operational and distinct from tax jurisdictions

Commercial zone evidence uses driving distance in meters from the owner-configured private origin to the service address; compare integer meters against configured boundary values with one documented conversion. Candidate UI values: 15 and 30 miles. No unpriced gap between 15 and 16 miles. Store distance source, measured time, origin version and address hash.

Initial release permits a staff-verified route distance with supporting note and timestamp. No new paid maps provider is required. Unknown distance blocks automatic fee confirmation; an owner may issue a manual quote with reason. Do not expose the private origin or rely on ZIP centroids. Address changes invalidate unsigned quotes, permission evidence and route results; signed arrangements require the existing move/change process.

Fee calculation records separately delivery, installation and removal. A stairs surcharge is a priced component with a reviewed tax-category mapping and a specific visit scope. Charging a fee does not override a safety failure.

### D-BP3 Promotions and attribution are different

Campaign identifies a source; promotion changes a price; customer referral creates a customer reward; partner attribution can create a commercial payable. Do not use a shared untyped code field for all four.

One promotion per quote by default. Configuration states eligible offer versions, term, zone, effective dates, setup/monthly discount, maximum uses and per-customer cap. Code normalized using one canonical uppercase form; namespaced validation prevents ambiguity with customer and partner codes. Never trust client-supplied discount amounts.

The server creates a short-lived promotion hold tied to a quote/customer. Under a row lock, active holds plus committed uses may not exceed cap. A signed agreement commits the use exactly once. Unsigned expiration releases a hold; signed cancellation requires an audited owner adjustment to release a use. A quote reaching expiry is repriced and re-presented before signing, never silently changed under an existing signature.

Campaign spend is a Batch K expense linked by campaign ID. Time is stored separately in minutes with an optional cost rate; financial reports never add raw hours to dollars. Original and conversion attribution remain separate, with unknown as a valid value.

### D-BP4 Verified new is a first-use promise

Separate acquisition condition from offer tier. `new` text in Appliance.condition is not proof. Require verified-unused evidence and no first deployment. Both machines in a premium set must qualify. Check eligibility at reservation and again under asset locks at delivery/substitution. Record first deployment once; a return, swap or cancellation cannot clear it.

A continuing customer can retain a premium contractual rate without implying the machine remains unused. Replacement terms must say whether a replacement is new or an inspected equivalent; absent an agreed replacement policy, refer to the owner before substituting. Historic unknown stock defaults to not qualified for a first-use offer.

### D-BP5 Permission is scoped evidence

Ownership state: OWNER, TENANT, AUTHORIZED_MANAGER, UNKNOWN. A tenant assertion and an owner/manager authorization are different evidence types. Permission applies to an address version, customer occupancy and stated installation scope; moving or a different occupant requires re-evaluation.

Use a versioned authorization document with evidence of signer name, capacity, scope and signing time. Store token hashes only, expire and rotate links, and provide a minimal standalone signing page. A landlord does not receive a customer account or resident billing access merely to sign. No raw signature token in logs, analytics or messages stored beyond the existing secure delivery pattern.

Missing/denied/revoked permission blocks scheduling a confirmed installation and positive completion where required by policy. Leads, inspection and preparation remain available. Revocation creates a Today task, not an automatic forced retrieval or cancellation charge. Disputed possession is handled by the owner/counsel.

### D-BP6 Required installation evidence replaces advisory completion only for scoped jobs

Freeze a checklist version per installation attempt and per actual appliance. Required item outcomes are PASS, FAIL or NOT_APPLICABLE; N/A requires an allowed applicability rule and reason. Unsafe failure is never overrideable by an owner toggle. Store corrections as a new assessment revision; retain prior results.

Before accepting each positive result in DELIVERY, INSTALLATION or incoming SWAP, `completeJob` rechecks permission, compatible asset, evidence version and required safety results under its existing locks. Reuse the job's result/status vocabulary and `JobBillingHandoff`. A missing or failed installation does not masquerade as completed installation. Partial custody and existing owner-approved partial-delivery billing rules remain authoritative; this feature must not invent a whole-agreement billing shutdown or start time.

Component consumption uses existing `PartStockMovement` and purchasing services. Unique job/appliance/check-item evidence links prevent duplicate stock decrements on retry. Actual receipts/parts/labor feed K. Do not allocate the same component cost through both a new expense and an existing part movement.

### D-BP7 Commercial master agreements do not duplicate rental agreements

The commercial legal entity is a Customer, with existing service addresses and contacts. A `PortfolioContract` is a versioned umbrella artifact linked to that customer. Each `RentalAgreement` references the exact master version and serves as the equipment/location schedule. Signing the master alone does not reserve assets or begin billing.

One payer owns the portfolio. Each rental remains scoped to one service address and tax location. Volume qualification, price band, minimum commitment and vacancy/reduction policy are frozen for the agreed term. New schedules do not retroactively reprice existing schedules. Amendments require a new version and acknowledgment where needed.

Consolidated statements and manual receipt allocation remain the initial collection path. A single automatic debit spanning subscriptions is not delivered by this design. Occupants are service contacts unless separately authorized, not silent account owners.

### D-BP8 Partner compensation follows collected eligible rent

A partner is a Customer marked for a business relationship; a partner agreement is separate from its customer role and contains signed commission terms. Attach at most one partner agreement to each rental. A successor may inherit it only under the signed partner terms; preserve continuity and avoid double-counting predecessor and successor for the same period.

Flat commission for one service month equals `roundHalfUp(monthlyCommissionCents × eligibleNetRentCollectedCents / contractualEligibleMonthRentCents)`, capped at monthlyCommissionCents. Percentage commission equals rounded eligible net rent × basis points / 10,000. A zero denominator earns zero. The denominator uses contracted rental amounts after agreed discounts; exclude tax, deposit and non-rent fees. Use invoice service-period evidence, not the cron execution month. Partial first/last service periods prorate the monthly cap by the existing contract day basis.

Unsettled ACH, checkout completion, unapplied customer cash and merely ACTIVE status do not earn a commission. Non-cash goodwill credit is not eligible cash. A prepaid annual receipt is allocated to service months; entitlement accrues no earlier than those months and is reversed for unused refunded periods.

For each rental/partner/service-month, compute the current entitlement from settled allocations and reversals, lock that accrual key and append only the difference from the already accrued total. Stable source fingerprints make reprocessing a no-op. This handles partial payments without rounding each payment into duplicate flat commissions. Refund, dispute, returned payment and restored dispute outcomes recompute the target and append signed corrections, never delete earnings.

Batch K posting contract: positive earned commission debits a dedicated PARTNER_COMMISSION_EXPENSE account and credits PARTNER_COMMISSION_PAYABLE; negative corrections reverse those amounts. Confirmed payment debits the payable and credits the selected cash/bank account. Use K source-key idempotency and closed-period correction rules; approval alone makes no cash posting. Do not also record the same payment as an unrelated expense. Exact account-key additions ride BP-14 after checking K’s merged account registry.

Start with owner-approved manual settlement. A settlement's allocations reserve payable entries so two approvals cannot pay the same amount. Mark paid only with date, amount and unique payment evidence reference. Paid reversals become a recovery/offset balance; no automatic partner bank debit. Negative earnings do not erase a completed payment.

### D-BP9 Partner portal has narrow membership

Use existing authenticated User with CUSTOMER role plus explicit `PartnerMembership`, not a new global PARTNER role. Membership authorizes only that partner's commissions, settlements and approved aggregates. Owner creates/revokes access through the existing server-side account provisioning pattern; public signup stays disabled.

Referral partner DTOs omit resident names, addresses, balances, payment methods and signatures. Provide month/count/commission totals and anonymized reference IDs. A customer who is also a property-paid payer can access its own normal customer portfolio through existing checks, not through broader partner permissions. Test both relationships independently.

### D-BP10 Metrics extend existing definitions

K retains its billed/accounting asset payback. BP adds collected-cash recovery and campaign economics as distinctly labeled metrics, with drilldown and completeness indicators. Use the business [financial model](../business/FINANCIAL-MODEL.md) definitions. Missing costs, zero denominators and immature renewal cohorts produce “Not enough data,” not zero cost or a green profit badge.

### D-BP11 Owner configurable agreement templates

**Owner clarification 2026-10-07:** business plans and consultant terms must become reusable, configurable templates, not hard-coded agreement terms. Template examples are starting points the owner can duplicate, name, edit, save and select without a code change.

A template includes editable clause text, ordering, optional clause groups, term choices, cancellation/renewal policy, notice timing, deposit policy and replacement/service wording. Numeric policies are structured fields that drive the real domain behavior; changing prose alone must never silently change billing. Commercial offer prices/fees stay in offer versions, and jurisdiction tax decisions stay in T. The editor flags a text/policy inconsistency before publishing and renders the resolved customer document and policy summary together.

Template kinds are residential agreement, commercial master, property authorization and partner agreement. Multiple named versions may exist per kind, such as standard refurbished, flexible local, premium and a negotiated commercial customer template. Supplied examples start as editable drafts. An owner can include/exclude optional service, renewal, early-ending and rate-lock clauses when their corresponding supported policy is selected; mandatory legal disclosures, safe access and cancellation controls cannot be removed through presentation settings.

Terms resolve in this order: explicit permitted per-agreement overrides with required approval/reason, then the selected template version, then existing BusinessSettings defaults for fields the template explicitly inherits. Resolve inheritance and copy values into termsSnapshot when the quote/document is issued. Each snapshot records the source of each value. There is no live pointer that makes a later global setting change rewrite an issued or signed agreement. Refreshing an unsigned document creates a new version and invalidates its old signing link; accepted agreements retain their exact text, values and hash.

Use the existing terms-snapshot/domain validators and legal approval mechanism. A template version is approved only after its required legal review and compatible behavior validations; revision invalidates that version’s approval. The owner can preview, compare, publish, retire, duplicate or restore a suggested template. Restoring creates a fresh draft and preserves edited versions. Mandatory legal bounds are validation constraints explained on screen, rather than adjustable business defaults.

Template rendering uses an allowlist of placeholders for customer, address, equipment, resolved term/prices/fees and policy text. Escape all inserted values; prohibit executable expressions, arbitrary HTML/scripts and references to unrelated customer records. Show missing fields as errors before signature, never blank binding terms. Owner-editable text must not be used as authorization, monetary arithmetic or a command.

Default seeds are examples marked “Suggested starting template — review before use.” Fees, rates, duration lists, reminder timing, promotion hold lengths, commission policy and operational thresholds are stored values; values already owned by B2/E/T/K/O continue to use those settings. Do not create competing global controls. The optional 45-day retention contact is configurable and distinct from the existing legally constrained notice schedule.

### D-BP12 Options are selectable only when behavior supports them

The owner requested additional options and research on 2026-10-07. The [options catalog](../business/OPTIONS-CATALOG.md) defines 22 commercial/operational choices and their current, BP or later implementation ownership. It is the required template-design input; candidate future options do not silently become deliverables of the existing 16-slice estimate.

Expose five editor groups: equipment/service, duration/renewal, charges/payment, access/delivery, exceptions/protections. A typed capability descriptor declares each option key, supported choices, existing domain validator, required policy fields, compatible template kinds, required approvals and delivery status. This is a small appliance-specific manifest beside the template validator, not a generic scripting/rules platform or another database ledger.

Statuses shown to the owner: Supported; Needs setup; Needs review; Not built yet. Compute them from actual domain support, configuration, review evidence and stock as relevant. A published template can select only supported, ready choices. Legacy inherited behavior remains intact; new optional extras start unselected, not automatically enabled by default seeds. A duplicate template retains its version/provenance and does not duplicate accounts or obligations.

Explicitly validate conflicts: auto-renew prose versus NONE policy; manual collection versus undisclosed automatic debit; waiver and deposit conflation; incompatible replacement stock; stale/new-address permission; promotion/prepay/referral stacking; a promised customer credit without an implemented credit path. Report all affected fields with plain explanations before issue/signing; do not just hide inconsistent controls.

Do not put unsupported money behavior into policyOverrides JSON. Its allowlist stays tied to real terms-snapshot/domain schema support. Later options (pause/installments, unified move wizard, one-time partner compensation, automatic outage compensation, dynamic volume repricing, rent-to-own) have an informational disabled state with a roadmap reference. Add their implementation cards/tests and schema support before enabling them. Terms/status labels remain owner-editable where safe; financial and authorization invariants cannot be bypassed by changing prose.

Tests in BP-2/3 prove an owner-added supported choice executes the real rule, an unsupported choice cannot be signed, contradictions block publication, text/structured values stay consistent, defaults restore into a new draft and old signed agreements remain unchanged. Options involving new workflows stay on ROADMAP with acceptance requirements rather than placeholder implementation.

## 3. Data contracts

All IDs are cuid strings unless an existing model uses another type. Money is Int cents; percentage is Int basis points for commissions (tax retains its own existing precision). Timestamps are UTC; service-month keys are first-of-month Colorado business dates. All financial/evidence relationships use restrictive deletion. Every model has createdAt and actor audit evidence; mutable operational records have updatedAt and optimistic version Int default 1. Append-only versions/entries have no business-field update path. No historical evidence backfill may invent a signature, condition or permission.

The following is the complete proposed relational contract. Implementation cards render it into literal Prisma/SQL and must add relation inverses, indexes and constraints. If a prerequisite already provides an equivalent model, record the mapping instead of adding a duplicate.

### 3.1 Offers and campaigns

| Record | Required fields beyond common fields | Constraints |
|---|---|---|
| `AgreementTemplateVersion` | templateKey String, revision Int, label String, kind RESIDENTIAL/PORTFOLIO/PROPERTY_AUTHORIZATION/PARTNER, state DRAFT/PUBLISHED/RETIRED, clauses Json, policyOverrides Json, inheritedFields Json, allowedTermMonths Json, monthToMonthAllowed Boolean, approvalEvidence Json?, publishedAt DateTime?, publishedByUserId FK? | unique templateKey+revision; published versions immutable; strict clause/policy/placeholder validation; editing creates a new revision and invalidates approval |
| `CommercialOfferVersion` | offerKey String, revision Int, label String, state DRAFT/PUBLISHED/RETIRED, effectiveFrom DateTime, effectiveTo DateTime?, policy Json, publishedAt DateTime?, publishedByUserId String? | unique offerKey+revision; published policy immutable; effectiveTo after effectiveFrom |
| `MarketingCampaign` | name String, channel String, startsAt DateTime, endsAt DateTime?, status DRAFT/ACTIVE/ENDED, outreachMinutes Int default 0, hourlyCostCents Int? | nonnegative minutes/cost; campaign not erased once referenced; no secrets or raw tracking URL parameters |
| `Promotion` | normalizedCode String unique, campaignId FK?, revision Int, policy Json, state DRAFT/ACTIVE/ENDED | policy frozen once any claim exists; revise by successor record/code; cap and eligibility validated |
| `PromotionClaim` | promotionId FK, quoteId FK, customerId FK, agreementId FK?, status HELD/COMMITTED/RELEASED, expiresAt DateTime, committedAt DateTime?, releasedReason String? | unique promotionId+quoteId; one committed claim per agreement; lock promotion to enforce global/per-customer caps |
| `CommercialQuote` | customerId FK, serviceAddressId FK, offerVersionId FK?, addressHash String, inputHash String, expiresAt DateTime, policySnapshot Json, resultSnapshot Json, sha256 String, supersedesId FK?, acceptedAgreementId FK? | acceptedAgreementId unique; frozen after issue; replacement quote for changed inputs; customer/address ownership enforced |

`AgreementTemplateVersion.clauses` schema version 1: ordered [{key, title, body, optional, enabled, supportedConditionKey?}]. policyOverrides contains only supported fields from existing terms-snapshot schemas; inheritedFields explicitly names allowed defaults. allowedTermMonths is an array of supported positive integers, not an enum of the example durations. A template’s policy and clause selection are validated together; allowed display conditions are a fixed safe evaluator, not user-authored code.

`CommercialOfferVersion.policy` schema version 1: pricingMode, monthlyCentsByEquipmentKeyAndTerm (explicit single/type/set rates), allowedTermMonths (owner-editable supported month counts plus month-to-month eligibility), qualification REFURBISHED/VERIFIED_UNUSED/ANY_INSPECTED, feeLines [{key, category, cents, scope PER_JOB/PER_SET/PER_APPLIANCE}], depositMode NONE/FIXED/ONE_MONTH_RENT, depositCents nullable, includedPrepayBonus boolean, zonePolicy {originVersion, coreMeters, extendedMeters, allowManualOutside}, renewalPolicy {rateLockMonths, waiveUnchangedConnection}, replacementPolicy INSPECTED_EQUIVALENT/VERIFIED_UNUSED/OWNER_REVIEW, minimumContributionCents and disclosureVersion. The margin preview uses K cost inputs plus explicitly labeled expected service/return allowances; missing costs require owner review and never satisfy the floor automatically. Validate strict keys, bounds and tax-category mappings; no arbitrary executable formulas.

`Promotion.policy` schema version 1: eligibleOfferKeys, eligibleTerms, eligibleZones, startsAt, endsAt, maxUses, maxUsesPerCustomer, setupDiscountCents, monthlyDiscountCents, monthlyDiscountDurationMonths and combinability flags default false. Expiry and cap must be finite for a “limited” promotion.

`CommercialQuote.resultSnapshot`: stable line IDs, quantities, recurring rent, fee components, discount provenance, deposit, prepayment, tax engine input/output evidence IDs, dueNow, recurringTotal, minimumTermTotal, future mandatory fee disclosure, manual override reason/approval ID, route evidence and qualification basis. Do not treat quote tax as paid invoice tax; invoice issuance follows T's effective-date rules and approved customer disclosure.

Add nullable agreementTemplateVersionId FKs to CommercialOfferVersion, CommercialQuote, RentalAgreement, PortfolioContract, PropertyAuthorization and PartnerAgreement. Each issued DocumentArtifact payload includes the template key/revision, resolved clause text, policy values, inheritance provenance and template hash; approved overrides are frozen too. Existing agreements with no template reference retain their old snapshots; do not infer or relabel a historical template.

Add nullable `campaignId`, `conversionCampaignId` FKs to Lead; do not replace howHeard/referredByCode. Add nullable commercialQuoteId (unique), portfolioContractId, partnerAgreementId FKs to RentalAgreement. Preserve existing line snapshots and signed artifact hash. Batch K expense gets nullable campaignId; no parallel campaign cash ledger.

### 3.2 Asset and installation evidence

Add to Appliance: `unusedVerification` enum UNKNOWN/VERIFIED_UNUSED/NOT_UNUSED default UNKNOWN, `unusedVerifiedAt` DateTime?, `unusedVerifiedByUserId` FK?, `unusedEvidencePhotoId` FK?, `firstDeployedAt` DateTime?. Unknown historic units do not qualify. T supplies acquisition tax fields; do not redeclare them here.

| Record | Required fields | Constraints |
|---|---|---|
| `PropertyAuthorization` | customerId FK, serviceAddressId FK, addressHash String, revision Int, occupancy OWNER/TENANT/AUTHORIZED_MANAGER/UNKNOWN, status DRAFT/PENDING/SIGNED/DENIED/REVOKED/EXPIRED, scope Json, signerName String?, signerCapacity String?, contactId FK?, artifactId FK?, signatureEvidence Json?, signedAt DateTime?, validUntil DateTime?, tokenHash String? unique, tokenExpiresAt DateTime? | unique address+customer+revision; signed scope immutable; expiry/revocation keeps signature evidence; no consent inferred from contact record |
| `InstallationAssessment` | jobId FK, applianceId FK, revision Int, policyVersion Int, addressHash String, authorizationId FK?, results Json, outcome PASS/FAIL/INCOMPLETE, assessedByUserId FK, assessedAt DateTime, supersedesId FK? | unique job+appliance+revision; evidence immutable; completion uses latest valid result for actual asset/address |

Results schema: [{key, outcome PASS/FAIL/NOT_APPLICABLE, reason?, evidencePhotoIds[], partStockMovementIds[]}]. Required keys and applicability are a versioned owner installation policy in BusinessSettings; the safety minimum cannot be removed without a reviewed policy version. Existing material usage owns quantities/costs. Add artifact kinds PROPERTY_AUTHORIZATION and PORTFOLIO_CONTRACT; authorization signature data includes artifact hash, consent version, signer assertion and verification evidence. Privacy exports/deletion retention and backup registries include these records.

### 3.3 Commercial and partner records

| Record | Required fields | Constraints |
|---|---|---|
| `PortfolioContract` | customerId FK, contractKey String, revision Int, status DRAFT/SIGNED/ENDED, effectiveFrom DateTime, effectiveTo DateTime?, artifactId FK, terms Json, signedAt DateTime?, signerContactId FK? | unique contractKey+revision; signed immutable; service scope and payer ownership checked |
| `PartnerAgreement` | partnerCustomerId FK, normalizedCode String unique, revision Int, status DRAFT/ACTIVE/ENDED, effectiveFrom DateTime, effectiveTo DateTime?, rateKind FIXED/PERCENT, fixedCents Int?, rateBps Int?, policy Json, artifactId FK, approvedByUserId FK?, signedAt DateTime? | exactly one rate field; nonnegative fixed and 0–10000 bps; no earned entries before approved/signed effective period |
| `PartnerCommissionEntry` | partnerAgreementId FK, rentalAgreementId FK, serviceMonth Date, sourceFingerprint String, deltaCents Int, eligibleRentCents Int, targetEntitlementCents Int, reason EARNED/REFUND/DISPUTE/RESTORED/ADJUSTMENT, sourceEvidence Json | unique partner+agreement+month+sourceFingerprint; append only; index partner+month; evidence points to original receipts/allocations/refunds |
| `PartnerSettlement` | partnerCustomerId FK, periodEnd Date, status DRAFT/APPROVED/PAID/CANCELLED, amountCents Int, approvedByUserId FK?, approvedAt DateTime?, paidAt DateTime?, paymentReference String? unique, evidencePhotoId FK? | positive amount; only owner approves/confirms; immutable amount/allocations after approval; payment reference required for PAID |
| `PartnerSettlementAllocation` | settlementId FK, commissionEntryId FK, amountCents Int | unique settlement+entry; lock entries; positive allocations may not exceed unsettled positive balance after offsets; cancelling un-paid settlement releases reservation |
| `PartnerMembership` | partnerCustomerId FK, userId FK, revokedAt DateTime? | unique partner+user; active membership required on every query/export |

PartnerAgreement.policy version 1 includes eligible rental categories, service-period proration basis, refund/dispute offset rule, payout frequency, minimum payout cents, renewal inheritance, campaign/referral combinability and disclosure version. No bank credentials in this JSON. Commission sourceEvidence references allocations and amounts rather than copying card or resident PII. Negative corrections must be included when constructing a settlement; the same accrual/settlement locks prevent paying an old positive entry while ignoring a concurrent refund.

## 4. Domain APIs and transaction boundaries

Use named modules under existing domains, not page-local rules. Staff writes validate the authenticated active actor/capability inside the transaction and use existing row-lock helpers and AuditLog. Customer writes use customer ownership checks; standalone property signing instead validates its scoped, expiring token inside the same signature transaction and records signer evidence. It never fabricates a staff actor. New result types are discriminated unions; BLOCKED always has typed reasons and an owner action.

```ts
// src/domains/pricing/commercial-offers.ts (pure calculation; loader separate)
quoteCommercialOffer(input: CommercialQuoteInput): CommercialQuoteResult
// result: READY { lines, recurringCents, dueNowCents, minimumTermCents,
// depositCents, taxEvidence, warnings } | BLOCKED { reasons }

// src/domains/pricing/commercial-quotes.ts (database)
issueCommercialQuote(actorId: string, input: IssueCommercialQuoteInput): Promise<CommercialQuoteDTO>
acceptCommercialQuoteInTx(tx: Prisma.TransactionClient, actorId: string,
  input: { quoteId: string; agreementId: string; expectedHash: string }): Promise<void>

// src/domains/growth/promotions.ts
holdPromotion(actorId: string, input: { quoteId: string; code: string }): Promise<PromotionClaimDTO>
commitPromotionInTx(tx: Prisma.TransactionClient, quoteId: string, agreementId: string): Promise<void>
releaseExpiredPromotionHolds(now: Date, limit: number): Promise<{ released: number }>

// src/domains/customers/property-authorization.ts
requestPropertyAuthorization(actorId: string, input: AuthorizationRequestInput): Promise<AuthorizationRequestResult>
signPropertyAuthorization(input: AuthorizationSigningInput): Promise<AuthorizationSigningResult>
assertPropertyAuthorizationInTx(tx: Prisma.TransactionClient,
  input: { customerId: string; serviceAddressId: string; addressHash: string; scope: string }): Promise<void>

// src/domains/jobs/installation-assessment.ts
recordInstallationAssessment(actorId: string, input: InstallationAssessmentInput): Promise<AssessmentDTO>
assertInstallationReadyInTx(tx: Prisma.TransactionClient,
  input: { jobId: string; applianceId: string; addressHash: string }): Promise<void>

// src/domains/customers/portfolio-contracts.ts
createPortfolioContract(actorId: string, input: PortfolioContractInput): Promise<PortfolioContractDTO>
attachPortfolioContractInTx(tx: Prisma.TransactionClient, agreementId: string, contractId: string): Promise<void>

// src/domains/referrals/partner-commissions.ts (customer rewards unchanged)
reconcilePartnerCommission(input: { agreementId: string; serviceMonth: string }): Promise<CommissionReconcileResult>
// internal authenticated job; does not accept arbitrary client amounts

// src/domains/referrals/partner-settlements.ts
approvePartnerSettlement(actorId: string, input: SettlementApprovalInput): Promise<SettlementDTO>
confirmPartnerPayment(actorId: string, input: SettlementPaymentEvidenceInput): Promise<SettlementDTO>

// src/domains/portal/partner-summary.ts
getPartnerSummary(userId: string, input: { partnerCustomerId: string; from: string; to: string }): Promise<PartnerSummaryDTO>
```

Input DTOs include IDs, expected versions and bounded user facts; server loaders derive all money, ownership, active policy and evidence. Cards enumerate their complete fields against current Prisma types. Never pass client-generated QuoteResult back as authoritative money.

Lock order: follow the current global domain lock order; customer ledger before agreement before job before appliances. Promotion signing adds its promotion/claim lock at a documented deterministic point used consistently by every claim writer. Partner accrual and settlements share a partner-ledger lock before service-month/entry locks. Prove two-request races in real Postgres. Do not hold DB locks while calling email, Stripe or storage.

Authorization requests and reminder delivery reuse the durable E message ledger and dedupe keys. A signing token never proves delivery. Failed sends keep the request pending with retry/uncertain state visible in Today. Commission workers run from settled local ledger events with a periodic reconciliation backstop and no provider transfers. All cron processing is bounded, resumable and idempotent.

## 5. Screens and permissions

| Surface | Experience | Permission |
|---|---|---|
| `/desk/settings/agreement-templates` | Named templates; duplicate/edit clauses and supported policy; inheritance explanation; preview customer document and behavior; compare versions, review and publish | OWNER edit/publish; ADMIN prepare draft with O capability; neither STAFF nor CUSTOMER can alter templates |
| `/desk/settings/offers` | Versioned offers, clear price mode, fee/deposit settings, effective dates, preview and publish | OWNER publish; ADMIN draft, publish only with O capability |
| Existing lead and rental builder | Source, offer, term, address eligibility, qualification, itemized due-now/monthly/minimum-term review | Existing staff/customer scope; money controls restricted |
| Existing customer property panel | Permission required/received/denied, contact and lawful-access evidence | Team with customer scope; signature artifacts restricted |
| `/authorize-property/[token]` | Minimal property/scope review and signature; no resident billing | Valid scoped expiring token; distributed abuse controls |
| Existing inventory detail | Verified-unused evidence, first deployment, acquisition tax shortcut | Existing inventory permission; sensitive purchase amounts remain restricted |
| Existing driver job screen | Per-asset required checks; clear stop reason and correction path | Assigned/authorized job staff only; no financial DTOs |
| Existing commercial customer detail | Master version, covered agreements, statement and signer authority | Existing payer scope; financial parts OWNER/ADMIN |
| `/desk/growth/partners` | Partner terms, earned/reversed/payable amounts, settlement approval | OWNER financial writes; ADMIN view/preparation; STAFF none |
| `/account/partner` | Own month/count/earnings/payment summary and export | CUSTOMER + active membership; no resident lookup |
| Existing reports/growth | Campaign economics and cash-recovery alongside existing metrics | Existing finance permissions; definitions and missing-data warning |

Use mobile layouts, Evergreen tokens, keyboard labels and dark-mode/axe coverage. An owner can edit business values with plain explanation, recommended starting value and restore action. Restoring a recommended value creates a new version; it never rewrites signed quotes. Settings screens name customer-visible consequences, including tax and cancellation disclosure.

## 6. Implementation sequence and PR budget

Default scheduling: complete the current approved T → S → V → F/launch sequence and K → M → O before BP activation work. BP replaces selected growth ideas from P rather than adding a second conflicting roadmap. Operational access/safety enhancements may be pulled earlier by an explicit scheduling decision, but no automatic roadmap reorder is implied. Until then use the operating procedure manually for real work.

No schema change, feature flag activation, live send, paid service or payout in this design PR. Each future slice stays within PLAYBOOK limits. Multiple additive migrations are explicitly permitted only in the schema slices below, one per slice. Estimate 16 PRs, subject to narrowing at card creation; do not merge slices to hide mixed-risk work. All new features start unpublished/off where activation creates customer commitments.

| PR | Risk area | Deliverable and predecessor | Named proof |
|---|---|---|---|
| BP-1 | Schema | Template/offer/campaign/promotion/quote tables and Lead/Agreement links; after O, reconcile T/K fields | `tests/commercial-schema.integration.test.ts`: populated upgrade preserves historical prices; backup/restore coverage |
| BP-2 | Money | Template resolution/validation, quote calculation, promotion holds/commit, configurable-term/pricing-mode integration and renewal snapshots; BP-1 | `tests/commercial-pricing.test.ts`, `tests/promotions.integration.test.ts`: no double discount, two signers for last promo, stale quote, owner-added 9-month term, template change preserves signed terms |
| BP-3 | Screens | Template/offer editors, builder and customer quote disclosures; BP-2 | `e2e/commercial-offers.spec.ts`: phone/dark, duplicate/edit template, final price consistent, unpublished hidden |
| BP-4 | Schema | Appliance unused-evidence/first-deployment fields; BP-3 | `tests/appliance-first-use.integration.test.ts`: historical UNKNOWN, no false new backfill |
| BP-5 | Money | First-use reservation/substitution/delivery invariants and evidence capture via existing inventory form; BP-4 | Same integration suite: two claims, returned unit, mixed set, premium swap policy |
| BP-6 | Schema | Authorization and assessment tables; artifact kinds, policy setting; BP-5 | `tests/property-evidence-schema.integration.test.ts`: ownership FKs and backup/privacy coverage |
| BP-7 | Auth | Scoped authorization issue/sign/revoke and minimal token route; BP-6 | `tests/property-authorization.integration.test.ts`: wrong customer/address, expired/replayed token, revoked membership cannot sign as staff |
| BP-8 | Money | Installation assessment domain and completion gate; BP-7 | `tests/installation-assessment.integration.test.ts`: failure prevents positive result, partial delivery, no double stock/billing, incoming swap checked |
| BP-9 | Screens | Property evidence and phone job checklist workflows; BP-8 | `e2e/installation-evidence.spec.ts`: unsafe stop and correction, permission request, dark/axe |
| BP-10 | Schema | PortfolioContract and agreement link; BP-9 | `tests/portfolio-contracts.integration.test.ts`: signed versions immutable and payer consistency |
| BP-11 | Money | Commercial master/schedule signing and quote volume invariants; BP-10; reuse existing artifact/editor components | Same suite: master alone creates no billing, different location taxes, prospective volume change |
| BP-12 | Schema | PartnerAgreement, entries, settlements, allocations, memberships; BP-11 and K | `tests/partner-schema.integration.test.ts`: unique keys, restrictive FKs, restore/privacy coverage |
| BP-13 | Money | Commission accrual and reversal reconciliation; BP-12 | `tests/partner-commissions.integration.test.ts`: duplicate webhook, ACH pending, partial rent, prepaid year, dispute after payout |
| BP-14 | Money | Owner approval/manual settlement and K payable/expense integration; BP-13 | `tests/partner-settlements.integration.test.ts`: competing approvals, negative offset, payment evidence, journal replay |
| BP-15 | Auth | Partner membership checks, restricted portal and owner partner screens; BP-14 | `tests/partner-scope.integration.test.ts`, `e2e/partner-portal.spec.ts`: revoked access, cross-partner/export denial, resident PII absent |
| BP-16 | Screens | Campaign cost entry and cash-recovery/report views, METRICS definitions and owner handoff; BP-15 | `tests/business-metrics.test.ts`: zero denominator, missing costs, refund, asset swap, matured renewal cohort |

At card creation, BP-2, BP-7, BP-11 and BP-15 are explicit size-risk checkpoints. Split domain from integration/screen work if either exceeds ~500 production lines, ~15 files or one dominant risk area; an unbounded “finish everything” card is prohibited. The table estimates scope, not a promise that each will fit without decomposition.

## 7. Required acceptance and release evidence

- [ ] Owner can duplicate a suggested template, change a supported term/fee/renewal option and clause, preview and publish it without code; unsupported or inconsistent terms produce an explanation. Existing accepted documents retain their old text/policy/hash; draft refresh requires re-review.
- [ ] Every BP01–BP31 disposition has delivered behavior, an existing-code evidence reference or an explicit deferred item.
- [ ] Existing signed agreements, discounts, deposit balances, subscriptions, notices and inventory custody survive populated migration/rollback drills unchanged.
- [ ] Unknown tax, access, route distance, asset cost and first-use state are visibly unknown; none becomes implicit exemption, zero fee or successful approval.
- [ ] Offer price appears consistently in public copy, quote, signing and invoice; term discounts never apply twice; source campaign cannot mutate price.
- [ ] Promotion signing, asset allocation, job completion, accrual and settlement races each have real-Postgres tests, not only mocks.
- [ ] Continuing rentals preserve continuity root, cancellation route, notice evidence, one active subscription and deposit transfer; 45-day marketing cannot satisfy a required notice.
- [ ] New legal documents are versioned and approved through the existing legal gate before signature or publication.
- [ ] New fields/artifacts participate in export, privacy retention/deletion, backups and restore; no secrets/private documents in the repository.
- [ ] Tax decisions remain with T, accounting with K and parts/retirement with C/M; no alternate authoritative financial total.
- [ ] Partner settlement cannot use unsettled cash, deposits, tax, duplicated events or a second approver's reservation; uncertain payment evidence never becomes PAID.
- [ ] External partner and property-signing access passes adversarial read/write/export tests; public signup remains disabled.
- [ ] Browser files assigned to e2e/shards.json; routes and METRICS registered; phone/light/dark/keyboard evidence; owner walkthrough and published promises match real capacity.

## 8. Owner decisions and unresolved professional questions

IN-48 approves actual commercial values and price presentation before publication; IN-49 approves the operational standard and counsel-reviewed permissions/templates; IN-50 approves partner compensation, disclosures and manual-payment policy. Reuse existing IN-06/07 and IN-21/31/33–46. No business documents are blocked by these choices.

Unresolved use-tax-paid versus merely accrued exemption and continuous-use tax treatment stay under IN-33/36. Do not alter T's engine based on the consultant's claim. Before live use, the owner/CPA must resolve those settings and record the evidence. Retention marketing cannot weaken SB25-145 cancellation behavior. Counsel reviews mandatory-fee display under HB25-1090 before prices are advertised.

Stop the affected implementation slice if a prerequisite changes financial ownership, no approved signature flow can evidence the proposed signer, a required tax category remains undefined, or a partner payout would require a new provider. Continue unrelated authorized work; record the exact dependency instead of polling or redesigning it silently.

## 9. Deferred scope

Automated partner bank transfers/Stripe Connect, a single automated portfolio debit, rent-to-own legal/financial redesign, a paid distance provider, supplier wholesale integration and public self-scheduling remain separate work. None is necessary to create this documentation or pilot the business with reviewed quotes and manual operational controls.
