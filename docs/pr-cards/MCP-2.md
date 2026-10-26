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
Private preview-storage security prerequisite in progress on branch `ai/chatgpt/mcp-2-preview-storage-safety` (separate PR required by AGENTS.md §6 for an existing public-repository exposure).

Plan acceptance for the independently safe security fix:
- [ ] Remove the real private-store identifier and hostname from current application code, test fixtures and public setup examples; do not embed a replacement identifier.
- [ ] In preview, require its explicitly named token and store ID to match before any private access; no fallback to production/public credentials.
- [ ] Build the allowed private hostname from the validated store ID, and reject responses from a wrong host or path before using an unsigned URL.
- [ ] Unit tests cover matching credentials, missing or mismatched values, wrong-host responses, unauthorized roles, and cleanup failures; no real credentials or store identifiers in fixtures.
- [ ] CI passes at the exact head and all reviews are addressed before merge.

The code for this prerequisite removes live identifiers from source/test fixtures and preserves fail-closed checks; CI and review still pending. The remainder of MCP-2 (backup artifacts, recovery, pruning, paired media, owner retry and restore drill) is NOT implemented by this preliminary security fix and remains open on this card.

