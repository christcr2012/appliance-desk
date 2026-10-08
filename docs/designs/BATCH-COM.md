# Design — Batch COM: Appliance Desk communications and telecom costs

**Status: APPROVED by Chris — 2026-10-08.** Owner approval authorizes implementation under the repository's existing batch order and review gates. It does not authorize paid provider setup, number purchase, A2P submission, or live communications. This is a complete subsystem architecture; only L1a/L1b/L2 have bounded execution cards now. Later cards must expand schema fields into exact Prisma/SQL text before their PR starts, without inventing new business decisions.

**Baseline:** main `730f449ea5c7300a0a1f27c214074a9301736ad3`, inspected 2026-10-07. #298/#299 are merged. #300 is the only open PR observed; its tax metadata concurrency review is fixed at its recorded head and is outside this batch. This design does not change its branch or interrupt tax implementation.

## 0. Current-code inventory and drift

The tree inventory and bounded repository searches covered phone/messaging/metrics references. Full source reads covered messaging delivery/events/history/suppression, SMS adapter, Twilio route, reminder sender, provider settings, deployment safety, dashboard, reports, and customer timeline. Schema sections, Batch E/S/K designs, current process, launch gates, review guidance and relevant historical audit excerpts were inspected. This is a subsystem architecture review, not a claim that every source file or report was independently audited.

| Current evidence | Consequence / correction |
|---|---|
| `MessageDelivery` already claims business keys, separates ACCEPTED/DELIVERED and reconciles known SIDs; E #216 implemented it | Extend it; no second outbound queue or replacement of email |
| `deliver.ts` retries UNKNOWN immediately; `sms.ts` accepts a local key but does not send it to the provider | COM-L1 must remove automatic UNKNOWN SMS replay. Existing integration test explicitly expects that replay and must change. Do not claim exactly-once telecom delivery |
| `events.ts` marks unmatched callbacks processed and performs read/write status changes without per-delivery serialization | Retain unmatched events for replay; serialize finalization, callbacks and reconciliation on the same delivery; terminal states cannot be overwritten by sender completion |
| Twilio route supports delivery status and STOP only; other inbound messages are acknowledged/ignored | Add durable inbound ingestion; keep the existing callback URL compatible |
| STOP uses `customer.findFirst` for phone aliases; suppression is checked for MARKETING but not all SMS | Match by canonical address without choosing the first person. STOP blocks every normal SMS purpose at the last dispatch check |
| `smsOptInAt` and `ConsentRecord` exist; lead privacy consent is not SMS consent | Extend consent evidence to normalized phone, purpose and disclosure. Never treat lead form/privacy acceptance as texting permission |
| Current Vercel non-production guard allows an unmarked local environment; low-level SMS has no dedicated owner activation switch | Telecom must require explicit production runtime + deployment marker + owner activation + verified account/number. Missing markers always select non-sending adapter |
| `getMessageHistory` is a bounded preview; customer timeline has note/activity streams | Keep preview and add a complete paginated communication stream. Do not silently hide old communications |
| `METRICS`, dashboard, revenue/fleet/growth/reports, Today exceptions and AutomationRun already exist | Extend these surfaces; do not build a second analytics/health system |
| S is approved but not implemented; K is approved but not implemented | Launch COM follows S. Financial booking follows K; operational costs can exist before books |
| E #215/#216 review threads returned empty; #216 description calls UNKNOWN replay safe | No pending E inline finding was observed; code inspection disproves safe replay for Twilio. Historical P6 H6 is partly remediated by E, further consent work remains |
| ARCHITECTURE says buying a number requires completed A2P and adding its env var activates SMS | Correct those documentation claims: acquisition/voice setup and A2P texting approval are separate; configuration is never activation approval |

Before each implementation PR: re-read current STATUS/MASTER-ROADMAP, applicable card, CHANGES-SINCE-DESIGN; check all named symbols against current code. If baseline changed, record affected contracts, not a new full-repo audit. S sources and K expense signatures below must be reconciled with their actual implementations before linking them.

The attached October 1 Package 1 audit is historical guidance for atomicity, bounded reads and failure semantics, not proof its old customer/estimate findings remain open.

## 1. Decisions and release boundary

1. **Extend `src/domains/messaging/`.** Provider code belongs in `src/lib/communications/providers/`. Twilio implements SMS/voice/usage. Keep Resend on its existing email boundary. No new queue service, Flex, Conversations, Studio, TaskRouter or AI receptionist is required for launch.
2. **One permanent local identity.** Adopt or port one owner-selected number whose actual resource supports SMS and Voice; verify account ownership and capabilities read-only. Use one Twilio Messaging Service with only this sender at launch, Advanced Opt-Out, and the accepted campaign. Sender selection must never substitute another number silently. Provider switching is possible but number portability is a separate operation, never guaranteed by an adapter.
3. **Launch:** reliable manual/two-way SMS, simple OWNER/ADMIN inbox, phone-specific consent, editable core SMS template, forwarding with missed-call records, optional explicitly approved voicemail, monthly cost/usage, reconciliation and budget alerts integrated with Today/reports. Ordinary call recording, transcription, outbound calling and softphones remain off.
4. **Automation:** retain existing email/notice obligations. Migrate the existing job reminder to the SMS policy/templates first. Enable new transactional SMS events individually after launch tests and consent/legal approval. Do not turn every email into SMS.
5. **Proposed order:** finish T → S → COM-L → V → F-part-2 → launch. COM-N follows K/O and precedes BP by default; COM-A is unscheduled. Until this sequence/design is accepted, keep the current approved work order and COM runtime blocked.
6. **No approval shortcuts:** no number purchase, port, paid configuration, campaign registration, provider-side keyword edits, public number replacement, live SMS/call or production data deletion during engineering.

## 2. Additive schema contract

Use cuid primary keys, UTC timestamps, foreign keys with RESTRICT for retained business evidence, indexes stated below, and explicit environment/account scope. Existing primary keys and email rows stay valid. SQL CHECKs enforce exclusive nullable choices and nonnegative counts. All new schema lands in the designated schema PR before its consumers, one migration per such PR; later additive migrations in this batch are explicitly allowed at COM-L3/L7/L10.

### 2.1 Foundation (COM-L2 and COM-L3)

