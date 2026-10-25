# COM-N1A — Lead, estimate and signature text messages

Design: [docs/designs/BATCH-COM.md](../designs/BATCH-COM.md). Migration: none. Everything ships **OFF**.

## What it delivers
Staff (Owner or Admin) can text a lead, an estimate's recipient or an agreement's signer from that record's screen:
- lead: "We got your request"
- estimate: "Your estimate is ready", "Your estimate is still waiting"
- agreement: "Ready to sign", "Still needs a signature", "We got your signed agreement"

The screen shows the exact words, the masked phone and the number of text parts. **Nothing sends by itself.** A text goes
only after staff press Send.

## Gates (all must pass; each re-checked at the last moment under locks)
1. Master text switch (`customerSmsEnabled`) — stays OFF; this card never turns it on.
2. Phone setup saved (communications policy) with a ready, verified business number.
3. This kind of text switched ON by the Owner (`communicationsPolicy.workflowTexts`), default OFF.
4. Wording approved by the Owner (a numbered, approved template revision; starting wording from the catalog).
5. Recorded permission for that exact number and business number (staff-recorded evidence: phone / writing / in person).
6. STOP / opt-out (never overridable by staff).
7. Quiet hours (default 9 pm–8 am Colorado, Owner-editable, "restore recommended"). Live back-and-forth replies are exempt.
8. Record state fits (no estimate draft/expired, no already-signed agreement, no lost/converted lead).
9. Live site only: free U.S. number check; testing/CI use the fake carrier and the testing app refuses provider calls.

## Safety behavior
- One press = one frozen message; same-screen double press cannot send twice; a recent identical text needs "send again".
- Unknown carrier result is shown as unknown and is never retried automatically.
- Every press is recorded as a delivery (state shown on the screen and in Communications) and linked to the lead/estimate/agreement.
- Texts are not legal notices; signature/estimate links reuse the existing signed-in/token rules.

## Acceptance → evidence
`tests/com-n1a-workflow-integration.test.ts` (throwaway Postgres, fake carrier): starts fully off with plain reasons; staff refused;
wording rules; switches/version conflicts; master switch untouched; permission needed then recorded once; one text sent and linked;
double press; draft refused/changed preview; quiet hours; unknown result; switch-off at last moment; STOP wins.
`tests/com-n1a-workflow-unit.test.ts`: quiet hours incl. daylight saving; every starting text ≤ 3 parts.

## Owner checklist
Extends the existing "Text messages going live" row: approve each wording, switch kinds on, then the master switch.
