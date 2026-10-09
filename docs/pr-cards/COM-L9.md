# COM-L9 — Gated voicemail, private media and missed calls

**Status: IN PROGRESS.** Baseline inspected main `bee0039` (COM-L8 #370 merged).
Source: `docs/designs/BATCH-COM.md` §5, §5.1, §9; owner IN-52 pending.
No live activation or provider edits; COM-L8 callbacks and L7 schema are authoritative.

## Checklist A (reconciled)
| Plan assumption | Actual on main | Kind / action |
|---|---|---|
| Secure voice webhook | L8 canonical signed request verifier and encrypted replay | Extend only for media/record-complete |
| Voice routing | L8 Denver CLOSED, guarded forward/press 1 | Add explicit VOICEMAIL opt-in; CLOSED remains default |
| Call/media schema | L7 CallSession/CallLeg/CommunicationMedia; no media bytes yet | Reuse, no migration; AVAILABLE only after private blob write |
| Private blob | `getPrivatePhotoStore` holds independent private store per environment | Use stored relative path, authenticated actor-checked read |
| Inbox | COM-L6B SMS-only list/detail; L7 staff can read only assigned-call threads | Add missed-call/voicemail view with OWNER/ADMIN scope; no phone-name guessing |
| Provider callbacks | L8 account row serialization; PENDING_MATCH status replay | Same idempotent receipts and no arbitrary provider URL |

## Acceptance
1. Voicemail never records without IN-52 owner-approved message/privacy/retention/hold and two independent, default-OFF live switches. Recording is only an intentional message after explicit announcement; ordinary call recording and transcription remain OFF. After hours CLOSED still hangs up.
2. On approved after-hours or missed forwarded call, Twilio TwiML announces the message, records with a strict max duration and separate signed recording lifecycle endpoint, then thanks/hangs up. A private callee voicemail never counts as staff acceptance.
3. Validate media SID, account, call root and prior authorized prompt. Fetch bytes only from a constructed Twilio API URL with server auth, refuse user/provider-submitted URL, enforce content type and <=8MB limit, verify hash, store only in approved private Blob store, mark AVAILABLE only after durable write. Persist signed replay/failed receipt without audio in event logs. FAILED media remains visible and retryable; never imply playback from merely reported availability.
4. Authenticated media read uses OWNER/ADMIN (STAFF only when call thread explicitly assigned), verified private key and no redirect to provider or external unsigned blob. No customer access, public URLs, arbitrary path, caching of private recordings or raw audio in logs.
5. Private missed-call list, call detail, voicemail availability/retention/hold and media playback in Owner Desk Communications. Distinguish MISSED, UNKNOWN, VOICEMAIL; no inferred customer from shared phone. Screen follows SMS inbox navigation and keyboard semantics.
6. Tests: unit policy gates/signature/canonical and privacy guards; disposable real Postgres missed voicemail, duplicate and failure->retry receipts, role scope, provider fake downloaded media; browser checks for added UI.
7. `npm run typecheck`, local PostgreSQL preflight, index/secret/route inventory, exact-head GitHub CI and self diff review; automated review unavailable — waived.

## Gates / next
IN-52 is still not approved; do not configure live Twilio recording, provider fallback or voicemail storage, run a real call, turn on production capture, delete private customer media or spend money.
COM-L10 follows only once this PR merges; carry no unapproved activation.
