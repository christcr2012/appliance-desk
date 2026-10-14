## Permanent PR #455 handoff

Work finished in this session's #450–#455 integration PRs is listed in
`docs/STATUS.md`. Reconcile actual main and live on the next run; live still
tracked at the earlier #449 release at the last independent observation.
Read and execute the release-acceptance JSON queue only where its required
revision is included in a checked READY deployment and permitted live owner
TEST/read-only evidence exists; don't promote synthetic CI to external proof.
Continue **W-22FIN**, not W-23: the remaining cohesive engineering is the
pre-approval all-in quote/mandatory charges and enforceable estimate-to-
frozen-order acceptance and payment/first invoice sequence. Record exact
pass/fail and owner/professional limitations without fabricating approval.
Historical handoff: #455 was the last merge of that session; current workload
targets and session procedures are governed by AGENTS.md and SESSION-START.md.

## Converted estimate → verified reviewed signing offer — W-22FIN

Original public estimate URL now retains historical preliminary rental-only
figures but clearly labels their exclusions. Once the customer's estimate is
CONVERTED and **every** linked agreement has independently verified frozen
tax-inclusive signing evidence, that same public URL shows a complete,
customer-isolated per-location and combined offer (no estimate-local guessed
fees). Until all sources agree, a review-required status replaces the finalized
offer; no partial total is exposed as final. Owner estimate detail links to the
same customer-facing readback. Shared frozen-order component distinguishes
estimate context from actually signing one address; no signature, outbound
message, Stripe attempt, provider fee, first-invoice credit or public product
pricing is created. The existing isolated two-location browser fixture
checks owner, signed order and converted estimate. This is not yet
pre-approval all-in acceptance; remaining workflow continues under W-22FIN.

## Payment UNKNOWN/FAILED recovery — scoped W-22FIN continuation

OWNER/ADMIN agreement view now distinguishes a verified receipt, failure,
provider PENDING/uncertain-remote-result/SUCCEEDED-without-local-receipt, unmatched prior
attempt, and no attempt. Provider-uncertain states cannot offer manual
collection or create a second attempt; `prepareSigningPaymentAttempt` also
refuses any anomalous SUCCEEDED-without-receipt under its obligation lock; the
DB rejects UNKNOWN as a stored attempt state, while remote UNKNOWN must stay
PENDING until authoritative resolution (not just UI wording).
A final FAILED attempt may be retried under a new durable identity only after
provider confirmation; a verified full offline receipt needs explicit owner
attestation. Owner Today/exception view shows urgent uncertain results and
points to the specific agreement without exposing provider secrets.
Pure policy tests and isolated PostgreSQL UNKNOWN denial/final-failure replay
are required. No provider API, LIVE charge, refund, new customer message or
first-invoice credit is inferred. Full W-22FIN quote integration remains.

## Verified cross-location customer and owner offer readback — PR #453

Both signing URL and owner agreement view now share one verified, customer-
scoped frozen-order readback. It reconciles per-location setup, setup tax,
down payment and tax-inclusive amount against the complete order and marks
the current agreement. This does not sign other properties, demand another
payment, infer an invoice credit, change historical terms or publish prices.
If any address is foreign/missing or any sibling frozen digest disagrees,
the signing URL fails closed; owner view displays a review warning.
Three-width/axe disposable-browser coverage proves the same data in public
signing and authenticated owner views. This is eligible W-22FIN engineering,
not the full remaining all-in estimate/approval milestone; real-identity and
provider acceptance stay release-gated.

## Delivery dispatch must reverify signed money — W-22FIN

Starting a DELIVERY/INSTALLATION job linked to a W-22 prepared agreement
now rechecks its accepted immutable fingerprint, matching payment evidence
and its **same-customer, exact-amount received** receipt (or a genuine signed
zero-due obligation) inside the job-status transaction under the agreement
lock. Any missing/foreign/partial/ambiguous/pending payment denies physical
dispatch with an actionable owner message; booking a date remains possible.
Legacy rentals with no W-22 prep retain their prior operation. Pure
denial/identity/zero tests and a full isolated Postgres
freeze → sign → owner-receipt → dispatch integration suite
are required at exact-head CI; production/provider confirmation stays in
the acceptance queue. This is one safety-critical part of unfinished
W-22FIN, not W-22 engineering completion.

## Signed-delivery scheduling status readback — W-22FIN continuation

A signed, unscheduled DELIVERY job belongs to the same customer-scoped rental
read model as its genuine booked visits. The account Rentals page now
states explicitly that an unscheduled delivery is **being arranged, not booked**;
when the owner records an actual future appointment it displays that time
instead. Unsigned draft delivery jobs remain hidden while real scheduled
visits retain visibility. Owner To do still owns scheduling and payment checks;
no customer self-booking, notification, or provider side effect. The
disposable-Postgres/browser test checks the unscheduled-to-booked transition.
This closes another readback step, not the all-in estimate/approval completion.

## Signing-obligation owner/customer readback continuation — October 14

From source `2f68599ac35d65e6c72e919475381483a7dca289`, both customer Rentals and owner agreement review
consume `customerSigningSummary` and render the same authorized,
customer-isolated amount/status breakdown. Both withhold all amounts on
REVIEW_REQUIRED; only an exact-customer, exact-value, valid-date settled
receipt is labelled received. Signing receipt does not prove the first
invoice credit. The new UI pure and route tests are pre-merge checks;
production authenticated customer/Stripe TEST readback remains queued.
This closes a readback seam, **not** the entire W-22FIN outcome. The
current owner/customer all-in quote + enforceable approval/payment-to-delivery
workflow remains the current unfinished work before W-23.

# W-22FIN — Complete configurable signing-to-delivery business workflow

## Recovered portal engineering — October 14

Recovered the unfinished customer signing DTO branch into the current portal query,
with immutable obligation amounts, explicit awaiting/received/not-due/review states,
same-customer exact-amount dated receipt checks and no raw receipt/customer IDs.
Invalid or unsigned amounts stay absent; a signature never proves payment or invoice
credit. Six pure regressions and a customer-isolated real-Postgres DTO regression
cover the recovered integration. Local pure tests, targeted lint and full typecheck
passed with a 4 GiB typecheck heap. This runner has no local PostgreSQL; required CI
provides that execution, not a fabricated local pass. This recovers branch work,
not the remaining customer all-in UI or the entire W-22FIN outcome. No business-use
policy, Stripe LIVE, customer communication or production fixture is activated.



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
