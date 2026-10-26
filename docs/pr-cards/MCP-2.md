# MCP-2 — Backups you can trust

Build spec: `docs/build-specs/engines/HEALTH-BACKUP.md` sections 6–12. Design: `docs/mcp/APPLIANCE-DESK-UPGRADES.md`,
`docs/mcp/DATA-AND-RECOVERY.md`. Approved by Chris 2026-10-25. Depends on MCP-1 (failure codes). Risk: **backups,
private storage, deleting old copies**. All testing uses fake storage and throwaway databases — never the real store.

## Why
Today a backup that saved fine but failed to tidy old copies is reported as "backup failed", nothing checks the saved
copy can be read back, old-copy cleanup could delete the last good backup, backups share the public pictures' storage
key, and the nightly photo copy may pair with the wrong backup.

## One PR
The backup record table, stages, pruning and photo pairing are one chain; each piece alone leaves the chain wrong.

## Acceptance
- [ ] Capture, upload, read-back, prune and photo-copy failures are told apart (tests for each).
- [ ] A prune failure after a verified upload is a successful backup plus a "tidy-up" notice.
- [ ] The newest verified backup and its photo list are never deleted, at any age (test with 1,200 objects).
- [ ] Backups never use the public pictures' key; missing private storage gives a plain next step.
- [ ] Photo copy pairs with today's verified backup only; a photo deleted during the copy is not copied.
- [ ] "Run the backup again" runs once on double click and doesn't change other jobs.
- [ ] Restore drill restores rows, relationships and photos into throwaway targets (CI).
- [ ] `ci` green at the exact head; every review comment read.

## Owner checklist
One row: confirm which private storage the live app's backups use (System health shows it). Never blocks merging.

## Progress

- Security prerequisite merged as PR #609; private preview store identifiers are no longer in active code.
- 2026-10-25: resumed the already-approved persistent Vercel Sandbox, fetched origin/main and created a separate clean worktree `ai/chatgpt/mcp-2-backup-reliability`. `npm ci` passed using the quickstart's synthetic Prisma env workaround.
- **Plan acceptance** (whole card): an additive, documented and restorable `BackupArtifact` ledger; separate capture/upload/verified-readback/prune failure states; verified-private backup destination; never prune newest verified database and newest complete media pair; only pair media with today's verified database artifact, and honor deletion tombstones; owner-only serialized manual retry; disposable-database and fake storage tests including concurrency, pagination and restore; owner-facing readiness and retry controls; all CI/review gates at exact head.
- Full feature implementation and tests: not yet verified. Never contact production storage during this work; owner only confirms private-store setup after deployment.
