# O02 preview isolation — concrete setup handoff

Status: BLOCKED on Vercel environment administration. No schema work or
external environment change performed by this update.

Verified read-only 2026-09-30:
- Appliance Desk Vercel project: prj_3HAWVPau4QJqPu8hf6PbgRBlbLOi.
- Team: team_PUafLQmqT7LYBaBs8lEOPYMG.
- Neon project: jolly-term-08991992, production main br-wild-smoke-b7etke32
  is protected. Existing development branch br-bold-rain-b74uzbdy is ready,
  named dev-codex-prelaunch-interest-20260930. Reuse only after checking its
  users/data and intended lifetime; it is not automatically wired to Vercel.
- Connected Vercel tools here expose project/deployment reads, not environment
  writes; no Vercel CLI auth/token is configured in this execution environment.
  Project read succeeds with idOrName despite the connector's documented
  projectId argument mismatch. No credentials are recorded in this document.

## Proposed change in the Vercel dashboard (requires permitted UI access)

Apply to Preview only. Preserve Production settings and the main database.
Inspect branch-specific overrides as well as generic Preview values.

| Setting | Required result |
|---|---|
| DATABASE_URL | Runtime pooled URL of the selected isolated development branch |
| DIRECT_URL | Migration direct URL of that same branch; prove database identity before build |
| Auth secret and canonical URLs | Independent preview/test auth context and correct preview host; no production session sharing |
| Stripe keys/webhook secrets | Test mode only; verify no live key or live endpoint credentials inherited |
| Email and SMS credentials/mode | Non-sending preview; code must reject outbound attempts even if keys accidentally remain configured |
| Blob/private files/backup output | Independent private preview store/namespace; no production overwrite, upload target or public customer-file exposure |
| Cron authorization | Distinct preview secret; production cron credentials do not grant access to preview mutation routes |

This is a proposed configuration contract, not a claim that those keys or
separate stores exist. Inspect actual source/settings before choosing exact
names or buying services. If a new store incurs cost, stop under IN-15.
Keep secrets in approved settings, never in Git, chat, logs or PR descriptions.

After wiring, implement fail-closed build/runtime target checks, preview
non-sending guards and private namespace checks as bounded O02 PRs. Verify
migrations from both prior schema and empty disposable schema. Deploy a
cumulative preview, create a clearly tagged disposable fixture ONLY there,
verify its absence in production with read-only evidence, and demonstrate
outbound email/SMS and live payment attempts cannot execute. Record branch/DB
identity fingerprints without passwords. Never reset/seed the production DB.

Only then mark O02 VERIFIED and start O09/O13 migrations. A different database
name or a NEXT_PUBLIC preview flag alone is not proof of isolation. Dashboard
changes take effect outside Git and need before/after scope plus safe reversal
documented in ARCHITECTURE and HANDOFF.
