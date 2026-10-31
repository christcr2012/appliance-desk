# MCP-9 — verify an AI assistant connection without guessing

This is a **real-client acceptance walkthrough**, not a claim that any client has passed.
Use the dedicated Appliance Desk testing app only after its deployed revision includes
the approved connector. Do not change the public/live site or test with real customer records.
Never paste a password, OAuth token, RTC pass, private URL or provider secret into a chat,
terminal command, issue, screenshot or this public repository.

## Direct MCP assistant (recommended)

1. Sign in to the authorized **testing** app as its synthetic owner, then open
   **System health → AI assistants → Connect an AI assistant**.
2. In an MCP-capable client, add the app's displayed `/api/mcp` address. Use its
   standard browser-based sign-in, inspect the requested data areas and approve only
   the needed read access. Do not turn on any live write/payment/message capability.
3. From that same client, call **whoami** and one explicitly scoped read. Inspect the
   returned role, approved scopes, release environment and a harmless result. A tool
   listed in the app does not count as working until a real client actually receives
   its response. Check a large owned result handle only when one is naturally returned.
4. If the client supports refresh, renew its token and repeat the same read without
   changing the approved scopes. After the normal tested release, reconnect and check
   the same route again; a local mock is not proof of a hosted redeploy.
5. Disconnect the assistant in System health. Check that its old token can no longer
   read anything. Do not use production customer data to demonstrate revocation.

## Optional RTC HTTP client / command-line tool / Hub

1. Only if you personally choose this integration, open **Advanced: Robinson Toolkit pass**.
   Select the narrowest permitted read-only data areas, leave live reads disabled unless
   separately authorized, and create a time-limited pass. It is shown once.
2. Put the pass in the client's protected secret storage, not a URL or command argument.
   Configure the displayed HTTPS tool base address; the RTC endpoints include
   `/api/contract`, `/api/tools`, `/api/whoami`, and owned `/api/results/{handle}`.
   RTC passes do not work in the OAuth `/api/mcp` endpoint.
3. Make one non-sensitive read and (when applicable) retrieve a scoped result handle.
   Revoke that pass in System health, then verify that the same client can no longer
   read or retrieve the result. An optional Hub is not needed for direct MCP acceptance.
4. If the Hub requires an outside account, deployment, fee, or infrastructure change,
   record that prerequisite on the owner checklist and do not provision it from this test.

## Record only observed evidence

For each client actually tried, record its **exact name and version**, the **testing
app's deployed commit SHA**, date/time, approved read scopes, route, harmless result
and revocation outcome. Keep sensitive headers and returned business content out of
the public evidence. An incomplete trial is **NOT_TRIED** or **NOT_PROVEN**, never
PASSED. Engineering may update `docs/mcp/acceptance.json`'s `rtcClients` entry with
`status: "PASSED"`, the tested `revision` and sanitized `evidence` only after the
authorized real-client check. A passing SDK fixture, CI run or saved connection alone
must never change that status.

Owner-only testing and real-provider acceptance do not hold back separately finished
source changes from review and merge.
