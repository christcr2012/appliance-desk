# COM-L5B — Scoped SMS consent and provider keywords

Status: **MERGED (COM-L5B PR; see GitHub history)**. Base: main `61dc180` after W-0C #359 and COM-L5A #358.
Dependency: COM-L5A. Design: `docs/designs/BATCH-COM.md` §4.2–4.3, §9. No schema migration.
Scope: consent evidence and existing portal preference; not new sending, provider setup, A2P activation,
marketing campaigns, legal notice delivery or automated replies.

Follow `docs/implementation-contracts/DRIFT-PROTOCOL.md` checklists A and B.

## Drift — checklist A
- Signed inbound route `src/app/api/webhooks/twilio/sms/route.ts` handles STOP before inbound gate; L5A inbox is default-off.
- Canonical sender/contact and append-only `ConsentRecord` (L2) support purpose, action, scope, disclosure version/hash.
- Existing account portal choice only writes legacy `smsOptInAt`; consent eligibility reads scoped records and is already fail-closed.
- Legacy STOP ledger blocks every SMS; START may only clear provider STOP, never create marketing or transactional grants.

## Acceptance
1. Signed inbound STOP, START, HELP and provider `OptOutType` (authoritative) persist deduplicated scoped evidence.
   STOP suppresses all purposes even for an unresolved/shared number, including with inbox off. START is a provider
   re-enable only, not consent, and cannot override an unrelated owner/customer suppression. HELP never enrolls.
2. Portal transactional-only opt-in preserves exact independently checked disclosure/version/hash and phone/sender scope.
   No implied marketing permission; opt-out revokes the phone point's consent. Changing numbers never carries an old grant.
   Existing message gate remains disabled unless all separate owner/provider/contact verification gates pass.
3. Unsupported/no-purpose evidence never authorizes a send. Phone ownership, unsigned webhooks, or a START cannot
   grant marketing or legally required-notice service. Never send application opt-out confirmations.
4. Real throwaway PostgreSQL exercises deduplication and suppression across identities, START and portal scopes.
   Unit and existing inbound/portal tests; all preflight gates, exact-head CI, review, and merge.

## Checklist B / handoff
Update STATUS, business rules, owner guide, and work index as shipped; note any deferred public lead disclosure
surface or legal wording approval under COM-L6, without making it a disguised active marketing opt-in.

## Verification
- 63 passing tests across eight files, including actual throwaway PostgreSQL for STOP/START/HELP,
  address ambiguity, replay, inbound persistence and portal opt-in/opt-out.
- No sends or new activation paths; owner policy, sender verification, scoped consent and
  STOP gates remain independent. The existing legacy day-of reminder master gate stays OFF.
- Client checkbox displays exact immutable disclosure text with privacy and terms links;
  checkbox concerns transactional updates only, never marketing.
- Actual sender scope is null until an owner-approved policy exists, intentionally failing
  the SMS eligibility gate instead of inventing a consented sender.
- Public lead-form independent disclosure approval and message composer UI are inherited
  by COM-L6; COM-L5B does not silently enroll incoming leads or activate marketing.
