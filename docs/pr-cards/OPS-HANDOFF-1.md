# OPS-HANDOFF-1 — AI check-up key hand-off package: panel briefing block + keyless discovery document

Status: **COMPLETE** — merged PR #844 (squash `27f2da21`) at exact head `c12ef948`, `ci` green and `review-gate` green (waived via self-review; Codex silent in its window). Approved by Chris, via the main chat, 2026-11-04 — he found the gap himself. Baseline inspected: `92688d1b` (2026-11-04, #841).
Batch: S follow-on · Prerequisites: S-2 (merged, PR #334). One PR, no migration, no schema change.

## The gap (owner's words, 2026-11-04)

The AI check-up key generator (Desk → Automations, "AI check-up keys") tells the owner to give the key to an AI assistant, but an assistant handed only the key cannot use it: it does not know the app's address, the ops endpoints, the Bearer format, the structured note contract (three categories, fixed recommendations), or the job it is meant to do. The panel says "Setup is manual" and defines nothing. The contract is currently knowable only by reading the source code; a product cannot depend on that.

## Outcome

Key + one paste makes a working check-up agent for an assistant with no repo access and no owner translation:

1. **Hand-off block.** When a key is created, the panel shows one ready-to-copy block containing the key, this deployment's base address, and a plain briefing for the assistant: where to call, how to authenticate, what a check-up is, the three triage categories and the fixed recommendations, the rate limit, the error answers, and what the data deliberately excludes. One copy button copies the whole block. The block is shown once, with the key, and is gone after a reload — exactly like the key itself. The panel no longer says "Setup is manual."
2. **Keyless discovery document.** `GET /api/ops` needs no key and returns the same contract as JSON, written for the deployment it is fetched from, so an assistant can re-learn the contract at any time. It reveals no issue data and no key material; the key stays the only credential.

## Build contract

- **One source for the contract.** A new pure module `src/domains/system-issues/ops-contract.ts` holds the note categories, the fixed recommendation texts and the per-key rate limit. `src/domains/system-issues/ops-api.ts` imports them from there, so what the API enforces and what the hand-off/discovery publish can never drift apart. The module imports nothing server-side (no database, no Node built-ins) so the client panel can use it too.
- **Base address.** The address in the hand-off and the discovery document is the origin the owner/assistant is actually talking to — the deployment whose database holds the key. The server page derives it from the request host (forwarded host first, `https` unless the host is a localhost) and passes it to the panel as a prop; the discovery route derives it from its own request URL. Never a hard-coded production address: a key created on the testing copy must point at the testing copy.
- **Discovery route.** `src/app/api/ops/route.ts`: `GET` only, no authorization, no database access, `Cache-Control: no-store` like its sibling ops routes. Body: service name, purpose, base address, how to get a key (owner, Desk → Automations), the Bearer header format, both endpoints with their inputs and response shape, the full note contract (categories, recommendation keys **and** their fixed texts, code-reference rules, expectedVersion/409 behaviour, optional PR URL rule), the rate limit (60 requests/hour per key, 429), the error answers (404 key missing/wrong/revoked — deliberately indistinguishable; 409 changed since read; 422 does not match the contract; 429 slow down), what a response contains and what it deliberately excludes, and the check-up job in plain words.
- **Panel.** `src/app/desk/automations/ops-key-panel.tsx` keeps the existing create/revoke behaviour and the standalone key display, and adds: the hand-off block in a read-only text area labelled for assistive tech, a copy button following the existing clipboard pattern (with a short "copied" confirmation), and intro copy that says the block is the whole setup. The label/creation/revoke flows do not change.
- **Runbook.** `docs/runbooks/AI-CHECKUP.md` gains a short section recording the hand-off block and the discovery document as the no-repo-access route; the existing repo-access routine is unchanged.
- **Enabling fix (found while registering this very packet).** The work index's `executionPackets` registry held exactly 80 entries — the shared bound `validatePackets` in `scripts/work-packet.mjs` applies — so registering any new packet made `check-secrets` (and CI's secret-scan job) fail. The registry call gets a ledger-sized bound (500), since the registry grows by one entry per card by design; every per-packet field keeps the tight 80 bound. A new case in `scripts/work-session.test.mjs` pins that 81 registered packets validate.

## Invariants

- No change to authentication strength: key format, hashing, timing-safe compare, revoked-key denial and the indistinguishable 404 all stay exactly as S-2 built them. The discovery document is public **static text only** — it is not an authorization surface and grants nothing.
- No change to note validation, the rate-limit value (60/hour/key), the issues response shape, or what issue data excludes. Publication reads the same constants enforcement uses; it never re-states them.
- No new data exposure: the discovery document contains no issue rows, no counts, no key material, no hashes, no internal identifiers. The hand-off block contains the freshly created key only because the owner is handing it over in that moment; it is never stored, logged or re-shown.
- No committed key-shaped constants in tests (secret scan): tests generate throwaway keys at runtime.
- Trial rules unchanged: any live exercise happens on the testing copy only. This card's merge does not itself exercise a live key.

## Required tests

- `tests/ops-contract.test.ts` (unit): the discovery document and the hand-off text carry every contract element (endpoints, Bearer format, all three categories, all four recommendation keys **with** their fixed texts, 60/hour limit, error answers, exclusions); the discovery document contains no key material even when a hand-off is built alongside it; the published categories/recommendations are the very constants `ops-api` enforces (same module).
- `tests/ops-discovery-route.test.ts` (unit): `GET /api/ops` answers 200 with no Authorization header, returns the document for the request's own origin, and contains no issue data.
- `e2e/system-health-keys.spec.ts` (extended): creating a key shows the hand-off block containing the key, the address and the briefing; after reload the block is gone with the key.
- Existing `tests/ops-api-integration.test.ts` must stay green unchanged (the ops-api refactor is behaviour-preserving).

## Acceptance

- [x] Creating a key on the System health page shows the hand-off block; one copy action copies key + address + briefing as one text.
- [x] The block's address is the deployment the key was created on (verified on a non-production origin in tests).
- [x] `GET /api/ops` with no key returns the full contract and nothing else; with any key it returns the same document (the key is ignored, never echoed).
- [x] Panel no longer says "Setup is manual."
- [x] `ci` and `review-gate` green at the exact head; merged under the no-taps rule.
