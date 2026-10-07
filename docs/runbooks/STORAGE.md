# Storage and recovery runbook

Appliance Desk uses separate storage roles. Treat every credential and pathname as production data; never “clean up” a store by browsing and deleting unfamiliar objects.

## What lives where

1. `BLOB_READ_WRITE_TOKEN` selects the existing Vercel Blob store used by the application. Database backups are written under `backups/` with private access; F1-b pairs each database backup with `<backup-url>.media.json`.
2. Operational/customer photos use the separately verified **private photo store** selected by `PRIVATE_PHOTO_BLOB_READ_WRITE_TOKEN` + `PRIVATE_PHOTO_BLOB_STORE_ID`. The code refuses a mismatched token/store ID.
3. Private-photo recovery copies stay in that same private store at `recovery/YYYY-MM/<sha256>/<source-path>`. Privacy-deletion tombstones live under `recovery/tombstones/`.
4. Preview uses its own verified preview private store and must never fall back to production storage.

## Normal checks

1. Open **Desk → Automations**. The daily `backup` and `media-copy` runs must each have a known successful result; “never ran” is not healthy.
2. A media manifest reports every referenced private photo with size/SHA-256. **Unreferenced** means “investigate,” not “delete.”
3. **Missing** means the database references bytes the store could not read. **Tombstoned** means privacy deletion intentionally forbids recovery; a live database row pointing there is an integrity problem and the media-copy run fails.
4. Never delete `recovery/` or tombstone objects during routine cleanup. Recovery copies are content-addressed so older backups keep the bytes they were paired with.
5. For recovery, follow `docs/runbooks/RESTORE.md`: restore the isolated database, verify the paired media manifest, then run the tombstone-aware media restore.

## Failure response

1. Confirm the failing automation and exact error before touching credentials.
2. For a private-store configuration failure, verify the token and configured store ID belong together. Do not substitute the public/catalog credential.
3. For a missing referenced photo, locate the paired recovery manifest and verify its hash. Do not overwrite a different primary object.
4. If privacy deletion is involved, the tombstone wins even if recovery bytes still exist.
5. A second storage **provider** is not configured by Batch F; adding one is a spending/owner decision (IN-15).

## Drill

Automated drills: `tests/backup-restore-integration.test.ts` for the database and `tests/media-inventory.test.ts` for hashing, versioned recovery copies, orphan reporting and privacy tombstones.

Last drilled: **2026-10-06 (automated database/media recovery drills).**
