# MCP-9 — Tool-contract compatibility and the honest client list

Build spec: `docs/build-specs/engines/RTC.md`. Approved by Chris 2026-10-25. Depends on MCP-4…MCP-8. Risk: **a
second way in (passes)** — same catalog, same checks. The Robinson toolkit/hub repositories are read-only references.

## Acceptance
- [ ] RTC 1 routes pass the pinned conformance probes; passes and OAuth tokens never cross doors.
- [x] Rate limits hold across two server instances (test): PR #787, exact-head full CI #41180116792.
- [x] Results over 8 KB use owned 24-hour handles, re-authorized on read: PR #787, exact-head full CI #41180116792.
- [x] The client list shows only clients actually tried; nothing marked passed from tests alone: PR #794, exact-head full CI #41209589527. No external clients have been tried.
- [x] `ci` green at the exact head; every review comment read. Satisfied for PR #829 at `15626ec9`: ci SUCCESS (all 12 jobs), review-gate SUCCESS, every review comment read and answered (comments on #827/#829).

## Owner checklist
"Try your assistant connection"; "Optional: connect through the Robinson hub". Never block merging.

## Progress
**October 31 evidence reconciliation:** PRs #787, #793 and #794 are merged; their exact-head full CI and Review Gate runs passed (#41180116792/#41180116750, #41206019621/#41206019642, #41209589527/#41209589596). The pinned upstream generic direct-setter write probe remains NOT_PROVEN; an app-specific owner-approval journal test cannot replace it. Local OAuth refresh and two-process HTTP limits are engineering proofs, not external client verification. All declared clients, hosted redeploy, optional Hub and owner-only acceptance remain NOT_TRIED. The historical progress paragraphs below reflect earlier branch states, not current status.

Upstream RTC 1 contract verified and pinned; the acceptance plan is committed. Initial read-only pass issuance/authorization, owner UI, RTC HTTP tool routing, owned 24-hour handles, backup exclusions, and unit/real-database tests are committed on the feature branch. Initial GitHub CI exposed a missing source brace and a generic secret-scanner match on a synthetic rate-limiter fixture; both are corrected without weakening lint or scan rules. First clean-history CI passed secret scan, static checks and all initial browser shards; the next full run identified a CommonJS top-level-await error in the real two-process rate-limit helper and a 360px mobile overflow in System health. Both were corrected without weakening the tests. Exact-head CI at `58d638e` passed before the new scope mapping changes. Owner-selected read areas now map to the actual underlying MCP scopes; catalog discovery is also gated by those same scopes. `tests/mcp-rtc-read-scopes.test.ts` and the updated HTTP catalog tests cover least privilege, missing grants and refusal of implicit feedback-content or write access. New exact-head CI and the upstream full conformance probes remain pending. MCP-8 has now merged as PR #764 (exact-head CI and review gate completed). The present PR #780 remains a read-only foundation; full RTC 1 conformance, carefully confirmed MCP-5 writes and authenticated real-client acceptance are separate unfinished MCP-9 work. Do not mark all MCP-9 criteria complete or claim RTC 1 compatibility from a green source test alone. The owner-facing pass form still issues read-only passes only. Engineering has added an internal test-only full-pass profile and a strictly allowlisted RTC preview/execute bridge to the existing MCP-5 journal, with a second wire confirmation and unchanged independent owner approval; no real user can issue a writable pass from the UI until the full conformance and review gate are proven. No live provider integration is activated. The new `tests/mcp-rtc-write-policy.test.ts`, `tests/mcp-rtc-full-issues.test.ts` and `tests/mcp-rtc-full-read-handler.test.ts` check guarded journal-only writes and genuine large reads without bypassing existing MCP authorization; a full pinned upstream wire probe and authenticated real-client verification are still required. Full RTC 1 compatibility is **NOT PROVEN** until all applicable upstream write/confirmation, OAuth-refresh and two-process probes pass. A discovered full-pass RTC batch-routing defect is corrected locally: batches refuse writes even for full passes, with a regression test. Read-only production status access is not automatic: the owner must explicitly opt in when issuing a pass, and the UI lists this grant for later revocation; no writable production pass is issued. This remains unverified until next exact-head CI.

