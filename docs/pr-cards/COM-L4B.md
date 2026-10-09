# COM-L4B — Account-scoped SMS adapter and claimed dispatch

Status: MERGED (#354) after exact-head CI and review gates. Baseline: merged COM-L4A #353, main 29ebd32 (2026-10-09).
Design: BATCH-COM §3 provider boundary and §4.1 send/retry reliability. Risk: external provider/ledger; no other batch functionality, schema migration, live activation, paid resource, or public UI.

## Drift checklist A
| Approved assumption | Current main | Disposition |
|---|---|---|
| L4A message and attempt prepared together with exact consent/readiness evidence | request-communication.ts, MessageDelivery/Attempt, MessageDelivery.currentAttemptId | preserve immutable payload, scope and frozen revision; recheck gates |
| Legacy SMS already has signed webhooks and conservative UNKNOWN outcomes | lib/sms.ts, messaging/events.ts, delivery-state.ts | reuse callback signature and serialized reducer; do not create a competing public webhook |
| Provider account/number readiness default disabled | TelecomAccount.status, BusinessPhoneNumber registrationStatus/verifiedAt, settings.customerSmsEnabled | no money, secrets or external sends without explicit owner go-live switches |
| L3 provider-event evidence/backup records | ProviderEvent and MessageAttempt from #346/#352 | persist SID and unknown attempts, never auto-retry uncertain Twilio outcomes |

## Implement
- Small account-scoped Twilio adapter using installed twilio v6 and approved API key/secret; no credentials stored, logged, or cached in database. A narrow injected fake exercises the same contract. Status URL has an opaque attempt correlation and uses existing verified webhook.
- dispatchCommunication claims PREPARED only once; re-checks active actor, sender readiness, policy, STOP, consent, frozen message version in a DB transaction and dispatches after the transaction is committed. No external request inside a lock.
- Categorize definitive 4xx as rejected except ambiguous 408/429; 5xx/timeouts/process uncertainty => UNKNOWN, never automatic replay. Persist provider SID and correlated observation via existing reducer. No response can downgrade terminal delivery evidence.
- Safe restart/reconciliation: stale DISPATCHING stays UNKNOWN with explicit owner attention, not sent again. Missing config and preview/test environments never invoke Twilio.
- Exact-head CI, disposable PostgreSQL races, replay/STOP and mocked provider tests are mandatory before merge. Do not turn on production SMS or start provider spending.

Next: COM-L5A verified inbound SMS, then consent projection in L5B.


## Delivered contract and test evidence (2026-10-09)
- New production-only Twilio v6 API-key scoped SMS adapter in `src/lib/communications/providers/`, with truthful 408/429/5xx/timeout UNKNOWN outcomes and definitive 4xx REJECTED. Unavailable account/secret/environment returns no real provider. No voice/usage method pretends to exist.
- Production region proof uses Twilio **free Basic Lookup** with no paid `Fields`. Verified valid E.164 + countryCode US must match the recipient exactly; neither '+1' nor unknown country authorizes sending. No live lookup was run during development.
- `dispatchCommunication`: immutable frozen payload, read-only country observation before the transaction, then second check of author/owner controls, account/number, consent, STOP and business thread under locks. Claims one PREPARED attempt, calls provider only *after* commit, finalizes through the existing monotone delivery reducer. Opaque random attempt ID appears in the signed webhook callback URL; origin is the owner-controlled approved HTTPS policy setting. Stale DISPATCHING stays UNKNOWN with no automatic replay.
- No new schema, customer-facing UI, provider credentials, paid activation or real messages. Existing legacy reminder send remains default-off; transition belongs to COM-L6A with approved templates and consent.
- Test proof: disposable PostgreSQL runs L4A+L4B intent tests including late STOP, late switch-off, accepted SID, idempotency/UNKNOWN/stale recovery; provider unit tests for error and country classifications; exact-head CI required before merge.
