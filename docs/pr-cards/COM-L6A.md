# COM-L6A — SMS template validation, segments and safe reminders

Status: IMPLEMENTED, exact-head CI and merge pending; base main 9d449f6 (W-16B #362 merged) (COM-L5B merged #361).
Design: docs/designs/BATCH-COM.md §§4.3, 6.4, 9; predecessor COM-L5B.
Owner gates: DO NOT activate customer SMS, provider registration, spending or live payments.

Follow docs/implementation-contracts/DRIFT-PROTOCOL.md checklists A and B for assumptions, risk and verification.

## Checklist A — actual drift
- CommunicationTemplateRevision exists from COM-L3 but L4A request rejects all template variables and checks code-unit count, not billable SMS segments.
- L4B dispatcher decrypts frozen body before send but needs to independently enforce actual segment budget.
- Legacy day-of reminders directly call deliverMessage with a hardcoded footer, predating COM-L5B scoped verified contact consent.
- Template editing and SMS inbox UI belong to later COM-L6B; L6A provides a reusable validated preview and owner read-only template surface.

## Bounded accepted contract
1. One pure, tested GSM-7/UCS-2 segment calculator: GSM extension characters consume 2 septets; UTF-16 surrogate pairs consume 2; 160/153 and 70/67 limits; no implicit Smart Encoding. Empty body is zero segments; too many segments fail closed at preparation and final dispatch.
2. A strict template compiler with allowlisted variables and text rendering, no silent unknowns/missing fields, no HTML evaluation. Preview shows example/worst known replacements, encoding, units, cost unknown when no verified price. Only approved/current SMS revisions can be used in prepared intents. Frozen message is rendered *before* it is encrypted and tied to idempotency.
3. Existing automated job-day SMS MUST NOT bypass scoped sender/verified contact consent. Keep legacy sending disabled pending an explicitly approved automation actor/context; persist no false 'sent' markers when blocked. Reuse validated reminder template + preview in the proper workflow, not a second unsafe send mechanism.
4. Disposable PostgreSQL template-intent/consent tests, unit boundary tests, local quick preflight, exact-head GitHub CI + performance, review + merge. W-16B independent lane left intact.

## Evidence / handoff
Complete after verification; next COM-L6B inbox with human-assigned thread/context authorization and template editing UI.

## Verification and release boundary
- Approved/current revision compilation with strict allowlisted, bounded values; immutable
  rendered-content hash and ciphertext. Changing variables changes the idempotency hash.
- GSM-7 160/153 and UCS-2 70/67, including extension escape and UTF-16 pairs.
  Dispatch re-checks actual decrypted content; previews alone do not authorize sending.
- Notifications settings shows read-only current-revision and day-of reminder previews
  with configured segment ceiling; unknown carrier price is not claimed as free.
- Safety migration: scheduled day-of cron no longer bypasses scoped consent, account
  or permission requirements. It reports heldForReview without touching sent flags or
  calling Twilio. Auto sends remain unavailable until separately owner-reviewed
  automation authorization and recipient/job binding exist. COM-L6B owns inbox/review.
- Tested on disposable PostgreSQL: variable replay, approved revision, over-budget
  UCS-2 and changed frozen-body final dispatcher refusal.
