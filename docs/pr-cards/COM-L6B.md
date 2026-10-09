# COM-L6B — Authorized SMS inbox, read cursors and manual workflow

Status: IMPLEMENTED; exact-head CI and merge pending. Base main 2dc2e59 (COM-L6A #363 and W-16B #362 merged).
Design: docs/designs/BATCH-COM.md §§4.2, 4.3, 7, 9.
Follow docs/implementation-contracts/DRIFT-PROTOCOL.md A/B checklists.

## Checklist A — code-to-design
- L3 already provides account-scoped threads, encrypted messages, assignee,
  resolution, status, version and per-user read markers. No new migration.
- L5A ingestion never guesses identity or job from a phone. Inbound messages
  are encrypted and duplicate-safe. Never show one candidate's private
  billing/agreements on an AMBIGUOUS thread.
- L4A/L4B own owner/admin manual message preparation/dispatch with consent and
  latest STOP checks. Inbox must not invent a second sender or enable provider.
- L6A retired unsafe job-day automatic sender; inbox exposes review context,
  but no automated customer sends or implicit consent.

## Bounded contract
1. Owner/admin view all threads in their telecom account; STAFF sees only
   assigned threads; customer and anonymous sessions cannot inspect an inbox.
   Authenticated role re-checked in domain transaction, including mutations.
2. List closed/open/waiting, assigned/unassigned, resolution and unread state.
   Stable bounded pagination; bodies decrypted server-side only for explicitly
   authorized message thread detail. Unknown/ambiguous reveal no private
   candidate customer account information.
3. Per-user read cursor monotonic and anchored to a real message in the same
   thread; replay/id mismatch or unassigned actor fails without a write.
4. Owner/admin can assign staff; authorized actor can change status with
   expected version. UI links inbox → thread → mark read/change status.
   No SMS reply until an explicitly approved separate operator send action
   passes requestCommunication and dispatchCommunication gates.
5. Disposable PostgreSQL tests for isolation, read cursor and status conflicts;
   preflight, exact-head CI/performance and review before merging. No live send.

## Handoff
COM-L7 follows; richer conversation reply and job-context enforcement
requires separately scoped safe owner authorization before activation.


## Implementation evidence
- Account-scoped business threads from COM-L3; no migration or duplicate
  communications datastore.
- Per-user read position anchored to a real thread message and never moves
  backward. STAFF cannot read/mark/modify unassigned threads; OWNER/ADMIN
  triage all threads, and only OWNER/ADMIN can assign.
- Optimistic thread version enforced on status and assignment, with a typed,
  PII-free AuditLog record for each change; no private message text in audit.
- Read-only body timeline decrypts on the server after auth and fails closed
  when key is missing or content redacted. Unresolved/ambiguous threads
  withhold linked customer and lead account IDs.
- UI under Owner Desk → Communications: status/identity/assignment filters,
  inbox thread drillthrough, mark read, status and assignment forms.
- No customer sends, signatures, provider spending or live activation.
- Verify with disposable PostgreSQL security tests, quick preflight,
  exact-head GitHub CI/performance and pull request review.

- Navigation regression: OWNER/ADMIN/STAFF all discover the new inbox; private finance destinations stay hidden from STAFF.

- Browser-c fix: E2E owner/staff mobile menu includes Communications; use the shared accessible Button instead of white text on pale brand-green background (WCAG contrast regression).
