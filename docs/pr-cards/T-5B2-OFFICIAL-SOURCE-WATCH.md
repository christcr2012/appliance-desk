# T-5b2 — official tax source page watch

Base branch: ai/chatgpt/t5b1-official-rate-metadata · Risk area: external-source monitoring / SSRF safety · Migration: none · Budget estimate: ~470 production lines / 11 files
Design: `docs/designs/BATCH-T.md` section 13.3 plus the T-5b boundaries in 13.1/13.6 (reasons only — this card is the build spec)

## Read only these (in this order)
1. `src/app/api/cron/tax-address-recheck/route.ts` — current authenticated daily cron shell and scheduling gate
2. `src/domains/automation/runs.ts` — `runAutomation`, daily business-date run keys, pause/retry semantics
3. `src/domains/tax/address-recheck.ts` — `shouldRunMonthlyTaxAddressRecheck` and existing monthly behavior only
4. `src/domains/tax/official-rate-metadata.ts` — `OfficialSourceWatch` access created by T-5b1
5. `src/domains/exceptions/index.ts` — Sales-tax Today item loader/rule conventions
6. `src/domains/messaging/deliver.ts` — `deliverMessage` and its durable MessageDelivery/idempotency behavior
7. `src/lib/` — `grep -rn "fetch(" src/lib src/domains | grep -E "timeout|AbortController|redirect|content-type" | head -20`; reuse an existing hardened fetch helper only if it already satisfies every rule below
8. `docs/designs/BATCH-T.md` — only section 13.3 and the explicit T-5b no-auto-law-change boundary

## Before you start (verify; if false, stop and report)
- T-5b1 is merged and `OfficialSourceWatch` exists.
- The existing `tax-address-recheck` route is still the single daily tax cron entry point; do not add a second Vercel cron.
- `deliverMessage(...)` still writes through the durable message ledger; no direct provider-send path may be added.
- Official-source URLs are still Owner-controlled data rows, not hard-coded fetch targets.
- Each seeded source URL must be re-verified during this implementation PR. A URL that no longer resolves stays inactive and is recorded in `docs/STATUS.md`; do not guess or substitute a replacement.

## Build

### External fetch guard
Create `src/domains/tax/safe-official-source-fetch.ts`.

Export:

```ts
export type OfficialSourceFetchResult = {
  finalUrl: string;
  contentType: "text/html" | "text/plain";
  text: string;
  hash: string;
};

export async function fetchOfficialSourcePage(
  url: string,
  options?: { timeoutMs?: number; maxBytes?: number },
): Promise<OfficialSourceFetchResult>;
```

Required behavior:
- HTTPS only.
- Parse and validate the hostname before opening a connection.
- Resolve DNS and reject every loopback, RFC1918/private, link-local, carrier-grade NAT, multicast, unspecified, IPv6 loopback/link-local/ULA, `.local`, and literal localhost/internal destination. Validate every resolved address; any unsafe answer rejects the request.
- `redirect: "manual"`; any 3xx is an error. Never follow a redirect.
- Default timeout 10 seconds using `AbortController`; callers may only lower it in tests.
- Default response cap 1 MiB. Abort/cancel once the cap is exceeded; never buffer an unbounded body.
- Accept only `text/html` and `text/plain` media types (parameters such as charset are allowed).
- Decode UTF-8, normalize CRLF/CR to LF, collapse runs of horizontal whitespace, trim each line, drop empty leading/trailing lines, and compute SHA-256 of the normalized text.
- Returned `text` is capped to 200 KB after normalization, matching `OfficialSourceWatch.lastText` in the approved design. The hash is over the full accepted body, not the capped stored text.
- Never log response bodies, credentials, cookies, customer data, or resolved private addresses.

### Watch processing
Create `src/domains/tax/official-source-watch.ts`.

Export:

```ts
export type OfficialSourceWatchRun = {
  checked: number;
  changed: number;
  recovered: number;
  failed: number;
};

export async function runOfficialSourceWatch(
  now?: Date,
): Promise<OfficialSourceWatchRun>;

export function buildOfficialSourceChangeExcerpt(
  previousText: string | null,
  currentText: string,
): string;
```

Rules:
- Due only on Monday by `America/Denver` calendar date. A non-Monday call is a no-op.
- Read only `active = true` rows, ordered by label then id.
- Process sources independently; one failure must not stop the others.
- First successful observation initializes `lastHash`, capped `lastText`, `lastCheckedAt`, clears `lastError` / `consecutiveFailures`, and does **not** create a change alert.
- Unchanged success updates `lastCheckedAt`, clears failure state, and preserves `lastChangedAt`, `lastExcerpt`, and `reviewedAt`.
- Changed success stores the new hash/text, `lastChangedAt = now`, `reviewedAt = null`, and a privacy-safe approximately 600-character excerpt centered on the first normalized difference. Never store more than 700 excerpt characters.
- A changed page creates one durable Owner-facing transactional message through existing `deliverMessage(...)` ledger machinery. Use idempotency key `tax-source-changed:<watchId>:<hash>`, `channel: "EMAIL"`, `purpose: "TRANSACTIONAL"`, `templateKey: "tax-source-changed"`, `customerFacing: false`, and subject `{ type: "OfficialSourceWatch", id: watchId }`; retries must not duplicate email.
- Send to the existing internal notification address convention: `process.env.BILLING_NOTIFICATION_EMAIL || settings.publicEmail`; do not invent a new notification setting in this PR.
- Email uses the same informational text/excerpt as the Today item and includes the official URL. It must not claim that law/rates changed.
- On failure, increment `consecutiveFailures`, set a sanitized `lastError` (max 500 chars), and `lastCheckedAt = now`; preserve last good hash/text/change evidence.
- Failure #1/#2 produces no page-moved alert.
- At `consecutiveFailures >= 3`, a persistent Today item appears until the next successful check or the row is paused/inactive.
- Recovery clears the failure state automatically; it must not clear an unrelated unreviewed page-change alert.

