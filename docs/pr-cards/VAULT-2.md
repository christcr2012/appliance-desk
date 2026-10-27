# VAULT-2 — Logins vault and emergency access

Build spec: `docs/build-specs/engines/RECORDS-VAULT.md` sections 4–7. Requested by Chris 2026-10-25. Depends on VAULT-1,
ACC-6. Risk: **passwords** — separate encryption key, owner only, fresh sign-in code to reveal.

## Acceptance
- [ ] Owner only; everyone else and every AI/ops/export path refused (tests incl. the grep test for secret fields).
- [ ] Reveal, copy and save need a fresh second-step code; 5-minute unlock; every reveal audited without the value.
- [ ] Failed codes lock the vault; signing out everywhere clears unlocks; backups keep values encrypted.
- [ ] Emergency access ships **off**; when turned on in a test, the wait, deny and one-time read-only export work.
- [ ] `ci` green; every review comment read.

## Owner checklist
"Vault encryption key" row (spec section 4). Never blocks merging.

## Execution packet (2026-10-27, base `39d4bf8e` — SETUP-1 merged)

Registered as `docs/pr-cards/execution/VAULT-2.json`. Branch `ai/vivienne/vault-2`.
Scope: migration `20261112000000_vault` (VaultCredential, VaultUnlock, EmergencyAccessRequest, BusinessSettings
emergency fields), `src/lib/field-crypto.ts` gains a vault key trio, new domain `src/domains/vault/`
(rules, index, unlock, emergency, attention), screens at `/desk/vault` and `/desk/vault/[id]` (OWNER),
the public `/emergency/[token]` pages (ships off), a daily cron sweep for the reminders, and the
record page's Login card via VAULT-1's `BusinessPaperwork.credentialId`.

### Drift check (spec vs the repo as it stands at `39d4bf8e`)