| Model/change | Required fields and constraints |
|---|---|
| `TelecomAccount` | provider String; environment enum PRODUCTION/TEST; externalAccountId String; label; status enum UNCONFIGURED/READY/DEGRADED/DISABLED; checkedAt nullable; redacted readiness JSON; createdAt/updatedAt. Unique(provider,environment,externalAccountId). No secrets in rows |
| `BusinessPhoneNumber` | accountId FK; address E.164; providerNumberId; messagingServiceId nullable; capabilities JSON with validated voice/sms/mms booleans; registrationStatus UNKNOWN/PENDING/APPROVED/REJECTED; verifiedAt; retiredAt; createdAt/updatedAt. Unique(accountId,address), unique(accountId,providerNumberId); partial unique accountId where isPrimary=true and retiredAt IS NULL; isPrimary Boolean false |
| `ContactPoint` | environment; channel SMS (future EMAIL supported by enum, not migrated now); address canonical; suppressionState NONE/OPTED_OUT/REVIEW; suppressionVersion Int 0; stoppedAt nullable; createdAt/updatedAt. Unique(environment,channel,address). A phone is not a person |
| `ContactBinding` | contactPointId FK; customerId FK nullable; leadId FK nullable; customerContactId FK nullable; verifiedAt nullable; revokedAt nullable; source enum LEGACY/SELF_SERVICE/INBOUND/STAFF; createdAt. CHECK exactly one entity FK populated. Partial unique indexes on each active binding pair; index each entity FK |
| `MessageAttempt` | deliveryId FK; accountId FK nullable for legacy/email; attemptNumber Int; operationKey String unique; state PREPARED/DISPATCHING/ACCEPTED/REJECTED/UNKNOWN/NOT_SENT; providerResourceId nullable; requestHash; startedAt; finishedAt nullable; errorCode nullable; nextAttemptAt nullable. Unique(deliveryId,attemptNumber), unique(accountId,providerResourceId) for non-null; indexes(state,startedAt), deliveryId |
| Extend `MessageDelivery` | telecomAccountId FK nullable; currentAttemptId nullable FK unique; requestHash nullable; renderedBody nullable encrypted text; renderedSubject nullable encrypted text; templateRevisionId nullable FK (added L3); actorUserId nullable FK; scheduledFor nullable; origin AUTOMATION/MANUAL nullable; environment nullable for historical rows. Preserve current state enum; expose INBOUND via new message model, not MessageDelivery |
| Extend `ProviderEvent` | telecomAccountId nullable FK; environment nullable; disposition RECEIVED/PENDING_MATCH/APPLIED/IGNORED/FAILED/LEGACY_HANDLED default RECEIVED; attempts Int 0; nextAttemptAt nullable; lastErrorCode nullable; responseStepKey nullable; responseXmlEncrypted nullable for deterministic voice-step replay. Keep existing (provider,eventId) unique. New eventId is namespaced by account+environment+resource+semantic event; indexes(disposition,nextAttemptAt), (telecomAccountId,receivedAt) |
| Extend `ConsentRecord` | contactPointId FK nullable; leadId FK nullable; purpose SMS_TRANSACTIONAL/SMS_MARKETING/SMS_CONVERSATIONAL nullable; action GRANT/REVOKE/PROVIDER_REENABLE/HELP nullable; source nullable enum PORTAL/WEB_FORM/SIGNED_DISCLOSURE/INBOUND_EXCHANGE/PROVIDER_KEYWORD/STAFF_EVIDENCE; disclosureVersion/textHash nullable; occurredAt nullable; scope JSON nullable. Existing kind/details/customerId stay; index(contactPointId,purpose,occurredAt,id). Event evidence append-only |

L3 adds the following alongside reciprocal relations:

| Model | Required fields and constraints |
|---|---|
| `CommunicationThread` | accountId; businessNumberId; externalContactPointId; customerId nullable; leadId nullable; resolution UNRESOLVED/AMBIGUOUS/RESOLVED; status OPEN/WAITING/CLOSED; assignedUserId nullable FK; version Int 1; lastActivityAt; createdAt/updatedAt. CHECK at most one customer/lead. Unique(accountId,businessNumberId,externalContactPointId); indexes(status,lastActivityAt,id), assignedUserId |
| `CommunicationReadMarker` | threadId FK; userId FK; lastReadOccurredAt nullable; lastReadMessageId nullable; updatedAt. Unique(threadId,userId). Store each person's cursor, never a shared read boolean; mark read only after authorized thread fetch |
| `CommunicationMessage` | threadId FK; direction INBOUND/OUTBOUND; deliveryId FK nullable unique; providerResourceId nullable; accountId FK; bodyEncrypted nullable (inbound only; outbound reads frozen MessageDelivery payload); bodyHash; occurredAt; receivedAt; actorUserId nullable FK; consentRecordId nullable FK; redactedAt nullable. Unique(accountId,providerResourceId); index(threadId,occurredAt,id). Outbound delivery pointer is mandatory; inbound has no fake send ledger |
| `CommunicationLink` | messageId nullable FK; callSessionId added as nullable FK in L7; entityType allowlisted Customer/Lead/ServiceAddress/RentalAgreement/Job/MaintenanceRequest/Invoice/Estimate/CustomerNotice; entityId; source EXPLICIT/WORKFLOW/STAFF_CONFIRMED; createdAt; actorUserId nullable. L3 messageId NOT NULL; L7 makes it nullable and adds CHECK exactly one message/call parent; unique per parent+entityType+entityId; index(entityType,entityId). Resolve/validate entity in the domain transaction; no client arbitrary subject strings |
| `CommunicationTemplateRevision` | key String; revision Int; channel SMS/EMAIL; purpose TRANSACTIONAL/MARKETING/CONVERSATIONAL (add enum value to MessagePurpose); body; subject nullable; triggerKey allowlisted; variables JSON schema descriptor; policy JSON (enabled,timing,segment filters,quiet-hour handling); isCurrent Boolean false; approvedAt/approvedBy nullable; createdAt/createdBy. Unique(key,revision); partial unique key+channel where isCurrent=true. CHECK revision > 0; template channel/purpose immutable per key. Used versions immutable; edits create another revision |

Thread participants are the fixed business-number/contact-point pair at launch. Group participants and MMS/media attachments are deferred; do not add unused participant tables. Internal notes use existing CustomerNote/LeadNote for resolved records; unresolved thread notes remain deferred; record only resolution/assignment events in AuditLog. Do not store free-text notes in audit summaries or pretend an unresolved-notes editor exists.

### 2.2 Voice (COM-L7)

| Model | Required fields and constraints |
|---|---|
| `CallSession` | accountId, businessNumberId, contactPointId nullable, threadId nullable FKs; direction INBOUND/OUTBOUND; providerRootCallId; actorUserId nullable; routingPolicyVersion; state NEW/RINGING/CONNECTED/ENDED/FAILED; outcome ANSWERED/MISSED/VOICEMAIL/DECLINED/UNKNOWN nullable; startedAt, connectedAt, endedAt nullable; disposition nullable allowlisted + dispositionNote encrypted nullable; version Int 1. Unique(accountId,providerRootCallId); index(threadId,startedAt,id), index(outcome,startedAt) |
| `CallLeg` | callSessionId, accountId FKs; providerCallId; providerParentCallId nullable; role INBOUND/FORWARD/STAFF/CUSTOMER; status QUEUED/RINGING/IN_PROGRESS/COMPLETED/BUSY/NO_ANSWER/CANCELED/FAILED; sequenceNumber nullable; durationSeconds nullable; answeredByStaffAt nullable; startedAt/endedAt; price facts live in cost ledger. Unique(accountId,providerCallId); index(callSessionId) |
| `CommunicationMedia` | callSessionId FK; kind VOICEMAIL/RECORDING/TRANSCRIPT; providerResourceId; privateStorageKey nullable; contentHash nullable; durationSeconds nullable; state PENDING/AVAILABLE/FAILED/DELETED; accessPolicyVersion; retentionUntil nullable; legalHold Boolean false; deletedAt nullable; createdAt. Unique(callSessionId,kind,providerResourceId); index(state,createdAt). No public provider media URL |

