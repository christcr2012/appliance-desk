# October 13 owner answers — engineering and acceptance contract

**Authority:** [October 13 text/voice reconciliation](../owner-decisions/2026-10-13-text-voice-reconciliation.md), [OWNER-INPUTS](../OWNER-INPUTS.md), later dated [DECISIONS](../DECISIONS.md), and [56-subject routing map](../owner-decisions/2026-10-13-implementation-map.json). This is **implementation design**, not implementation or legal/CPA/provider acceptance. Names below describe contract boundaries, not pre-approved new tables. Check current main and reuse already implemented facilities before making migrations.

## 1. Source reconciliation and sequencing — binding on implementing agents

- There are 56 **subject-level coverage entries** in five categories, not 56 unbuilt features or owner questions. The reconciliation updated 23 numbered IN register rows because many subjects share IDs. Never re-ask an answered decision because an older line said OPEN.
- The currently active implementation is **W-22FIN**. Integrate already-built W-21 partial-return and prepaid-set behavior where needed inside the current W-22 acceptance chain rather than restarting W-21 as a parallel roadmap batch. Then W-23, W-24, W-25 and W-26 in their **existing approved order**; later approved W, K and postlaunch units follow the existing work-index. Do not advance an unfinished engineering batch to hit a PR multiple.
- **Later, more specific owner decision controls:** the October 13 reconciliation says a late grace period was not captured from its earlier conversation excerpt. The later October 13 DECISIONS entry and OWNER-INPUTS IN-84 expressly approve **five calendar days and one $5 flat late fee on day six**, configurable. That is an owner policy, not a legal conclusion or approval to charge current customers automatically.
- Engineering can build provisional, editable, tested policies without professional sign-off. **Affected real business use remains OFF** until the OWNER records adviser evidence, approval scope, effective date and reference in an audited owner UI; revocation and future revisions must be possible. Existing public price, Stripe LIVE, money-out, paid providers, outbound SMS/email, recorded media, tenant purge and marketing gates remain separate. No full release/professional confirmation is claimed here.
- **Proposed scope remains proposed.** The mapped K-CASH and BP items need their preexisting design/rollout approvals. This packet does not make them eligible early. Map target IDs are future homes, not permission to jump sequence.
- Acceptance hierarchy: approved contract → coded feature → exact-head CI/isolated Postgres → checked live deployment → real provider/owner/professional acceptance. Never substitute one for the next.

## 2. W-22FIN — unified money, pricing, setup, return and reserve contracts

Read and reconcile the existing signing-charge calculator, prepared/frozen signing evidence, agreement send/sign, pre-delivery cancellation, Stripe TEST/receipt/first-invoice credit and customer estimate/account pages, as well as W-21 single-machine return pricing. Concrete current seams include **src/domains/billing/signing-charges.ts**, **signing-charge-snapshot.ts**, **src/domains/agreements/index.ts**, **pre-delivery-cancellation.ts** and the estimate, owner agreement and account routes. Preserve all merged correctness work.

### Mandatory all-in quote and separate money categories

The customer and OWNER must review the **same source-fingerprinted offer**, by service location and machine: normal machine rent, separate visible pair discount, effective term/prepay discount, mandatory one-time items, administrative setup, route-based delivery, optional agreed reserve, first-month down payment, verified jurisdiction tax, and official fees. A suggested **read model** may include location ID; stable line/machine identities; original/discounted cents; term and effective date; setup decision FULL, PARTIAL or WAIVED plus reason/actor; delivery fee; down payment; reserve liability; tax-by-jurisdiction; mandatory all-in total; amount at signing; reviewed tax/rate/terms versions and source fingerprint. This must not become an independent invoice truth store.

