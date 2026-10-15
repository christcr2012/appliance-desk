## October 15 already-started bundle scope reconciliation

Concurrent main #468 (`ad0d628f`) introduced pre-code bundle-plan accounting
while this same PR's implementation was already assembled at `d2535c06`.
Merge checkpoint `205c35b7513f0661e375db061867eec396eba8c3` preserves that guidance.
No retrospective pre-code plan or checker certificate is fabricated. The original
five subsection IDs and every acceptance criterion remain in the existing packet;
this reconciliation does not shrink that scope or count completed main behavior.

Measured NEW production diff against actual main `ad0d628f`: **1308 added / 54
removed lines in 42 source/migration files**, excluding tests/docs/formatting.
Even the resumed work after draft `26c4759` adds **610 / removes 47 production
lines in 29 files**: exact-order received-advice gate, full quote/reserve adoption,
independent source reconstruction, receipt-backed cancellation return, current
unsigned policy/tax checks, audited reopening and restore source dependencies.
The original draft and resumed work are contributions to this same unmerged
bundle; neither is a second completed bundle. Earlier merged helper work is not
included in that measurement or recounted by the completion scorecard.

Current remaining plan at `205c35b7`: resolve the documentation-only concurrent
main conflicts, retain new accounting/session checks, run mandatory pre-push,
then execute all required exact-head normal CI/browser/upgrade/review/merge gates.
No additional missing production path is identified, so the honest additional
production estimate is zero; tests and CI waiting do not create new workload.
If a gate reveals a source defect, record its concrete remaining engineering in
this card before the correction. W-23 stays excluded until this original complete
outcome merges; it is a separate customer/location outcome, not padding.

## PR #466 assembled V2 implementation — verification in progress

Resumed existing draft, merged current main `d6cc8b5b`, and retained all original
W-22FIN subsection IDs. New source connects the V2 frozen order to exact-order
owner CPA/counsel clearance, quote/approval/adoption, signature/obligation SQL,
receipt-backed reserve, cancellation/confirmed return, dispatch, first invoice,
portal and signed document readback. No production activation or genuine external
acceptance is asserted. Earlier draft checkpoints are superseded by this section.

| Existing subsection | Assembled implementation and finite proof |
|---|---|
| W-22FIN-POLICY | Owner-only immutable exact-order clearance; missing/stale/future/foreign denial; independent setup-tax policy; date-effective revocation, active actor, audit and backup |
| W-22FIN-QUOTE | Versioned category/tax/reserve sources; stable nested JSONB digest; per-address 28631/16975 and combined 45606; complete owner/customer/document DTOs |
| W-22FIN-APPROVAL | Same reviewed identity at send/accept/convert/sign/collection; stale acceptance denied; prepared conversion reuses original agreements; standalone estimate reserve checkout cannot double collect |
| W-22FIN-RECOVERY | Exact receipt/attempt replay; reserve created once on settlement, included once in cancellation return; generic deposit refund cannot double return; uncertainty retains original recovery rules |
| W-22FIN-DELIVERY | Signed/paid dispatch guard supports V2; actual completion establishes delivery; first invoice uses only own settled rent advance once; other location remains undelivered/uncredited |

Focused disposable Postgres has passed the connected synthetic flow, including
actual completeJob and provider-contract-shaped simulated first invoice. This is
source verification, not genuine Stripe/provider acceptance. Required broad
preflight, exact-head CI, browser regression and review disposition still govern
merge and bundle counting. Preserve IN-79, IN-07, IN-48, money-out, communication,
Stripe LIVE and checked scheduled release gates. Active unit remains W-22FIN
until all required engineering gates pass; no partial helper counts as a bundle.

# W-22FIN — Complete configurable signing-to-delivery business workflow

**Scope:** W-22 parent card / approved Amendment B §6.2. This packet resumes
**after merged W-22D18 (#442)**. Existing signature, refundable-payment evidence,
first-invoice credit, no-time delivery draft and owner To do remain inherited
contracts, not work to repeat. Inspected source main `905a0fb8` (PR #464). Reconcile later merges before editing.

## Current engineering state — PR #466

The five original subsections and their proof are listed above. The integration
contract records the original source gaps at baseline #464; its consumer map
remains the review checklist, not a new list of unfinished helpers. The assembled
PR addresses each mapped seam. Exact-head CI, browser and review disposition
still determine merge; only then count this as one complete W-22FIN engineering
bundle. W-23 is the next eligible roadmap outcome after that merge, with the
existing W-22 external acceptance retained separately in STATUS.

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
