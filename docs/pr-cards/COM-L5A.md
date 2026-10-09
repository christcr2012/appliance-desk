# COM-L5A — verified inbound SMS and deterministic contact identity

Status: IMPLEMENTED; PR #358 OPEN; original focused local preflight and GitHub CI green; synchronized head awaiting fresh exact-head CI and performance evidence. Dependency COM-L4B #354 MERGED (80ac467).
Baseline initially inspected: #354 branch edd9de5 (2026-10-09), main 29ebd32. Synchronized with main merge #354 at 80ac467; the earlier baseline is preserved for historical traceability.
Design: BATCH-COM §4.2, §5 signed-webhook contract; MASTER-ROADMAP COM-L5A.
Scope: incoming SMS only — verified receipt, idempotent encrypted storage, guarded contact resolution.
Not scope: automated replies, marketing enrollment, STOP/START/HELP projection (L5B), MMS downloads, voice, provider activation, live spend.

## Checklist A — drift
| Assumption | Actual | Resolution |
|---|---|---|
| Provider/status webhook already verifies Twilio signatures | app/api/webhooks/twilio/route.ts uses SDK validator; messaging/events.ts L1B reducer | Preserve old route; add separate bounded inbound route with canonical owner-approved origin, no unsigned fallback |
| Contacts and bindings are account-scoped | ContactPoint, ContactBinding, BusinessPhoneNumber, TelecomAccount (L2) | Resolve only single active verified binding; duplicates ambiguous; unknown unresolved |
| Threads and encrypted message evidence persist | CommunicationThread and CommunicationMessage from L3, content helper L4A | Never store raw SMS in event summary/log; use keyed hashes/encryption and replay-safe provider IDs |
| Owner inbound gate and canonical public origin | BusinessSettings communicationsPolicy L4A/L4B | Extend strict policy with default-off inboundEnabled; production-only handler, test harness isolated |
| Existing verified STOP behavior | L1A processVerifiedTwilioStop and address advisory lock | STOP cannot be dropped; maintain existing immediate address-wide suppression, leave broad consent projection to L5B |

## Delivery contract and testing
- Verify original form values and bounded request against canonical configured HTTPS origin+exact path/query, with TWILIO_AUTH_TOKEN. Do not trust request Host/X-Forwarded-Host or allow preview+production account crossover.
- Reject wrong AccountSid/number, retired number, inappropriate channel, invalid signature/format/size before any state write. Reply empty TwiML only after durable write.
- Persist one provider event and one encrypted inbound message per SID under a single transaction; audit only safe IDs, not message contents. No send, download, or automatic response.
- Bind only a sole, verified, nonrevoked subject; multiple/unverified -> AMBIGUOUS, zero -> UNRESOLVED. Phone routing cannot grant portal access or attach job/property/billing context. Later explicit resolution may update thread without moving historical messages.
- Disposable Postgres replay/ambiguous/cross-account/suppression tests; signed route invalid origins/signatures; no live keys/test traffic. Local preflight and exact-head CI/review mandatory.


## Local verification and safeguards
- Signed bounded Twilio form webhook added at `/api/webhooks/twilio/sms`, using the approved canonical HTTPS origin, SDK signature, explicit account and verified receiving number checks. Missing origin/key or a preview environment returns no processing. Response is empty TwiML only after successful durable ingestion; failures remain retryable.
- Existing verified STOP writes are preserved even if the inbox gate is disabled. No automatic confirmation, broad consent, external sending, or MMS download.
- Encrypted inbound message/ProviderEvent/thread writes share a PostgreSQL transaction; provider SID replay is idempotent. Binding resolver defaults to UNRESOLVED, permits only uniquely verified persons, keeps shared numbers AMBIGUOUS, and does not automatically reassign historical conversations. No invoices/jobs/properties are attached by phone.
- No schema migration or live activation; the optional policy `inboundSmsEnabled` defaults off. An operator must separately approve any production provider/number and switch.
- Disposable PostgreSQL integration: four tests, verified route/security unit: six tests, identity unit: four tests. `npm run preflight -- --unit tests/communications-inbound-resolution.test.ts --unit tests/communications-inbound-route.test.ts --db tests/communications-inbound-integration.test.ts` passed with 34 related and 14 selected tests, plus type/lint/migration checks.
- PR #354 remains open due to an exact-head GitHub CI trigger limitation. COM-L5A must remain stacked against #354 until that PR passes its required CI and merges. No bypass or premature claim that either PR is merged.