### 2.3 Usage and costs (COM-L10)

| Model | Required fields and constraints |
|---|---|
| `TelecomSyncCursor` | accountId; resource MESSAGES/CALLS/USAGE/PRICING/READINESS; nextPageToken nullable; windowStart/end; completedThrough nullable; claimToken/claimUntil nullable; lastSuccessAt/lastFailureAt nullable; lastErrorCode nullable. Unique(accountId,resource). Never advance checkpoint on a partial page failure |
| `TelecomUsageSnapshot` | accountId; category; startDate/endDate (provider GMT dates); count Decimal(24,10), countUnit; usage Decimal(24,10), usageUnit; price Decimal(24,10) nullable; currency; providerAsOf; capturedAt; isTotal Boolean; payloadHash; providerSource String. Unique(accountId,category,startDate,endDate,providerAsOf,payloadHash); index(accountId,startDate,endDate). Append corrected snapshots; latest applicable observation is selected |
| `CommunicationCostFact` | accountId; businessNumberId/messageAttemptId/callLegId nullable FKs; sourceKey; component; classification ESTIMATED/PROVIDER_REPORTED/INVOICE_RECONCILED; amount Decimal(24,10) signed; currency; quantity nullable Decimal; unit nullable; rateVersionId nullable; occurredAt; providerAsOf nullable; recordedAt; supersedesId nullable FK; statementId nullable FK. Unique(accountId,sourceKey,classification); index(accountId,occurredAt,classification). Revisions get a new sourceKey+supersedes link; never sum superseded facts |
| `TelecomRateVersion` | accountId; service/category; destination country/prefix nullable; senderType; component; rate Decimal(24,10); currency; unit; source PRICING_API/OWNER_VERIFIED; effectiveFrom; effectiveUntil nullable; fetchedAt; completeness JSON. Unique(accountId,service,component,destinationKey,effectiveFrom,source) with destinationKey non-null canonical String. No fabricated carrier/tax rate |
| `TelecomStatement` | accountId; externalId; periodStart/end; currency; invoiceTotalCents; issueDate; privateEvidenceStorageKey; evidenceHash; state DRAFT/VERIFIED/SUPERSEDED; revision Int; verifiedBy/At nullable; paidOn nullable; paidFromAccountId nullable (K relation at COM-N); vendorTaxCents nullable; expenseId nullable unique (K relation at COM-N); createdAt. Unique(accountId,externalId,revision). Evidence is private server upload using existing storage controls; no customer DocumentArtifact impersonation |

**Precision exception:** contractual/customer amounts and accounting postings remain integer cents. Raw provider decimal prices/rates/counts are telemetry, preserved exactly with Prisma Decimal, never JS floats. Round the aggregate once to cents at display/statement/Expense boundaries using one named decimal helper. Preserve provider sign semantics per resource (message/call prices vs usage charges); never blindly use abs(), lose refunds, or add currencies. Unknown price is null, not zero.

### 2.4 BusinessSettings policy

COM-L1a adds `BusinessSettings.customerSmsEnabled Boolean @default(false)` as the single outer SMS master gate; it is **not duplicated inside JSON**. COM-L2 adds `communicationsPolicy Json @default("{}")` and `communicationsPolicyVersion Int @default(1)`; validate against a versioned Zod schema. Empty policy = every narrower live telecom feature OFF, and SMS remains OFF whenever the standalone `customerSmsEnabled` master gate is false. Store primaryAccountId/numberId, inboundEnabled=false, voiceRoutingEnabled=false, approvedPolicyVersion, productionWebhookOrigin, timezone from existing business timezone, hours/holiday exceptions, forwarding targets, timeout seconds, acceptance step, after-hours CLOSED/VOICEMAIL, greeting template keys, optional voicemailEnabled=false, retention values, supported destination countries, SMS quiet hours, maximum segments, automatic retry limits, daily/hourly automation circuit limits, budget configuration and current approved template revision IDs.

Initial suggested budget USD 50 monthly, elevated USD 75, critical USD 100 is **only an editable inactive proposal** shown during setup; don't seed it as an activated decision. Anomaly defaults are similarly displayed and accepted; without a baseline show insufficient history. Country rules validate actual US numbering/destination, not simply +1 (shared by other territories). Owner chooses threshold action NOTIFY; circuit breakers pause the offending automation only when explicitly enabled, never globally cut inbound calling or legal notices.

All policy edits are OWNER only, versioned/audited with expected-version conflict checks. Owner screens explain effect, default and reset; structural/provider restrictions are implementation invariants, not arbitrary controls. Secrets remain existing server environment entries; use API key+secret for supported REST operations and account Auth Token for signature verification. New key-secret env names get .env.example placeholders only.

## 3. Provider boundary and command contracts

`src/lib/communications/providers/types.ts` defines account-scoped adapter capabilities. Domain caller never imports twilio. Reuse installed Twilio SDK version first; record the lockfile version at implementation and check its current official API types. No SDK upgrade is implicit.

```ts
type SubmitOutcome =
  | { kind: "ACCEPTED"; resourceId: string }
  | { kind: "REJECTED"; code: string; retryAfterSeconds?: number }
  | { kind: "NOT_ATTEMPTED"; reason: string }
  | { kind: "UNKNOWN"; resourceId?: string };
interface TelecomProvider {
  capabilities: { sms: boolean; voice: boolean; usage: boolean; pricing: boolean; invoices: boolean };
  sendSms(input: { operationId: string; from: string; to: string; text: string; callbackUrl: string }): Promise<SubmitOutcome>;
  fetchMessage(resourceId: string): Promise<MessageObservation>;
  fetchCall(resourceId: string): Promise<CallObservation>;
  listMessages(window: SyncWindow): Promise<ProviderPage<MessageObservation>>;
  listCalls(window: SyncWindow): Promise<ProviderPage<CallObservation>>;
  listUsage(window: SyncWindow): Promise<ProviderPage<UsageObservation>>;
  readReadiness(): Promise<ReadinessObservation>;
  readPricing(): Promise<ProviderPage<RateObservation>>;
  // placeCall added only COM-N, not an unimplemented launch stub
}
```

Observation types must include account/environment/resource identity, status, source timestamps, nullable segments/duration/price/currency and page cursor. Usage supports provider-specific categories and units. invoices=false until an accessible official invoice API contract is proven for this account; launch supports verified statement import. The adapter's operationId is local correlation, **not a claim Twilio Message creation supports exactly-once/idempotent replay**.

