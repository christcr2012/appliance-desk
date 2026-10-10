# COM-L13B — Evidence-labelled telecom reports, Today and health

**Status: MERGED after exact-head CI and review (PR assigned at release).** Base 1d11df7 (COM-L13A #380 merged), no migration.
Authorities: BATCH-COM §6.1–6.3, §7–8; COM-L10–13A code, AGENTS, work-index.

Acceptance:
- Private /desk/reports telecom section: owner/admin only; explicit GMT provider period, account name, reported total, current provider resource costs separated from account total, verified statement comparison separately, unknown prices/categories, last successful usage sync and stale label, budget only as *inactive suggestion*. No profit/paid/personal attribution invented, no double counting.
- Shared METRICS registers telemetry basis, date, source and drill; ACTUAL means provider-observed **not** paid/reconciled, projected ESTIMATE; no replacement of rental earnings.
- Typed S issues for stale previously active/completed telecom usage sync and independently verified mismatched statement, PII-free summary, typed bounded identifiers. At most one fingerprint/account + condition; clear only when confirmed recovery. Existing HIGH System Issues appear in Today, no separate duplicate To do inbox.
- Any missing configuration/never-synced account is clearly "not started" and not treated as an active outage; don't invoke paid Twilio or send owner alerts until IN-53. Existing S sweep is the only periodic scanner.
- Unit, isolated disposable PostgreSQL, browser/route inventory as applicable, exact-head CI and review. Automated review unavailable — waived unless automated feedback arrives; address findings.
- STATUS, index, CHANGES-SINCE-DESIGN updated as if merged. COM-L14A follows, then L14B, L15; pause after L15 merge before W-1.

## Implementation evidence and review
- `/desk/reports` private telecom section uses the actual L12 scoped read contract, exact GMT windows, known/unknown provider/source layers, validated warning-preview policy and drill to private setup. Existing rental revenue figures, expenses and customer attribution stay unchanged.
- `telecom-attention.ts` pure decisions and `telecom-health.ts` bounded DB projection drive the existing typed S sweep. No customer IDs, phone numbers, message text or provider secrets enter SystemIssue. Existing HIGH issue handling adds resolving To do links, not a second task queue. Unresolved threads and unmatched missed inbound calls are counted without content.
- Unit coverage: tests/telecom-attention.test.ts; disposable PostgreSQL: tests/telecom-attention-integration.test.ts; owner browser/accessibility: e2e/telecom-reports.spec.ts. Exact-head CI is required before merge; local browser worktree build can be blocked by external node_modules symlink.
- No new provider calls, cron, communications, budget alert dispatch, auto-cutoff, paid expense or financial posting. IN-51/52/53 remain launch approvals.
- Automated review unavailable — waived unless feedback arrives. Self-reviewed GMT/currency/date/source distinctions, issue clear conditions, data minimization and role-gated surfaces.
