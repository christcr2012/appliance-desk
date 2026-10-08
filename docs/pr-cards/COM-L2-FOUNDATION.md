# COM-L2 — Telecom foundation schema

**PROPOSED; requires COM acceptance, L1a/L1b and refreshed schema drift check.**
Base: final L1b branch or current main with L1a/L1b merged.
Risk: schema · Migration: one additive `<next_timestamp>_com_foundation` · Budget: ~400 production lines/<10 files.
Design: BATCH-COM sections 2.1/2.4. No runtime sends, UI, new adapter or provider configuration.

## Read only
AGENTS/STATUS/MASTER-ROADMAP; prisma/schema.prisma headings for User, Customer, Lead, CustomerContact, BusinessSettings, ConsentRecord, MessageDelivery, ProviderEvent;
current backup table inventory/restore schema policy and tests/schema-health.test.ts;
scripts/check-migrations.mjs; BATCH-COM section 2.1/2.4. Never read whole schema.

## Before starting
No names below conflict with merged schema. Current User/Customer/Lead/CustomerContact PKs are String cuid.
Existing email MessageDelivery and ProviderEvent rows must remain unchanged and valid.
If this card is over measured budget, split schema by contact vs attempt/account before implementation and update roadmap; do not combine code consumers.

## Exact new Prisma definitions
```prisma
enum TelecomEnvironment {
  PRODUCTION
  TEST
}
enum TelecomAccountStatus {
  UNCONFIGURED
  READY
  DEGRADED
  DISABLED
}
enum TelecomRegistrationStatus {
  UNKNOWN
  PENDING
  APPROVED
  REJECTED
}
enum ContactSuppressionState {
  NONE
  OPTED_OUT
  REVIEW
}
enum ContactBindingSource {
  LEGACY
  SELF_SERVICE
  INBOUND
  STAFF
}
enum CommunicationConsentPurpose {
  SMS_TRANSACTIONAL
  SMS_MARKETING
  SMS_CONVERSATIONAL
}
enum CommunicationConsentAction {
  GRANT
  REVOKE
  PROVIDER_REENABLE
  HELP
}
enum CommunicationConsentSource {
  PORTAL
  WEB_FORM
  SIGNED_DISCLOSURE
  INBOUND_EXCHANGE
  PROVIDER_KEYWORD
  STAFF_EVIDENCE
}
enum MessageAttemptState {
  PREPARED
  DISPATCHING
  ACCEPTED
  REJECTED
  UNKNOWN
  NOT_SENT
}
enum ProviderEventDisposition {
  RECEIVED
  PENDING_MATCH
  APPLIED
  IGNORED
  FAILED
  LEGACY_HANDLED
}
enum CommunicationOrigin {
  AUTOMATION
  MANUAL
}

model TelecomAccount {
  id String @id @default(cuid())
  provider String
  environment TelecomEnvironment
  externalAccountId String
  label String
  status TelecomAccountStatus @default(UNCONFIGURED)
  checkedAt DateTime?
  readiness Json @default("{}")
  numbers BusinessPhoneNumber[]
  deliveries MessageDelivery[]
  attempts MessageAttempt[]
  events ProviderEvent[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@unique([provider, environment, externalAccountId])
}
model BusinessPhoneNumber {
  id String @id @default(cuid())
  accountId String
  account TelecomAccount @relation(fields:[accountId], references:[id], onDelete:Restrict)
  address String
  providerNumberId String
  messagingServiceId String?
  capabilities Json @default("{}")
  registrationStatus TelecomRegistrationStatus @default(UNKNOWN)
  isPrimary Boolean @default(false)
  verifiedAt DateTime?
  retiredAt DateTime?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@unique([accountId,address])
  @@unique([accountId,providerNumberId])
}
model ContactPoint {
  id String @id @default(cuid())
  environment TelecomEnvironment
  channel MessageChannel
  address String
  suppressionState ContactSuppressionState @default(NONE)
  suppressionVersion Int @default(0)
  stoppedAt DateTime?
  bindings ContactBinding[]
  consents ConsentRecord[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@unique([environment,channel,address])
}
model ContactBinding {
  id String @id @default(cuid())
  contactPointId String
  contactPoint ContactPoint @relation(fields:[contactPointId], references:[id], onDelete:Restrict)
  customerId String?
  customer Customer? @relation(fields:[customerId], references:[id], onDelete:Restrict)
  leadId String?
  lead Lead? @relation(fields:[leadId], references:[id], onDelete:Restrict)
  customerContactId String?
  customerContact CustomerContact? @relation(fields:[customerContactId], references:[id], onDelete:Restrict)
  source ContactBindingSource
  verifiedAt DateTime?
  revokedAt DateTime?
  createdAt DateTime @default(now())
  @@index([customerId])
  @@index([leadId])
  @@index([customerContactId])
  @@index([contactPointId,revokedAt])
}
model MessageAttempt {
  id String @id @default(cuid())
  deliveryId String
  delivery MessageDelivery @relation("DeliveryAttempts",fields:[deliveryId],references:[id],onDelete:Restrict)
  accountId String?
  account TelecomAccount? @relation(fields:[accountId],references:[id],onDelete:Restrict)
  attemptNumber Int
  operationKey String @unique
  state MessageAttemptState @default(PREPARED)
  providerResourceId String?
  requestHash String
  startedAt DateTime @default(now())
  finishedAt DateTime?
  errorCode String?
  nextAttemptAt DateTime?
  currentFor MessageDelivery? @relation("CurrentMessageAttempt")
  @@unique([deliveryId,attemptNumber])
  @@unique([accountId,providerResourceId])
  @@index([state,startedAt])
  @@index([deliveryId])
}
```

