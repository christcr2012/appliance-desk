# COM-L8 — Signed Twilio voice forwarding and callback recovery

**Status: MERGED (#370), conditional on exact-head CI and reviewer disposition.**
Baseline inspected: main `66710fe` (COM-L7 #368 merged); branch `ai/gpt6/com-l8`.
Source contract: `docs/designs/BATCH-COM.md` §5, §5.1, §9, IN-51/IN-52. No schema migration, no live activation.

## Checklist A — reconciled assumptions
| Assumption | Actual at baseline | Kind/adjustment |
|---|---|---|
| Call schema needs creating | `CallSession`, `CallLeg`, `ProviderEvent` delivered by L7 | Already done; reuse |
| Voice webhook exists | SMS inbound has bounded signed validator, no voice routes | Add signed voice routes, reusing strict account/origin principles |
| Communications policy | Strict SMS-only Zod schema | Add optional default-OFF voice routing fields |
| Voicemail/media | L7 private metadata only | Do not add media download or capture; COM-L9 owns it |
| External fallback | Requires provider configuration by owner | Launch checklist; cannot prove outage fallback in app alone |

## Shipped contract / acceptance evidence
1. Four Node-only Twilio POST endpoints (`/api/webhooks/twilio/voice`, `/accept`, `/dial-result`, `/status`), each validates signed canonical HTTPS URL and bounded raw form, account SID and call SID. Inbound verifies the business number, denies preview/non-disposable development.
2. Optional versioned voice policy defaults OFF, permits only a verified/approved non-loop US destination, with Denver local business hours, closure dates, up-to-30-second ring timeout. Inactive or invalid state reads safe greeting and hangs up; no voicemail, arbitrary URL, ordinary recording, transcription or outbound call.
3. Twilio builds accepted forwarding Dial, press-1 child whisper, and deterministic response replay via encrypted provider receipts. Per-account Postgres row serialization, account-scoped parent/child legs and event counters prevent duplicate call legs; pending early statuses drain on ingress.
4. Staff acceptance plus connected bridge sets ANSWERED; busy/decline/missing acceptance is MISSED or explicit UNKNOWN when evidence contradicts. Terminal status cannot regress under reordered callbacks.
5. Tests: `tests/voice-routing.test.ts` (4; Denver MST/MDT, DST, holiday, loop and OFF); `tests/voice-webhooks-integration.test.ts` (4; real throwaway PostgreSQL for signed callbacks, replay, accept/decline, early/out-of-order terminal). The shared business-settings writer is registered in `SHARED_SETTINGS_TESTS`.
6. `npm run typecheck`, `npm run test:db -- tests/voice-webhooks-integration.test.ts` both passed locally (85 related + 4 selected database tests, no unexpected skips), preflight/lint/route/secret/migration checks green; exact-head GitHub CI remains a merge condition.

## Handoff and gates
- **Automated review unavailable — waived.** Human/agent diff review, full required `ci` green at exact head, and resolved blocking review threads are required *before* #370 merges.
- Owner IN-51 must approve/verify actual Twilio voice destination, hours/holiday/after-hours and production fallback URL; owner/production voice activation is OFF. IN-52 is required before voicemail and any media capture; neither voicemail nor ordinary call recording/transcription is active.
- Next JIT card: COM-L9 approved *optional voicemail/private ingest and missed-call inbox*, build only behind IN-52 default-off gate; reuse L8 receipts, session+leg identity, private media schema and signed callbacks. COM-L9 does not change customer SMS activation.
- No additional schema, money, paid provider configuration or site pages were created in this PR.