| # | Spec says | Repo reality | Resolution in this build |
|---|---|---|---|
| 1 | Reveal codes are "verified through the existing Better Auth two-factor server functions — no new code system" | The login flow verifies through the client during a sign-in challenge | Verified in the installed better-auth source: `verifyTOTP`, `verifyTwoFactorOTP` and `verifyBackupCode` all accept a live session (`isSignIn = !session.session`), so the vault's server actions call `auth.api` with the request headers and the owner's own method (authenticator, email or text code, backup code). Better Auth checks the code; the vault domain keeps the unlock/lockout bookkeeping |
| 2 | `field-crypto.ts` with a separate key `VAULT_ENCRYPTION_KEY` | field-crypto is hardcoded to `COMPLIANCE_ENCRYPTION_KEY` (CMP-1) | The core is parameterised by env name; the compliance exports keep their exact behaviour and error text, and `encryptVaultField` / `decryptVaultField` / `hasVaultCryptoKey` are added for the vault key |
| 3 | Backup policy: VaultCredential backed up still encrypted; VaultUnlock → null | The manifest also needs a decision for the new EmergencyAccessRequest model | VaultCredential → backed up (values stay encrypted; restoring without the vault key leaves them unreadable, and the restore guide will say so). VaultUnlock → null, and EmergencyAccessRequest → null: a token hash and one-time state must not survive a restore — the owner re-issues a link |
| 4 | §5's grep test: the four secret field names appear only in `src/domains/vault/`, `src/domains/paperwork/` and their tests | SETUP-1's `src/domains/setup/guide.ts` selects `numberEncrypted` to compute a presence flag | The guide now asks the paperwork domain for record facts (id, has-number, file count, marked-done) through a helper, so the identifier lives only inside the paperwork domain and the grep rule holds exactly as spec'd |
| 5 | Emergency settings: `emergencyContact` + `emergencyWaitDays` (default 7, 1–30) | Owner settings live on the BusinessSettings singleton (ACC-6's trustedDeviceDays pattern, with a CHECK) | `emergencyAccessEnabled` (default false — ships off), `emergencyContactName/Email/Phone`, `emergencyWaitDays` with a 1–30 CHECK. The link token is stored only as a SHA-256 hash on EmergencyAccessRequest; one non-terminal request at a time |
| 6 | Reminders "on two channels (email and text) at the start, halfway and one day before" | The app notifies via `sendEmail` / `sendSms` helpers and runs periodic work as `/api/cron/*` routes registered in vercel.json + the automation health registry | Start reminders send synchronously when the contact requests access; halfway and day-before reminders run in a daily `/api/cron/emergency-access` sweep (same registry pattern), each stamped on the request row so it sends once. Email goes to the owner's account address; text goes to the owner's saved phone when texting is ready |
| 7 | "Failed codes lock the vault" + owner email "(existing switch)" | Account security mail already flows through `sendAccountNotice` kinds (ACC-3/ACC-6) | A `vault_locked` notice kind is added to the account domain. The lock itself is derived from `vault.unlock_failed` audit rows (5 within 15 minutes → locked until 30 minutes after the latest failure) — never a stored flag |
| 8 | "Signing out everywhere / password change deletes all VaultUnlock rows" | ACC-6 clears remembered devices in-tx at sign-out-everywhere (`sessions.ts`), password/email change (`account/index.ts`) and second-step change (`second-step.ts`) | `clearVaultUnlocksInTx` runs at the same points, in the same transactions |
| 9 | Rotation reminders on To do "only when rotateEveryMonths set" | To do sources are owner-gated attention modules (SETUP-1's pattern) | `src/domains/vault/attention.ts` + a `VAULT` category (label "Update login", group "system"), wired owner-only in the exceptions index |
| 10 | Decisions questions VAULT-BANK and CONT-SUCCESSOR | Neither is in `docs/OWNER-INPUTS.md` yet | Both filed as DQ entries in this PR. VAULT-BANK's starting value (allowed, with the honest on-screen note from spec §5) is what the screen shows; the note ships regardless of the answer |
| 11 | §7: the emergency export is the records pack + "the vault decrypted into a PDF" | The PDF library's standard fonts print only the WinAnsi character set and throw on anything outside it, so one login with an emoji or non-Latin character in a saved value would sink the whole export; a password can also carry repeated or leading/trailing spaces, which a word-splitting wrapper silently collapses (both found in Codex review) | The ZIP keeps the PDF — its text wrap is now character-exact, whitespace included, and characters the fonts cannot print show as "?" with a note on the PDF saying so — and always adds `logins.txt` (UTF-8) carrying every login exactly as saved. Everything the PDF can print is unchanged; the exact copy rides alongside it |

### Named regression cases
- Unit: username masking; rotation due dates from lastRotatedOn/createdAt; the grep test over `src/` for the four secret field names; field-crypto vault trio round-trips and refuses a missing/wrong-format key while the compliance trio is unchanged.
- Integration (throwaway Postgres): non-owner reads/writes are not-found; list/detail DTOs contain no encrypted field and a masked username; saving a secret without an unlock is refused; grant → reveal returns the value and writes `vault.reveal` with no value in the row; unlock expiry (5 minutes) and session binding are enforced; 5 failed codes lock for 30 minutes and send the notice; sign-out-everywhere clears unlocks; emergency: off → the public page is inert; on → link, request, reminders stamped once, deny ends it; a second run: wait elapses, code goes to the saved contact only, wrong codes are counted, the right code yields a one-time ZIP download (records + vault PDF) and a second download is refused.

## Progress
Packet and drift check written 2026-10-27 (this commit also lands the SETUP-1 merged close-out: SETUP-1 card acceptance + work-index). Build follows.

Build completed 2026-10-27 on `ai/vivienne/vault-2`: migration `20261112000000_vault`; field-crypto vault trio; `src/domains/vault/` (rules, schema, unlock, index, emergency, attention); screens `/desk/vault` + `/desk/vault/[id]` with the Better Auth unlock flow and 30-second reveal/copy; the record page's Login card; the public `/emergency/[token]` flow + one-time download route; the daily `/api/cron/emergency-access` reminder sweep; unlock clearing at the ACC-6 forget points; backup decisions (credentials backed up encrypted, unlocks and emergency requests never); DQ-VAULT-BANK and DQ-CONT-SUCCESSOR filed. One build fix beyond the packet: the emergency export tolerates a business with zero records (the VAULT-1 pack refuses an empty pick) by omitting the records file and saying so in the READ-ME. Proof: `tests/vault.test.ts`, `tests/vault-secret-fields-grep.test.ts`, `tests/vault-integration.test.ts` (14 cases, real Postgres), `e2e/vault.spec.ts` (browser-e).

Review round on PR #664 (2026-10-27): the first CI run failed the repo checks — the execution packet named a `node_modules` path as a reference (the packet validator refuses protected paths) and two anchors were descriptive rather than verbatim; fixed and reproduced locally (`work-session` tests green). Codex found three real bugs, all fixed with regression tests in the same round: (P2) the derived lockout evaporated once failures aged out of the 15-minute counting window — the lock is now derived from failure clusters over a window-plus-lock lookback (`vaultLockFromFailures`, unit + backdated-rows integration tests); (P1) a totally failed start warning was treated as success — `requestEmergencyAccess` now checks the delivery result, stamps `startNoticeFailedAt` (migration `20261112010000_vault_start_notice`), shows it on the owner's vault page and the public waiting page, and the daily sweep retries it; (P2) the export PDF truncated words past 110 characters — wrapping is now lossless (`wrapPdfText`) and the export test reconstructs a 300-character password in full. PR #664 itself went phantom-dirty when AR-11 (#662) merged, so the finished tree moved to a successor PR built from the new main (same pattern as VAULT-1).