Domain signatures (all actor commands re-check `assertActiveTeamActor` in their transactions):
- `requestCommunication(actor, {threadId, context?, templateRevisionId?, body?, operationKey, expectedThreadVersion})`: validates scope, consent, template/policy and records immutable intent+message+attempt+audit atomically; returns delivery ID and queued/blocked reason.
- `dispatchCommunication(deliveryId, now)`: claim attempt once, final activation/consent/context/actor check, render frozen payload, call provider outside DB transaction, finalize with row lock/CAS. Existing `deliverMessage` delegates SMS here after foundation; email compatibility unchanged.
- `ingestVerifiedSms(account, input)`: transactionally dedupes event, records incoming content once, applies consent keyword, resolves contact, updates thread+lead contact evidence and audit, returns stored TwiML acknowledgement.
- `applyVerifiedMessageStatus(account, observation)`, `reconcileTelecomEvents({limit,now})`: common reducer; callback can attach by opaque attempt correlation or SID.
- `resolveCommunicationContact(actor,{threadId,customerId?|leadId?,version,reason})`: only one principal, validates records and bindings, audits; no customer creation or consent grant from matching.
- `getCommunicationInbox(actor,filter,cursor)`, `getCommunicationThread(actor,id,cursor)`, `getCommunicationContext(actor,threadId)`: bounded role-shaped DTOs, stable (time,id) cursors with next-page links and explicit total when requested.
- `recordContactConsent(actorOrSelf,input)`: append evidence and update address projection in one locked transaction. Customer identity derives from session.
- `saveCommunicationTemplate(actor,input,expectedRevision)`: validate allowlisted variables/trigger/policy, create immutable revision, approve separately.
- `getTelecomSpend(actor,{accountId,from,to,basis})`, `syncTelecomUsage({accountId,now,limit})`, `evaluateTelecomAlerts({accountId,now})`.
No call to provider is made while a transaction or row lock is held.

## 4. SMS reliability, matching and compliance

### 4.1 Send and retry state

PENDING → ACCEPTED/FAILED/UNKNOWN/NOT_SENT/SUPPRESSED; ACCEPTED → DELIVERED/FAILED. Provider-specific failure detail lives on the attempt; the existing public labels remain. Terminal state changes use a common serialized reducer; contradictory terminal observations go to reconciliation/owner review, not last-write-wins. Late accepted completion cannot downgrade delivered/failure evidence.

Preparation freezes rendered payload, revision, initiating user, normalized recipient, context, consent evidence and request hash. Reusing a key with a changed recipient/body/context returns CONFLICT. Automatic workflow keys identify event + subject + event version + occurrence; editing a template does not resend an old event.

Only definitely unsubmitted/rejected requests may retry, with bounded backoff and the same frozen payload. 429 can be safe to retry under verified provider behavior; HTTP 408, network timeout, 5xx or process death after DISPATCHING are UNKNOWN and **never replayed automatically for Twilio**. Failure after provider acceptance but before SID persistence is also UNKNOWN. Preserve every attempt and SID, including older delivery-failure attempts; do not clear historical IDs.

Status callback URL includes opaque random attempt correlation (no PII). Verify signature first, then account/resource identity. Early status callbacks are persisted PENDING_MATCH until their local attempt can be linked; do not finish them as ignored. Recovery retrieves resource observations; text/time/destination similarity alone cannot prove a unique send. No-SID uncertainty stays actionable for owner/provider inspection; any new send is a separate explicitly confirmed operation with duplicate-risk wording.

Unmatched/PENDING/UNKNOWN due items are paged with stale-claim recovery and dead-letter visibility. Acknowledging an issue is not evidence of provider success.

### 4.2 Inbound identity and context

Normalize using existing helper tightened with numbering validation. Bind customers, customer contacts and leads; lead-to-customer conversion links evidence without duplication. A unique verified active binding may resolve a person, but **not automatically a property/job/agreement**. Those attach only from explicit workflow context, signed reply token or staff confirmation. Display current candidate jobs/properties as suggestions.

Shared/duplicate/unverified numbers remain AMBIGUOUS; unknown numbers remain UNRESOLVED. Inbox work must not expose one candidate's bills or message history to another. Phone numbers are identifiers for routing, not authentication. Ignore client-provided entity links. Changing a customer's phone never transfers consent to the new phone; revoke/review previous bindings and preserve old messages.

### 4.3 Consent policy

Separate grants for transactional SMS and written marketing consent; inbound exchange grants only replies concerning that exchange. Consent projections are by business sender/contact point/purpose, with source, timestamp, disclosure snapshot/hash and evidence. Phone possession alone, signing a lease, privacy consent and START alone never create broad marketing consent.

STOP (including provider-confirmed synonyms) immediately suppresses all ordinary SMS for the address even if identity is unresolved. Lock that address during preparation/dispatch eligibility checks; queued unsent messages become SUPPRESSED. A send already accepted/in flight cannot be recalled; document that boundary rather than promising absolute race prevention. Natural-language withdrawal seen by staff is recorded through the same command.

Advanced Opt-Out `OptOutType` is authoritative when present. Do not send a second STOP/START/HELP confirmation when Twilio already replied. START clears provider block, records re-enable evidence, and reinstates only a documented approved text-in scope; otherwise require scoped opt-in. Portal opt-in cannot override a provider STOP; surface the need to text START. HELP never enrolls someone. A2P approval is an independent send gate.

Public lead forms, portal preferences and agreement optional disclosures use versioned legal/site-content fields, independent unchecked consent choices, business identity, purpose/frequency, rates disclosure, STOP/HELP and policy links. Keep service available without marketing consent. BP agreement templates reference those approved disclosures, not their own consent system.

SMS delivery/read callbacks do not establish identity, signature or legally sufficient notice service. Existing CustomerNotice kind/method/legal approval and B2 renewal gates remain authoritative. Critical blocked/failed notices offer an allowed alternate channel and Today resolution; no automatic channel switch that changes legal effect.

## 5. Webhook and voice contracts

All telecom routes: HTTPS, bounded request bodies, expected content-type, SDK signature validation over **configured canonical public origin + exact path/query and original form values**. Reject missing/untrusted origin configuration instead of trusting Host/X-Forwarded-Host. Do not parse away parameters before validation; tolerate provider-added fields. Validate AccountSid and configured receiving number/service after signature, before writes. No unsigned fallback, production-account webhook in preview, or copied production credentials in tests.

Traditional Twilio signatures provide authenticity, not a signed expiry. Replay protection is durable semantic event keys and idempotent effects; don't invent a timestamp window that rejects genuine late callbacks. Track retry header separately; it is not the sole business dedupe key. POST storage failure returns retryable error; commit accepted durable receipt before 2xx. Voice action replies cache deterministic TwiML by call/resource/step in ProviderEvent.responseXmlEncrypted; summary keeps only safe routing identifiers, never raw destinations or XML in ops logs. Repeated callbacks do not create extra call legs or instructions.