- Starting private example: washer $35 + dryer $35 − explicitly labeled set discount $10 = $60. Both machines remain separate equipment, contract, return and accounting identities. Public website pricing remains hidden until a separate release approval.
- $45 admin setup once per **new** delivery location, distinct from installed consumables, route delivery and relocation. OWNER must explicitly record full/partial/waived decision and reason for each applicable new order; no automatic setup on a live-address add-on, regular swap or redelivery. Where setup is waived but the charged cents happen to equal a later new configured baseline, preserve override identity and Restore action.
- Five+ machines OR business/property manager triggers a **first-month down payment** at signing; apply it exactly once to its first delivery-generated invoice. It is neither refundable reserve nor extra rent. No ordinary household security deposit.
- Negotiated large-account **refundable reserve** is a separate liability. Proposed minimal accounts: per-client reserve agreement amount/policy/terms approval; immutable held/adjusted/refunded movements with signed evidence and ledger actor; quarterly configurable replenishment reminder after a shortfall. A pending provider payment is not held money. Damage deductions need a real authorized claim and dispute checks. Refund money-out requires independent human approval and provider verified result, with no automatic transfer.
- If any required tax, legal terms, delivery charge or review is unresolved, show a private *incomplete estimate* with an explicit missing item. Never publish a fictitious binding all-in number, sign or request money from that estimate. Synthetic previews can use researched provisional defaults, but **do not activate them as actual tax rules**.
- Send/sign freezes the exact reviewed cents, source fingerprints, tax evidence and policy version. A modified quote or effective policy revision triggers new review, never retroactively edits signed obligations. Customer account shows accepted amounts and actual paid/owing status, not optimistic receipt state. One payment cannot apply twice to initial invoices.

### Prepaid pair breakage and partial return

The returning machine receives a credit for unused period at **its allocated share of the discounted price actually paid**. Do not take back past pair discounts or reprice coverage already prepaid, including a prepaid annual term. The remaining appliance moves to contract-valid single-machine pricing and applicable six/twelve-month single-machine discount on **future unpaid** coverage only. Record original receipt/line/covered period and an immutable credit journal; do not overwrite historical invoice evidence. Cash refund is separately approved by OWNER/finance-authorized role. Test mid-month, first/last day, leap year, annual prepay, renewal, replay and Stripe subscription update failure.

### Cancel/refund, late fee and payment allocation

Before first delivery: ordinary household cancellations return **everything collected**, even if an appointment was scheduled. Large-order rule: configurable **72 elapsed hours from signature** for default full refund; after that recommend retaining eligible setup and returning down payment, subject to owner decision and signed-lawful terms. Each cancellation requires human case approval, reason, independently approved money-out and idempotent provider reconciliation. Never treat approved refund estimate as refund settled.

Later W-5 payment work must apply partial customer receipts oldest non-disputed due obligation first (stable due date + ID ordering), and support a configured **five-day grace + single $5 on day six** without compounding, with auditable waiver and no retroactive change to signed terms. Test zero/partial/replayed receipts, disputed claims, DST, day-five/day-six, 72-hour boundary, independent refund authorization and customer statement balance.

### W-22 FINISH criteria

One owner-reviewed multi-location quote leads to one accurate customer estimate → signed agreement → payment due/settled/failed states → unscheduled owner delivery task → actual delivery → initial invoice and exactly-once down-payment credit, across owner and customer views. Explicit setup/delivery/return/reserve differences reconcile across all surfaces; anti-replay and tenant isolation are proven on disposable Postgres and browser. **Real Stripe TEST, legal/CPA and checked release proof stay separately queued**. Do not declare engineering complete merely because helper PRs merged.

## 3. W-23 — property contacts, claims, privacy and portfolio import

The **contracting property manager/owner remains the customer**. Tenants are per-location contacts with current/past effective dates; they do not inherit billing, login, price, cross-unit visibility or consent. Reuse existing location contacts and COM-L consent/notice pipeline rather than creating a second customer or messaging stack.

