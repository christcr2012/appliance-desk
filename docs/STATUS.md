## W-22FIN owner mandatory-charge policy and preapproval readiness — implementation checkpoint

An owner-only dated, append-only and audited policy now records applicability
decisions for delivery, installation, removal, damage waiver and retail delivery.
It deliberately does not certify tax, legal terms, pricing publication or the
applicability of a given charge at a particular jurisdiction/address. The owner
estimate page now assembles verified line/address/package counts with setup and
first-month advance amounts, keeps deposits separate, and explicitly lists all
missing mandatory charges. It labels the subtotal **NOT all-in or payable** and
never authorizes customer approval, Stripe, signature or collection. Historical
signed prices and receipts remain unchanged. See W-22FIN active card and the
PR scorecard; new disposable DB/browser tests and exact-head CI are pre-merge gates.

**Outstanding engineering in W-22FIN (do not start W-23):** independently
verified preapproval all-in quote, immutable owner review, customer binding
acceptance and deposit checkout tied to exact reviewed obligation, full
multi-site cancellation/retry/first-invoice/delivery reconciliation. Recheck
only eligible real released acceptance at verified live revision; professional
IN-79/IN-07 and owner publication/money-out approvals remain separate.

## October 14 W-22FIN engineering continuation and acceptance handoff

Completed in session: PR #450 owner/customer exact settled signing amount
readback; #451 signed pending delivery vs real appointment; #452 verified
receipt gate on physical dispatch; #453 complete frozen per-location signing
order on customer/owner views; #454 fail-closed provider-uncertain retry and
owner issue guidance. PR #455 adds a converted estimate's same verified
all-location frozen offer with review-required for incomplete revisions.

**Unfinished engineering, same W-22FIN unit:** owner-prepared all-in offer
available to customer *before* estimate approval; itemize/include all
mandatory charge categories (including any refundable deposit, damage waiver
or retail delivery fee where legally applicable) in an owner-approved
effective-dated policy; link provisional estimate approval/early checkout
to that binding frozen amount rather than treating old monthly/one-time lines
as a payable complete offer; prove full multi-site reversal/recovery and
first-delivery invoice once all accepted facts reconcile. The converted
estimate readback is an integration improvement, not an excuse to move W-23.
Do not activate real tax-dependent pricing or Stripe LIVE without the
retained owner/CPA/counsel/professional gates. Do not make a production fixture
or send live customer messages for acceptance. The maintained
`release-acceptance` queue below governs future checked releases.

## W-22FIN converted preliminary estimate → verified frozen final readback

The original estimate link now explicitly separates provisional rental-line
figures from final location-level money. For a CONVERTED order, a complete
customer-owned frozen signing digest is required before displaying per-site
and combined setup, tax and down payment totals; missing/foreign sibling
agreements result in REVIEW_REQUIRED instead of a fictitious all-in offer.
Owner estimate view links to the same customer result. Existing draft
approval/deposit and standalone mandatory-other-charge policy remain
unfinished work within W-22FIN; no W-23 authorization or real business
activation is implied. CI, release and owner/provider acceptance remain
independent.

## W-22FIN signing payment recovery and verified retry guard

Owner/admin agreement and exception workspaces explicitly separate PENDING
provider results, uncertain remote outcomes, final FAILED attempts and
verified settled receipts. An attempt with a persisted SUCCEEDED state but no
reconciled signed receipt cannot silently create a second charge; DB status
constraints intentionally reject UNKNOWN, so unresolved remote outcomes
remain PENDING and require provider-authoritative reconciliation. The
server-side reservation rechecks the attempt state under the existing
obligation lock. A synthetic failed prior attempt may be retried with a
fresh idempotent key; owner confirmation of real offline funds remains
mandatory before recording a receipt. Exact-head CI and provider/customer
acceptance remain independently pending. W-22FIN remains active; no W-23.

## October 14 W-22FIN multi-address frozen offer visibility

Customer signing and owner agreement now read one independently verified
frozen customer-order digest, with separate current-address signing amount,
per-address fees/tax/down payment and order-wide reconciliation.
An incomplete/foreign source hides the public signing link instead of
showing partial totals. Existing prelaunch publication, provider charge,
professional approval and first-invoice gates remain unchanged. Exact-head
database/browser acceptance and genuine release/user acceptance are distinct.
W-22FIN remains unfinished until estimate approval and complete recovery
flow are integrated; W-23 remains blocked.

## W-22FIN delivery/payment reconciliation — dispatch guard

A signed physical delivery start now re-verifies the agreement's frozen
W-22 offer and exact owned signing receipt/zero-due evidence under an
agreement lock; an appointment booking remains separate. This prevents
pending, unknown and wrong-customer payments from authorizing dispatch.
Synthetic unit assertions and exact-head CI are required before merge;
genuine provider/customer acceptance and owner-controlled business use
remain separately pending. No status/Stripe LIVE/communications activation.

## W-22FIN next integration — genuine pending delivery visibility

The signed-delivery job already persisted by W-22D18 has `status=SCHEDULED`
with a null appointment time. Customer Rentals previously queried scheduled
times only, omitting that real unscheduled handoff. The following implementation
now includes the signed, same-customer delivery draft and distinguishes
"being arranged" from a confirmed visit. The established owner-only scheduling
To do and money readiness remain authoritative. Browser/DB, CI and external
acceptance remain distinct; this is no auto-booking or customer message.
W-22FIN remains IN_PROGRESS pending complete all-in quote/approval and
payment-to-delivery acceptance.

## October 14 checked production catch-up and W-22FIN continuation