### Today items
Extend the existing Sales-tax exception loader/rules, without adding another inbox:
- `TAX_SOURCE_CHANGED`: one item per active watch where `lastChangedAt != null` and `reviewedAt == null`; wording follows the approved design: “Colorado updated <label> — here is what’s new”, with excerpt + official link.
- `TAX_SOURCE_UNREACHABLE`: one item per active watch with `consecutiveFailures >= 3`; wording: “We couldn’t check <label> — the page may have moved”.
- Both link to the future T-7 Sales-tax settings/history destination if that route already exists; otherwise link to the current Sales-tax Today context and do not build T-7 UI here.
- Acknowledge only `TAX_SOURCE_CHANGED` by setting `OfficialSourceWatch.reviewedAt = now`; OWNER only, with an audit event. Acknowledgement never marks a rate change as accepted.
- Paused/inactive sources produce neither item.

### Cron integration
Extend `src/app/api/cron/tax-address-recheck/route.ts`:
- keep existing bearer authentication and existing address-recheck behavior unchanged;
- keep the existing `runAutomation({ ruleKey: "tax-address-recheck", ... })` call unchanged in purpose;
- add a second `runAutomation({ ruleKey: "tax-rate-watch", ... })` call on every authenticated daily invocation. The watch work itself no-ops unless the Denver date is Monday (or the December CPA-reminder condition below is due);
- return both automation outcomes in the route response without making one source-page failure fail the existing monthly address re-check;
- do not add another cron schedule.

### Yearly CPA reminder
In the same tax cron/domain, create one Owner Sales-tax Today reminder each December (one per Denver calendar year): “Ask your CPA whether anything in Colorado sales tax changes on January 1 for you”. Use deterministic key `tax-cpa-annual-review:<year>`. This reminder is a Today task, not an automatic legal/rule change.

## Tests
- `tests/tax-safe-official-source-fetch.test.ts`:
  - "rejects http and redirect responses"
  - "rejects loopback private link-local local and internal destinations before fetch"
  - "rejects an unsafe address when DNS returns mixed public and private answers"
  - "times out a stalled response"
  - "rejects oversized and non-text responses"
  - "normalizes text and hashes the full accepted body while capping stored text"
- `tests/tax-official-source-watch-integration.test.ts`:
  - "first successful observation initializes without alerting"
  - "unchanged Monday check preserves reviewed change evidence"
  - "changed content stores a capped excerpt and one idempotent owner message"
  - "three consecutive failures create a persistent page-moved Today item"
  - "successful recovery clears only the failure alert"
  - "owner acknowledgement records reviewedAt and audit evidence"
  - "inactive sources are never fetched or surfaced"
  - "December CPA reminder is once per Colorado year"
- `tests/tax-address-recheck-cron.test.ts`:
  - "daily cron keeps existing auth and runs source watch only on Colorado Monday"
  - "source-watch failure does not fail the existing address re-check"

## Commands
- `npm run typecheck 2>&1 | tail -40`
- `npm run lint 2>&1 | tail -40`
- `npx vitest run tests/tax-safe-official-source-fetch.test.ts tests/tax-official-source-watch-integration.test.ts tests/tax-address-recheck-cron.test.ts 2>&1 | tail -80`

## Stop and ask if
- Implementing the watch would require following redirects or allowing a private/internal destination.
- The only available message path bypasses the durable `deliverMessage(...)` ledger.
- A source URL no longer exists and no official replacement is explicitly verified.
- Any requested behavior would auto-interpret a page change as a law, taxability, filing-rule, or rate change.

## Done when
- [ ] the existing daily tax cron invokes `tax-rate-watch` as a second `runAutomation` rule and the watch does work only on Colorado Mondays without changing the monthly re-check behavior
- [ ] SSRF/redirect/timeout/size/content-type defenses are proven by tests
- [ ] page changes create one persistent Today item plus one idempotent Owner transactional message
- [ ] three failures create a persistent page-moved item and recovery clears it
- [ ] December CPA reminder is once per Colorado year
- [ ] every seeded URL is re-verified; working rows are activated, broken rows remain inactive and are recorded without guessed replacements
- [ ] no law/rule/rate change is auto-applied
- [ ] `docs/STATUS.md` updated; review threads dispositioned