1. **Every tenant maintenance request** creates one tracked manager-notification intent with idempotency key in the same transaction as the repair ticket. The client's contact-method preference and tenant's own SMS consent are independent; unactivated outbound channels queue private follow-up rather than silently sending or losing notice. Included repair has no surprise damage fee.
2. **Separate alleged damage** from recurring rent. Proposed states: evidence draft → manager review → disputed/approved → separately issued invoice → settled/credited/voided. Evidence version identifies visit, suspected cause, photos, staff actor, repair and optional trip/replacement cost. Manager can dispute; OWNER can amend or waive with reason. Default invoice due **90 calendar days**, editable per claim. Active dispute stops scheduled collection, including after due date.
3. **Damage autopay defaults OFF**. Automatic charge is not eligible until an independently signed *damage-invoice-specific* authorization, lawyer-cleared terms, owner activation, and TEST provider acceptance exist; otherwise use secure manual payment. Existing saved card alone is not consent.
4. Former-tenant PII retention defaults to **12 months after recorded move-out**, editable; legal hold, claims and disputes block eligible purge. Purge preview, export, role checks and actual eligible deletion log required; do not delete financial/tax evidence or activate real purge until privacy/legal review.
5. Portfolio CSV import: bounded file/rows/size; validate identity, addresses, duplicate phone/email/units, formula injection and cross-customer collisions; dry-run create/update/conflict/no-op preview; authenticated explicit owner/client approval and idempotent commit. No email, phone, SMS, or charge side effect from import.
6. Separate future partner commissions stay **OFF** until BP economics/disclosures, margin/rate, reversals, frequency/threshold and every payout are independently approved.

Acceptance: manager vs tenant isolation, state transition/claim dispute, 90-day Denver boundary, missing SMS consent, exact manager notice intent, media holds/release, CSV concurrency/duplicate rollback, financial export, legal activation guards.

## 4. W-24 → W-25 → W-26 — delivery, phone and multilingual contract

### W-24: route costs and real scheduling

Origin: editable verified **central Greeley** point. Use real driving route distance, never a ZIP polygon or straight line; provider selection, cache expiry, costs and outages are engineering contracts, **not permission to purchase APIs**. Without a verified route/provider, require owner-recorded manual source/distance/time rather than producing a binding delivery fee. Configurable starting bands (miles): **0–15: FREE delivery; (15–30]: $75; (30–50]: $125; >50 OFF** unless separately approved and manually quoted. All mandatory fee disclosures must reconcile to W-22 quote; local delivery FREE does not imply free administrative setup. Outer region charges remain private/quote-led until approved for publication.

**Relocation:** $75 once per relocation job, not per machine, owner-configurable and approved with reason; never assess an automatic second $45 setup fee. Safety hookup consumables go on visit evidence, not separately sold as mandatory equipment. A missed customer visit trip fee starts $0/OFF and must be assessed case-by-case with fault evidence and owner approval; ordinary swaps/owner reschedules free.

Customer requests several eligible owner-offered dates and AM/PM windows as **requests** only. Only authorized owner/staff confirmation with conflict-safe slot locking transitions to scheduled delivery. Phone service hours **08:00–18:30 every day Denver**, including holiday override, are not delivery availability. No self-booking. Tests: exact 15/30/50 boundaries, epsilon, origin change, route-provider outage, no accidental paid maps, stale quote, one vs many relocation machines, DST, overlapping windows/duplicate confirmation and no auto booking.

### W-25: verified support mailbox, phone order and telephony policy

Phone order enters an ordinary draft and sends an approved secure customer link for actual signing/acceptance; **no verbal consent substitute**. Public/reply address is **support@robinsonappliancerentals.com**, reusing existing single Workspace ops mailbox and aliases, with genuine inbound/reply test before live sending; do not buy a new seat.

Existing COM voice stack remains authoritative. New local Twilio phone number requires separate owner selection and purchase approval, and private forwarding destination validation. When activated: seven-day 08:00–18:30 Denver forwarding, configurable holiday override, editable approved voicemail greeting after-hours. Voicemail media: private OWNER/authorized access, **90-day default** with legal holds and eventual purge; voicemail transcription and ordinary call recording/transcription independently OFF at start. Real caller recording requires privacy/consent review first. Provider usage monitor starts **$20/month**, notification thresholds **$10/$15/$20**, monthly reset, **notify only**, not a provider-enforced cap or silent communications shutdown. Phone routing != delivery hours.

