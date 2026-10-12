# Verified low-cost Neon profile — 2026-10-12

The owner confirmed that these projects have no active real-world workload. Existing compute endpoints and future project defaults have been verified at **0.25 CU minimum, 0.25 CU maximum, and 300-second autosuspend**. This is the deliberate idle-development profile, not a production performance target. Next queries resume a suspended compute automatically and can incur cold-start latency.

No database, role, table, branch, backup, recovery-history setting, credential, pooled/direct connection string, or access control was removed or changed. The Launch plan remains in place. Storage and plan/usage fees still apply; scale-to-zero stops idle compute charges only. Do not add keepalive queries or frequent database health polling.

## Before performance is needed

1. Obtain the owner's approval to leave the idle-cost profile and identify the actual workload and budget. Do not automatically restore an old 8–9 CU ceiling.
2. Inspect the current compute and project defaults through metadata. Test representative load on a disposable local PostgreSQL instance or approved isolated branch, never the live database.
3. Review p95 query latency, CPU, memory, connection saturation and cache behavior. Fix avoidable queries before adding compute.
4. Raise the compute cap incrementally (for example 0.25 → 0.5 → 1 CU) only from measured need and an approved budget; retain autosuspend unless the owner explicitly chooses always-on operation. Update both current endpoints and future defaults if the new policy applies project-wide.
5. Use pooled URLs for application traffic and direct URLs for migrations; keep existing credentials outside the repository. Verify driver reconnect/timeouts after suspension and under concurrency before launch.
6. Record before/after settings, cost implications and proving workload in the next implementation PR and deployment checklist. Roll back capacity if the change does not improve the measured workload.

Current official guidance: [compute management](https://neon.com/docs/manage/computes), [scale to zero](https://neon.com/docs/guides/scale-to-zero-guide), and [autoscaling](https://neon.com/docs/introduction/autoscaling). Launch uses five-minute autosuspend; a shorter adjustable threshold requires Scale, so this change buys no upgrade.

## Project record

Project name: Appliance Desk. Prior allowed compute range: 0.25–8 CU on both current endpoints and future defaults. Read-back confirmed the low-cost values on 2026-10-12. For RAD Memory, this runbook is a reference record; verify which app currently uses the project before changing capacity.
