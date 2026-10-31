# RTC 1 conformance runner — immutable upstream test fixture

The following files are exact source copies from the **read-only** repository
`Robinson-AI-Systems/robinsons-toolkit-hub`, commit `e6cfb98266728ce0e986ab068569a5d1117a4334`, under `packages/conformance`.
The Git blob hashes are recorded in `tests/mcp-rtc-vendored.test.ts`.
Do not edit a vendored file in place. To upgrade, pin a new reviewed commit,
reimport every changed file, update hash evidence and repeat all app probes.

This reference harness is a **test oracle**, not full RTC 1 certification.
The fake-server checks prove the oracle catches deliberate violations. Merged PR #787
independently proved the pinned two-server HTTP limiter using one disposable PostgreSQL
database (120 admitted and 60 refused), and tested the app's synthetic HTTP journal
with separate owner approval and idempotent confirmation. The upstream generic
direct-setter write probe still does not match Appliance Desk's mandatory owner journal,
and real-client acceptance is NOT_TRIED. Local PKCE OAuth refresh selection-preservation
evidence is being added separately; do not mark it proven before exact-head CI.
No real owner credentials, production accounts or outside repository changes are involved.