## MCP-9 acceptance plan — pinned RTC 1 protocol, two credential doors and conformance (October 29)
Upstream authority (READ-ONLY): `Robinson-AI-Systems/robinsons-toolkit-hub`,
commit `e6cfb98266728ce0e986ab068569a5d1117a4334`,
`docs/CONTRACT.md` (RTC 1 frozen 2026-10-11), plus
`packages/conformance` from the same commit. Do not edit, deploy,
provision or spend against that repository. RTC 1 requires:
`GET /api/contract`, `GET /api/tools`, `GET /api/tools/{name}`,
`POST /api/tools/{name}`, `POST /api/tools/_batch`,
`GET /api/results/{handle}`, `GET /api/whoami`, `GET /api/openapi.json`;
MCP remains at `/api/mcp`, using a different credential kind.
- [x] Introduce OWNER-issued pass-only HTTPS credentials: 32 random bytes, `rtc_pass_` plus 43 base64url characters, hash-only persistence, one-time display outside chat, revocation, scope/profile/area limits and definite expiry. The existing OAuth credentials must fail at the RTC door and RTC passes must fail at MCP.
- [x] Reuse current app MCP catalog and guarded journal/dispatch; reject unknown tools and wrong scopes, read-only pass writes and RTC writes without both wire confirmation and the existing MCP-5 preview/approval. Every allowed change is independently read back and journaled. Never enable live payment/email/SMS/providers.
- [x] Return RTC 1 manifest, metadata, search/describe, read-only batch (at most ten), scoped calls, owner whoami and OpenAPI; bound outputs to 8 KB and persist handles for 24 hours with same-pass reauthorization. No credential can appear in a URL, result, log or field filter.
- [x] Persist atomic database-backed rate limits and prove overlapping calls against two processes on one disposable PostgreSQL database. Also prove pass revocation/expiry, scope narrowing, idempotence, 8 KB boundary and connector refresh preserving selected settings. Proven: two-process proof in PR #829 exact-head CI (run 41287468472) plus Lane 6 independent verification; revocation/expiry and scope narrowing in the pass/read-scopes suites; idempotence in the journal suite; 8 KB boundary in the HTTP suite; connector refresh in PR #793.
- [x] Vendor/pin the upstream RTC 1 named probes under CI at the verified SHA; all applicable probes pass or explicitly remain NOT_PROVEN. Owner System health client matrix and `docs/mcp/acceptance.json` remain NOT_TRIED until a real authorized client connection is witnessed. Runbooks and owner guide describe optional Hub setup without changing other repos.
- [x] Exact-head CI, required review gate, drift/roadmap/status/database notes and merge requirements all pass before marking complete. Satisfied for the PR #829 engineering slice (merged `dfb1eed5`); the card itself remains open on A1 (generic-write NOT_PROVEN) and A3 (clients NOT_TRIED).

**Resolved specification difference:** The older local MCP-9 build draft proposed 30/90/365-day passes (90 days initially).
Pinned RTC 1 §2 instead specifies 24 hours by default, maximum 30 days for ordinary passes
(hub-specific long-lived exception is separate). Implement the upstream-compatible
24-hour default and 30-day cap, and document that user-facing difference in acceptance.
Do not claim RTC 1 compatibility on app-generated tests alone.

MCP-8 must merge first. The distinct MCP-9 protocol bundle stays separate from
the performance/settings PR. No live pass or production credential will be issued
during tests.

## Two-process HTTP acceptance addition — October 31, 2026

