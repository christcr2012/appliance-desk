# Communications acceptance ledger — COM-L15 (2026-10-10)

**NOT A GO-LIVE SIGN-OFF.** Evidence statuses are scoped. A passing local
PostgreSQL or CI-browser test proves only the synthetic fixture used by
that test. No tests here send real Twilio traffic or imply legal consent.

| Area | Status / bounded evidence | Remaining acceptance |
|---|---|---|
| SMS master and transport | TESTED: sms-activation-integration.test.ts; communications-intent-integration.test.ts; sms.test.ts | Owner IN-09, production sender/A2P and explicit live switch approval |
| Callback ordering, unknown/STOP behavior | TESTED: communications-inbound-route.test.ts; communications-inbound-integration.test.ts; communication-consent-integration.test.ts; communications-policy.test.ts | Independent controlled live callback/STOP verification after provider and legal approval |
| Identity, inbox and context | TESTED: communications-inbound-resolution.test.ts; communication-timeline-integration.test.ts; communication-context-integration.test.ts; communication-context-links.test.ts | Controlled customer-link review and F-part-2 role/UAT; shared numbers never trusted alone |
| Incoming voice, forwarding and privacy | TESTED: voice-webhooks-integration.test.ts; voice-routing.test.ts; voice-voicemail-integration.test.ts; communications-calls.spec.ts | IN-51 forwarding/owner number; IN-52 announcement/media approval; controlled real call. Recording/transcription OFF |
| Owner setup/private reports | TESTED: telecom-settings.spec.ts; telecom-reports.spec.ts; communication-launch.spec.ts; telecom-attention-integration.test.ts | Check current account/number capability from provider, not fixture; owner setup/alerts approval |
| Exact costs and statement evidence | TESTED: telecom-costs.test.ts; telecom-sync-integration.test.ts; telecom-statement-integration.test.ts | IN-53 budgets; verified invoice remains evidence and is not a paid Expense; K is later |
| Cross-surface isolated launch smoke | TESTED: communication-launch-integration.test.ts (disposable Postgres); communication-launch.spec.ts (CI browser) | Carrier, law, real-user UAT and final multi-system go-live remain F-part-2 |

## External and owner dependencies: pending, never implied complete

- IN-03: Select the actual public permanent number.
- IN-09: Verify sender/A2P with Twilio and separately approve LIVE SMS.
- IN-51: Confirm account ownership/shared status, forwarding destination, hours and separate voice activation.
- IN-52: Approve voicemail/privacy/retention; recording and transcription stay OFF.
- IN-53: Confirm budget/currency/threshold/notification recipients and separately activate any cost alerts.
- Real carrier callback, SMS receipt and live call fallback: NOT TESTED LIVE.
- Books posting/closed-period corrections: DEFERRED TO K/COM-N3.
- New automatic template families, staff calling/reply: COM-N.
- Security, recovery, legal and end-to-end customer UAT: F-part-2.

## How to reproduce without contacting customers

Use only the disposable local/CI PostgreSQL database. COM-L15's new read-only
smoke does not modify the business-settings singleton; any other test that
does so must be registered in SHARED_SETTINGS_TESTS (vitest.config.mts).
Keep CI PostgreSQL on public.ecr.aws/docker/library/postgres:17.

Run the focused integration suites referenced in the table and the owner
browser suites. Inspect real workflow statuses, not only HTTP 200 results.
Never invoke a disposable seed, wipe, real send or webhook simulator against
production. Recheck environment, identities, activation switches and consent
immediately before any future approved dispatch.

A missing provider observation is UNKNOWN, not READY; a provider ACCEPTED
message is not DELIVERED; a billed usage snapshot is not proof an invoice
was paid or posted. No synthetic pass can replace carrier/owner approval.
The sign-off lives in F-part-2, not this ledger.

See COMMUNICATIONS-OWNER-HANDOFF.md and COMMUNICATIONS-TWILIO.md.
