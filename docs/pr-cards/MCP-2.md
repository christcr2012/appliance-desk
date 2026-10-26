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
- [x] Capture, upload, read-back, prune and photo-copy failures are told apart (tests for each).
- [x] A prune failure after a verified upload is a successful backup plus a "tidy-up" notice.
- [x] The newest verified backup and its photo list are never deleted, at any age (test with 1,200 objects).
- [x] Backups never use the public pictures' key; missing private storage gives a plain next step.
- [x] Photo copy pairs with today's verified backup only; a photo deleted during the copy is not copied.
- [ ] "Run the backup again" runs once on double click and doesn't change other jobs.
- [ ] Restore drill restores rows, relationships and photos into throwaway targets (CI).
- [ ] `ci` green at the exact head; every review comment read.

## Owner checklist
One row: confirm which private storage the live app's backups use (System health shows it). Never blocks merging.

## Progress

- Security prerequisite merged as PR #609. Recovery implementation on branch ai/chatgpt/mcp-2-backup-reliability.
- Verified locally: isolated npm install with synthetic Prisma settings; schema validation; all 26 focused backup/media unit tests; npm run check:quick (secret scan, migration/route consistency, typecheck, lint and words).
- Code covers staged SHA-256 readback and private credentials, a ledger-linked full media pair, privacy-deletion checks, safe pruning and old-object pagination, owner-only serialized retry and retention settings, a plain-language System health screen and a user guide.
- Real-database tests for competing owner/nightly retries and retention, and the existing full restored-database drill extended with linked backup artifacts and customer/agreement/invoice relationships, are included. Browser tests cover owner settings/retry visibility and accessibility. They are not yet proven until exact-head CI finishes.
- No hosted storage/provider/production data changed. Owner's live private-store confirmation is on the single owner checklist. Do not claim the merge until CI, review and exact-head receipt are observed.
