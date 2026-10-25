# COM-N2 — Verified click-to-call

Design: [docs/designs/BATCH-COM.md](../designs/BATCH-COM.md). Builds on COM-N1C and the voice foundation (COM-L7/L8). Migration: none. Ships **OFF**.

## What it delivers
A "Call" box on the job, lead and maintenance-request screens. Press **Call from the desk**: the carrier rings the signed-in person's own
confirmed mobile (My account) from the business number; after they answer and press 1 it dials the customer's saved number with the business
number as caller ID. The customer's number is read from our records at that moment, never from the callback.

## Who and when
- Owner/Admin: any customer. Assigned STAFF: only a SCHEDULED/IN_PROGRESS job assigned to them. Customers never.
- Needs the Owner switch "Calls from the desk" (also needs call routing on), a READY account, a verified voice-capable business number.
- Authority and the switch are re-checked at each carrier step; losing either stops the call before the customer is dialed.
- One call per person at a time; a repeat click (same token) is the same call; an unclear carrier answer is recorded `UNKNOWN`, never retried.
- Call is filed on the customer thread (CallSession) with an audit entry `COMMUNICATION_CALL_STARTED` (job/lead/request + call id).

## Safety
Fake carrier only in the disposable test harness against a TEST account; live only on the real production site with a free US lookup of both
numbers and an https callback origin. No recording. Nothing is bought or switched on.

## Acceptance → evidence
`tests/job-click-to-call-integration.test.ts` (9): off by default, role limits, confirmed staff phone required, staff phone (never customer) is
rung first, idempotent click, press-1 gating, saved-number dialing with no injection, reassignment/switch-off stops, carrier refusal vs unknown,
no carrier outside the harness.
