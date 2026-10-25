# COM-N1C — Billing, renewal and refund text messages

Design: [docs/designs/BATCH-COM.md](../designs/BATCH-COM.md). Builds on COM-N1A/N1B. Migration: none. Everything ships **OFF**.

## What it delivers (Owner/Admin only — never staff, never customers)
Preview-then-send boxes on the invoice screen and the agreement screen:
- "Your invoice is ready" (sign in to view; no amount in the text)
- "Friendly reminder: invoice still open" — needs a professional's review
- "We received your payment"
- "Your refund was issued" (uses the latest refund on the invoice, shows the amount) — needs a professional's review
- "Your rental term ends soon" (courtesy heads-up, fixed-term rentals ending within 60 days) — needs a professional's review

Links go to the existing signed-in invoice page; no payment or signed-document links outside the existing rules.
These texts are courtesy messages, **not legal notices** (CustomerNotice and the renewal gates stay authoritative).

## New safety: professional-review lock
Collections, refund and renewal wording (design: needs legal approval) cannot be switched on until the Owner confirms that a
qualified person has read those exact words. Changing the wording removes the confirmation and switches the text off.
The sender re-checks the confirmation at the last moment.

## Acceptance → evidence
`tests/com-n1c-workflow-integration.test.ts`: staff/customers refused; lock refuses switch-on; confirm then on; edited wording clears
review and switches off; last-moment gate; state fit rules; four texts sent and filed on the invoice/agreement; amounts only where
intended; removing the review stops the next send. N1A/N1B tests unchanged and passing.

## Owner checklist
New row: have a lawyer read the three wordings before real use (never blocks building).
