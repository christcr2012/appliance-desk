# Daily production release policy

Owner-approved 2026-10-12. Pull requests target `main`; `main` is the default development branch. Do not merge PRs into `live` or push directly to it. Do not run Vercel CLI production deployments or manually promote a preview during routine development.

`.github/workflows/daily-live.yml` alone promotes a checked main snapshot to `live`, once per America/Denver calendar day, scheduled at 10:23 UTC (04:23 daylight time / 03:23 standard time; GitHub may start late). An atomic branch and dated tag update prevents a rerun from promoting twice. No changes means no release; failed, pending or missing required checks or diverged history refuse promotion. Nothing force-pushes. Existing customer billing and MCP production-access gates remain unchanged.

Vercel projects linked to this repository must track `live` for production and have automatic preview deployments disabled. `vercel.json` permits Git deployments only for `live`, including future linked projects. Keep existing GitHub CI and any existing local browser/build tests enabled; use local fixtures rather than paid Vercel previews. Emergency releases require a separate explicit owner instruction. The release schedule is independent of development PR batch counts.

The repository-specific required check names are in `.github/release/policy.json`. Repositories without application CI require the release-policy tests; this does not claim their application code has been tested. Public GitHub Actions standard runners do not incur Vercel build charges. Production traffic, cron execution, storage, database services, Vercel subscriptions and existing sandbox resources can still incur costs.

## Initial setup and recovery

Before merging this policy, create `live` from the existing `main` SHA and read back both branch references. This rollout performs that provisioning through the authenticated GitHub connector; it is a one-time setup action, not a routine release. The scheduled job intentionally refuses a missing live branch rather than silently recreating a deleted production branch. If live is deleted, investigate and restore its last verified released SHA before the next run. Never initialize an existing live branch over its current history.

For a new Vercel project, set Settings → Environments → Production → Branch Tracking to `live`, disable automatic Preview deployments, then read back both settings. Repository Git configuration does not change Vercel's production-branch setting by itself. Apply the Git rule to each nested Vercel project root too. No Vercel deployment success is required to merge development PRs; existing app CI and the release-policy check must pass. A checked snapshot is promoted; a merge racing the final push can reach production the following day.