| Endpoint | Responsibility |
|---|---|
| Existing `POST /api/webhooks/twilio` | Preserve old status callback contract; distinguish status from inbound by validated payload shape; delegate to shared verification/ingestion |
| `POST /api/webhooks/twilio/sms` | Incoming SMS; durable receipt and empty TwiML Response. Incoming MMS stores a visible unsupported-media flag, no fetch/reply loop; MMS remains off |
| `POST /api/webhooks/twilio/voice` | Incoming call identity/session; frozen routing-policy choice; SDK-built Dial TwiML |
| `POST /api/webhooks/twilio/voice/accept` | Private press-to-accept step on forward destination; Gather then staff acceptance; personal voicemail does not count as human answer |
| `POST /api/webhooks/twilio/voice/dial-result` | Persist parent/child relation, answered/missed outcome; approved voicemail or greeting/hangup |
| `POST /api/webhooks/twilio/voice/status` | Per-leg progress with SequenceNumber where supplied; terminal outcomes monotonic; fetch later authoritative resource when conflicting |
| `POST /api/webhooks/twilio/voice/media` | Approved voicemail/recording lifecycle; availability ≠ stored media. Import using authenticated provider API, not arbitrary callback URL |
| `GET /api/communications/media/[id]` | Authenticated scope check + short-lived private access, same protection as existing private photos |
| Existing cron reconciliation + job reminder routes | Add bounded telecom reconciliation/dispatch passes via AutomationRun; keep existing CRON_SECRET and pause conventions |

### 5.1 Launch call routing

Configure business hours/holidays in Denver timezone and one verified owner destination. Never forward to the business number, to an unapproved target, or to the inbound caller dynamically. Use timeout, maximum legs and press-to-accept to avoid loops/personal voicemail interception. Freeze route version per call. Record separate inbound and forwarding legs and durations; a completed parent call is not proof staff answered.

After-hours CLOSED reads approved greeting then hangs up; VOICEMAIL requires recording policy and media retention approval. No route or disabled voice yields a safe approved unavailable greeting/hangup and a provider issue, never a caller-controlled Dial. For app outage, external provider fallback URL/TwiML configuration is a reviewed owner setup step; launch test must prove it, not assume app code can handle its own outage. No paid provider configuration from engineering.

Voicemail records only the caller's intentional message after clear announcement; ordinary conversation recording and transcription are independently gated and off. Store private media; authorized deletion removes provider copy and local/recovery copies under privacy policy. Legal hold prevents routine purge. A transcription failure never hides playable voicemail.

### 5.2 Evolution

COM-N click-to-call: authorized staff's configured verified destination rings first, they accept, then Twilio dials the customer with the verified company caller ID. Persist both legs, actor and allowed job/customer link. Unknown call creation never auto-retries. No emergency dialer/personal-number substitution.

COM-A browser Voice SDK: authenticated short-lived, user-bound access tokens; active session/capability and assigned-work authorization before call initiation, approved outgoing application and verified caller ID. Add queues/on-call/IVR only from observed need. Native background calling and push delivery require a separately designed app; no browser promise that mobile browsers ring reliably while closed.

## 6. Cost ingestion, accounting and truthful totals

### 6.1 Three independent evidence layers

1. **Estimated:** frozen local segments/durations × applicable rate version plus known recurring charges. Missing carrier/fee/tax components explicitly mark incomplete estimate.
2. **Provider reported:** Message/Call resources and Usage Records; prices may arrive later. Store resource charge components separately from aggregate usage. Usage includes products resource logs may omit.
3. **Invoice reconciled:** owner-verified statement/CSV evidence with currency, period, total and adjustments. No automatic finalized label from month-end or API timing.

Don't sum these layers. For account total use the provider's total-price category for the identical provider period; child categories are an explanatory breakdown, not additional charges. Maintain a tested non-overlapping category mapping; residual = total minus classified categories, shown as unallocated/adjustments. Unknown categories are visible and trigger review. Never sum daily and monthly snapshots together, parent/child categories together, Message prices plus Usage totals, or invoice total plus prepaid top-ups.

Message/Call resources may supply prices, segments and durations after send. Forwarding costs include both legs; optional speech/media products are separate components. Phone/A2P recurring charges, carrier surcharge, platform fee and tax are included only where observed or verified. Invoice/API mismatch remains unresolved with tolerance and missing components shown, not force-balanced.

Account-wide reported spend may include another application's usage. Setup must identify whether this account is dedicated. If shared, show total account spend separately from reliably attributed Appliance Desk resource costs; ambiguous category/number costs remain unallocated. A new dedicated account/subaccount is an owner decision with paid/provider setup review, not automatic provisioning.

### 6.2 Sync algorithm

Read-only account-scoped adapter lists; validate returned identity/currency; page until cursor checkpoint or bounded runtime, then resume. Persist each page transactionally with unique source keys and AutomationRun. Do not advance past failed pages. Rolling overlap (owner schedule default proposal: recent 7 days, current and previous billing month daily, older corrections on owner request) repairs late charges; append updated snapshots. Separate provider GMT day/month totals from Denver business reporting intervals; never relabel UTC-month provider totals as exact Denver-month totals.

Price snapshots fetched daily/proposed; source timestamp and freshness shown. Unsupported rate/price returns unknown; no current website price scraped as a customer/account contract. Budget/spike checks use the freshest complete comparable window; a stale sync also raises a health issue. Incomplete month data is clearly flagged.

Preserve completed cursors and last successful totals on outage; show stale, not zero. Alert on significant discrepancy above owner-selected absolute AND/OR percent tolerance with explicit combination semantics. Refund/credit/adjustment facts preserve signs. Never convert a Twilio account balance or recharge into communications expense automatically.

### 6.3 Books (COM-N after K)

Twilio invoice evidence creates a **draft** existing Expense, category Communications, vendor Twilio, total cents, tax from verified statement, paid date/source account confirmed by owner. Until actual payment is confirmed, show unposted obligation in telecom reconciliation, not paid Expense. Post using K's existing command and unique statement/expense linkage under lock; journal source is EXPENSE, never another telecom journal source. Top-ups are not booked again as invoice expense; accountant-approved prepaid treatment uses K/owner decision before automation.

An existing manually entered matching bill requires explicit link/review, never a second entry. Corrections void/reverse using K's normal path and closed-period policy. No direct journal writes or rewriting closed months. Expenses/journal evidence are retained even after communication content deletion.

### 6.4 Segment preview

Implement one pure GSM-7/UCS-2 calculator: extended GSM characters consume escape units; non-GSM uses UTF-16 units including surrogate pairs. For the proposed local SMS sender use 160/153 GSM and 70/67 UCS-2 capacities; test boundary placement and escape pairs against Twilio's calculator. Render variables and required disclosure/footer first. Smart Encoding is off until its exact transformation is configured and reflected in frozen payload/preview.

