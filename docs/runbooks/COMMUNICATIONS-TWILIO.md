# Twilio communications readiness and activation

**Engineered through COM-L14B; COM-L15 adds final synthetic acceptance evidence.** The private inbox, SMS consent/dispatch fences, inbound routing, voice/call evidence, settings and reporting now have automated test coverage. This is **not proof of live account setup, carrier approval, a working real phone number, or production-readiness**. Live SMS, voice routing, optional voicemail, purchasing and budget actions still require the distinct owner/provider approvals documented here. Old references to dormant legacy SMS do not authorize activation. Design: ../designs/BATCH-COM.md. Owner guide: COMMUNICATIONS-OWNER-HANDOFF.md.

## 1. Prepare business facts (no paid submission)

Reuse IN-03/IN-09, add IN-51/52/53 from OWNER-INPUTS.
- Confirm the final LLC legal name, EIN and registered legal address exactly match the entity evidence. Do not invent an EIN or assume the entity filing is completed.
- Verify business website, working support contact and company identification.
- Publish owner/legal-approved privacy and SMS terms describing actual behavior; consent data is not sold/shared for unrelated marketing. Provider processing disclosures must remain truthful.
- Build separate unchecked informational and marketing consent controls, exact disclosure versions, optional agreement consent, portal withdrawal and text-in flow.
- Gather opt-in flow URLs/screenshots that demonstrate the actual choices, not staged mock behavior.
- Describe genuine use cases (customer support, rental/job notices); campaign categories must match actual approved traffic. Don't register marketing merely because it may be added later.
- Prepare real sample template messages with company identity and opt-out instructions, truthful frequency, rates disclosure and HELP support text.
- Retain exact opt-in/opt-out/help behavior evidence and link it to the campaign. Carrier/provider approval never substitutes customer consent.

Official checklist: https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/collect-business-info
Separate consent: https://www.twilio.com/docs/api/errors/30913
Policy: https://www.twilio.com/en-us/legal/messaging-policy

## 2. Verify existing account and number (read-only)

- Record whether this is a dedicated Appliance Desk account or shared. Never show shared account charges as fully attributable business spend.
- Inspect owned numbers and SMS/Voice capabilities. Prefer retaining/porting the selected permanent number where appropriate; no forced migration for inbox/softphone upgrades.
- Buying/porting a number, configuring voice, and A2P messaging approval are separate actions. They can occur in different stages, each with its own approval.
- Confirm account/campaign/messaging service/sender links and registration status; unknown status blocks new outbound production SMS.
- Make one company number the only active sender in the launch Messaging Service. Verify Advanced Opt-Out and do not emit duplicate confirmations.
- Use server-held REST credentials and account Auth Token for webhook verification; no credentials in app forms, screenshots, issue notes or repository.

Number facts: https://www.twilio.com/docs/phone-numbers/api/incomingphonenumber-resource
Keywords: https://www.twilio.com/docs/messaging/tutorials/advanced-opt-out

## 3. Engineer and test while live features stay OFF

- Preview/local/CI use non-sending injected providers, disposable DB and independent private media. Production runtime markers AND owner approval are required.
- No production numbers/credentials in test fixtures. Twilio test credentials/magic numbers, when used in an isolated account, are not proof real inbound delivery or voice works.
- Verify signature/account/receiving-number rejection, canonical origin, callback dedupe, status ordering, early callbacks, unknown-send holding and STOP suppression.
- Prove SMS inbox/history, shared-number ambiguity, templates/segments and scoped consent on the preview.
- Prove parent/child call legs, press-to-accept, missed-call path and optional approved voicemail private access. Recordings/transcription stay OFF.
- Prove read-only cost ingestion against fixed fixtures, replay/correction, no double counting, stale provider data, budgets and existing Today/System health integration.
- Confirm all chosen COM-L acceptance boxes and full CI/preview/reviews at exact head. Complete final F-part-2 scenarios with telecom included.
- Finalized/invoice-reconciled cost requires verified statement evidence. Provider usage is displayed with its own basis.

