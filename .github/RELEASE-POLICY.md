# Daily production release policy

Owner-approved 2026-10-12. Pull requests target `main`; `main` is the default development branch. Do not merge PRs into `live` or push directly to it. Do not run Vercel CLI production deployments or manually promote a preview during routine development.

`.github/workflows/daily-live.yml` alone promotes a checked main snapshot to `live`, once per America/Denver calendar day, scheduled for just after Denver midnight (00:01 America/Denver), with bounded missed-run retries later that night and one UTC backup run at 12:43 UTC (GitHub may start late). An atomic branch and dated tag update prevents a rerun from promoting twice. No changes means no release; failed, pending or missing required checks or diverged history refuse promotion. Nothing force-pushes. Existing customer billing and MCP production-access gates remain unchanged.

Vercel projects linked to this repository must track `live` for production and have automatic preview deployments disabled. `vercel.json` permits Git deployments only for `live`, including future linked projects. Keep existing GitHub CI and any existing local browser/build tests enabled; use local fixtures rather than paid Vercel previews. Emergency releases require a separate explicit owner instruction. The release schedule is independent of development PR batch counts.

The repository-specific required check names are in `.github/release/policy.json`. Repositories without application CI require the release-policy tests; this does not claim their application code has been tested. Public GitHub Actions standard runners do not incur Vercel build charges. Production traffic, cron execution, storage, database services, Vercel subscriptions and existing sandbox resources can still incur costs.

## Initial setup and recovery

Before merging this policy, create `live` from the existing `main` SHA and read back both branch references. This rollout performs that provisioning through the authenticated GitHub connector; it is a one-time setup action, not a routine release. The scheduled job intentionally refuses a missing live branch rather than silently recreating a deleted production branch. If live is deleted, investigate and restore its last verified released SHA before the next run. Never initialize an existing live branch over its current history.

For a new Vercel project, set Settings → Environments → Production → Branch Tracking to `live`, disable automatic Preview deployments, then read back both settings. Repository Git configuration does not change Vercel's production-branch setting by itself. Apply the Git rule to each nested Vercel project root too. No Vercel deployment success is required to merge development PRs; existing app CI and the release-policy check must pass. A checked snapshot is promoted; a merge racing the final push can reach production the following day.

## Active development and release races (owner, 2026-10-13)

`main` holds ongoing checked development; `live` identifies the released snapshot. Agents continue merging into `main`, never into `live`. A commit merged after a release belongs to the next scheduled release; do not keep live synchronized on every merge or trigger extra daytime builds. The release job refreshes changed remote refs and waits up to ten minutes for missing/pending exact-head checks. A completed failed check, diverged history or exhausted window refuses promotion. Atomic daily markers and non-forced fast-forwards remain mandatory. The schedule is 00:01 America/Denver, with native DST and possible GitHub queue delays.

An explicit owner request can authorize a one-off manual release after the exact candidate passes required checks. Read fresh main/live refs, require ancestry, update live without force and with an expected-head lease, then verify Vercel production reaches READY for that SHA and the production alias resolves to it. A branch update alone is not deployment-success evidence. This exception does not authorize automatic releases at agent batch boundaries, new provider production permissions or spending.

CI registry recovery (2026-10-13): main run 38403982749 and prior main runs failed before tests when the ECR Postgres mirror exceeded its public data limit. Unit and browser services now use the official public `postgres:17` image on GitHub-hosted Ubuntu runners, where GitHub documents a Docker Hub public-pull exemption: https://docs.github.com/en/actions/reference/limits#docker-hubs-rate-limit-for-github-actions. The database version, isolated test databases, all three unit shards, all four browser shards and required aggregate CI remain unchanged. Actual Actions initialization and test completion are the acceptance evidence; never bypass failed CI to release.

## Missed-event recovery (owner repair, 2026-10-14)

A successful checked no-change run now creates the same dated daily receipt as
a promotion. Otherwise a later fallback could deploy a post-midnight merge
even though the primary schedule ran successfully. The receipt is tag-only on
an unchanged live branch and does not invoke an additional Vercel build.
The check inventory, concurrency readback and no-force tag creation still apply.

The primary remains 00:01 Denver. Backup events run at 00:17, 01:17 and 05:37 Denver,
plus 12:43 UTC (06:43 MDT / 05:43 MST). Each invokes the same atomic, checked,
once-per-Denver-day promoter. These are recovery opportunities, not extra releases.
GitHub can omit every scheduled event; backup configuration alone does not prove reliability.
Verify the actual run, daily receipt, released SHA and Vercel production deployment.

If all events are missed, the signed-in owner `christcr2012` can Run workflow on
`main` with `recover_missed_daily` checked. The default is false; other actors,
branches and invocations fail closed. Recovery retains exact-main CI, ancestry,
atomic marker and read-back checks and skips if a release already occurred that day.
No provider production permission, plan, spending limit or preview setting changes.
