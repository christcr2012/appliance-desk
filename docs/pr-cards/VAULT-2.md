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

## Progress
Not started.
