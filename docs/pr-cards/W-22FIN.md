# W-22FIN — Complete configurable signing-to-delivery business workflow

**Scope:** W-22 parent card / approved Amendment B §6.2. This packet resumes
**after merged W-22D18 (#442)**. Existing signature, refundable-payment evidence,
first-invoice credit, no-time delivery draft and owner To do remain inherited
contracts, not work to repeat. Inspected source main `905a0fb8` (PR #464). Reconcile later merges before editing.

## Current engineering state and next action — owner review, October 15

Read [the integration contract](../implementation-contracts/W-22FIN-INTEGRATION.md)
§0 and §2A first. This card is the current direction; archived session reports
are historical evidence. Existing packet IDs and original acceptance stay binding.

Verified main `905a0fb8`: #459 prepared agreements/exact reviewed adoption,
#462 cancellation/collection serialization, #463 signed cancellation policy,
and #464 owner reserve/service/RDF review are merged. Do not repeat them.
None connects nonzero mandatory categories through the frozen payment envelope.

| Existing subsection | Current source evidence | Remaining engineering to finish |
|---|---|---|
| W-22FIN-POLICY | Audited settings, owner reserve/service revisions and scoped private tax/RDF assessment | Consume those revisions in complete signed evidence; prove future edits preserve signed facts |
| W-22FIN-QUOTE | Prepared agreements and V1 setup/advance readback; unsupported-category denial | Complete versioned evidence for nonzero service/tax/RDF/waiver/reserve, then same owner/customer projection |
| W-22FIN-APPROVAL | Viewed-fingerprint and atomic prepared adoption guards | Same complete evidence at all send/approve/convert/sign/checkout boundaries; first-invoice allocation proof |
| W-22FIN-RECOVERY | Pending/failed retry, serialized cancellation and signed-size/window safeguards | Reconcile added categories and partial locations through settlement/cancellation without duplicate liability/refund |
| W-22FIN-DELIVERY | Unscheduled job, payment dispatch guard and existing rent-advance credit | Version-compatible dispatch and connected multi-location delivery/first invoice proof |

**Immediate implementation:** replace the V1-only category bottleneck through
all its consumers using integration §2A. Begin with the existing 45606-cent
nonzero fixture as a failing regression and connect it through stored quote,
frozen signing, obligation, checkout/settlement, cancellation and first invoice.
Do not substitute another warning screen, readiness flag, isolated calculator,
re-audit, policy form or zero-only happy path for that integration.

Keep these five existing rows as the remaining-work boundary. A merge changes a
row only with its original complete acceptance evidence; do not append a fresh
list of renamed subtasks after each PR. Concrete risk repairs remain valid, but
return directly to this integration afterward. Once all five rows and the
complete browser/DB flow pass required review/CI, record W-22FIN engineering
complete and advance to W-23; external acceptance remains separately queued.
No additional design-approval round or artificial PR/line cap is introduced.

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

## Existing policy authority

Reuse the October 13 owner engineering contract and October 15 research linked
from the integration contract. They already define owner choices and scoped
professional gates. The [historical card](../archive/implementation-history/W-22FIN-through-464.md)
preserves earlier regulatory/source observations; do not repeat that research
unless an actual new policy question or changed source affects implementation.

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