Manual owner-approved release is independently verified: `main` and `live`
both `2f68599ac35d65e6c72e919475381483a7dca289` (#449), Vercel production deployment
`dpl_3QHctQyDoLX1a8gRFMg8isvbjEXR` READY at that source and assigned
`robinsonappliancerentals.com` plus `www` without alias error.
Exact-head GitHub CI, three unit shards, four browser shards and release-policy
were SUCCESS. This clears source/release ancestry for the existing queue, NOT
authenticated customer, live-provider or legal/CPA sign-off.

W-22FIN substantive source continuation now shares the existing customer-isolated,
receipt-validated signing-obligation readback between account Rentals and the owner
agreement view. Review-required status hides corrupt/unverified amounts, awaiting
and received stay distinct, and first-invoice credit is never assumed. The
existing source verification for the underlying DTO remains inherited; new UI
behavioral tests and exact-head Actions/merge are separately required. Multi-
location all-in estimate/approval gating and full payment-to-delivery integration
remain unfinished; do not advance W-23 or activate any real-business gate.

## October 14 completion recovery and checked release preparation

Owner requested complete Git reconciliation before a one-off manual release.
Consolidated duplicate completion rules while preserving owner-decision/regulatory
and activation gates; recovered unfinished customer signing-evidence DTO code with
invalid/foreign/ambiguous receipt denials and isolated integration coverage.
Repaired the capacity workflow Postgres image after verified ECR data-limit failure;
all performance thresholds and tests remain unchanged. Local six pure tests, lint,
index/housekeeping tests and full typecheck passed; no local PostgreSQL is installed,
so real DB/browser/build/performance proof is required in exact-head Actions.
W-22FIN remains the current parent outcome; never claim this is full completion.
No provider acceptance or business activation is implied by the authorized release.

## Owner direction — sequential batch completion, not recurring slice carryover

Current active work is W-22FIN. Finish its whole remaining **engineering**
and tests before beginning W-23. The agent must investigate and solve
technical blockers, directly ask the owner for missing owner decisions
and resume immediately after the reply. Do not silently defer source work
or use PR alignment as a reason to switch batches. Only exact
deployment/provider/professional **acceptance** may remain queued
with provenance and a specific re-entry trigger. Full rule in AGENTS.md.

## Permanent owner-question and regulatory-default workflow — 2026-10-14

Owner clarification: unresolved operational/business choices are interactive,
scoped questions. Ask in the active session after checking existing recorded
answers, then record the answer and resume; never strand an entire batch.
For laws, statutes, accounting and CPA/legal matters, agents research official
primary sources, guidance and future effective changes to build provisional,
owner-configurable, versioned defaults now. Explicit professional sign-off is
tracked separately and restricts only affected real business use. The affected
feature must explain its gate and give the owner an audited confirmation path.
AGENTS.md and SESSION-START.md hold the full permanent requirements.
This is a development procedure, not legal/tax approval or live authorization.

## W-22FIN checkpoint — recorded owner fee adjustment (2026-10-14)

Owner-only audited per-location signing fee adjustments, optional full waiver
and immutable signed-order guard are under active substantive implementation.
This is not the whole W-22FIN batch: all-in customer/owner estimate-through-
agreement presentation and payment failure follow-up still require engineering,
test evidence and merge. Actual CPA review, legally approved terms, Stripe TEST
and production release/acceptance remain separate scope-specific gates.

## W-22FIN progress — CPA-backed owner activation path under implementation (2026-10-14)\n\nThe next substantial W-22 implementation adds recorded adviser confirmation, effective date, owner attestation, and audited tax-policy revisions. It will deny unreviewed/legacy tax choices during both draft preparation and downstream tax review, preserving remaining per-jurisdiction rules and verified address obligations. This is SOURCE WORK ONLY until exact-head CI/review/merge, followed by checked release and independent real-provider acceptance. It does not approve CPA/legal treatment, customer charges, Stripe LIVE or public pricing. Remaining all-in customer quote and integrated delivery acceptance still belong to W-22FIN; the owner expects the whole engineering milestone, not small repeated handoffs.\n\n### Workflow maintenance handoff — owner publication approved

New offline session utility: eight behavioral tests passed, including actual Git ancestry, partial releases, unknown/failed deployments, rollback, dependency gating, invalid queues, PR alignment and bounded output. All repository queues validate. Existing source/status evidence is preserved; no provider acceptance or release was performed. Owner explicitly approved publication on October 14; publish the reviewed maintenance branch, require exact-head CI/reviews, and merge only when those gates pass. No extra production release is authorized by this approval. Full broad application suites on the shared runner were interrupted after resource/time-limit failures; do not claim them passed. Existing exact-head remote CI/review gates must pass before any main merge.

## Release acceptance queue — workflow optimization 2026-10-14

Owner-authorized guidance/tooling maintenance: consolidated session procedure, focused
checks between meaningful edits, substantial capability grouping, and read-only queued
acceptance/PR-boundary report. This records source/tooling work, not a live/provider pass.
The queue below seeds existing outstanding obligations; reconcile exact scenarios and
already-proven evidence from the unchanged cards/ledger before running. Keep all prior
open obligations, original fixture ownership, approvals and deployment provenance.

<!-- release-acceptance:start -->
```json
[
  {
    "id": "DESK-W22",
    "priority": 1,
    "requiredRevision": "d5b994dd11af641d8f4e437ee566cea345ab2129",
    "task": "Catch up deployed cancellation/signing/delivery checks and remaining genuine Stripe TEST acceptance",
    "procedure": "docs/STATUS.md",
    "gates": "W-22 remains partial; preserve W-23 sequencing, refunds/signatures, customer isolation and provider approval gates",
    "dependsOn": [],
    "status": "PENDING",
    "lastEvidence": "Release source 2f68599ac35d65e6c72e919475381483a7dca289 verified in READY Vercel deployment dpl_3QHctQyDoLX1a8gRFMg8isvbjEXR; source ancestry and exact-head CI now proven. Authenticated customer, Stripe TEST, carrier/provider or owner acceptance NOT executed or passed; production credentials/fixtures not used."
  },
  {
    "id": "DESK-COMMS",
    "priority": 2,
    "requiredRevision": "d5b994dd11af641d8f4e437ee566cea345ab2129",
    "task": "Reconcile deployed communications acceptance and execute only cleared checks",
    "procedure": "docs/runbooks/COMMUNICATIONS-ACCEPTANCE-LEDGER.md",
    "gates": "Existing SMS/customer email consent and activation gates; no sending or live activation implied",
    "dependsOn": [],
    "status": "PENDING",
    "lastEvidence": "Release source 2f68599ac35d65e6c72e919475381483a7dca289 verified in READY Vercel deployment dpl_3QHctQyDoLX1a8gRFMg8isvbjEXR; source ancestry and exact-head CI now proven. Authenticated customer, Stripe TEST, carrier/provider or owner acceptance NOT executed or passed; production credentials/fixtures not used."
  },
  {
    "id": "APPLIANCE-W22-PORTAL-RECEIPT",
    "priority": 3,
    "requiredRevision": "c0de6e7da0bacfbabc114547745b286c2f4d0188",
    "task": "Verify signed customer signing obligation/receipt DTO with own-account scope, corrupt/foreign receipt denials and no provisional or raw receipt evidence",
    "procedure": "docs/pr-cards/W-22FIN.md",
    "gates": "Existing authorized owner/customer test accounts only; no production fixture creation, customer charge, communication or policy activation",
    "dependsOn": [],
    "status": "PENDING",
    "lastEvidence": "Source commit c0de6e7 is included in deployed 2f68599ac35d65e6c72e919475381483a7dca289 / READY Vercel production; exact-head main CI unit+browser succeeded. Customer-scoped real production authenticated readback and corrupt/foreign denial probes remain unverified: do not run live fixtures without explicit approval."
  },
  {
    "id": "W22FIN-SIGNING-OWNER-CUSTOMER",
    "priority": 1,
    "requiredRevision": "d8aa536965d47d1694d455e67239b14cb5acc094",
    "task": "Authenticated existing customer and OWNER confirmation of same frozen signing amount in Rentals and Desk, correct pending/received states, invalid/foreign receipts denied, first-invoice credit not assumed",
    "procedure": "docs/pr-cards/W-22FIN.md",
    "gates": "No new live fixtures, payment, messaging, professional approval or provider activation",
    "dependsOn": [],
    "status": "PENDING",
    "lastEvidence": "PR #450 merged; full exact-head CI, isolated database and browser tests passed. Source not independently observed in live production; real authenticated acceptance unverified."
  },
  {
    "id": "W22FIN-SIGNED-DELIVERY-VISIT",
    "priority": 1,
    "requiredRevision": "9afff558ccf113fbb0441939f7016a1eb4caa9e5",
    "task": "Customer with signed unscheduled DELIVERY job sees being arranged, not booked; after owner schedules, actual date/time appears; no phantom appointment",
    "procedure": "docs/pr-cards/W-22FIN.md",
    "gates": "Read existing owner/customer records only; no production fixture, job mutation or customer notification without separate authorization",
    "dependsOn": [],
    "status": "PENDING",
    "lastEvidence": "PR #451 merged; exact-head full CI/disposable Postgres/browser acceptance passed. Released and real-user acceptance still pending."
  },
  {
    "id": "W22FIN-DISPATCH-RECEIPT",
    "priority": 1,
    "requiredRevision": "2350c63c599bcfddd79899d6c949a0960c2cddf6",
    "task": "After checked release, validate W-22 delivery start requires signed frozen proof and exact customer receipt or zero-due; pending/unknown/foreign funds do not authorize dispatch",
    "procedure": "docs/pr-cards/W-22FIN.md",
    "gates": "Never start a real production delivery for testing; no money-out or Stripe LIVE; existing approved TEST/customer acceptance only",
    "dependsOn": [],
    "status": "PENDING",
    "lastEvidence": "PR #452 proposed; pure payment-denial cases and genuine frozen order/sign/owner-receipt disposable-Postgres suite; exact-head CI and release/provider acceptance still pending."
  },
  {
    "id": "W22FIN-MULTI-ORDER-VIEW",
    "priority": 1,
    "requiredRevision": "08735efa56b6302d3ec818eea316e41394007199",
    "task": "After checked release, review an approved existing two-location customer signing link and owner desk, confirm one complete immutable frozen order, per-address and combined amounts, no second checkout/receipt and denial of missing/foreign scope.",
    "procedure": "docs/pr-cards/W-22FIN.md",
    "gates": "Read only, no live fixtures, payment, customer message or public pricing; professional and Stripe approvals remain independent",
    "dependsOn": [],
    "status": "PENDING",
    "lastEvidence": "PR #453 source implemented, new isolated browser and pure tests added; required CI/release/authenticated user acceptance not yet claimed."
  },
  {
    "id": "W22FIN-PAYMENT-RECOVERY",
    "priority": 1,
    "requiredRevision": "e776e4a3468a3cebda1e1be505606d69125f4567",
    "task": "After checked release, authenticated owner view shows clear response for PENDING/provider-uncertain/FAILED signing payment; no duplicate attempt under actual unconfirmed provider outcome; safely recover only after confirmed failure and legitimate receipt.",
    "procedure": "docs/pr-cards/W-22FIN.md",
    "gates": "No synthetic production charge/receipt/attempt mutation; read-only existing owner TEST evidence first; no autonomous money-out/Stripe LIVE/customer messages",
    "dependsOn": [],
    "status": "PENDING",
    "lastEvidence": "PR #454 source implemented against merged #453, with exact-head tests and CI still required before claiming engineering acceptance; production not deployed."
  },
  {
    "id": "W22FIN-FINAL-ESTIMATE-READBACK",
    "priority": 1,
    "requiredRevision": "42a8d744b80e939e5f69dee3cdcce5ddbfd30785",
    "task": "After checked release, open an approved existing converted multi-location estimate with owner and authorized customer link: show exact frozen charges for all locations or review-required when one location incomplete, without implied payment or sending",
    "procedure": "docs/pr-cards/W-22FIN.md",
    "gates": "Use existing safe read-only records, no live synthetic estimate/job/payment mutation, professional/Stripe/communication gates unchanged",
    "dependsOn": [],
    "status": "PENDING",
    "lastEvidence": "Source PR #455 implementation commit 42a8d744b80e939e5f69dee3cdcce5ddbfd30785 prepared; exact-head CI, checked production release, and authenticated real customer/provider acceptance remain unverified."
  }
]
```
<!-- release-acceptance:end -->

## October 14 recovery rerun owner authentication — follow-up

## W-22D18 — signed rental gets a real draft delivery job and owner To do

PR #441 (D17) merged with all exact-head checks; normal daily release
remains on `live` for production. D18 is scoped to Amendment B S6:
a non-renewal customer signature atomically persists one unassigned,
unscheduled DELIVERY job unless one already exists. The active agreement's
To do links the actual job until owner schedules delivery. This is
owner/admin finance-context work; staff and customers do not receive
the owner reminder. Signing remains different from receiving money:
verify the signing payment before dispatch, and do not auto-book or
notify the customer.

Disposable PostgreSQL signing/renewal and role/To do unit tests pass;
authenticated browser and exact-head Actions still need independent
evidence. Actual Stripe TEST and W-22 complete signing-through-delivery,
all-in quote/website acceptance, CPA IN-79, legal and LIVE remain open.
PR #438's concurrent source repair and verified October 14 READY deployment are preserved. Recovery additionally checks GITHUB_TRIGGERING_ACTOR and github.triggering_actor, so non-owner reruns of the owner's prior recovery cannot promote a newer day. Original and triggering actors must both be christcr2012, on main with explicit recovery input. Negative tests cover another/missing triggering actor. Exact-head CI and existing application/provider gates remain mandatory.

## Owner standing rule — complete configurable work despite professional review (2026-10-14)

The owner directed every subsequent session to **keep building approved
capabilities that depend on attorney/CPA/bookkeeper review** wherever safely
possible. The restriction applies to **conducting affected real business**
until review is approved, not developing/testing/merging the project; unrelated
business remains usable. Build changeable, validated, authorized, audited and where necessary
effective-dated settings plus end-to-end tests; preserve immutable signed and
billed evidence and fail closed at the exact unapproved customer charge,
binding term, filing or LIVE action. Never presume the answer or silently
activate on passing CI. See AGENTS.md, SESSION-START and OWNER-INPUTS.
W-22 IN-79 remains an explicit setup-tax **charge/send approval gate**, not
a reason to defer the surrounding all-in disclosures, owner policy configuration
or other implementation. Genuine legal/CPA/customer/Stripe TEST acceptance
remains separately OPEN. Next engineering priority remains cohesive W-22
completion, not further single-helper slices. No release authorized.

# STATUS — current work, blockers and next action

## October 14 release recovery — live verified, trigger repair pending PR #438

The scheduled 00:01 Denver event was absent on October 14. Owner-authorized
same-day recovery subsequently fast-forwarded main and live to the checked
`f4cd4ea1bc984b0bf01cecd0599cf13f4f6d5e20`. The dated
`live-promotion/2026-10-14` Git tag independently resolves to that SHA.
Vercel deployment `dpl_BBHMiZJUn9jEtTPwssR3g1yP9KbT` is READY
at the exact live commit, with the production aliases
`robinsonappliancerentals.com` and `www.robinsonappliancerentals.com`
assigned and no alias error. This is release/deployment evidence,
not authenticated Stripe/customer workflow acceptance.

PR #438 fixes the missed trigger with bounded Denver and UTC fallbacks,
owner-only manual recovery, and a checked no-op daily receipt to prevent
extra intraday promotions if the 00:01 run succeeded with no changes.
Existing exact-main ci and release-policy, atomic dated marker, ancestry
checks, production/spending gates and no-force rules remain mandatory.
W-22D17 manual/Stripe TEST refund evidence reconciliation remains
independent and has not moved any customer funds.

## W-22D17 external refund reconciliation (current implementation branch)

Based on the checked D16 cancellation and October 14 `f4cd4ea`
production release, the isolated branch `ai/gpt6/w22d17-refund-reconciliation`
adds owner-only recording of an **externally completed** refund. It rechecks
the original receipt and pending cancellation under database locks and
stores the unique return reference, method, actual event date and audit.
Manual check/bank/cash is labelled owner-attested; Stripe TEST requires a
read-only provider refund success matched to the original charge, USD
currency and approved cents, and is disabled for production/LIVE mode.
The pending Today item only disappears on a committed return record.
No money-out, messages, tax choice or production fixture was executed.

**Evidence:** five disposable PostgreSQL cases and three provider/policy unit
cases passed; browser/auth/accessibility, exact-head CI and real Stripe TEST
provider acceptance are separately pending. Work packet W-22D17 is active;
W-22 stays PARTIAL. The October 14 live release is proven at `f4cd4ea`.
The separate release reliability repair PR #438 merged to main; normal
daily checked live promotion applies to it, not immediate deployment.


## October 13 verified release and W-22D16 implementation (current)

**Observed current GitHub:** main and live are both `7e0d99fa8701d318421d95eb4cfed79c52d3cff5` (#436); no open PRs or issues and no unfinished remote implementation branches. The two `archive/` branches are intentional and must not be merged. The exact-head CI, release-policy and housekeeping workflow passed. **Observed Vercel production:** deployment `dpl_oGFdAyB13CjvKBdnTPMjQGh27wwH` is READY for exactly the same `live` SHA and assigned public aliases, without alias error. This confirms the October 13 one-time release outcome; normal reviewed daily releases resume. It does not prove authenticated app/Stripe acceptance.

**Current branch in this handoff:** `ai/gpt6/w22-pre-delivery-cancellation-20261013` from current main. Work packet W-22D16 implements **approved IN-76 pre-delivery owner cancellation and accountable refund-due workflow**, not a money-out transaction. Owner/admin reviews receipt, delivery, signed terms and pending charges, confirms full or eligible large-order retention, and the atomic agreement cancellation stores explicit refundable/retained cents with a permanent audit and high-priority refund To do. Settings define the 72-hour large-order full refund window. Undelivered unpaid agreements have zero refund. Existing signed obligations, invoice payments and deposits are not silently ignored. Generic cancellation may not release collected signing funds without the review. No Stripe refund, live payment, automatic communication, tax decision or production write is activated.

**Evidence so far (pre-PR; rerun at final head):** schema validates, 5 policy unit cases pass, 4 real disposable PostgreSQL integration tests pass, work packet selector/anchor check passes. Typegen succeeded; a 2GB-default-heap typecheck ran out of memory in local sandbox and a bounded heap retry is underway. Saved-session browser spec and full Actions validation still required. No merge or deployment of this feature claimed here.

**Next owner-gated acceptance:** independently verified external refunds, provider state after cancellation, legal review of signed cancellation terms, CPA IN-79 administrative-fee tax, and Stripe TEST real-provider acceptance remain separate. W-22 remains PARTIAL; W-23 sequencing gate remains. Next approved independent W-22 work is visible without requesting routine approvals already supplied.

---


## Invoice-list performance investigation — index correction (PR pending, 2026-10-13)

Post-#432 main `917b22c` is the verified baseline. Investigated the
independent #429 5,000-invoice performance failure (5.42ms against 5.304ms
guard) using disposable PostgreSQL and the actual count+page operation.
EXPLAIN found sequential scan and top-N sort over 5,002 rows because the
billing page orders by createdAt DESC and id DESC without a compound index.
One isolated same-fixture before/after probe measured 3.82 -> 1.63 ms/op
medians and EXPLAIN execution 1.551 -> 0.045ms with a disposable matching
index. Root cause is demonstrably missing sort support; variability across
runners still exists and is not explained away. The additive schema migration
and index-regression test are undergoing full local/Actions validation.
No threshold/fixture change, performance waiver, spending or deployment.

W-22D15 (#432) merged with exact-head PR CI/review after safe failure
deadlines and owner/manual evidence; provider Stripe TEST remains unverified.
Owner IN-75/76 now answered, but case-specific refund authorization, counsel
and implementation remain pending. Rental-only IN-84 answered and no
rent-to-own scope. CPA IN-79 OPEN, W-22 PARTIAL, W-23 blocked.
Next product unit: JIT W-22 cancellation and signing-through-delivery
completion after this independent measured performance repair.


## Historical W-22D15 — PR #432 merged (superseded recovery handoff)

Current upstream main `2ba7776b462436ecb2b35dcab35a26e4b5477257`
includes owner decisions #433/#434. The updated W-22D15 branch includes that
exact main through a normal merge, without rebase. The former ambiguous
Playwright alert selector and Codex finding (missing same-day failed-payment
deadline and failure timestamp) are fixed. Codex review thread is resolved
with exact-head test evidence. Workflow-dispatched CI run `38460370577` passed
all three unit shards, four browser shards, secret/static and aggregate gates
at `4b8b899`. However a GitHub Actions-bot branch synchronization caused
pull-request workflows to report `action_required`, so ruleset 24419414
still considered required PR-context `ci` missing and refused merge.
Historical resolution: a GitHub-App-authored PR sync established the
required exact-head pull_request CI run `38461068954`, which passed,
and PR #432 merged as main `917b22c` after all review threads were resolved.
No bypass, waiver or manual Vercel release was used.

W-22D15 owner To do shows one failed attempt with same-day deadline
based on persisted attempt update time, distinct from pending/ordinary
unsigned/uncaptured money. The owner agreement page shows failed
evidence and existing separately confirmed MANUAL money-in path.
Still no automatic provider retry, fabricated receipt, scheduled visit,
Stripe LIVE or refund. Actual provider TEST acceptance remains unverified.

Historical #429 independent benchmark red: 5,000-invoice 5.42ms against
the unchanged 5.304ms guard. A different isolated PostgreSQL run
measured 5.11ms (samples 5.11/4.76/5.86/4.82/5.79). At the time
these results suggested unexplained variation. **Superseded by
PERF-INV5000 / PR #435 above:** direct EXPLAIN and same-fixture
before/after measurement subsequently established the missing
createdAt/id sort index as a genuine query bottleneck, while
runner-to-runner latency variation still merits monitoring.
Do not waive, remove or rebaseline the regression guard.

Owner IN-75 relocation and IN-76 cancellation **answered** in #433:
$75 per relocation job requires case approval and no second $45 setup;
ordinary before-delivery refund is full regardless of scheduling;
commercial default full refund within 72 hours, then setup-fee
retention with returned down payment, subject to explicit owner review,
contract/counsel and independent money-out approval. These are NOT
implemented or authorized to pay out by this PR. Owner IN-84 in #434
confirms rental-only (no rent-to-own) and the disclosed editable
5-calendar-day grace / one $5 fee on day 6 per overdue installment;
actual activation remains gated on correct terms/legal review.

CPA IN-79 remains OPEN, W-22 PARTIAL, W-23 blocked.
Never auto-activate LIVE, messages, spending, refunds,
production data changes or Vercel release.

**2026-10-13 owner-policy reconciliation (documentation only):** Newly approved business choices are recorded in [OWNER-INPUTS](OWNER-INPUTS.md) and [the text/voice decision appendix](owner-decisions/2026-10-13-text-voice-reconciliation.md). The old IN-75/76 'recommendations only' language in historical handoffs is superseded by those *owner answers*, **not** by verified code. W-22 remains PARTIAL; CPA IN-79 OPEN; W-23 blocked; no provider/LIVE/money-out/publication gates waived.

## W-22D14 — new hookup proof per delivered appliance (PR #429 under verification)

New per-machine true/false/unknown hookup evidence, missing-item high-priority
follow-up, PARTIAL visit and unchanged delivered custody/billing are implemented.
A saved-session staff browser test exposed an actual server-page projection omission:
although `getDeskJobById` selected the persisted field, `page.tsx` dropped it
before `JobDetailPanel`. The page now forwards it to STAFF and owner; existing
browser regression asserts visible evidence before and after reload. Old records
remain NULL (unknown). Selected local database/related tests and quick checks
passed; the local Next.js browser build was killed (137) by this 4GB sandbox.
Exact-head GitHub CI/browser, performance and review are still required. The
branch merged current #431 fixture isolation and #430 official Postgres image,
keeping both other-agent changes and all existing tests. No automated review
was available due to Codex quota; manual disposition must be recorded.
W-22 PARTIAL, CPA IN-79 OPEN, IN-75/76 recommendations only, W-23 blocked.
No LIVE, money-out, customer communications, spending or manual release.

## Owner-requested release maintenance — shared fixture isolation (2026-10-13)

The six MCP production aliases reached READY at their checked release snapshots.
Appliance Desk release automation fixes #428 and registry recovery #430 are merged.
The owner explicitly requested a one-off manual release after checks; routine
agent development still merges main, and nightly checked main→live runs at
00:01 America/Denver. Provider LIVE, communications and spending gates remain.

Main run 38404970079 proved an intermittent W-22 signing failure: indirect callers
of seedTaxReadyContext were not in SHARED_SETTINGS_TESTS and could overwrite or
restore BusinessSettings.singleton while another fixture signed an agreement.
Ten existing helper callers now join the serial lane; the guard recognizes helper
calls even without an inline database-name marker. No application money/tax
semantics, assertions or suites are removed. Local source/config inventory and
secret checks pass; full exact-head Actions unit/browser and main checks remain
required before release. Active W-22D14 PR #429 is left to its existing agent.


## W-22D13 PR #427 — shared-settings CI recovery (2026-10-13)

Live GitHub PR #427 head `cbc96f7` passed all four saved-session browser
shards, static gates and policy checks; full CI failed in shard 1 on
`tax-migration-integration` because its assertion read the writable
`BusinessSettings.singleton` after unrelated serialized integration
fixtures exercised Colorado tax choices. The test now verifies the **actual
database column defaults** using a short-lived separately named settings row,
with `finally` cleanup and without changing business tax decisions or
resetting other tests' state. Its isolated disposable-PostgreSQL run passed.
Performance baselines independently failed before tests on a public ECR
PostgreSQL 17 image pull (`toomanyrequests`); use documented, authorized
retry/recovery, not test removal. Re-run full exact-head checks after the
single corrective commit; inspect/waive unavailable automated review only
with recorded manual-review disposition, then merge if all gates pass.

D13 implementation remains owner/admin-confirmed money-in evidence on one
signed agreement, not a Stripe charge or invoice-wide credit. W-22 PARTIAL,
CPA IN-79 OPEN, IN-75/76 recommended only, W-23 blocked. No money-out,
customer communications, LIVE Stripe or manual production release.

## W-22D13 — owner-recorded signing payment (2026-10-12/13; CI pending)

Verified predecessor #426 merged to main 9087bc2fb3ec40a176f821809551a9b9c17470c1.
Active JIT packet is W-22D13. The OWNER/ADMIN-only manual signing form
and server action record exactly the immutable reviewed signed amount after
explicit real-money confirmation. They reuse the MANUAL attempt and
actor/agreement locks, write one auditable MANUAL Receipt, and create a
down-payment entitlement only for the signed agreement. They do not
allocate to another property's invoice, mark invoice PAID or refund.
The initial genuinely frozen/signed five-machine $35 disposable PostgreSQL
test passes all four cases including concurrent replay/denied roles.
Selected typecheck, lint, static and source/disposable-Postgres checks
passed (21 selected tests). The local Next.js browser build OOM-killed at
exit 137 in the known 4-GB sandbox; browser did NOT run locally. Required
unmodified GitHub exact-head CI/browser and review remain pending; this
is not provider acceptance.

Next after D13: independently approved per-machine new-hookup and
downstream W-22 workflows; cancellation/refund policy IN-76 must be
reconciled before affected money-out; CPA IN-79 still OPEN.
W-22 PARTIAL, W-23 blocked, LIVE/communications/spend unchanged.

## W-22D12 first-invoice shared display (2026-10-12; external gates independent)

D12 extends the read-only invoice DTO with existing line kinds and clarifies
on the shared owner/customer/print document that verified first-month money
is **already deducted** as one invoice CREDIT. "Paid on this invoice" is
separate; existing tax, due, paid, balance, status and authorization remain
unchanged. Synthetic $60 rent + $4.80 tax - $60 signing credit gives $4.80
due and OPEN until actual independent invoice payment. Saved-session
owner/customer browser tests and unit/disposable-Postgres tests verify
print/mobile/dark/keyboard/axe, pending, replay, property isolation and
draft denial. Do not equate mock/provider-shape tests with real Stripe TEST
acceptance. Local selected typecheck/lint/static/DB/unit checks passed (38 selected tests),
but local Next.js production build was OOM-killed (137) in the 4-GB sandbox,
so local browser did NOT run. This is the repository's known anti-stall
resource limit, not a waived test. PR #426 exact head a247580
passed ALL GitHub CI and browser shards, capacity, security and release policy;
manual review disposition recorded because Codex review quota was exhausted.
#426 merged as main 9087bc2fb3ec40a176f821809551a9b9c17470c1.
No extra hosting spend was approved.

Next after D12: owner-recorded signing payment, then approved cancellation/
refund and per-machine hookup in prerequisite order. IN-75/76 remain
recommendations unless owner answers exist. W-22 PARTIAL, CPA IN-79 OPEN,
W-23 blocked. No LIVE Stripe, money-out, external communications or spend.

## Verified Next.js security patch follow-up (2026-10-12)

Runtime Next.js and matching eslint-config-next are pinned to 16.3.8, a patch
update from 16.3.6. Npm's actual advisory ranges all ended below 16.3.8; registry
metadata confirmed this exact release exists. No blanket npm audit fix or framework
major/minor migration. Existing signed/payment/owner/hosting contracts are unchanged.
This security follow-up inherits merged #424's execution toolkit and checked D12
packet; no new product scope or five-PR padding.

Local proof: real clean safe install, 58 tooling Node regressions, focused session/preview
tests, complete preflight/typecheck/lint, index/links and audit readback passed.
Next is absent from the actual post-patch npm audit. Exact-head CI/review/merge,
deployment and provider acceptance still require their own evidence. Next: finish exact-head regression/CI
and review, then resume W-22D12 with `npm run work -- start`. No LIVE activation.

A separate **development-tool** advisory affects braces <=3.0.3 through fast-glob /
micromatch / eslint-config-next. Registry version enumeration ends at 3.0.3; braces 3.0.4 lookup returns E404; npm's proposed eslint-config-next 14 downgrade
is not a compatible repair for Next 16. No untrusted user glob input was found in
this project's lint workflow. Keep this precise upstream follow-up visible; recheck
when a compatible patched braces release or reviewed parent dependency is available.
This does not block the verified Next patch or D12. No clean-audit claim.

## Current execution tooling and next capability (owner request 2026-10-12)

**Inspected prerequisite:** #423 merged; main `600f93ed`. Its exact-head CI,
performance and daily-release-policy runs passed. Recheck current GitHub/main,
concurrent work and reviews at session start. No real Stripe TEST acceptance claimed.

**MERGED #424** at main `059fa296c37f160163e6428c3ff6770f7ef3e790`; exact PR-head CI/release-policy passed; manual review disposition is on #424. #424 post-merge main CI run 38324577116 and release-policy run 38324577229 passed; recheck at future heads.

**Implemented:**
- `npm run work -- start` validates and prints the bounded active packet;
  `read <number>` prints bounded code/design context; `route <unit>` gives later
  scope anchors, never inferred dependency eligibility.
- `check`/CI reject stale existing references, unsafe paths/selectors and wrong
  parents. `plan` reports proposed test files; `verify` refuses missing tests and
  runs normal preflight; `probe` is only disposable-DB diagnosis.
- `doctor` diagnoses hook/lock/dependency setup without exposing credentials;
  `install` safely supplies synthetic localhost config to per-worktree npm ci/Prisma
  generation, avoiding the reproduced missing-DIRECT_URL startup failure;
  `drift` shows changed integration paths; `metrics` reports bounded local
  passed/failed/cached timings; `prompt` produces an unverified restart draft.
- Actual-content check fingerprints survive staging/commit of identical files;
  real changes, modes and merge conflicts invalidate evidence. Secret scans cover
  tracked/non-ignored new files before staging too, preserving the gate. All existing
  test/authorization/exact-head gates remain. No product financial code changed.
- Active W-22 card is short; historical implementation log preserved. Old
  ~800-line stop and manual preview/batch-release contradictions reconciled.
  Larger cohesive capabilities are permitted with explicit risk/validation.

**Local validation:** 58 Node regression tests pass; index validation preserves all
144 card groups/148 acceptance units and changed active links. Disposable-Git
cache comparison: three old keys versus one new key for stage/commit of identical
files. Secret scan and complete sandbox preflight (typecheck/lint/static checks) pass;
safe offline installer/generation and doctor were exercised in the real worktree.
The following quick gate reused all seven passing checks. #424 exact-head CI/release-policy and the documented manual review disposition passed before merge; these local figures do not claim a total project speedup.

**Next:** W-22D12 ([card](pr-cards/W-22D12.md)); run `npm run work -- start`.
Prove/repair exact signing credit, tax, actual paid amount and balance through
webhook mirror → scoped invoice DTO → shared owner/customer document/print.
Its new regression/browser files are **proposed**, not implemented. Then select
eligible manual settlement/cancellation/delivery remainder from W-22; retain
CPA IN-79, LIVE/money-out gates, real TEST evidence distinction and W-23 dependency.
This owner-authorized maintenance request is one cohesive PR, not a five-feature batch.

## W-22D11 exact first-invoice Stripe credit — MERGED #423; actual provider acceptance remains open

Approved goal: correctly deduct signing first-month rent from its **own**
subscription's first invoice, once, without billing a second agreement.
Merged #423 implements an immutable receipt/credit invoice application
journal, a negative agreement-tagged subscription first-invoice item,
readback against actual provider object IDs, UNKNOWN outcome recovery and
local webhook CREDIT mirroring. Disposable PostgreSQL/mocked-provider checks
are implementation evidence; authenticated real Stripe TEST acceptance has
**not** been observed. Neither success at subscription creation nor a credit
journal declares invoice **PAID**. The customer/owner invoice display must
still be audited end-to-end before this milestone closes.

**Blocker investigation and re-entry** (AGENTS scoped-blocker rule):
- CPA **IN-79**: external determination of Colorado taxable administrative
  setup fee; the prior decision is already recorded as OPEN in OWNER-INPUTS.
  Prerequisite: CPA-backed classification; re-open tax configuration/acceptance
  when the actual decision is recorded; next: ask CPA, never invent the rate.
- Real Stripe TEST application: no authenticated, verified TEST invoice
  integration evidence is available in this session. This blocks **provider
  acceptance**, not local implementation/testing or unrelated approved work.
  Re-check configured authorized TEST credentials/environment before acceptance,
  never use LIVE; next: run an isolated real TEST flow and reconcile provider
  invoice/negative line/receipt with PostgreSQL evidence when accessible.
- W-23 requires actual W-22 completion (including cancellation/refund and
  delivery); not eligible merely because this code/CI is green. Recheck
  once W-22 acceptance is complete. Continue the next approved independent
  W-22 cancellation/delivery work rather than stopping for CPA/TEST gates.

## Permanent milestone handoff and acceptance matrix (2026-10-12)

**Outcome:** Every eligible signed agreement can move through exact payment,
receipt, first invoice, and delivery without double charging or crediting a
sibling property's bill. This W-22 batch is an outcome boundary, not a quota.

| Capability / criterion | Code | Automated proof | Deployed / real integration acceptance | Next |
| --- | --- | --- | --- | --- |
| Frozen signed amount and TEST Stripe settlement | Implemented through #420 | Exact-head CI and disposable PostgreSQL; authenticated provider evidence path tested | LIVE disabled; no live end-to-end acceptance | Keep existing isolation and reconciliation |
| Receipt-bound per-agreement down-payment entitlement | Implemented in W-22D9 (#421) | Disposable PostgreSQL and exact-head #421 CI passed | Real acceptance not observed | Reuse in D12; do not rebuild entitlement |
| First delivery invoice credit exactly once (local and Stripe) | #423 merged exact provider application/mirror; #422 barrier retained | #423 exact-head CI, performance and daily-release-policy passed; disposable DB/mocked-provider tests | No authenticated TEST provider acceptance; LIVE off | D12 owner/customer invoice amounts and integrated proof; real TEST readback when available |
| Cancellation, refunds, and per-machine hookup/delivery acceptance | NOT complete | NOT proven end-to-end | NOT accepted | Follow the approved W-22 dependency chain after credit accounting |

**Deferred-blocker register:** IN-79 requires CPA-backed Colorado setup-fee
classification (dependent on approved W-22 tax category); reopened only after
the CPA determination is recorded in `docs/OWNER-INPUTS.md`, tax configuration
and behavior verified. Next: ask CPA the existing IN-79 question, not owner to
repeat an answer. W-23 depends on W-22 actual completion and acceptance;
reopen only after W-22 criteria are genuinely met. Stripe LIVE and money-out
remain subject to their separate existing explicit owner approvals; next:
TEST-only accounting, no activation/spend. W-24 customer delivery-date choices
have their own separate work index dependency; do not silently pull them into
W-22. Recheck this register at session start and after owner input, PR merge
or hosted integration change. Existing hosting-cost policies remain in force.

## W-22D10 first-invoice double-charge barrier (MERGED #422)

Recurring Stripe subscription setup now checks the W-22 signed payment and
receipt-backed credit before any provider claim or product/subscription call.
A positive down payment (unpaid, inconsistent, or already collected) blocks
a new first rent invoice until its exact agreement-specific Stripe invoice
application is implemented and reconciled. The existing billing-blocked To do
shows an actionable agreement link and the reason. Historical/waived/no-credit
agreements keep their existing path. Even an already-recorded subscription is
flagged for owner reconciliation instead of being called safe. No new payment,
credit application, delivery permission, owner approval or LIVE activation.
Next: W-22D11 negative first-invoice item on the *matching* subscription,
durable local allocation, real Stripe readback/retry, and portal amounts.
IN-79 OPEN, W-22 PARTIAL, W-23 blocked.

## W-22D9 settled down-payment entitlement (PR #421)

The Stripe TEST receipt now creates one immutable per-agreement down-payment entitlement with exact frozen amount, fingerprint and receipt; PostgreSQL rejects altered and foreign allocations. This is NOT an applied invoice credit. Next: invoice-specific application and provider readback, then cancellation, refund and delivery. CPA IN-79 OPEN; W-22 PARTIAL; W-23 blocked.

## W-22D8 verified Stripe TEST signing receipt settlement (PR #420)

Authenticated Stripe TEST signing checkout events now reconcile the immutable
accepted agreement/attempt with the payment intent's succeeded status, exact
USD cents, metadata and unique charge. Under the established short locked
webhook transaction the provider charge creates one durable customer receipt,
marks the attempt SUCCEEDED and the obligation SETTLED; event replays never
double-record cash. Unpaid Checkout completion is not settlement, failed
asynchronous attempts can be retried, and duplicate/altered/live evidence is
rejected. Production activation remains blocked. **The collected first-month
down payment is recorded but is NOT yet credited against an invoice.**
Next W-22: per-agreement, replay-safe first-invoice credit/application,
cancellation/refund decisions and per-machine delivery acceptance. CPA IN-79
OPEN; W-22 PARTIAL, W-23 blocked. Hosting controls remain in
docs/HOSTING-COST-POLICY.md and the merged .github policies.


## October 12 hosting-cost handoff integrated into W-22D7 (#418)

Latest main includes the owner-directed daily checked main-to-live workflow
(#417) and verified Neon 0.25 CU/300-second idle policy (#419).
The consolidated `docs/HOSTING-COST-POLICY.md` links the authoritative
merged policies and forbids automatic previews, manual promotions, unapproved
resource increases and Stripe LIVE activation. The requested separate hosting
handoff branch was not present in the appliance-desk remote at verification;
this integration uses the merged policies and explicit owner instructions.


## W-22D7 TEST signing Checkout (PR #418)

The signed, frozen per-agreement amount can now be used to create an idempotent
Stripe TEST hosted Checkout session. The provider ID is stored against the
durable attempt after its cents, currency, fingerprint and agreement ID are
verified; repeat calls retrieve it instead of opening another session. An
unknown old attempt and non-test/production configuration fail closed. Checkout
completion is **not** payment settlement; no invoice credit or paid status
is set. The existing webhook now explicitly rejects W-22-tagged Checkout events
rather than misclassifying them as legacy deposit payments. The service is not
exposed through a public route while CPA IN-79 and
owner LIVE approval remain open. Next: authenticated webhook verification and
durable receipt settlement, then first-invoice credit. W-23 stays blocked.

## W-22D6 durable collection attempt reservation (PR #416)

A transaction now rechecks signed immutable W-22 evidence against its stored unpaid obligation
before reserving a uniquely keyed checkout/manual collection attempt. Concurrent/replayed requests return
the same still-active attempt, unauthorized manual methods are blocked, and DB constraints reject
invalid methods, totals or statuses. This is **not** Stripe collection or proof of payment.
Existing receipts, invoices and paid-state remain unchanged. Next: provider checkout integration
with hard CPA IN-79 activation gate, then verified settlement and replay-safe first-bill credit.
W-22 remains PARTIAL; IN-79 OPEN; W-23 blocked.

## W-22D5 outstanding signing payment To do (PR #415)

Finance-authorized OWNER/ADMIN users now see positive, still-unpaid frozen
signing obligations in the `/desk/today` To do list, with exact amount,
customer, signed time and an agreement-specific review action. The bounded
oldest-first query reports truncation; STAFF sees no financial information.
Waived zero-fee agreements and any future settled records are not presented
as unpaid. These are manual follow-ups, **not recorded receipts**: no Stripe
checkout, payment settlement or first-bill credit is enabled. W-22 remains
PARTIAL, CPA IN-79 OPEN, W-23 blocked.


## W-22D4 atomic signed payment obligation (PR #414)

The same locked database transaction that signs a reviewed, frozen W-22
agreement now records exactly one immutable, per-agreement payment
**obligation** with complete fee, setup tax, down-payment and total cents.
Duplicate/replayed signature and failed obligation insert roll back; a DB
constraint refuses false paid statuses or unreconciled money. This is
not a charge, receipt, down-payment credit or permission to schedule delivery.
W-22 remains PARTIAL, CPA IN-79 OPEN and W-23 blocked. Next: owner To do
for payment owed, followed by separately reviewed Stripe/manual settlement,
replay-safe first bill credit, refunds and per-machine hookup proof.


## W-22D3 pending signing payment message (PR #413)

After signing the frozen reviewed offer, the customer now gets an exact
**still to pay** amount or a human-review warning; signing alone is not a
receipt. The old Checkout is not called for any W-22 evidence, while legacy
no-W-22 signing and renewals preserve their existing paths. The owner must
still arrange a payment; no W-22 Stripe/manual provider collection or first
invoice credit is implemented by this slice. Anti-stall runbook records the
October 12 PR #412 waiting-for-merge/sandbox expiration incident and a
required two-lane handoff checkpoint. W-22 remains PARTIAL; IN-79 OPEN,
W-23 blocked. Next: version-scoped signing payment and replay-safe settlement.


## W-22D2 verified signed payment readiness (PR #412)

After W-22D1 #411 merged, a read-only, repeatable-read payment gate now
requires an actually signed ACTIVE agreement, the full independently verified
frozen sibling order, and the exact accepted agreement-specific signature
proof. Legacy deposit/waiver or prepaid state blocks collection preparation,
as do mismatched order cents/hash; no invoice, provider or receipt is written.
This is a prerequisite, **not checkout or payment settlement**. Next: durable
provider request and replay-safe W-22 payment records, then first bill credits,
refund/cancellation and delivery evidence. CPA IN-79 OPEN, W-22 PARTIAL, W-23 blocked.


## W-22D1 frozen-payment safety (PR #411)

Signed W-22 fee/tax/down-payment evidence now has a provider-independent,
per-agreement payment-line planner. Legacy deposit/waiver Checkout refuses
new or incomplete W-22 evidence before Stripe, rather than charging an
amount different from the accepted offer. Historical no-W-22 Checkout remains.
This is **not payment integration or settlement**: next W-22D2 must build
the recoverable Stripe/manual path, proof-bound webhook and first-bill credit.
IN-79 OPEN; no live money or CPA treatment enabled. W-22 PARTIAL, W-23 blocked.

## W-22C6C signed document proof (PR #410)

The signed artifact now retains reviewed all-in setup/tax/down-payment cents
and frozen SHA-256 provenance in the immutable contract payload and HTML.
It rejects conflicting stored signature evidence and never implies payment
settlement. W-22 remains PARTIAL; IN-79 CPA decision OPEN, W-23 blocked.
Next: approved W-22 payment settlement, first-invoice credit, exceptions,
cancellation/refunds and delivery proof in card order.


## W-22C6B guarded frozen send/sign (candidate PR #409)

A server-side link now binds the customer-visible tax-inclusive signing
amount to the independently frozen per-agreement order fingerprint. A
missing or mismatched snapshot denies send/sign. The public signing page
shows exactly that address's setup, tax and down-payment evidence and does
not claim payment. This remains unmerged pending full CI/review. W-22 PARTIAL;
CPA gate IN-79 OPEN, W-23 blocked.


## W-22C6A — frozen evidence integrity readback (#408)

The server-only readback verifies all per-agreement cents, customer ownership/address and the canonical tax/jurisdiction fingerprint. JSONB key order is normalized. It cannot send, sign or collect. W-22 PARTIAL, CPA IN-79 OPEN, W-23 blocked; next W-22C6B guarded send/sign and customer totals.


## W-22C5 reviewed frozen charge evidence (merged #407)

The private owner-only freeze now stores each prepared agreement's immutable, versioned, tax-inclusive signing evidence and independent jurisdiction proof. It does not send, sign or collect; the subsequent units are W-22C6A integrity readback and W-22C6B guarded send/sign/customer presentation. IN-79 CPA gate remains OPEN and W-23 blocked. See W-22 card and independent test evidence.


## October 11 development-infrastructure upgrade (DEV-EFF-406; merged #406)

The separate diagnostic disposable-Postgres probe selects literal DB test specs without expensive import-graph expansion. Existing mandatory preflight, exact-head CI and provider/owner gates remain unchanged. Sandbox stale tracking-ref diagnosis added to recovery guidance. W-22C5 subsequently merged in #407, with saved readback verification in #408; see docs/pr-cards/DEV-EFF-406.md. IN-79 remains OPEN and W-23 blocked.


Updated 2026-10-11 as if PR #402 (W-22C1) merged, following main `1d18648` (#401). COM-L15 #393, W-1 #394,
W-18 #395 and W-22A #396 are merged. W-22 remains partial; no live payments,
customer messages, fee charging or tax filing are activated.

## Metricool marketing integration (owner-requested, 2026-10-09)
MKT-1 public visit tracking is merged in #371; exact-head CI and performance checks passed. Both automated review findings were fixed and regression-tested. Released from live 193b3f7 on 2026-10-09; Vercel production is READY. Actual-domain homepage and launch page serve the configured tracker; login CSP excludes it. Metricool receipt verification remains an open operational check.
Production METRICOOL_TRACKING_HASH controls activation; private routes and data excluded.
The changed privacy disclosure has a new version and retains the owner's existing
review/approval workflow. No approval is recorded automatically.
This independent marketing request does not reorder the COM/W engineering queue.

## Public pricing visibility (owner-requested, 2026-10-09)
MKT-2 merged in #374 and was deployed after exact-head green CI on main dfd0718 to Vercel production READY (dpl_fjKRCAM258aiNSbnByTHGfHnCSZk). Verified live robinsonappliancerentals.com/pricing and /rent/greeley both 307 redirect to /launch; /launch is 200, sitemap/homepage hide pricing. Internal pricing remains intact. The pinned engineering queue is unchanged.

## Business email guide (owner-requested, 2026-10-09)
`docs/EMAIL-AND-ALIASES.md` records every business email address, what it is for, where the app uses it and the
Gmail send-as/label setup. Google Workspace was inspected: all six plan addresses plus `dmarc@` already existed. On
the owner's approval two aliases were added, `privacy@` and `accounts@`, each with a Gmail label and filter (read back
and verified; reversal is in the guide). Open: putting `privacy@` on the website privacy page (needs its own card), IN-02 (public and reply-to email), the DMARC tightening dates
(2026-10-24 quarantine, 2026-11-23 reject) and the GW-08 mail test. No email, SMS or payment switch was touched.
Docs-only change; the engineering queue is unchanged.

## Implementation guidance — documentation update, 2026-10-11

[Implementation recipes](implementation-contracts/IMPLEMENTATION-RECIPES.md) add a
bounded card packet, trusted input/storage mappings, lock/provider/receipt patterns,
fixtures and targeted checks. The linked W-22 persistence example separates existing
code from candidate interfaces; it does not approve a schema, collect money or mark
W-22 complete. Startup and card-writing instructions route agents to only the needed
section. Queue, owner gates, public pricing hide and CI policy remain unchanged.
No application code or tests changed. Verified index, quick gate, diff/path/link
checks; exact-head CI and PR review remain publication gates.

## W-22B0 — private signing-charge draft preview (#398)

The owner/admin agreement detail now previews an order-wide, source-derived
setup-fee and large-order down payment before tax. Conversion siblings share
one fee per location; washer/dryer packages count each machine, and prepaid
rent/active locations avoid repeat charges. The preview is informational,
not an invoice, hosted checkout amount, signed snapshot or customer promise.
Tests: `tests/signing-charge-preview-w22.test.ts`; exact-head CI must be
green before this entry can be considered merged. The #397 recipes were
already incorporated. **Next: W-22B charge/credit persistence**, followed
by W-22C checkout/signing, webhook replay and operational/browser evidence;
IN-79 remains an explicit CPA taxability gate. Do not begin W-23 yet.

## W-22B — versioned signing charge snapshots (#399)

The private billing domain now stores a separate, versioned, idempotent,
per-agreement signing-fee/down-payment allocation from the real saved order
and settings. Same-quote addresses reconcile to one setup fee each, while
each agreement keeps its own initial bill credit amount. The per-agreement
records are **only draft preparation evidence**, not customer-payable lines,
settlement, a frozen signed document or a refund. `frozenAt` protects against
repricing once a successor actually freezes charges. Integration tests use
disposable Postgres and confirm replay, concurrent writers, access, revision,
immutable freeze and multiple delivery addresses; the new model is registered
in backups. Exact-head green CI is still required to merge #399.

**Next: W-22C freeze/tax/signing integration**, then hosted/manual payments,
webhook replay, first-bill credit, cancellation and delivery evidence. CPA
IN-79 remains pending; never activate live money or customer messages.
W-22 and its queue index remain PARTIAL; W-23 cannot begin.

## W-22B1 — owner draft signing-charge preparation and review (#400)

Draft agreement owners/admins can now prepare or refresh private per-agreement
signing-charge allocations on the agreement page, then see each address's
machine count, setup fee, first-month down payment, pre-tax subtotal and
revision in dollars. Every server action reauthorizes before the database
write; the read additionally checks role, customer, quote and draft state.
Missing sibling records are not misleadingly displayed as a complete order.
All prepared amounts are expressly **not signed, payable or settled**.
Eight unit/role/isolation tests pass locally; browser, CI and review remain
exact-head merge gates. No Stripe, customer email/SMS, live payment or CPA
tax treatment was activated.

W-22 remains PARTIAL. **Next: W-22C freeze tax-inclusive agreement/signing
facts**, then guarded hosted/manual payment, replay-safe first bill credits,
refund/cancellation and delivery evidence. W-23 stays blocked until W-22
fully meets its approved acceptance. Stop this chat after merged PR #400.

## W-22C0 — prepared-charge reconciliation (PR #401)

The owner draft-review page checks that one prepared order has all its
agreement allocations, one fee per new location, consistent revisions,
reconciled cents and correct down-payment attribution. A visible warning
separates this private draft from a frozen, tax-inclusive customer contract.
A configured tax treatment does not clear CPA gate IN-79. The agreement send
path is not yet integrated with these checks; do not infer it is protected.
No live collection, customer communication, signatures, invoice credits,
refunds or deliveries were changed. W-22 stays PARTIAL, and W-23 stays blocked.
Next: W-22C signed immutable tax-inclusive facts + guarded send.

## W-22C1 — independent administrative setup tax category (#402)

W-22's administrative setup fee now has its own database tax charge category
and invoice-line kind. Existing rental, installation and other tax decisions
never answer this new category. The new default jurisdiction rule is
UNDECIDED. CPA IN-79 remains OPEN; this is only taxonomy/policy scaffolding,
not a signed all-in total or permission to collect a fee. No provider or
customer billing changes. Next: W-22C reviewed immutable all-in signing
facts and send enforcement; W-23 remains blocked.

## Next

### W-1 owner To do workflow — merged #394

W-1 adds one clear action per exception, genuine Denver-time deadlines, exact outstanding balances, and a private durable owner/admin snooze with reason and audit history. Staff cannot snooze. Snoozed issues remain visible in a separate section and return automatically after the date. An additive Postgres table is included in the backup registry. Focused pure and disposable Postgres regressions are under tests/todo-w1*. No live payment, tax filing, customer messaging or other activation. The next planned card is W-18. Merged #394; W-18 followed in #395.

### W-18 money and explanation kit — merged #395

W-18 gives owner screens precise two-decimal dollar amounts, an exact dollar-entry parser, and an accessible glossary InfoTip. Sales-tax and use-tax setup now ask for dollars, never raw pennies; existing cent-based storage, audit and tax rules are unchanged. Repair, set pricing, fee and purchase-cost displays use shared helpers. Unit and UI tests and a repo preflight guard protect the wording and conversions. No provider activation, migration, or spending. Next: W-22 signing charges.

### W-22A signing-charge foundation — merged #396

The first W-22 slice records $45-per-new-delivery-location setup and five-machine/business down-payment settings; an owner-only settings screen with exact dollar entry, independently verified actor, audited updates and stale-edit protection; and a tested per-location integer-cent charge planner. Tax treatment remains UNDECIDED until CPA confirmation. No Stripe charge, payment credit, signing snapshot or live collection has been enabled. **W-22 is not complete.** Next W-22B/C must persist charge/credit lines, implement hosted/manual signing payments, webhook replay, cancellation, delivery evidence, all-in quote/contract/customer totals and browser acceptance before W-23. See docs/pr-cards/W-22.md for boundaries.

### Current queue (read this first)

- **Latest in chain:** W-22C1 (#402) merged after W-22C0 (#401) and W-22B1 (#400) merged after W-22B (#399) and W-22B0 (#398) after COM-L15 #393, W-1 #394 and W-18 #395. No open PRs before #398; recheck before implementation. The earlier COM-L15 pause checkpoint was passed by the subsequent merged work.
- **Current queue:** W-22 (B/C completion) → W-23 → W-24 → W-25 → W-26 → W-14 → W-2 → W-15 → W-3 → W-4 → W-5 → W-6 → W-7 → W-8 → W-9
  → W-10 → W-19 → W-17 → W-20 → V → F-part-2. W-11/W-12/W-13 when their outside gates clear (IN-61, IN-62/IN-44, IN-64).
  Authority: `designs/BATCH-W-AMENDMENT-B.md` section 8 and `pr-cards/work-index.json`.
- **Already done out of order (do not redo):** W-16A/B (sets are rental packages of separate machines; "Rent as"; old
  one-record sets split) and W-21A/B (out-of-service credits; a set machine the customer is done with → single price).
  Later cards build on them — see their entries in `designs/CHANGES-SINCE-DESIGN.md` (W-18 converts their screens to
  the ⓘ/dollars kit; W-14 records a set bought together as two machines; W-19/W-20 show their credits).
- **Testing:** real-database tests that write the business-settings row or create filing accounts must be listed in
  `SHARED_SETTINGS_TESTS` (`vitest.config.mts`) — `tests/shared-state-tests-listed.test.ts` enforces it (#367). CI pulls
  Postgres from `public.ecr.aws/docker/library/postgres:17` (Docker Hub's anonymous limit broke CI on 2026-10-09).
- **Owner decisions open:** IN-72 (new: prepay discount after a set becomes single machines — a safe default is built;
  confirm or change), IN-71 (record retention, CPA), IN-61, IN-62, IN-63, IN-64, IN-65, IN-44.

### Recent merges (newest first)

**2026-10-10 — COM-L15 communications launch evidence (recorded as if merged; still needs exact-head CI):** Added read-only, non-sending isolated PostgreSQL master-gate/delivery-evidence and assigned-job privacy regression, plus OWNER/STAFF mobile browser acceptance for setup/inbox/reports; corrected the prior Twilio runbook and published a plain-English owner launch guide and truthful acceptance ledger. IN-03/09/51/52/53, carrier A2P/voice checks, legal disclosures, media approval, K posting and F-part-2 go-live remain explicitly PENDING. No number purchase, live provider send, voicemail enablement, automatic cost alerts or new production credentials. Owner-requested pause is now before W-1.



**2026-10-10 — COM-L14B context evidence (recorded as if merged; exact-head CI required):** Job, maintenance and invoice pages show bounded, status-labelled evidence only for explicitly linked communications, never contact-number inference. Owners/admins can link a verified customer-thread message to a work record of the *same* customer from the private inbox; link + audit record are transactional and idempotent. STAFF only sees no-content delivery-status facts on jobs assigned to them; no private inbox, cross-customer data, finance, or company messages. Mobile and PostgreSQL isolation tests included. No provider send, dispatch change or migration. Next COM-L15.



**2026-10-10 — COM-L14A customer/lead communication timelines (as if merged, subject to full CI):** Existing OWNER/ADMIN customer notes/activity timeline now adds confirmed FK-linked SMS and call outcomes with one 25-row stable time/source/id cursor, separate source limits and communications filter. Lead contact history presents internal notes and verified linked communications together with cursor pagination, private inbox drill links, accepted-versus-delivered distinction and no phone-number-only identity linking or decrypted message content. No provider send/activation, schema migration or new billed action. COM-L14B follows.



**2026-10-10 — COM-L13B evidence-labelled Reports + To do/S (recorded as if merged, subject to CI):** Private Reports shows separate GMT provider total, previous-period observations, resource/attributed vs unallocated costs, verified statement evidence, reconciliation residual, source freshness and inactive budget preview. All five telecom metric definitions have explicit date/source/basis/drill. Existing S sweep produces PII-free typed HIGH issues for stale previously-working provider sync, comparable mismatched verified statements, unresolved inbox threads and missed calls lacking a thread; existing To do surfaces them with private resolving links and clears on documented recovery. No customer message or provider mutation, notification dispatch, paid Expense or budget activation. IN-53 remains pending. Next COM-L14A.



**2026-10-10 — COM-L13A owner telecom setup (as if merged; exact-head CI gate):** Private Settings > Phone, texts and provider costs workspace now distinguishes recorded provider/number readiness, off-by-default owner budget proposals, existing versioned SMS templates and private statement drafts from verified evidence. Owner PDF upload accepts a bounded private 4 MB PDF, captures hash, records an audit, and requires a separate owner confirmation plus verified stored bytes before marking the statement VERIFIED; only OWNER/ADMIN may download it. Owner-only policy update uses versioned strict communications policy, bootstraps defaults only from a recorded primary number, and cannot activate SMS/voice/provider calls, automated alerts, payments or K expense posting. Isolated DB evidence covers permissions, tampering, revisions and unchanged paid state. Local browser preflight build was blocked by an external node_modules symlink; security review fixes include 2FA enforcement, signed credits, read-only capabilities, and DB-first private-file reservation invalid for Turbopack; GitHub exact-head browser CI is mandatory.



**2026-10-09 — COM-L12 spend and budget evaluation (as if merged; exact-head CI gate):** Pure provider GMT-period totals, separate resource costs/estimates/verified statements, signed credit handling, non-overlapping daily fallback, explicit unknown/incomplete components, and owner ANY/ALL discrepancy tolerances are added. Account-scoped read service enforces OWNER/ADMIN, rejects ambiguous invoice evidence, returns stale cursor details and never treats provider telemetry as paid Expense. Optional policy budget rules are validated, suggested $50/$75/$100 starts OFF; preview evaluator cannot dispatch alerts or disable communications even if configured. No migration, SMS/voice activation, provider payment, side-effecting cron or live budget alert. COM-L13A is next; IN-53 remains outside activation.



**2026-10-09 — COM-L11 read-only telecom sync (recorded as if merged, pending PR gate):**
An account-pinned, GET-only Twilio adapter reads bounded GMT Usage pages, Message and Call charges, US messaging rates and owned-number capabilities using existing production-only account credentials. The matching durable cursor is claimed before a page, but the network request runs outside its DB transaction; validated snapshots, matched/unallocated costs and the next cursor commit together. A failed page preserves prior checkpoints, and source revisions keep old evidence. Account-level total usage is not added to resource costs or called an invoiced/paid expense. Missing prices stay unknown; readiness never approves A2P or turns on customer communications. No new schema, routes, paid lookups, SMS/voice, provider writes or financial posting. Next COM-L12: compare evidence, detect anomalies and show uncertainties under IN-53's separate activation gate.



**2026-10-09 — COM-L10 cost evidence schema (as-if merged; exact-head gate):** Added five account-scoped Postgres records for Twilio sync cursors, usage snapshots, signed component costs, provider rates and private verified statements. Provider raw prices/usage preserve Decimal(24,10) with one cents-rounding boundary, distinct estimate/provider/statement basis and no unknown-as-zero. Cross-account FKs, revision links, claim/window/statement invariants and acyclic backup restore checks are enforced. No provider API calls, telecom send, bill, payments, journal, public pricing or owner activation. COM-L11 is next for read-only retrieval and paging; IN-51/52/53 remain separate.



**2026-10-09 — COM-L9 merged (#375, conditional on exact-head CI):** The private Communications desk now lists missed calls/unknown outcomes, call legs and guarded voicemail playback. Two separately approved switches plus a version-matched owner policy gate the intentional-only recording; ordinary call recording/transcription remain OFF. Signed callbacks import bounded provider audio from pinned Twilio credentials to the existing private Blob store, prove availability only after storage, preserve replay and retry failures. Owner/admin can review, staff only assigned threads; no public media. Voice activation, IN-52 voicemail/privacy/retention approval, external provider fallback and deletion proof remain outside engineering. Disposable Postgres, unit, accessibility and full PR CI are merge gates. Next: COM-L10.


**2026-10-09 — COM-L8 merged (#370, pending exact-head GitHub CI before merge):** Twilio voice endpoints are signed against the approved HTTPS origin, account and owned number. Calls use owner-approved Denver business hours and an approved phone destination only after voice policy activation (still OFF); a private press-1 step and durable parent/child callback ledger prevent carrier voicemail or duplicate events from being recorded as staff answering. Call decline, conflicts and missing staff answer are kept as missed/unknown evidence. No ordinary call recording, voicemail, live sending, spending or provider settings change. Tested using disposable PostgreSQL and the COM-L8 regression suite. Next COM-L9: gated voicemail/private media and missed-call inbox.


**2026-10-09 — test isolation (#367):** tests that write records existing once for the whole database run one at a time;
the health sweep counts only issues it actually recorded; CI uses the ECR Public copy of the Postgres image. No test was
skipped or weakened.

**2026-10-09 — COM-L6B authorized communications inbox (#364):**
The private Owner Desk → Communications workflow now provides bounded
SMS thread lists and drillthrough, unread per staff user, assignment,
workflow status, and version-conflict protection. Every handler checks
an active team account; staff can access only assigned threads. Ambiguous
numbers never expose a guessed customer's account or lead linkage; message
text is decrypted only for authorized thread detail. Audit history records
assignments/status without message content. All customer texts remain off,
including the held-for-review day-of reminders. Card: docs/pr-cards/COM-L6B.md.
**Next: COM-L7** private call/voicemail schema after exact-head merge.

**2026-10-09 — W-21B merged (#366), Claude's lane:** when the customer is done with one machine of a set, the owner
records it on the repair screen: the rest go to single prices (keeping the agreement's term discount, IN-72), the
already-billed part of the month is credited, and Stripe's monthly item changes from the next period.

**2026-10-09 — COM-L6A template preview and reminder safety cutover:**
Approved SMS templates now validate variables, render immutable encrypted text
and count GSM-7/UCS-2 segments correctly at preparation and final dispatch.
Owner Settings → Notifications previews template samples, conservative Unicode
lengths and explicitly unknown costs. The old day-of reminder cron can no longer
send via the legacy path bypassing COM-L5B consent. It counts held-for-review
jobs without marking them texted. Automated sending still needs the COM-L6B
authorized recipient/job workflow and separate owner activation.
**Next: COM-L6B**, authorized inbox and user read cursors. No live sending.
Card: docs/pr-cards/COM-L6A.md.

**2026-10-09 — COM-L5B complete (merged by the COM-L5B PR after exact-head CI):**
Signed STOP/START/HELP events now produce private, replay-safe scoped consent evidence even
while the inbound inbox is disabled. STOP blocks ordinary SMS to an address (including
unresolved/shared numbers); START is only provider re-enable evidence, never marketing
or broad transactional consent. Portal opt-in writes a versioned exact transactional
disclosure and sender/phone scope; an old phone is revoked when changed. Marketing and
customer messaging remain off. Tested on isolated disposable PostgreSQL, no migration.
Card: `docs/pr-cards/COM-L5B.md`. **Next: COM-L6A**, validated templates, segment preview,
and migration of existing reminders. Public lead disclosure text/form choices remain
explicit follow-up work, not implied by COM-L5B.

**2026-10-09 — W-21A merged (#365), Claude's lane:** a machine taken for repair with no replacement (a swap with no
new machine delivered, or a pickup of some machines while others stay) now starts an out-of-service period; when a
machine is back the customer is credited exactly the days without it on the next bill (any line, set or single).
To do "Return or replace…" (urgent after 3 days, owner setting), a screen with the three ways forward, and a portal
note. (W-21B followed as #366.)

**2026-10-09 — W-16A (#360) and W-16B (#362) merged, built by Claude beside Sol's chain (Chris: "you take W-16A/B and
W-21"):** a washer and dryer set is a **rental package** of separate machines. Sets are managed in Settings → Products
and pricing → Sets and packages and shown on the website and quote form. Agreements and quotes can now rent a set ("Rent
as"), with the server checking one machine per part. Old one-record sets show on To do as "Split … into separate
machines", with a guided screen that keeps history, the rental and exact cost/tax totals. (W-21 followed as #365/#366.)

**2026-10-09 — W-0C MERGED (#359), exact-head CI required before merge:**
After latest `main` c712834 (which includes #356, #357 and the completed in-flight #358),
failed automatic charges on recorded invoices now become DELINQUENT without reopening PAID
or VOID invoices, and an idempotently claimed event records its failed attempt. To do shows
DELINQUENT (with or without due date), PARTIALLY_PAID and overdue OPEN; its button goes
straight to the invoice with the unpaid dollars. No late-fee change; no live payments,
customer SMS/email, provider spending, or tax filing activated. Card: `docs/pr-cards/W-0C.md`.
**Batch W Amendment B approved (IN-69), set/repair credits D-WB8 / W-21; IN-71**
settled for launch at seven-year owner-configurable record retention, with CPA review still
outstanding. W-0C resolves the original payment failure defect and does not implement W-21.

**2026-10-09 — COM-L4B PR #354 MERGED (80ac467):** exact-head required CI passed and performance baseline passed after one retry. Account-scoped default-off Twilio dispatch, last-minute consent/STOP checks, durable single-attempt claim, and fail-safe UNKNOWN recovery remain off in production. No sending, provider spending or phone activation authorized.

**2026-10-09 — COM-L4A merged (#353), following COM-L3 #352:** strict owner-controlled default-off SMS policy, evidence-based consent, canonical STOP suppression, private encrypted and idempotently prepared message intents. **Next: COM-L4B**, claimed delivery and last-minute sender/consent/readiness verification, then L5 inbound consent/reconciliation. No live sending, phone activation, billing or provider spending.

**2026-10-09 — Batch W Amendment A (tax filing on autopilot) added:** W-9 filing autopilot, W-10 use-tax "File now" + filled DR 0252, W-11 live GIS rates (waits on IN-61, may run early once done), W-12 XML return file (waits on IN-62, IN-44). Nothing ever submits or pays on Chris's behalf (D-WA2, IN-63). **D-WA6:** W-2 now also gives every seller-tax answer one dated next step (`nextPurchaseTaxStep`); W-13 receipt reading waits on IN-64; out-of-state seller tax waits on the CPA (IN-65).

**COM-L2 merged (#346, 2026-10-09):** the additive telecom account, number, contact-point/binding and send-attempt schema passed exact-head CI and disposable PostgreSQL backup/restore validation. COM-L3 extends its account and delivery lineage. SMS and provider spending remain off.

**2026-10-09 — test interference fixed (#367):** tests that write the one business-settings row or filing accounts now
run one at a time (guarded by `tests/shared-state-tests-listed.test.ts`), and the health sweep counts only issues it
actually recorded. The chance failures in tax and health-sweep tests are gone (two full local runs clean).

**Recovered unfinished work (2026-10-09, read before starting anything):** found uncommitted in the Vercel Sandbox
`appliance-desk-s1c-oct8` and committed there (not on GitHub; the sandbox clone originally lacked push credentials; this is resolved as of 2026-10-09):
- `/vercel/appliance-desk`, branch `recovery/t7d-leftovers-2026-10-09`, commit `691a02f` — edits to the tax overview
  (`workspace-overview.ts`, `sales-tax/page.tsx`, its test, T-7D card, contract log) left after #328 merged. Compare with
  `main`; keep only what main lacks, as part of W-3 (taxes in one place) — or discard if superseded.
  The main sandbox checkout is on that recovery branch: `git checkout main && git pull` before new work.
- **Test race fixed in #337:** `tests/system-issue-sweep-integration.test.ts` no longer compares global table counts; it
  records the sweep's own writes (only `systemIssue` allowed). If a similar global-count assertion fails by chance
  elsewhere, fix it the same way.

**Order:** see "Current queue" above. Keep owner/legal/CPA and live payment gates. [MASTER-ROADMAP](MASTER-ROADMAP.md) is
the single handoff; [PLAN](PLAN.md) owns acceptance; implementing sessions start at [SESSION-START](SESSION-START.md).

## Built

A/B/C/R/B2/D/E/E2, F-part-1, G, T (engineering) and S are merged; COM-L1A … COM-L6A, W-0A/W-0B/W-0C, W-16A/W-16B and W-21A/W-21B are merged. Existing operations, financial evidence, renewals, custody, parts, messaging, backups and security must not be rebuilt. E2’s public visual result was rejected as final quality; V remains. Website content controls and owner workspace additions remain designed future work.

## Remaining stages

| Stage | State |
|---|---|
| T completion | Engineering complete through #328; owner/CPA/provider/go-live gates remain |
| S | **Complete** (#330–#334) |
| COM-L6B…L15 → W-1…W-20 (W-16A/B, W-21 done) → V → F-part-2 | Approved remaining launch engineering and final product proof |
| K → M → O → COM-N | Approved later engineering; K/M after launch unless owner reschedules |
| BP | Proposed business documents/design; runtime acceptance still required |
| O32/O29/direct QBO/P/COM-A | Explicitly deferred or owner-selected prerequisites |

## Gates and limitations

- Stripe test; live customer email/SMS off. Owner approvals still govern activation, provider purchases and production writes.
- CPA/attorney/GIS, COM setup/consent/retention, V visual approval and final launch inputs remain in OWNER-INPUTS/GO-LIVE-CHECKLIST.
- Official-page fetchability does not prove a tax answer. Preserve source failures and the manual path.
- Historical audits remain final-review inputs under F2-D; this cleanup is not a full security certification.
- See **Environment** below for local database testing.

History and prior acceptance: [retired working snapshot](archive/reset-2026-10-08/README.md). Do not use its old unchecked boxes as the current queue.

## Environment (update when it changes)

- **Current release/cost policy (2026-10-12):** automatic previews disabled; scheduled daily checked main→live only
  (`daily-live.yml`), no manual batch/weekly release; sandbox sessions remain bounded; heavy
  checks run in free GitHub Actions. The sandbox push key **does** carry over to new sessions (verified: session started
  15:49 UTC after the old one expired had both injection rules).

- **Vercel build costs (2026-10-09):** builds now skip when only docs/tests/CI files changed, on PRs too, and
  transfer branches never build. IN-67 done: the ruleset no longer requires a "Preview" deployment (only `ci`), so skipped previews never block merges.

- **Sandbox GitHub push:** Installed 2026-10-09 by the owner through network header injection, never stored in the repository or sandbox environment; expires 2027-10-09 (one year). Dry-run verified; regular git push now works using HTTP/1.1. Use the fallback runbook if needed.
  **Check (2026-10-09, Claude):** the key was attached to the running session only — the sandbox's saved settings had no
  injection rule, so it disappears when that session ends. Whoever holds the key applies the same `networkPolicy` with
  `update_sandbox` (saved settings) so every future session keeps it.
- **Sandbox browser:** Chromium and its system libraries installed in `appliance-desk-s1c-oct8` on 2026-10-09 (a real
  launch verified). If a later session reports "No matching installed Chromium": `npm run sandbox:browser` once.

- **Local database testing:** Vercel Sandbox, project `appliance-desk`. Persistent sandbox in use:
  **`appliance-desk-s1c-oct8`** (most recently active, 2026-10-09; main checkout `/vercel/appliance-desk`, per-card
  worktrees beside it, PostgreSQL 18). Older persistent `appliance-desk-batch-t1` may have an expired snapshot. Resume,
  don't recreate — steps in PLAYBOOK 4b. Stop the session when done.

Older entries (October 8 cleanup, K-CASH design note, publication-check note, S-2, COM-L1A and COM-L1B evidence) moved to
[archive/STATUS-LOG.md](archive/STATUS-LOG.md) on 2026-10-09.

## W-22C2 private tax evidence and anti-stall guidance (#403)

W-22C2 adds a pure, non-collecting setup-tax candidate calculation using
jurisdiction-confirmed ADMINISTRATIVE_SETUP treatment. It never freezes a
contract, sends a payment or issues a first-invoice credit. The anti-stall
runbook now documents bounded isolated Postgres tests, exact-head CI and
manual review fallback. **Next: W-22C3 immutable agreement totals and guarded
send/sign**, followed by W-22 payment/credit/cancellation/delivery. IN-79
remains open; W-23 is still blocked.

## W-22C3 — private order-wide tax review (#404)

OWNER/ADMIN can inspect a per-agreement setup-tax candidate based solely on
stored draft records and confirmed category-specific jurisdiction evidence.
No posted or signed total, provider payment, credit or customer communication
is created. Tax uncertainty remains visible and blocked from being described
as payable. W-22 and IN-79 remain open; next W-22C4 contract draft/freeze
foundation, then server send/sign, collection and delivery. W-23 blocked.

## W-22C4 — canonical private all-in order candidate (#405)

The owner desk now assembles a single private draft across every related
agreement and delivery property. It reconciles setup fees, first-month
prepayments, separately validated setup tax and jurisdiction evidence.
A stable draft fingerprint detects changes. Neither the calculated totals
nor the owner display constitute a customer contract, a charge, signed
payment evidence or approval to collect; all such paths remain disabled.
**Next: W-22C5 reviewed immutable per-agreement tax-inclusive freeze and
server send/sign gates**, followed by W-22 checkout/manual payment, credit,
refund/cancellation and delivery acceptance. IN-79 open; W-23 blocked.
