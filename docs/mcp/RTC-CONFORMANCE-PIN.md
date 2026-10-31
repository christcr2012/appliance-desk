# RTC 1 conformance runner — immutable upstream test fixture

The following files are exact source copies from the **read-only** repository
`Robinson-AI-Systems/robinsons-toolkit-hub`, commit `e6cfb98266728ce0e986ab068569a5d1117a4334`, under `packages/conformance`.
The Git blob hashes are recorded in `tests/mcp-rtc-vendored.test.ts`.
Do not edit a vendored file in place. To upgrade, pin a new reviewed commit,
reimport every changed file, update hash evidence and repeat all app probes.

This reference harness is a **test oracle**, not proof of Appliance Desk conformance.
The fake-server checks prove the oracle catches deliberate violations. The app's
real, authenticated full-pass HTTP, MCP-5 writes, OAuth refresh and two-server
rate limits remain **NOT_PROVEN** until they pass against the actual app.
No real owner credentials, production accounts or other repository changes are involved.