- [x] Launch **two independently started Node HTTP servers** running the real `/api/whoami` handler against **one disposable PostgreSQL database**; issue one synthetic, two-factor-enrolled owner pass in that same database and send concurrent requests through both ports. Done by `tests/mcp-rtc-two-process-http-integration.test.ts` as shipped (PR #787) and re-proven in PR #829 CI.
- [x] Run the **unchanged pinned upstream** `verifyTwoInstanceRateLimit` oracle at the existing 120 requests/10 minutes policy: exactly 120 successful replies, all excess replies HTTP 429 with RTC `rate_limited` and a positive Retry-After. A single-process limiter unit test is not sufficient evidence. Proven in PR #829 exact-head CI at `15626ec9` (CI run 41287468472, all unit shards green) after the limiter fix in `src/lib/rate-limit.ts`; independently reproduced by Lane 6 on port 5435 (120 admitted / 60 clean 429s / zero 500s).
- [x] Prove revocation is denied by both servers after the probe, remove synthetic pass/user/audit/limiter records, never log or encode the pass in source or command-line arguments, and never touch production data. Proven by the same suite (post-probe revocation denied by both servers; fixture cleanup in-suite); no production data touched at any point.
- [ ] Keep MCP-9 draft unless the remaining **upstream journaled-write and OAuth-refresh** probes are actually proven; a green new test does not change the status of skipped probes. Capture exact-head test and review evidence before checking a box.

## Real-database RTC journal acceptance addition — October 31, 2026

- [x] In throwaway PostgreSQL create a synthetic OWNER with two-factor and an **internal test-only** full RTC pass; no live, UI-issued or production-writable credential is created.
- [x] Call the actual RTC HTTP tool route and shared MCP-5 journal: preview without `dryRun: true` must not persist a preview; a real preview must require an independent owner approval for a guarded synthetic backup-retry operation; execution without wire `confirm: true` or owner approval must have **no** business effect.
- [x] After explicit test-owner approval, simultaneous confirmed executions and replays must yield exactly one durable, independently verified synthetic effect and a single journal claim. Revocation must deny subsequent RTC use, with fixture/limiter/audit cleanup.
- [x] This proves the **application-specific journal**, not the upstream generic write/refresh probes. Keep RTC 1 conformance and client acceptance NOT_PROVEN until each distinct protocol requirement is actually exercised.

## OAuth refresh selection preservation — follow-up acceptance (October 31, 2026)

- [x] Use the existing locally registered PKCE OAuth client and disposable PostgreSQL integration test to renew a real granted access token, not a fabricated token or mock provider.
- [x] Independently read the persisted McpConnection id, grantVersion and approved scopes before and after refresh; verify that no additional permission appears in either the record or signed refreshed JWT and that the refreshed client still reaches only authorized MCP reads.
- [x] Run the unchanged pinned RTC verifyRefreshSettings oracle against an actual local OAuth refresh adapter, using explicit per-client selections and persisted identity as the before/after source. Assert denied or revoked authorization stays denied after refresh. Distinguish client-owned selections from server-enforced scopes.
- [x] Final exact-head CI/review for OAuth slice: merged PR #793 at `c52f194`, CI #41206019621 and Review Gate #41206019642 passed. Local refresh proof is not external-client, generic-write or deployment acceptance.

## Real-client evidence and owner trial walkthrough — October 31, 2026

- [x] System health RTC pass area filters clients by explicit PASSED, tested revision and human/provider evidence (PR #794, CI #41209589527). No external client is currently verified.
- [x] Client evidence remains server-rendered, separate from pass credentials; incomplete PASS rows are NOT_VERIFIED (PR #794, CI #41209589527). No trial was fabricated.
- [x] Owner direct MCP and optional RTC/Hub walkthrough is in `docs/runbooks/MCP-9-CLIENT-ACCEPTANCE.md` (PR #794). Writing it is not evidence of completing a trial.
- [x] Matrix filtering/UI tests and truthful ledger fallback merged in PR #794, exact-head CI #41209589527 and Review Gate #41209589596. All actual clients remain NOT_TRIED.
- [x] CI browser-b shared-settings correction: the existing W-22 V2 signing spec uses a synthetic global BusinessSettings revision and must execute in the same Playwright process with one worker for shard-b, so the shared business-settings fixture cannot race owner/tax tests or trigger a second login setup; retain every assertion, fixture, run/skip check and the existing five GitHub CI runners. Diagnose any additional failures independently, then require exact-head green CI.

## Implementation route (reconciled October 28, 2026)
This adds execution detail to the approved spec, not new scope. Proposed files/tests below must be created
only when absent; inspect the final prerequisite exports once before coding.

1. Read RTC sections 1–3; pin the referenced upstream contract before choosing wire paths/envelopes. If it
   cannot be read, record the exact source problem and continue independent local pass/authorization tests;
   do not invent a compatible-looking contract or modify the upstream repo.
2. Reuse current MCP authorization/catalog and MCP-5’s final dispatcher. Inventory actual exports first:
   `src/mcp/server.ts` exists at this baseline; `catalog.ts` in the spec is a target integration, not evidence
   it already exists. Refactor one shared registry if needed, preserving every existing tool/refusal test.
3. Prove the two doors reject each other’s credential type, expired/revoked passes fail, and queued writes
   recheck both the wire confirmation and MCP-5 preview/approval. Do not bypass scopes with a pass.
4. Test payload at/below/above the specified 8 KB boundary, owned 24-hour result handles, expiry and revoked
   access on handle read. Test limits through two server processes sharing one throwaway database.
5. Add the pinned conformance fixtures and named RTC/client/limit suites. Client acceptance entries start
   NOT_TRIED; test success never marks ChatGPT, Claude, mobile or Hub as actually tried.

## Limiter fix and remainder evidence — October 31, 2026 (Lane 5)

The two-process acceptance was re-run from scratch and **failed as shipped**:
under the pinned oracle's 180-request burst across two servers, the shared
limiter's claims aborted at Prisma's default transaction waits (2 s acquire /
5 s total) while queued behind the advisory lock, and callers saw HTTP 500s
instead of admissions or `rate_limited` refusals (two runs: 84 and 63
successes, 0 valid 429s). `src/lib/rate-limit.ts` now sizes the claim
transaction (`maxWait` 20 s, `timeout` 30 s) so a legitimate queue drains;
admission semantics are unchanged for every caller (RTC passes and the public
forms share this limiter, and its own suites pass: rate-limit 6/6,
auth-rate-limit-database 1/1, public-launch-rate-limits 2/2). A warm
two-server probe against the real `/api/whoami` handler then returned the
oracle's exact counts (120 admissions including the 2 warm-up requests, 60
valid 429s, 8.8 s wall). The acceptance suite itself still exceeds the
oracle's 10 s per-request fetch budget on this VM because its fixture servers
start cold under `tsx`; its decisive run is this PR's exact-head CI (the
suite passed in CI at PR #787's head with the slower, unfixed limiter). The
rate-limit acceptance lines above therefore stay unticked in this PR and are
ticked in the close-out on that CI evidence — not before.

Tonight's per-file verdicts on the lane database (port 5433), fixed code:
RTC set 45/45 green (http 13, integration 5, journal-integration 1, pass 3,
public-contract 1, read-scopes 3, projection 3, client-matrix 4, full-issues
3, full-read-handler 1, write-policy 4, vendoded pin 3, wire-conformance 1).
The journal addition's scenario is covered by `tests/mcp-rtc-journal-integration.test.ts`
(refusals without confirmation/approval; eight simultaneous confirmed
executions dispatch exactly once; replay returns the same success). The
browser-b correction line is implemented at `scripts/e2e-shard.mjs` (the
signing spec's group runs with `--workers=1`). Still NOT_PROVEN, unchanged:
the pinned upstream **generic** direct-setter write oracle, every real client
(NOT_TRIED), hosted redeployment and the optional Hub. This PR is the landed
successor of draft PR #798 (same reconciliation, rebased and extended);
#798 is closed with that reason recorded.

## Close-out of the two-process remainder — November 1, 2026 (Lane 5)

PR #829 merged at exact head `15626ec9` (squash `dfb1eed5`) on the owner's
release, with ci, Performance Baselines and review-gate all SUCCESS and zero
unresolved threads. The two-process acceptance lines above are ticked on that
exact-head CI evidence (run 41287468472) and Lane 6's independent
verification. Ledger criterion MCP-9-A2 is now PASS. What remains open on
this card is unchanged and honestly recorded: A1 PARTIAL (the pinned upstream
generic direct-setter write probe is still NOT_PROVEN), A3 NOT_RUN (every
real client NOT_TRIED — the owner trial), hosted redeployment and the
optional Hub. MCP-9 is not complete and is not marked accepted.
