# T-5b2b — official-source watch, Today and cron lifecycle

Base: final reviewed T-5b2a · Risk: external-source monitoring / durable notifications · Migration: none
Parent: `T-5B2-OFFICIAL-SOURCE-WATCH.md`. T-5b2a owns the network boundary; this card must use it and must not add another HTTP client.

## Read only
1. Parent T-5b2 card, excluding fetch implementation already completed by T-5b2a.
2. `src/domains/tax/safe-official-source-fetch.ts`.
3. `src/domains/tax/official-rate-metadata.ts`.
4. Existing tax cron, automation health, exception/Today, durable messaging and StaffTask seams named by the parent card.

## Build
- Add Monday-by-Colorado-date `runOfficialSourceWatch(now?)`; December CPA reminder may run on any December daily invocation.
- Active sources only; stable label/id order; process independently.
- First success initializes without alert. Unchanged success clears failure state but preserves existing change/review evidence.
- Changed success stores hash/text/excerpt, lastChangedAt, clears reviewedAt, and writes exactly one durable Owner transactional email using `tax-source-changed:<watchId>:<hash>`. While that change remains unreviewed, unchanged checks re-enter the same durable delivery key so FAILED/NOT_SENT/ledger-failed attempts can recover without duplicating successful mail.
- Failure increments capped sanitized evidence and preserves the last good content. The third and later consecutive failure surfaces a persistent Sales-tax Today item; recovery clears only failure state.
- Source-change Today item includes a separate HTTPS official-source link and an Owner-only “I looked at it” action. The action carries an exact displayed change version derived from `lastHash` + `lastChangedAt`; OWNER acknowledgement re-checks active Owner state and row-locks the watch in the same transaction, refuses inactive/already-reviewed/version-mismatched rows, sets reviewedAt, and audits. A stale page must never clear a newer unseen change. ADMIN may view finance/tax alerts but cannot be offered the acknowledgement action.
- Add the deterministic December StaffTask `tax-cpa-annual-review:<year>` once per Colorado year with the approved wording.
- Add `tax-rate-watch` as a second durable `runAutomation` call inside the existing authenticated tax-address cron. Preserve existing address re-check behavior and return both outcomes; one source-page failure never fails the existing re-check.
- Register the new rule in existing automation health. No new cron.
- Extend the existing Sales-tax exception feed, not a second inbox.
- Never infer a law, taxability, filing-rule or rate change from page text.

## Source verification / activation
Re-verify all six exact seeded URLs in this PR. No guessed replacement:
- sources that cannot be fetched by the hardened transport stay inactive;
- a working source may be activated only after exact-head implementation gates prove the transport/watch and the exact URL is rechecked;
- activation is a narrowly scoped data-state change, not a migration and not permission to activate live customer communications.

## Tests
- real-Postgres lifecycle: first/unchanged/change, durable email retry without duplicate row, failure threshold, recovery, inactive source, Owner acknowledgement/audit, stale-version rejection, once/year CPA task;
- cron/auth isolation: both rule keys and source-watch failure cannot fail address re-check;
- Today source link/change/failure behavior stays bounded;
- no real network/provider send in CI.

## Done
Exact-head typecheck/lint/focused tests/full CI/performance/preview/reviews green; source verification disposition recorded in STATUS; only verified fetchable rows activated; five-or-fewer failed sources remain inactive without guessed substitutes; no tax rule/rate is auto-applied.
