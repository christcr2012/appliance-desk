# W-22FIN — Complete configurable signing-to-delivery business workflow

**Scope:** W-22 parent card / approved Amendment B §6.2. This packet resumes
**after merged W-22D18 (#442)**. Existing signature, refundable-payment evidence,
first-invoice credit, no-time delivery draft and owner To do remain inherited
contracts, not work to repeat. Inspected baseline main
`64f000b3374621f0644d11b8b34b8bb0f1fd0d4b`.

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
