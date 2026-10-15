# October 13 decisions — researched implementation consequences

Checked **2026-10-15** against the primary sources below. Applies to the existing
[56-subject owner map](../owner-decisions/2026-10-13-implementation-map.json), not
a new work queue. Owner preferences remain in the
[engineering contract](../designs/OWNER-DECISIONS-2026-10-13-ENGINEERING.md).
Research establishes public facts; it does not establish this LLC's tax elections,
licenses, customer consent, counsel/CPA approval or provider-account capabilities.
Implement configurable synthetic branches now; retain the existing affected
real-use gates. No additional owner design-approval round is introduced here.

## R1. All-in prices — W-22FIN, W-24, W-7

**Published:** [HB25-1090](https://leg.colorado.gov/bills/hb25-1090) requires prominent
total-price disclosure and addresses separately disclosed charges and genuinely
indeterminate service prices. Read the enacted text, not the introduced bill.
[HB26-1013](https://leg.colorado.gov/bills/hb26-1013), signed March 26, 2026, changes
residential landlords' utility-allocation provisions; it does not establish a
general exception for appliance rentals.

**Engineering consequence:** one canonical quote must distinguish recurring rent,
mandatory one-time price, tax/official fees, refundable reserve and money due now.
Disclose route-dependent price factors while unresolved; do not present an
incomplete private subtotal as a binding complete offer. Retain the owner's
stricter all-in presentation and prelaunch hidden-price policy. Do not decide
that appliance installation/delivery qualifies as excluded statutory shipping
merely because its UI label says delivery.

**Counsel question:** approve the actual household/commercial templates, total-price
presentation and delivery classification, including cancellation, reserve,
damage and late-fee provisions. Five grace days/$5 and 72 hours are owner policies,
not legal safe harbors. A property manager purchasing appliance service is not
automatically the same legal relationship as a residential landlord billing a tenant.

## R2. Rental tax depends on acquisition evidence — W-22FIN, W-14, W-2, W-15

**Published:** [Colorado DOR leases guide](https://tax.colorado.gov/sales-use-tax-topics-leases)
distinguishes leases of 36 months or less from longer leases. Paying applicable
acquisition sales/use tax can change short-term rental-payment taxation. Tax-free
short-term acquisition requires DOR written permission. Associated charges and
property location also matter. This guidance expressly excludes self-administered
home-rule city taxes.

**Engineering consequence:** preserve per-asset acquisition invoice/tax evidence,
lease duration, jurisdiction, reviewed treatment and effective policy reference;
do not infer a fleet-wide tax election from an owner checkbox. Before asset
assignment, a quote needs a verified applicable inventory/tax policy or must stay
incomplete. Mixed acquisition histories cannot collapse into one unqualified
"rent is taxable" flag. Moving equipment can change future sourcing without
rewriting old invoices. Setup, installation, removal, optional service and reserve
each need classification; merely listing a charge separately does not prove exemption.

**CPA question:** determine actual acquisition treatment, required registration/
permission and each charge category by jurisdiction, including advance-payment
tax timing. Store decision evidence with approved effective dates. Until verified,
use UNDECIDED for affected real offers; test taxable/exempt/unknown synthetically.

## R3. Retail delivery fee is conditional and dated — W-22FIN, W-9, W-10

**Published:** [DOR rates](https://tax.colorado.gov/retail-delivery-fee-rates) lists
**$0.31, July 1, 2026–June 30, 2027**, after $0.28 in the preceding year.
[DOR retailer guidance](https://tax.colorado.gov/retail-delivery-fee-retailers)
describes the qualified-business exemption (previous-year Colorado retail sales
at most $500,000) and new-business transition. The
[applicability guide](https://tax.colorado.gov/special-topics-retail-delivery-fees)
addresses short-term leases, a single delivered
order with periodic payments, retailer-paid versus customer-collected election,
and restrictions on refunding collected fees. Free exchanges do not automatically
create a new taxable retail delivery.

**Engineering consequence:** evaluate applicability/exemption evidence first,
then the reviewed taxable event and effective rate. A startup is not automatically
liable just because a truck delivers equipment. Unknown sales history/election
is unresolved, not a guessed exemption. Preserve evidence for exempt zero values.
Do not multiply one qualifying order's fee by its months, machines or signing
agreements. Multiple deliveries/addresses need an explicit reviewed order/delivery
assessment; the single-delivery rule alone does not decide them. Keep customer's
own route delivery charge separate from this government fee. If collected, retain
its separate statutory invoice line; if retailer-paid, do not silently add it to
customer due. Do not tax it with a generic state sales-tax percentage; home-rule
treatment requires separate confirmation.

**Acceptance:** test exempt/unknown/liable, June 30/July 1 rate selection,
one order split into agreement records, recurring invoices and replacement replay.
For a post-delivery return, the owner's generous refund may require a separately
approved business-funded reimbursement rather than reversing statutory RDF.
Ask CPA/counsel to distinguish pre-delivery cancellation from a delivered return;
never silently reduce the promised customer refund or fabricate a tax refund.

## R4. Greeley is a separate evidence boundary — W-22FIN, W-2, W-11

**Published:** the [City sales-tax page](https://greeleyco.gov/business/business-operations/sales-tax/)
provides its own filing portal, municipal-code link and city tax contact. It also
advertises **proposed** ballot measure 2F; a proposal is not an enacted tax rate.
The DOR guide above does not resolve self-administered city treatment.

**Engineering consequence:** address verification must identify jurisdiction and
administration authority, with source, retrieved date, effective interval and
rate/treatment revision. A Greeley mailing city or ZIP does not prove taxable
city boundaries. Do not combine a historical city PDF rate and today's state rate
into a production default. Research the actual delivery address and enacted local
rules when implementing; future election results require a fresh check.

**Remaining determination:** CPA/city confirmation of equipment leases,
associated charges, RDF and licensing for the actual business model. Keep the
existing manual evidence workflow available; this does not authorize account
registration, tax submission, a paid lookup provider or contacting the city.

## R5. Optional ACH is not debit permission — W-22FIN recovery, W-5, W-25

**Published:** [Stripe ACH Direct Debit](https://docs.stripe.com/payments/ach-direct-debit)
requires bank verification and mandate acceptance; authorization distinguishes
one-time from recurring debit. It is delayed and can fail or be disputed.

**Engineering consequence:** keep existing PREPARED/PENDING/final attempt states;
remote uncertainty stays PENDING, never a fabricated stored UNKNOWN enum. Neither
Checkout completion, bank verification nor the owner's ACH preference proves
settlement or permission for recurring/damage debits. Record provider mandate
reference/scope without account secrets. Maintain webhook dedupe and post-settlement
return/dispute handling. No automated retries or off-session debits are activated
by this research. Prove duplicate, delayed failure, revoked mandate and unknown
provider-result recovery with existing adapters and isolated fixtures.

## R6. Tenant/manager notices and voicemail — W-23, W-25, COM-L

**Published:** [Twilio messaging policy](https://www.twilio.com/en-us/legal/messaging-policy)
requires recipient- and subject-specific consent, with opt-out handling. Imported
contacts are not blanket consent. [Usage triggers](https://www.twilio.com/docs/usage/api/usage-trigger)
notify when thresholds are crossed; usage data can lag. The
[recording API](https://www.twilio.com/docs/voice/api/recording) supports deletion;
deleted media is unrecoverable and provider metadata persists separately.

**Engineering consequence:** tenant repair creation and manager-notice intent
are atomic, but delivery depends on that recipient/channel's consent and activation.
Queue owner follow-up when unavailable. The $10/$15/$20 monthly alerts are notify
only, not a hard $20 cap; dedupe threshold/month notices and expose stale/missing
usage. Do not shut down support calls silently. Owner's 90-day voicemail policy
needs private media access, hold checks, provider/local deletion reconciliation and
partial-failure recovery. It is not automatic provider retention. Recording and
transcription remain independently OFF; voicemail policy does not authorize
recording ordinary conversations. Existing phone-purchase/outbound gates remain.

## R7. Retention periods have different purposes — W-23, W-14, K

**Published:** [Colorado AG privacy guidance](https://coag.gov/resources/colorado-privacy-act/)
describes applicability thresholds and consumer rights; do not assume every small
business is covered or exempt without assessment.
[IRS record retention](https://www.irs.gov/businesses/small-businesses-self-employed/how-long-should-i-keep-records)
ties property records to the disposition-year limitation period and recognizes
longer non-tax retention needs.

**Engineering consequence:** 12 months after tenant move-out, 90-day voicemail,
and seven years after fleet exit are separate owner policy clocks, not universal
statutory deletion deadlines. Use move-out/fleet-exit/media dates, not createdAt.
Open claims, legal holds and accounting evidence can block purge. Redact/delete
eligible contact/media fields without deleting signed contracts, depreciation
basis, tax evidence or unresolved claims. Retention preview must explain each
blocked item, and completion requires provider deletion evidence where relevant.
CPA/privacy review decides actual legal schedule; do not activate mass purge now.

## R8. Privacy-preserving marketing address — W-7, W-25, W-26

**Published:** [FTC CAN-SPAM guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)
allows a valid USPS-registered PO box or qualifying registered private mailbox
for commercial-email postal-address disclosure.

**Engineering consequence:** no need to publish the owner's home address as the
marketing default. Use distinct private operating and approved public mailing
address fields; missing public mailing evidence blocks marketing, not private
engineering. Correct Reply-To aliases and opt-outs still matter. This finding
does not prove a mailbox satisfies bank KYC, local licensing, service-of-process
or every transactional/legal notice requirement. Owner chooses a compliant
address separately; research does not purchase a mailbox or send a message.

## R9. QuickBooks Free is a preference, not a verified adapter — K-5, K-CASH-6

**Published:** [Intuit Free product](https://quickbooks.intuit.com/online/free/)
currently advertises one connected bank account and limited invoicing.
[Journal CSV instructions](https://quickbooks.intuit.com/learn-support/en-us/help-article/import-export-data-files/import-journal-entries-quickbooks-online/L4tQBwbs7_US_en_US)
specify journal number/date, account, description, debit and credit mapping.
These pages do not demonstrate a successful import in this owner's tenant.

**Engineering consequence:** retain the
[October 8 portable export/onboarding proof](2026-10-08-startup-banking-quickbooks.md).
Export balanced, stable-ID journals independently of edition; keep rental invoices
in Appliance Desk. Require actual tenant sample import, replay/deduplication,
statement match and balance tie-out before claiming compatibility. One bank feed
does not promise multiple subaccounts, API access or accountant collaboration.
No automatic paid upgrade, bank choice or API connection. K-CASH remains PROPOSED.

## Research handoff and refresh

R1–R4 are immediate inputs to W-22FIN; R5 applies to its recovery and later ACH.
R6–R9 are mapped later inputs, not permission to reorder work. When implementing,
record the exact policy/evidence revision and address/event it covers. Refresh
sources if law, fee period, provider contract or edition changes; use a new
effective revision instead of overwriting signed history. Escalate only actual
missing business choices to Chris. Obtain professional determinations through
existing owner review controls; do not ask Chris to research public facts.
