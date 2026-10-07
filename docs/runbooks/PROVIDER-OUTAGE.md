# Provider outage runbook

Use this when Stripe, Resend, Twilio, Vercel Blob, or another configured provider is failing or returning uncertain results.

## What the system means

- **Healthy** — the latest automation run completed successfully.
- **Failing** — the latest run recorded a definite failure.
- **Unknown** — a run or provider outcome cannot be proven either way. Do not assume failure and do not blindly retry.
- **Never ran** — there is no run evidence yet; this is not healthy.
- **Paused** — the owner intentionally stopped that automation.
- **Unconfigured** — a required environment variable is missing.
- Message **Accepted by provider** is not the same as **Delivered**.
- Message **Not sent**, **Failed**, **Outcome unknown**, **Bounced**, **Spam complaint**, and **Suppressed** must never be described as sent.

## Response

1. Open **Desk → Automations** and identify the exact failing/unknown rule and its most recent timestamp.
2. Do **not** manually rerun a cron until you have checked its existing `AutomationRun`. Daily jobs use durable run keys specifically to prevent duplicate work.
3. For message problems, open the related Customer or Lead record and inspect **Messages**. Do not resend an `UNKNOWN` message just because the provider dashboard is slow.
4. Check the provider dashboard/status page using the stored provider id when one exists. Never paste message bodies, customer exports, secrets, or credentials into logs or support tickets.
5. If an email hard-bounced or a Twilio STOP event was received, leave suppression in place. Fixing an address does not authorize marketing by itself.
6. If Stripe state is uncertain, use the billing reconciliation workflow and the Stripe dashboard. Do not mark an unconfirmed payment successful or edit durable billing evidence by hand.
7. If the provider is still down, pause only the affected automation when that prevents repeated definite failures. Keep unrelated automations running.
8. After recovery, allow the normal reconciliation/nightly pass to finish durable pending work. Confirm the exact run becomes healthy and any affected message/payment record reaches a known state.
9. Resume a paused rule only after configuration/provider health is restored.

## Never do

- Never delete `AutomationRun`, `MessageDelivery`, `ProviderEvent`, payment, notice, or document evidence to make a screen look healthy.
- Never create a second send for a message whose outcome is `UNKNOWN`.
- Never turn on live customer email/SMS/marketing or add credentials as part of an outage repair without the owner's explicit activation approval.
- Never treat a provider status page as proof that a specific customer payment or message succeeded.

## Drill

In an isolated preview/test environment: remove or invalidate one provider credential, run the affected workflow, confirm the UI shows **unconfigured/failing/unknown** as appropriate, confirm no duplicate provider action occurs, restore configuration, run normal reconciliation, and verify the record returns to a known state.

Last drilled: **not yet manually (as of 2026-10-06)**. Automated provider failure/idempotency/reconciliation paths run in CI; a manual provider-outage drill remains to be recorded.
