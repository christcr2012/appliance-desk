# VAULT-1 — Business records: documents, numbers and dates

Build spec: `docs/build-specs/engines/RECORDS-VAULT.md` sections 1–3. Requested by Chris 2026-10-25. Depends on CMP-1
(field encryption). Risk: **private files and encrypted numbers**.

## Acceptance
- [ ] Records hold files (private storage, PDF/images by magic bytes), masked numbers (encrypted), issue/expiry dates, portal links, costs and linked filings.
- [ ] Starter records offered for every account and document in the spec; adding them twice changes nothing.
- [ ] Renewal reminders on To do; "Renewed…" keeps the old file as history.
- [ ] Export pack (ZIP + index), numbers masked unless unlocked; audited.
- [ ] OWNER only (ADMIN read of non-sensitive kinds); `ci` green; every review comment read.

## Progress
Not started.
