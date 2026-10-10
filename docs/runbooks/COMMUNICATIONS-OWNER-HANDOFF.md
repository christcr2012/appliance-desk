# Appliance Desk communications — owner launch handoff

**As of 2026-10-10: software engineered and testable, NOT proof of a live phone system.**
The single-number communications system has backend tests, private screens, telephone
routing fixtures and financial evidence displays. **No live SMS, voicemail capture,
number acquisition/porting, A2P approval, paid feature or carrier verification is
asserted by this document.** Engineering completion is distinct from launch permission.

## What you can review without spending money
1. Sign in as OWNER and open **Desk → Settings → Phone, texts and provider costs**.
   This is a private configuration/evidence screen. Verify the account is truly
   yours and whether it is dedicated or shared. An account record or capability
   observation does not mean the provider has approved a sender.
2. Open **Desk → Communications** to see the private inbox and missed/voicemail
   views. Synthetic and TEST fixtures exercise these; they are **not** proof that
   a real caller can reach you yet.
3. Open **Desk → Reports → Communications cost evidence**. Provider usage,
   estimated resources, verified statements and any budget-warning suggestion
   are **different layers**. Do not add them together as a paid expense.
4. Inspect customer, lead, job, maintenance and invoice communications context.
   An explicit identity/record link is required. A shared phone number does
   not prove who sent a message; provider ACCEPTED does not mean DELIVERED.

## Things only the owner can decide (still pending)
- **IN-03:** Which permanent public number will represent the company?
  Do not silently replace a working personal/business number.
- **IN-09:** Verify your own Twilio sender, messaging service and A2P status,
  and separately approve any eventual live SMS. Test credentials are not
  evidence of carrier approval.
- **IN-51:** Is the telecom account dedicated or shared? Where and during
  which hours should calls forward? What happens after hours? Choose what,
  if anything, to activate. No number purchase/port, forwarding change or
  provider configuration edit is included in this engineering work.
- **IN-52:** Approve announcement wording, privacy/retention and any permitted
  voicemail storage after legal review. Ordinary call recording and
  transcription remain OFF. Synthetic voice/media tests do not count as
  recording consent or statutory guidance.
- **IN-53:** Confirm warning amounts, currency, recipients and response
  rules before enabling cost alerts; $50/$75/$100 are only examples.
  Draft suggestions do not turn on notifications or automatically cut off
  inbound, emergency or legally required communications.

## Safe launch order, after outside approvals
1. Confirm legal entity, actual service/website/support identity, privacy/SMS
   disclosures and separate consent wording. Legal and carrier requirements
   must be verified before public use; do not invent an EIN.
2. With separate purchasing/registration permission, verify or obtain the
   selected number and submit accurate company/campaign data to Twilio.
   Confirm sender and A2P registration status **from the provider**; a paid
   submission does not imply approval.
3. With separate routing approval, validate outbound caller ID, forwarding
   target, hours and fallback. Make a real test call **only after** the owner
   approves it. Test answer/press-to-accept, no-answer/busy and after hours.
   Keep optional voicemail disabled until IN-52 and privacy notices are approved.
4. Inspect test-only SMS consent, STOP/START/HELP, provider callbacks, unknown
   send outcomes, role access, and exact company-number ownership.
   Live SMS requires separate explicit owner approval and a confirmed
   working carrier path; never enable as a side effect of changing a template.
5. Separately approve budget alerts and routing/switches. Verify current
   deployment/runtime environment, callbacks, secrets in the provider
   dashboard (never pasted into logs/chat), and recovery/STOP workflows.
6. On a later approved launch, perform and record controlled real-user and
   real-carrier acceptance in F-part-2 before calling this feature live.
   Capture signed evidence with no message body, media, token or recipient PII.

## What remains outside this card
- COM-N: expanded transactional template families, job-scoped calling and
  other approved future sending actions. These are not implied by inbox UI.
- K accounting: only a verified and properly posted Expense belongs in
  profit/loss or financial exports. Telecom estimates are not accounting.
- F-part-2: full product go-live acceptance, carrier/live routing, legal,
  finance, security and recovery evidence. COM-L15 cannot satisfy external
  prerequisites by synthetic tests alone.

**Reference:** The technical verification and troubleshooting checklist is
COMMUNICATIONS-TWILIO.md in this folder; owner decisions in
../OWNER-INPUTS.md; staged acceptance in ../GO-LIVE-CHECKLIST.md.