Show example and worst-known variable lengths, encoding, units, predicted segments, known cost components and unknown fees. Empty text has zero segments; overlong output blocks with explanation. A change of encoding/segment count warns on save and activation; the dispatch limit re-checks real rendered content. Provider reported NumSegments supersedes prediction in usage analytics without rewriting original estimate.

## 7. Existing surface integration and metrics

This matrix is the required implementation surface inventory. Existing runtime surfaces were inspected through their domains and bounded references; K/S/O/BP entries are future design dependencies, not claims of installed screens.

| Existing surface | Launch enhancement | Near-term / boundary |
|---|---|---|
| Today + `domains/exceptions` | Unresolved inbound, unreturned missed calls/voicemail, important notification failures with direct resolving link and permission-shaped counts | Suppressed legal notice retains existing obligation and alternate method workflow |
| Batch S System health / private ops | Typed PII-free fingerprints for provider unavailable, callback backlog, A2P/sender not ready, usage-sync stale, cost anomaly | No body, phone, customer ID, media link or raw provider payload in AI-checkup output; don't duplicate a job/run issue already represented by S |
| `/desk/automations` | Telecom event replay, dispatch, usage/cost sync and readiness rules with freshness/paused/never-ran states | Add rules through existing registry, no second health dashboard |
| Settings provider status | Verified account/number capabilities, A2P status, activation gates, latest successful inbound/outbound, last callback/sync | Configuration edits OWNER only; general health ADMIN; financial details finance-permission only |
| `/desk/communications` (new business workflow) | Inbox tabs SMS / Missed calls / Voicemail; unread per-user cursor; assigned/unassigned; resolved/unresolved; channel/status/date filters; context and reply | Assignment/activity record, cursor history, keyboard/mobile/dark/axe. No duplicate cost dashboard here |
| Customer and lead workspaces, existing MessageHistoryPanel/timeline | Unified communications stream incl accepted vs delivered, incoming replies and call outcomes; safe links; old outbound preview links to full page | Append communications cursor kind with time/source/id stable ordering; lead contact evidence records genuine inbound/call outcomes |
| Jobs / dispatch / driver | Reminder outcome and linked contact attempts for assigned job | STAFF sees only current assigned-job context and allowed fixed transactional templates; no company inbox, unrelated history or billing details |
| Maintenance / work-order detail | Related communications and important failed scheduling notices | Automations by configured rule; no inferred relation from same phone |
| Billing / deposits / renewals/cancellation | Related message evidence and unresolved notification problems; accepted never means legal notice delivered | No amounts in STAFF DTOs; collections/renewal SMS wording needs legal approval |
| `/desk/dashboard` | Owner/Admin unresolved work count, failed notifications; finite widgets only | Company's spend/budget summary only authorized finance users |
| `/desk/reports`, `/desk/revenue` | Communications cost section: provider-period/month label, evidence basis, current/previous spend, channel breakdown, budget and drill-through | Do not subtract telecom estimates from collected-rent/earnings as actual profit. Existing rental revenue remains intact |
| `/desk/growth` / lead reporting | Last contact, consent and unresolved-contact evidence | Response-time, contact attempts/outcomes; no claim SMS caused conversion |
| `/desk/fleet` | No arbitrary allocation of fixed telecom costs to appliances | Only actual explicit job attribution; fleet lifetime revenue/cost metrics stay unchanged until an approved allocation method exists |
| K P&L/expenses/export/year-end/forecast | Deferred until K; launch cost evidence remains available | Verified posted Expense feeds P&L/export once, forecast uses evidence-labelled expected communications expense |
| O goals/switches/permissions | New switches appear in existing read-only switch inventory when O lands | Goal keys from shared METRICS, no second goal system |
| BP business scenarios/campaign economics | No standalone partner attribution | Observed telecom unit economics and approved campaign links; no causality invented |

Register each metric in `src/domains/reports/definitions.ts` with basis, source, date boundary, exclusions, freshness and drill. Keep ACTUAL/ESTIMATE registry semantics: provider-observed counts are ACTUAL, projected spending ESTIMATE; label “provider reported, not invoice reconciled” explicitly. Do not misclassify a known provider charge as finalized books.

Launch keys: `communications.inboundMessages`, `outboundAccepted`, `delivered`, `failed`, `missedCalls`, `unresolvedContacts`, `telecom.reportedSpend`, `estimatedSpend`, `reconciledSpend`, `budgetRemaining`, `usageSyncAge`.
Near-term keys: `telecom.projectedSpend`, `costPerActiveCustomer`, `costPerContactedCustomer`, `costPerLinkedJob`, `spendPercentRentalRevenue`, `outboundSegmentsPerActiveCustomer`, `voiceMinutesPerActiveCustomer`, `communications.medianResponseMinutes`, `deliveryFailureRate`, `optOutRate`.

Definitions:
- Active-customer denominator = distinct customers with ACTIVE agreements on each business day; average daily count across matching report interval. Null if no supported historical coverage; never divide by today's count and call it historical unit economics.
- Contacted-customer denominator = distinct confidently linked customers with provider-accepted outbound or genuine inbound contact, excluding keyword-only/system events.
- Job/customer attribution includes only linked resource costs. Fixed/shared fees remain unallocated; allocation estimate is separately labelled if approved later.
- SMS success rate = delivered / resolved delivery attempts, with accepted/pending/unknown counts displayed separately. Retries are attempts, not new customer messages. No SMS “read” analytics promise.
- Response time = inbound business exchange to first authorized human response; exclude auto-acks and keyword events; show sample count, ordinary elapsed and business-hours basis. No employee league tables or surveillance.
- Rental-revenue ratio requires recognized net rental revenue from K for the same interval/basis; before K show unavailable, not cash/ARR substituted silently.

Forecast once at least one configured complete comparable observation window exists. Observed variable spend / active-customer-days × scenario customer-days + known fixed recurring charges; use 200/250/500/1,000 as editable scenarios, not budget facts. Display historical window, coverage, customer-days and limitations; show insufficient history otherwise. Projection splits incurred cost from remaining-days expectation and avoids double counting fixed charges. Volume discounts/new feature adoption require refreshed rates and are not assumed.

## 8. Access, retention and operational failures

| Actor | Launch rights |
|---|---|
| OWNER | All communication operations, verified statements/costs, policy/number setup, template approval |
| ADMIN | Company inbox/context/replies/assignment, operational health and existing authorized financial reports; cannot activate provider/change policy/approve disclosures |
| STAFF | No general inbox/phone matching or company costs; later approved job-scoped fixed templates/click-to-call only on assigned job |
| CUSTOMER | Own contact preferences/consent; no internal inbox, staff notes, provider billing or another person's shared-number history |
| Ops AI key (S) | Safe issue summaries only; no communication contents, recordings, consent payloads, finance evidence or send operations |