## 4. Owner-approved external setup (one concrete approval per gated action as needed)

These are pending setup actions, never authorized by a merged docs PR:
- Buy/port the chosen number only after owner reviews the number, capability, cost and portability constraints.
- Submit the legal brand/campaign and associated charges only after verified entity/EIN facts and campaign materials are approved.
- Configure production webhooks and fallback using the exact canonical URLs in BATCH-COM section 5. Preserve the legacy status URL until senders are migrated.
- Configure forwarding only to verified targets, hours/after-hours policy and press-to-accept. Prohibit business-number/self loops and unsafe destinations.
- Approve voicemail announcement, privacy/retention/legal-hold/deletion policy before collecting media. Approve conversation recording and transcription separately later.
- Approve monthly budget and anomaly actions. Show rates/data freshness; missing fees stay unknown.
- Verify actual permanent public contact replacement across website/settings/structured SEO data, business documents, templates and listings. Owner publication approval precedes replacement; signed old documents remain immutable.
- Register authenticated provider fallback so an app outage has the approved unavailable/voicemail behavior. Test fallback deliberately with consenting owner test caller.
- Review provider destination restrictions and feature permissions; no international/premium dial destinations by default unless explicitly approved.

## 5. Controlled production proof and activation

Only after explicit live SMS/call approval:
1. Use consenting owner-controlled phones and the approved company number for a bounded real inbound/outbound SMS test.
2. Verify accepted/delivered distinction, reply linkage, STOP/START/HELP/provider block and local consent; restoring provider delivery alone does not grant marketing.
3. Place an approved inbound call: staff accepts; test no-answer/after-hours/voicemail only if selected. No customer dialling during this proof.
4. Verify a callback and read-only resource/Usage observations appear once and retain correct provider/account/environment.
5. Check expense estimate vs reported usage; wait for invoice evidence before claiming invoice reconciliation. Missing coverage is shown.
6. Turn on selected workflows one at a time; quiet hours, templates, consent and activation fences remain enforced.
7. Record evidence and release state in GO-LIVE-CHECKLIST/STATUS. A2P rejection, missing number or failed proof keeps the affected channel OFF; other approved channels remain usable.

## 6. Provider failure and spending response

- UNKNOWN send: don't press retry automatically; inspect known SID, callbacks/provider evidence. If no proof, owner may approve a separate resend knowing duplication is possible.
- Critical notice SMS failure/STOP: use the approved legal alternate delivery path; retain obligation/evidence in CustomerNotice.
- Unmatched inbound contact: identify with a privacy-safe exchange; don't expose candidate billing/property data or use a phone match as authentication.
- Cost sync outage: retain previous figures and show stale; System health/AutomationRun tracks it.
- Spend warning: inspect channel/category/leg/segment breakdown; don't shut off legitimate inbound service. Pause only the identified automation under approved circuit settings.
- Suspected credential abuse: owner rotates/revokes affected keys through approved provider controls, reviews destination/feature usage and records redacted evidence. Don't copy raw secrets/provider payloads into issues.
- No ordinary conversation recording, AI reception or automatic payment/accounting posting is implied by this runbook.

## 7. Retention and finance after launch

Persist minimal durable message/call/event/usage/cost facts locally; preserve proof after provider log expiry. Protect content/media separately from operational/financial evidence. Purge requires scope/hold validation and private local/provider/recovery deletion under existing privacy procedures.

When Batch K exists, link each verified paid statement to one existing Expense, owner-approved payment source/date, then post through K. Top-ups, invoice and usage rows must not become three expenses. Existing manual bills require linking/review. Accountant decisions about prepaid provider balances remain explicit.

Usage evidence: https://www.twilio.com/docs/usage/api/usage-record
Call billing scope: https://www.twilio.com/docs/voice/why-doesnt-my-invoice-match-what-i-pull-from-the-call-logs
