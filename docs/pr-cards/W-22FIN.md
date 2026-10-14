# W-22FIN — Complete configurable signing-to-delivery business workflow

**Scope:** W-22 parent card / approved Amendment B §6.2. This packet resumes
**after merged W-22D18 (#442)**. Existing signature, refundable-payment evidence,
first-invoice credit, no-time delivery draft and owner To do remain inherited
contracts, not work to repeat. Inspected baseline main
`64f000b3374621f0644d11b8b34b8bb0f1fd0d4b`.

**Execution priority:** This is the current roadmap unit. Complete its
approved engineering outcome before selecting W-23 or any later batch.
A missing owner-specific choice requires an immediate question and
same-session continuation; CPA IN-79 only gates affected actual business
use. Future release/Stripe/owner acceptance remains in its separate
ledger, not as a pretext to defer W-22FIN source work.

## Completion-first ordering (owner instruction 2026-10-14)

W-22FIN is the current engineering milestone. Finish the complete eligible
all-in customer/owner workflow, configurable owner rules, payment recovery,
delivery readbacks and regressions before W-23. The only permitted carryover
is precisely documented genuine external CPA/counsel/Stripe TEST, release and
authenticated customer/provider acceptance. If a missing owner decision
prevents safe implementation, ask the owner during this session; do not
silently skip the work or create endless small D19/D20 slices.

### Implementation checkpoint: owner fee waivers/overrides

The W-22FIN substantive implementation integrates an OWNER-only waiver/fee
override form on the actual multi-location draft agreement page, durable
actor/reason, fee read/review and prepared charge invalidation. Its source
fingerprint includes reason and adjusted cents. Signed and settled funds
are not rewritten. Real tax/CPA/Stripe acceptance remains separately gated.
No later W-23 work becomes eligible solely because this subsystem merges.

## Observable outcome (finish the cohesive engineering milestone)

The owner can prepare and review an actual all-in offer across each service
location with per-location setup fee and discounts/waivers, down payment,
mandatory other amounts, clearly separate government tax/fees, owner reasons,
approved terms and amounts that reconcile to signing and first delivery.
Customer estimate, agreement, signing, and authenticated account surfaces
read the appropriate reviewed/frozen contract, never an invented amount.
Website offerings remain unpublished where owner pricing-publication approval
is pending; no prelaunch price is accidentally exposed.

Failed or UNKNOWN signing payments lead to owner-visible actionable next steps
and supported safe retry/readback. The signed agreement's existing unscheduled
DELIVERY job is schedulable by owner/staff, and delivery/billing/payment evidence
remains distinguished; no automatic customer appointment, payment confirmation,
real refund or communication is invented.

## Regulatory evidence and configurable starting assumption — 2026-10-14

Research basis (verify before application; never a CPA determination):
- Colorado DOR, *Sales & Use Tax Topics: Leases*:
  https://tax.colorado.gov/sales-use-tax-topics-leases
  explains that associated lease-contract charges are generally taxable and that
  short-term lease treatment depends on acquisition tax/permission, for state-
  administered taxes. This supports a **taxable setup fee as the provisional
  planning assumption**, but NOT confirmation that the business's $45 charge
  is taxable in each service jurisdiction or that any particular lease-election
  path is currently authorized.
- Colorado DOR, adopted July 7, 2026, *Special Rule 46: Leases*:
  https://tax.colorado.gov/news-article/adopted-sales-tax-on-leases
  (consult official promulgated rule for actual effective date and changes).
- Colorado Legislature, HB25-1090:
  https://leg.colorado.gov/bills/hb25-1090
  addresses all-in mandatory price disclosures; taxes/government charges may
  be separately identified as the statute permits.
- Colorado DOR, retail delivery rate and exemption:
  https://tax.colorado.gov/retail-delivery-fee-rates
  https://tax.colorado.gov/special-topics-retail-delivery-fees
  official July 2026–June 2027 rate $0.31 where applicable, but small-business
  and exempt transactions must not be charged blindly. Home-rule city rules
  need their own confirmation.

The persisted **provisional setup-tax planning default is TAXABLE**, editable
by the owner independently from the CPA-confirmed treatment. It is never
authoritative in the charge-bearing send, tax snapshot or collection
authorization path. Regression tests must enforce that separation.

Use these sources for **synthetic preview defaults and configurable policies**,
not automatic business-use approval. CPA IN-79 remains unresolved. The
owner must be able to record a real adviser determination, dated evidence and
effective policy in Settings, see remaining jurisdiction/address gates, and
remove the affected restriction after *all* independent checks pass. Regulatory
text/rates can change; refresh authoritative sources on future policy updates.

## Professional-review restriction — business-use gate, NOT coding gate

**IN-79 CPA setup-fee taxability remains unresolved.** Build and test
editable owner policy, both synthetic taxable/non-taxable paths, UNDECIDED
fail-closed, historical terms/rate versioning and readable permission/status UI.
Do not permit real-customer charge-bearing agreement send, payable offer,
collection or the corresponding business transaction until reviewed tax
classification is explicitly configured/validated. Non-actionable internal
previews and isolated tests are eligible now. No owner override may silently
bypass the unapproved decision. Counsel/IN-07, public pricing/IN-48, Stripe
LIVE, money-out, customer email/SMS and money/spend approvals are independent
scope-specific gates. They must not prevent implementation or unrelated use.

## Build and integration contracts

- Reuse `getDraftSigningChargePreview`, the stored prepared signing snapshots,
  frozen offer/fingerprint tax evidence, settings form/action/audit and existing
  owner agreements page. **Do not build a second charges table or ledger.**
- Reconcile estimate and owner/customer read DTOs: existing line items versus
  mandatory location-level fees, deposit, rent, setup, down payment and tax.
  Unknown components must be explicit; never present only partial total as final.
- Carry waiver/override reason and responsible role through owner review to a
  durable, auditable signed/frozen amount. Update only future eligible drafts;
  retain historical evidence and effective dates for revised rules.
- For payment/retry, distinguish PENDING/FAILED/UNKNOWN/SUCCEEDED, read only
  provider-authoritative settlement, use idempotent attempts and existing locks.
  No premature paid state or automatic money-out.
- Preserve customer/tenant isolation, all amount identities, multi-location
  allocation and safe replay for signature, cancellation and delivery.

## Verification before declaring engineering complete

- Unit: tax unknown/taxable/exempt alternatives, no-publication behavior,
  per-location waiver/discount, large-account edge cases and all-in arithmetic.
- Disposable PostgreSQL: settings permission + audit + history, signed amounts,
  replay/race, tenant isolation, failed-payment To do/retry and correct first bill.
- Browser: owner draft/waiver/readiness, customer estimate/sign/account view,
  denied checkout or binding send before CPA decision, delivery Today/job path.
- Exact-head CI/review and card drift matrix; no unchecked active code path.
  Genuine Stripe TEST provider proof, CPA/counsel sign-off and authenticated
  production owner/customer acceptance remain distinct and queued, never faked.

## Handoff

Parent W-22 remains PARTIAL until engineering **and** genuine acceptance are
separately recorded. Use the parent card and STATUS acceptance queue rather than
inventing a stream of single-helper D19/D20 PRs. Once the remaining safe
engineering is complete, update the active packet to the next eligible W-23
workflow, but retain W-22's gated real-business acceptance explicitly.
