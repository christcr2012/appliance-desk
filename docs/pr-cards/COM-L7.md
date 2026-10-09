# COM-L7 — Call legs, private media and retention schema

Status: IMPLEMENTED; verification and exact-head CI pending.
Owner design: docs/designs/BATCH-COM.md sections 2.2, 5.1, 6 and 9.
Prerequisite: COM-L6B inbox; see docs/pr-cards/COM-L6B.md.
Mandatory drift check: docs/implementation-contracts/DRIFT-PROTOCOL.md, A and B.

## A: checked current implementation
- COM-L2 has TelecomAccount, BusinessPhoneNumber, ContactPoint with account
  keys; COM-L3 has CommunicationThread. Link voice records to these rather
  than inventing a new customer or provider identity.
- No existing CallSession, CallLeg or CommunicationMedia models. COM-L7
  schema is additive; business SMS remains off, voice routing remains off.
- Existing private-storage system has separate, authorized data surfaces;
  this slice must NOT create a provider media download endpoint or public URL.
- Provider TwiML, acceptance, recording, callback and retention deletion
  are COM-L8/COM-L9 and require explicit activation gates.

## Accepted contract
1. CallSession records immutable provider root ID unique per telecom account,
   optional contact/thread links constrained to the same account, direction,
   versioned routing state/outcome and coherent event times.
2. CallLeg uniquely keys provider leg per account, links to an account-matched
   call and tracks forwarding/answer evidence with nonnegative durations.
3. CommunicationMedia uniquely keys session/kind/provider resource and
   stores only private storage keys and content hashes; reject URL-like
   storage paths, invalid available/deleted state and negative durations.
4. Legal hold blocks marking a media object deleted AND raw DB deletion.
   Expired media is *review-only*, not silently purged or called deleted.
   Actual provider/private/backups deletion and confirmation are later work.
5. Authorized owner/admin and assigned staff see metadata only; no private
   keys, raw provider identifiers or media downloads exposed. Owner/admin
   may review expired media metadata without authorizing a purge.
6. New tables added to backup manifest; no live calls, paid API usage,
   recording, transcription, public route or destructive migration.
7. Disposable PostgreSQL tests validate schema constraints, duplicate
   provider events, private key rejection, legal hold, role-checked reads;
   standard quick preflight, CI/performance and review required to merge.

## B: handoff
Next COM-L8 will add provider ingress/call reducer only after approved
signature, verified account/number, callback replay and recording gates.
No successor slice begins in this chat per owner pause instruction.
