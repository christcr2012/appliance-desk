# COM-L4A — consent eligibility and immutable communication intent

Status: IMPLEMENTING. Baseline main `958031f`, predecessor COM-L3 #352 merged.
Design: BATCH-COM §2.4, §3 and §4.3; roadmap COM-L4A.
Risk: authorization/consent and message preparation, without provider activation. No migration.

## Drift A
- BusinessSettings.customerSmsEnabled defaults false, communicationsPolicy '{}' with version 1; strict versioned policy parsing remains default-off.
- ConsentRecord scoped action/purpose/contact point must be validated; legacy smsOptInAt, phone possession and web privacy assent never imply a valid grant.
- COM-L3 threads, composite account FKs, MessageDelivery, CommunicationMessage, MessageAttempt, template versions and backup are available. No inherited review findings from #352; automated review waiver was documented there.
- Missing approved sender, contact identity, provider readiness, encryption key or legal consent must fail closed. No sending in this PR.

## Implementation acceptance
- OWNER-only setting changes with expected-version guard and audit; policy stays narrower than master switch.
- Authorized actor request records immutable encrypted delivery/message/attempt/audit atomically after latest scoped consent and suppression checks, revalidating in a database transaction. Same operationKey and same input may be retried safely; changed inputs rejected.
- Templates retain immutable reviewed revision; no guessed historical consent or account attachment, no raw message in audit.
- Real isolated PostgreSQL and focused unit tests cover default-off, scope/STOP, replay and conflicts, owner permissions, encryption, and actor deactivation. Quick checks, exact-head CI and manual review apply. No paid setup, activation, live SMS/email, pricing or production changes.


## Verified implementation evidence
- Added strict versioned SMS policy schema and OWNER-only transactional update; legacy customerSmsEnabled and email behavior stay unchanged. Wrong or absent policy remains off.
- Added server-only AES-256-GCM payload helper and HMAC-SHA256 hashes, no plaintext in persisted delivery, attempt, or audit evidence; missing key fails closed.
- Added transactionally prepared MessageDelivery, MessageAttempt, CommunicationMessage and thread revision with operation-key advisory serialization and existing STOP address lock. No provider calls.
- Real disposable PostgreSQL: 6 intent/owner/STOP/concurrency cases pass. Unit: 4 pure policy/encryption cases pass. Cached preflight: 10 related and 10 selected tests pass; type/lint/quick gate pass.
- Exact-head GitHub CI, final review and merge confirmation are mandatory. Source/approval gates for legal consent wording, country verification, provider readiness and sending stay blocked until their later approved implementation units.
