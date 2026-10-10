# COM-L11 — Read-only telecom account, usage, rate, and resource sync

**Status: MERGED after exact-head CI and completed review (PR assigned at release).** Baseline main `0d7fc8d`; COM-L10 #376 merged with exact-head CI green.
Authoritative: BATCH-COM §2.3, §3, §6.1–6.2 and §9. No schema migration, provider mutations, live SMS/voice activation, paid lookup, public route or financial posting.

## Drift checked
- L10 five tables, account-scoped cost trigger, exact signed Decimal(24,10), and backups already exist. Reuse, never re-model.
- L8/L9 private call legs; L4 SMS attempts exist. Only *uniquely matched* resources may be attributed; unknown belongs to account only.
- Twilio Usage dates are **GMT** and category totals include fees not in resource pricing. Keep their evidence separate. A provider snapshot is not a verified invoice.
- Twilio exposes read-only Message/Call, Usage Records, IncomingPhoneNumber, Account and country Pricing REST endpoints. Usage counts/prices may be strings; reject unknown numeric precision as unknown rather than JS float.
- Environment has production-only API key/secret gate; no credentials in DB, output or logs. Tests inject a fake transport and use throwaway Postgres.

## Acceptance
1. Read-only provider adapter verifies account SID, uses only allowlisted account-scoped GET endpoints and authenticated fixed Twilio hosts, bounds response/page, validates next-page path; no arbitrary URL/paid Lookup/fallback provider.
2. Sync command acquires bounded per-account/resource claim without holding DB transaction during network call; upserts each successfully validated provider page + advances cursor atomically and releases claim; failure leaves last committed page, records failure/staleness and allows safe retry.
3. Usage GMT-day/category observations append immutable corrections with exact provider hash; preserve account total versus child breakdown and unknown prices; no double counting, no invented client-local month.
4. Message/Call prices include distinct legs and delayed later pricing. Same observations are idempotent; changed signed prices append revision and point to same-account previous cost fact. Link only provider SID matched to a verified account attempt/leg; unmatched stays unallocated.
5. Read-only pricing records carry country/number type and carrier dimensions. Readiness verifies account and owned number capabilities but **does not** infer A2P approval, activate SMS/voice, or declare paid invoice reconciliation.
6. Bounded pagination, duplicate/out-of-order correction, no advance after page failure, zero/unknown/mixed currency, cross-account and GMT dates proven by unit + disposable Postgres tests. No shared settings writer added.
7. Security diff review; updated STATUS, work-index, design change note and guide. Exact-head green CI before merge. Automated review unavailable — waived.

Next: COM-L12 reconciles compatible periods and sets budget/alerts. IN-51/52/53 remain outside go-live decisions.

## Implementation evidence and successor handoff
- Read-only Twilio GET provider client is scoped to the verified account, fixed hosts and 50-item pages; the provider continuation must keep GMT filters and prevent subaccount expansion. Authentication is production-only, with fake network adapter in tests.
- One page and checkpoint commit atomically after provider GET; failed page persists a sanitized failure but never advances or loses the last completed page. Claim expires for recovery.
- Provider-reported message/call costs preserve sign and exact Decimal(24,10); same-resource revisions supersede only same account/currency/basis. Unmatched costs stay unallocated. Missing price is unknown. Usage category totals remain independent from resource facts.
- Account status and observed number capabilities do not activate messaging or attest A2P, IN-51/52/53 or live customer communications. No public UI or trigger was introduced.
- Tests: six provider adapter cases, four real isolated Postgres integration cases, plus preflight related suites and exact-head CI. Automated review unavailable — waived; inspect diff and handle any review finding before merging.
- Next COM-L12 consumes L11 cursor/snapshot/cost/rate evidence, with distinct observed/estimated/invoice bases and no duplicate totals.
