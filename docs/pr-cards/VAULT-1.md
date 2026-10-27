# VAULT-1 — Business records: documents, numbers and dates

Build spec: `docs/build-specs/engines/RECORDS-VAULT.md` sections 1–3. Requested by Chris 2026-10-25. Depends on CMP-1
(field encryption). Risk: **private files and encrypted numbers**.

## Acceptance
- [x] Records hold files (private storage, PDF/images by magic bytes), masked numbers (encrypted), issue/expiry dates, portal links, costs and linked filings.
- [x] Starter records offered for every account and document in the spec; adding them twice changes nothing.
- [x] Renewal reminders on To do; "Renewed…" keeps the old file as history.
- [x] Export pack (ZIP + index), numbers masked unless unlocked; audited. (Masked form delivered here; the unlocked form arrives with VAULT-2's unlock, per drift item 5.)
- [x] OWNER only (ADMIN read of non-sensitive kinds); `ci` green; every review comment read.

## Progress
Packet written 2026-10-26 (Vivienne, Lane 6). Branch `ai/vivienne/vault-1`, base
`main` at `238f7a573ddb410b43a754bbdea079caf5a74ca7` (CMP-1 merged, PR #642).
Building; first commit also carries the ACC-6 docs tidy-up (merged status for
ACC-6 in the work index, STATUS and the ACC-6 card).

## Packet (per docs/pr-cards/README.md minimum card)

**Prerequisites, verified on the base:** CMP-1 merged — `src/lib/field-crypto.ts`
exports `encryptField` / `decryptField` / `hasFieldCryptoKey` (AES-256-GCM,
`COMPLIANCE_ENCRYPTION_KEY`, `v1:` format); the compliance registry holds the
obligation keys the starter records link to. ACC-6 merged (PR #628).

**Drift check (spec vs the code on the base; correct the build, not the card's acceptance):**

| # | Spec said | Reality on the base | Disposition |
| --- | --- | --- | --- |
| 1 | Sales-tax license starter links `co.license.expiry` | No such key exists in the compliance registry (verified list on main) | Starters link only keys that exist; the license starter carries its own expiry (Dec 31 odd years) via `expiresOn` + 24-month repeat |
| 2 | File read route: "ADMIN only for kinds the owner marks 'admins may see'" | No such flag exists in the schema or settings | Owner setting "Kinds admins may see" on BusinessSettings (starting value: DOCUMENT, LICENSE, PERMIT, REGISTRATION, INSURANCE, VEHICLE, CONTRACT), and a record with an encrypted number is never admin-readable whatever its kind; filed as a Decisions question (DQ-VAULT-ADMIN-KINDS) |
| 3 | Record menu has "Archive" | `PaperworkStatus` has no ARCHIVED (TO_DO / IN_PROGRESS / DONE / NOT_NEEDED) | Archive = NOT_NEEDED (kept, with its files, out of Needs you); hard removal stays the existing delete |
| 4 | Export pack is a ZIP | No zip library in `package.json` and no zip writer in the codebase | Small in-repo ZIP writer (deflate via `node:zlib`, CRC32), unit-tested by round-trip; no new dependency (buying/adding packages is out of lane scope without need) |
| 5 | Numbers shown masked; "Show" via VAULT-2 unlock | `decryptField` is documented "only filing preparation may call this" | VAULT-1 never decrypts: screens and exports carry `numberLast4` + a has-number flag only. Reveal arrives with VAULT-2's unlock, which owns that call |

**Build contract:**
- Extend `src/domains/paperwork` (no parallel domain): migration
  `20261103000000_business_records` adds the spec section 1 columns to
  `BusinessPaperwork` plus `BusinessRecordFile`; `BACKUP_MODEL_POLICY` gains
  `BusinessRecordFile` (rows backed up; `numberEncrypted` stays encrypted in
  backups, same note as CMP-1's `einEncrypted`).
- DTO boundary: `numberEncrypted` never leaves the domain. DTOs carry
  `numberLast4` and `hasNumber`. Writes follow the paperwork domain's existing
  actor pattern; the number is encrypted with `encryptField` and refused with a
  plain explanation when `hasFieldCryptoKey()` is false (the key itself is
  CMP-1's owner-checklist row; no new key in this card).
- Files: `records` added to the private photo paths; upload through a server
  action (one file per request, magic bytes PDF/PNG/JPEG/WebP, 900 KB direct;
  larger PDFs via the private Blob path with a one-use token bound to the
  record, OWNER only, 15 MB max). Read route
  `src/app/api/records/files/[id]/route.ts`, `Cache-Control: private, no-store`,
  role-checked per drift item 2. Upload, download, export and renewal write
  audit rows.
- Screen: `/desk/paperwork` renamed **Business records** (URL kept), tabs
  Needs you / All / Coming up / Files; record page per spec section 3;
  "Renewed..." sets a new expiry, keeps every old file as history.
- To do: `listPaperworkAttention` uses the earlier of `expiresOn` / `dueOn`.
- `docs/AI-PR-READ-FIRST.md` read before the upload/auth code (uploads,
  secrets); `docs/DATABASE.md` and `docs/OWNER-GUIDE.md` updated in the PR.

**Named regression cases** (anchors: `tests/business-records-integration.test.ts`,
`e2e/business-records.spec.ts`): starter list added twice changes nothing;
a non-PDF/image payload with a PDF name is refused by magic bytes; oversize
refused; OWNER sees a masked number and its last 4, ADMIN sees an allowed kind
without a number and is refused a TAX_ACCOUNT record and any file on a
number-bearing record, STAFF/CUSTOMER get not found; export ZIP's index shows
masked numbers only and writes an audit row; "Renewed..." keeps the old file;
with no encryption key set, saving a number is refused with the explanation;
an expiring record surfaces on To do from `expiresOn` even when `dueOn` is later.

**Commands:** `npm run test:db -- tests/business-records-integration.test.ts`,
`npx vitest run` for the zip/domain units, `npm run test:browser -- e2e/business-records.spec.ts`,
then the repo preflight before the one push (lane DB on port 5435 for manual runs).

**Gates:** acceptance checked item by item with test/CI evidence; OWNER-GUIDE
and DATABASE updated; STATUS top entry at the end.


**Built 2026-10-26 (Vivienne, Lane 6).** Migration `20261103000000_business_records`
(additive; `scripts/check-migrations.mjs` clean). Domain: `src/domains/paperwork`
extended (`records.ts` — DTO boundary, files, renew, export, admin-kinds setting;
`rules.ts` — kinds, admin gate, magic-byte sniffing, effective date; `templates.ts` —
13 existing starters kinded + 19 new, 32 total; `src/lib/zip.ts` — the in-repo ZIP
writer). Screens: `/desk/paperwork` renamed Business records (URL kept) with
Needs you / All / Coming up / Files tabs + search, the record page (facts, masked
number, files with preview, Renewed…, history, archive), the export picker, and
the owner setting for admin-visible kinds. File reads: `/api/records/files/[id]`
(role-gated, audited for the owner); exports: `/api/records/export` (owner only,
audited). Backup manifest gained `BusinessRecordFile`. Docs: DATABASE.md,
OWNER-GUIDE.md, DQ-VAULT-ADMIN-KINDS in OWNER-INPUTS.md.

Evidence (local, lane DB on port 5435): `tests/business-records.test.ts` 10/10
(zip round-trip + CRC vector, sniffing incl. a renamed executable, the admin
gate, the effective date, starter consistency against the real compliance
registry); `tests/business-records-integration.test.ts` 11/11 (starter
idempotency, encryption round trip + masking + the OWNER/ADMIN/STAFF boundary,
missing-key refusal, magic-byte refusal + soft-delete history + the
delete-with-files guard, the verified large-PDF register path, renewal by date
and by repeat with files kept, To do surfacing from `expiresOn` + archive
silence, the masked export pack + its audit row, the upload gate, the
admin-kinds setting); existing paperwork suites 14/14 unchanged. Money and
plain-words checks pass. Browser: `e2e/business-records.spec.ts` (new,
browser-c) and the updated `e2e/business-paperwork.spec.ts` through the repo
launcher — results recorded in the PR. Remaining acceptance line (ci green at
the exact head; every review comment read) completes in the PR itself.

**Merged 2026-10-27** — PR #659 (successor to #657/#658, same final tree;
their branch histories showed phantom conflicts after main moved), squash
commit `9f7671dd` on main at head `562beffb`. CI fully green at the exact head
on both runs; Codex raised 7 findings across the three PRs (export pack
leaving record files out of the nightly copy, export quietly omitting
unreadable files, renew leaving a stale action date, export work inside one
database transaction, non-Latin-1 download file names, mark-done ignoring
expiry dates, and a P1: file removal not locking its row) — all fixed with
regression tests, every thread answered and resolved. Main's post-merge
secret scan passed. This close-out rides the SETUP-1 branch per the lane's
established pattern.
