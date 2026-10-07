# Message delivery runbook

Use this when an email/SMS or a legally important customer notice did not reach a known final state.

## Response

1. Open the related Customer/Lead **Messages** panel and **Desk → Automations**. Read the durable `MessageDelivery` state and provider message ID; do not rely on a toast or provider status page alone.
2. Treat **Accepted** as provider acceptance, not delivery. **Delivered** is confirmed delivery. **Failed/Not sent/Suppressed/Bounced/Spam complaint** are not sent-success states.
3. For **Unknown**, do not send another copy. The 15:30 `billing-reconcile:message-deliveries` pass runs `reconcileUnknownDeliveries`; when a provider ID exists it asks the provider for current state. Without a provider ID the uncertainty stays visible for a person.
4. Leave hard-bounce, complaint and STOP suppression in place. Correcting an address or phone number does not recreate marketing consent.
5. For a `CustomerNotice` in **UNCERTAIN**, open **Desk → Notices** and its Resolve screen. If evidence proves it went out, record the actual delivery evidence; if it did not and the allowed window is still open, use the offered resolution to put it back in line.
6. A **MISSED** notice is never sent late automatically. Use the explicit notice-resolution choices and record the required note. Never backdate delivery evidence.
7. Confirm the message/notice reaches a definite state and the related Today/exception item clears.

## Never do

- Never resend an `UNKNOWN` delivery just because no email/SMS was observed.
- Never change `MessageDelivery`, `ProviderEvent` or `CustomerNotice` rows directly.
- Never remove suppression to make an automation green.
- Never enable live customer email/SMS/marketing while troubleshooting without owner approval.

## Drill

Automated drills: `tests/messaging-deliver-integration.test.ts`, `tests/messaging-events-integration.test.ts`, `tests/notices-state-integration.test.ts`, and `tests/notices-hand-delivery-integration.test.ts`.

Last drilled: **2026-10-06 (automated CI coverage); manual provider-dashboard drill not separately recorded.**