Later O capability overrides may refine operational roles without adding new Role enum values. Enforce permissions in domain queries/actions/search/exports/media, and re-check actor scope at dispatch (deactivated staff cannot finish queued work). Plain-text message/voicemail content is private, encrypted using server-held versioned key references; keys excluded from backups. Reuse verified private-storage primitives and privacy/recovery tombstones. Never log tokens, numbers, message bodies or callback forms.

Retention settings separately control content/media, delivery metadata, consent and finance evidence. Activation requires accepted retention/legal-hold policy (IN-52); choose no invented statutory duration. Content can be redacted while preserving hashes/counts/costs/audit evidence; consent retained for applicable proof obligations. Privacy purge includes provider copies and backup media under existing runbook. No public short links to signed documents/payment details are inserted in messages unless existing token/access policy permits them.

| Failure | Deterministic response |
|---|---|
| Missing creds, removed number, not-ready A2P, switch off | NOT_SENT with exact non-secret blocker; no fallback to personal sender/provider |
| Invalid number/no scoped consent/STOP | Block/suppress before provider; alternate authorized channel and Today if required notice |
| Provider rejection / delayed callback | Record code/attempt; retry only known safe rejection; overdue accepted sends query provider |
| UNKNOWN/no SID | Hold, owner-visible issue, no automatic replay; explicit separate resend only after review |
| Ambiguous/unmatched incoming contact | Store safely, unresolved inbox, no private cross-account context |
| Call destination fails/busy/no staff accepts | Missed record; approved voicemail/greeting; actionable inbox |
| App/storage unavailable | Retry webhook where appropriate; tested provider fallback for voice; media availability remains pending |
| Usage/rate fetch fails | Keep previous observations, mark stale/incomplete, AutomationRun + S issue |
| Estimate/provider/statement mismatch | Keep separate totals, missing components/tolerance, reconciliation issue |
| Spend exceeds threshold | Notify Today/authorized email via existing messaging, dedupe period+tier; doesn't cut customer contact |
| Automation spike/loop | Deterministic volume/error/window checks; alert; optional approved per-rule circuit pause; no auto global disable |
| Credential abuse/destination violation | Reject non-approved destination/features; high S issue and owner rotation runbook; no secret in issue |
| Alert SMS fails | Today and independent authorized email remain; never rely solely on the failing provider for its alert |

Ops sources use `recordSystemIssue` typed templates/fingerprints and `resolveSystemIssue` from S. Customer-specific work belongs in normal protected exceptions/inbox. Budget issues reset/reopen by month+tier; sync issues resolve after actual recovery. Notifications coalesce by incident, with no alert-generates-alert loops.

## 9. Work units and bounded PR sequence

This is a dependency plan, not a promise every cluster fits budget. Mandatory individual cards use PLAYBOOK's ~500 production lines/~15 files/one risk area limit. If measured scope is larger, split at a complete tested contract; no placeholder adapters/screens. Cards for L1a/L1b/L2 are supplied now; generate remaining bounded cards against current code at each predecessor boundary before implementation. One batch stack; at most two unmerged dependent implementation PRs.

| PR / unit | Risk area and deliverable | Dependencies / evidence |
|---|---|---|
| COM-L1a | Sender safety: no UNKNOWN SMS replay; all-SMS STOP; explicit production+owner activation fence | Current E; real DB timeout/STOP/isolation tests; no schema |
| COM-L1b | Event integrity: serialized finalization/status reducer, unmatched callback replay | L1a; early-callback/concurrent state tests; no schema, existing processedAt=null/summary identifies replayable events |
| COM-L2 | Foundation schema: account/number/contact/binding/attempt, ProviderEvent/ConsentRecord extensions, communicationsPolicy; migration/backup coverage | L1; populated additive upgrade + restore; draft policy only |
| COM-L3 | Inbox/template schema: thread/message/link/template revision, MessagePurpose addition, payload snapshots | L2; one migration; stable cursor fixtures; no live behavior |
| COM-L4 | Provider/account adapter and dispatch: connect existing SMS delivery, attempt claims/correlation, last-minute consent/readiness check | L3; provider mocks plus DB races, env/test isolation |
| COM-L5 | Inbound SMS, deterministic resolution, scoped consent and STOP/START/HELP projection; public/portal consent actions | L4; signatures/account/body-bound tests; form disclosure approval remains separate |
| COM-L6 | SMS templates + essential manual inbox/history/consent UI; migrate existing day reminder | L5; safe render/segments tests, scoped actions, one browser flow; split provider-vs-screen work if budget exceeded |
| COM-L7 | Voice/media schema plus private retention/storage contract | L3; one migration + backup/privacy tests |
| COM-L8 | Voice forwarding, press-to-accept, child/parent callbacks, missing routing/fallback instructions | L7; deterministic TwiML and duplicate/out-of-order DB tests |
| COM-L9 | Optional approved voicemail ingest/private access and missed-call/voicemail inbox integration | L8; private-media isolation/tombstone tests, roles; no ordinary recordings/transcription |
| COM-L10 | Cost/usage/rate/statement/cursor schema and exact decimal helpers | L4/L8; one migration, precision/negative/null/restore evidence |
| COM-L11 | Read-only usage/pricing/readiness sync, page checkpoints, provider reported resource costs | L10; fixture API pagination/late correction/GMT window tests |
| COM-L12 | Estimates + usage/statement reconciliation, non-overlapping aggregates, budget/anomaly evaluation | L11; known fixtures, no double counting, missed invoice components explicit |
| COM-L13 | Owner telecom policy/template/number/cost settings UI, safe verified statement import, report/dashboard/Today/S/automation integration | L12; split settings/screens/report contracts into bounded cards; no provider configuration mutation |
| COM-L14 | Customer/lead/job/maintenance/billing/renewal surface integration and combined timeline pagination | L6/L9/L13; context/authorization, stable equal-time merge, bounded workload proof |
| COM-L15 | Launch regression, A2P/setup runbook, owner guide and F/launch acceptance ledger | All selected L units; adversarial DB + browser workflow; no claim live setup completed |
| COM-N1 | New transactional template/event families in groups: lead/estimate/signature; job/maintenance; billing/renewal/refund | COM-L, approved wording/consent; one family per bounded card; existing notice gates preserved |
| COM-N2 | Click-to-call and staff job-scoped communication actions | COM-L + current O permission contracts; actor deactivation, caller-ID/dual-leg/unknown tests |
| COM-N3 | K verified statement → existing draft/post Expense bridge, export/P&L/forecast integration | K + L12; duplicate manual expense link, closed-period/rounding tests |
| COM-N4 | Response/service metrics, unit economics, forecasts and deterministic spike/circuit controls | Historical evidence coverage + K/O where needed; zero denominators/sparse history/DST |
| COM-A | Browser softphone, queues/on-call, ordinary recording/transcription, AI only if justified | Separate accepted design and recording/paid setup gates; not scheduled or silently implemented |