## Existing model extensions (exact fields; keep everything existing)
```prisma
// BusinessSettings
communicationsPolicy Json @default("{}")
communicationsPolicyVersion Int @default(1)
// Customer
contactBindings ContactBinding[]
// CustomerContact
contactBindings ContactBinding[]
// Lead
contactBindings ContactBinding[]
communicationConsents ConsentRecord[]
// User
initiatedMessageDeliveries MessageDelivery[] @relation("MessageDeliveryActor")
// ConsentRecord
contactPointId String?
contactPoint ContactPoint? @relation(fields:[contactPointId],references:[id],onDelete:Restrict)
leadId String?
lead Lead? @relation(fields:[leadId],references:[id],onDelete:Restrict)
purpose CommunicationConsentPurpose?
action CommunicationConsentAction?
source CommunicationConsentSource?
disclosureVersion String?
textHash String?
occurredAt DateTime?
scope Json?
@@index([contactPointId,purpose,occurredAt,id])
// MessageDelivery
telecomAccountId String?
telecomAccount TelecomAccount? @relation(fields:[telecomAccountId],references:[id],onDelete:Restrict)
attemptHistory MessageAttempt[] @relation("DeliveryAttempts")
currentAttemptId String? @unique
currentAttempt MessageAttempt? @relation("CurrentMessageAttempt",fields:[currentAttemptId],references:[id],onDelete:Restrict)
requestHash String?
renderedBody String?
renderedSubject String?
actorUserId String?
actorUser User? @relation("MessageDeliveryActor",fields:[actorUserId],references:[id],onDelete:Restrict)
scheduledFor DateTime?
origin CommunicationOrigin?
environment TelecomEnvironment?
// ProviderEvent
telecomAccountId String?
telecomAccount TelecomAccount? @relation(fields:[telecomAccountId],references:[id],onDelete:Restrict)
environment TelecomEnvironment?
disposition ProviderEventDisposition @default(RECEIVED)
attempts Int @default(0)
nextAttemptAt DateTime?
lastErrorCode String?
responseStepKey String?
responseXmlEncrypted String?
@@index([disposition,nextAttemptAt])
@@index([telecomAccountId,receivedAt])
```

SQL:
- ContactBinding CHECK num_nonnulls(customerId,leadId,customerContactId)=1.
- Partial unique each (contactPointId, customerId / leadId / customerContactId) WHERE revokedAt IS NULL AND corresponding id IS NOT NULL.
- BusinessPhoneNumber partial unique accountId WHERE isPrimary AND retiredAt IS NULL.
- MessageAttempt CHECK attemptNumber>0; ProviderEvent CHECK attempts>=0; ContactPoint CHECK suppressionVersion>=0; BusinessSettings CHECK communicationsPolicyVersion>0.
- ContactPoint CHECK channel='SMS' for launch.
- ProviderEvent `processedAt` history remains untouched. Do **not** backfill existing processed rows as APPLIED: legacy handlers also marked ignored/unrecognized and some unmatched events processed. Add/use an explicit `LEGACY_HANDLED` disposition for every pre-migration row with non-null `processedAt`; use RECEIVED only where `processedAt` is null. Later reconciliation may promote a legacy row only when current evidence proves a more specific disposition. No APPLIED/PENDING_MATCH invention without source inspection.
- No data migration that infers consent, normalizes existing phone columns, creates phone numbers, labels historical data PRODUCTION, or generates financial facts.
- CurrentAttempt cross-row linkage to its own delivery is validated by the later transactional command; test that command at L4. This card does not claim the FK proves that invariant.
- Future schema additions are L3/L7/L10 only after cards name exact text.

## Tests (real PostgreSQL)
tests/communications-foundation-integration.test.ts:
“legacy email and event rows survive additive upgrade”
“binding requires exactly one entity”
“duplicate active binding is rejected but revoked history can coexist”
“two concurrent primary numbers cannot both activate”
“attempt sequence and provider-resource uniqueness hold”
“empty policy never authorizes telecom”
Upgrade a populated throwaway database and restore exported new rows. Backup includes all five tables and retained event/consent/attempt fields; secrets remain excluded.
No browser test or provider API.

## Done
Migration checker, Prisma validation/generation, typecheck/lint, real DB schema/upgrade/backup tests and exact-head CI green; STATUS/DATABASE updated. Settings remain empty, no activation, historical consent untouched.