Send-payment-link and later staff secure phone-card payment must use the approved Stripe path, not capture card numbers in Appliance Desk; no customer phone signature fallback. No automatic ACH debit is approved by an optional ACH product preference.

### W-26: Spanish and public home-address privacy

Version public pages, customer portal, quote, sign/payment, rental contract and messages by locale and exact underlying agreement revision. Spanish release requires documented fluent reviewer feedback and lawyer sign-off of enforceable/controlling language; keep unavailable paths in safe English with clear disclosure, not mixed or machine-generated unreviewed legal promises. Owner private home address must never be exposed in site, transactional/marketing templates or listings; separately compliant public mailing address remains an owner/provider operational dependency for marketing. Launch aspiration November 2026 is **not** a public commitment or date; preserve truthful Preparing to Launch until real inventory, readiness and approval.

## 5. Later already-ordered W, K and proposed postlaunch contracts

- **W-5 / W-20:** failed/held payment follow-up, oldest-first partial allocation, signed secure payment links, optional ACH mandates only after independent authorization, a single late fee, and optional consent-respecting email-only satisfaction survey no more than quarterly. Do not pull these into W-23 ahead of schedule; record their future acceptance.
- **W-14 / K-1A / K-2A / K-5 / K-7:** inventory is LLC property only when supported by real purchase/receipt/serial; personal tools stay unbooked absent documented transfer. Accounting maintains individually dated repeated small owner capital contributions, separately documented owner loans, draws/distributions and net invested; **not customer revenue or auto-transfers**. Opening cash/assets/payables/liabilities require verified source, never synthetic figures. Balanced immutable postings and portable CSV/CPA exports; exact bank/edition reconciliation is separately proven.
- **K-CASH-2 / K-CASH-6:** bank remains unselected; Bluevine/Axos candidates only, no application/provider spend. QuickBooks Free preferred only if edition and import functionality are independently verified; exports portable to later paid QBO or other accounting systems. **K-CASH remains proposed and needs its documented design review**, not an early start authorized by this mapping.
- **W-9 / W-10 / W-13:** prepare owner-reviewed sales/use-tax return packets for **manual official filing and payment**. No browser robot, account credentials or auto money-out. AI receipt scanning deferred, provider OFF. Seven-year purchase/tax records after asset fleet exit, editable with CPA/legal hold.
- **BP:** partner commissions/referrals OFF before launch, no partner payable, sales pitch or payout until separately approved economics, disclosures and release gates.
- **W-7 and final acceptance:** no invented inventory/launch date, private home address or unsupported legally binding terms; verify real service capability, marketing mailing address, owner setup, communications activation and real TEST/payment workflows before a real launch.

## 6. Instructions to the next lower-level coding agent

For its **current ordered approved unit** only: read this packet and the map entries pointing to its work-index ID; check current main, existing migrations and active card before writing a new one. Produce a complete useable outcome with exact write/read model, authorization, money/PII separation, locks/idempotency, migration/restore, audit provenance, owner-approved configuration UI and source fingerprints. Write unit, disposable real-Postgres, customer isolation, DST, replay, pricing, unauthorized, provider failure and mobile/browser checks. Do not create 56 implementation PRs. If a needed owner preference is missing, ask the owner **in the current session**, record answer and resume the same unit. Queue only genuine future provider/live/professional acceptance with exact revision, trigger, actor and evidence; do not call source work blocked by an upcoming release.

| Evidence level | Requirement | Not proof of |
|---|---|---|
| Design | owner text, relevant map entry, approved position, acceptance contract | finished code |
| Code | exact-head CI, replay/security/browser and isolated Postgres proof | deployed business workflow |
| Release | checked production live revision, schema/runtime readback | provider/owner acceptance |
| External | real Stripe TEST and verified legal/CPA/telecom/email decisions | general permission for LIVE spending |
| Real use | independently authorized policy, signed terms and per-operation approvals | future unapproved expansion |