L1 is the highest-priority launch safety correction once its design/card acceptance is recorded. T remains active meanwhile. L9 voicemail may be delivered OFF pending IN-52, but its launch selection must explicitly state whether voicemail is required. Any deferred L surface is recorded unmet rather than declaring COM-L complete.

## 10. Acceptance and meaningful tests

- **Transport:** HTTP accepted then response lost causes one provider request; concurrent worker/manual same key yields one effective local claim; changed payload same key conflicts; no-SID unknown remains visible; stale DISPATCHING never resends automatically.
- **Reducer:** callback before request returns, delayed callback after retry, same event twice, delivery vs failure concurrent, finalization after DELIVERED, rollback on audit error; every old attempt SID is addressable. Real PostgreSQL tests, not sequential mock calls alone.
- **Consent:** STOP concurrent with queue/dispatch, ambiguous/shared number, portal change and STOP race, START without marketing evidence, HELP/no double reply, natural-language staff revoke, phone change; final send gate blocks suppressed transactional SMS.
- **Webhook:** wrong/missing signature, altered query/form/origin, wrong account/number, unknown env, oversized payload, production traffic in preview, replay and new optional fields; no secret/PII in logs.
- **Matching:** 0/1/2 candidates, customer contact/lead conversion, reassigned phone, multiple open jobs/properties. No automatic sensitive subject attachment.
- **Voice:** staff human accepts vs personal voicemail, busy/no-answer/forward-loop, parent+child duration, late sequence, app fallback, after-hours/DST/holidays, no route; media inaccessible to STAFF/CUSTOMER/other tenant context.
- **Templates:** allowlist rejects expression execution/unknown variables; freezes revision; cannot remove required disclosure; encoding boundaries, escapes/surrogates and variable expansion; cost unknown if missing rate; segment-limit block.
- **Costs:** event resource and Usage/statement are not added together; parent/child/daily/month overlap; total category residual, shared account, signed credits, different currencies, provider rounding, late price, incomplete fee/tax; fake precise zero prohibited.
- **Sync:** concurrent claim, page failure/checkpoint resume, deleted provider resource, correction history, stale data, bounded runtime/limit with real navigation.
- **Metrics:** date/currency/basis consistency; active-customer-days history, zero customer/revenue, insufficient history, auto-replies excluded from response time, strict linked job attribution.
- **Accounting:** same statement twice/concurrently, already-booked manual bill, top-up and invoice not double expense, posted correction/closed month, integer-cent balanced journal via K.
- **Access/isolation:** all queries/actions/search/exports/media/cost widgets, deactivated actor at dispatch, copied production keys, missing runtime markers, phone binds not authentication. Test adapter produces test-only rows and never hits live Twilio.
- **Scale/browser:** >100 messages/threads/calls/cost pages with equal timestamps, stable cursors and next links; 360/768/1440 light/dark keyboard/axe; restoration preserves dedupe/cost facts and excludes keys/deleted media.
- **Launch proof:** one permitted contact → template SMS → callback → inbound reply → resolved thread; incoming call → forwarding acceptance or missed/approved voicemail; failure/STOP/unknown/outage → actionable existing Today/S; estimates vs provider totals vs verified invoice shown distinctly. F-part-2 replays these in final product.

No tests were run for runtime behavior during this documentation-only design. Existing test names were inspected as evidence of current expectations, not re-run. New features remain unimplemented until their PRs meet full CI, preview, review and acceptance gates.

## 11. External readiness and owner decisions

Reuse IN-03 (permanent public number) and IN-09 (sender/A2P/live SMS); no duplicate question. Add IN-51 (telecom account scope, forwarding and activation choices), IN-52 (recording/voicemail/privacy/retention approval), IN-53 (budget/destination/threshold policy). All can be engineered OFF before answers.

Checklist/runbook: `docs/runbooks/COMMUNICATIONS-TWILIO.md`. New secrets, key rotation and canonical webhook origin in ARCHITECTURE; field/model details enter DATABASE when migrations land; runtime rules enter BUSINESS-RULES when accepted/implemented. The design, plan and cards are the implementation handoff. Do not rewrite completed E as unbuilt.

## 12. Official research checked 2026-10-07

Links below establish vendor behavior; architecture/phase choices are this design's decisions. Re-check sources and account API availability before each affected implementation. No market price is encoded as fact.

- [Messaging Policy](https://www.twilio.com/en-us/legal/messaging-policy): scoped consent, reply-only inbound exchange, separate informational/promotional evidence and withdrawals.
- [A2P business information](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/collect-business-info) and [separate consent rejection](https://www.twilio.com/docs/api/errors/30913): entity/campaign/opt-in proof and separate marketing choice.
- [Advanced Opt-Out](https://www.twilio.com/docs/messaging/tutorials/advanced-opt-out): provider keyword result/confirmation coordination.
- [Secure webhooks](https://www.twilio.com/docs/usage/webhooks/webhooks-security), [connection overrides](https://www.twilio.com/docs/usage/webhooks/webhooks-connection-overrides), [API best practices](https://www.twilio.com/docs/usage/rest-api-best-practices): validation and retry boundaries.
- [IncomingPhoneNumber](https://www.twilio.com/docs/phone-numbers/api/incomingphonenumber-resource): owned number capabilities; buying/porting is distinct from campaign approval.
- [Message resource](https://www.twilio.com/docs/messaging/api/message-resource), [Usage Records](https://www.twilio.com/docs/usage/api/usage-record) and [call-log billing differences](https://www.twilio.com/docs/voice/why-doesnt-my-invoice-match-what-i-pull-from-the-call-logs): delayed resource pricing vs wider billing evidence; totals/categories need reconciliation.
- [Messaging pricing API](https://www.twilio.com/docs/messaging/api/pricing), [Voice pricing](https://www.twilio.com/docs/voice/pricing), [number pricing](https://www.twilio.com/docs/phone-numbers/pricing): account-specific rate snapshots.
- [SMS length](https://www.twilio.com/docs/glossary/what-sms-character-limit): encoding/segmentation preview.
- [Dial](https://www.twilio.com/docs/voice/twiml/dial), [Number](https://www.twilio.com/docs/voice/twiml/number), [Record](https://www.twilio.com/docs/voice/twiml/record), [Voice JavaScript SDK](https://www.twilio.com/docs/voice/sdks/javascript): forwarding/acceptance, approved voicemail and later browser calling.
- [Twilio billing](https://www.twilio.com/docs/usage/billing): invoice/group features vary; launch does not invent a universally available finalized-invoice API.

**Stop-and-ask only for genuine decisions:** accepted scope/order changes, replacing the company number/provider, paid activation, legal/recording approval, unsupported invoice API required for automation, account-wide costs mixed with other businesses, or conflicting K money/notice rules. Routine implementation names/splits are resolved through current code and bounded cards.
