# Database restore runbook

Use this only for an isolated recovery drill or a real recovery after the owner has decided recovery is needed. It does **not** authorize launch, production deletion, or provider changes.

## Restore the database

1. **Pick the backup and its code version.** Read `formatVersion`, `exportedAt`, `migrationId`, and `appVersion` from the JSON. Use the repository commit named by `appVersion` when possible. Format 2 includes provider/idempotency evidence but intentionally excludes `Account`, `Session`, and `Verification`.
2. **Create an empty isolated target database.** Local drills use localhost/127.0.0.1. For Neon, create or choose a branch whose name starts with `restore-`, then create an empty database inside it. Never point this command at production.
3. **For a Neon target, enable branch verification.** Set `NEON_API_KEY` and `NEON_PROJECT_ID` in the shell. The script maps the connection endpoint to its Neon branch and refuses it unless the actual branch name starts with `restore-`. The key is never printed or stored.
4. **Run the restore.**
   ```bash
   npx tsx scripts/restore-backup.ts /path/to/backup.json --into 'postgresql://...'
   ```
   The target must have no public tables. The script applies repository migrations only through the backup's `migrationId`, restores rows in foreign-key dependency order, resets recovered number sequences, and runs schema health.
5. **Confirm the result.** The command must end with `Schema health check passed.` Compare table counts with the backup. Confirm provider-state rows such as `WebhookEvent`, `ProviderOperation`, `MessageDelivery`, `ProviderEvent`, `CustomerNotice`, and `SubscriptionEndIntent` are present.
6. **Reset credentials before anyone signs in.** Authentication credentials are deliberately not copied. Every user must go through account/password recovery; do not copy old `Account`, `Session`, or `Verification` rows.
7. **Do not call recovery complete until media is checked.** F1-b adds the private-photo inventory/recovery-copy procedure. Database restore alone does not recover private photo bytes.

## Safety checks

- Non-local, non-Neon hosts are refused.
- A Neon endpoint whose branch cannot be verified, or whose branch is not named `restore-*`, is refused.
- A target with existing public tables is refused rather than overwritten.
- A backup whose table manifest differs from the checked-out code is refused; use its recorded `appVersion`.
- A migration named by the backup but absent from the checkout is refused.

Neon's endpoint API exposes the endpoint's branch ID and the branch API exposes its name, so the script verifies the real branch instead of trusting a typed label or guessing from a hostname.

## Drill

`tests/backup-restore-integration.test.ts` exports the seeded CI database, restores it into `appliance_desk_restore`, compares every backed-up table count, proves credential tables are empty, checks restored number sequences, and runs schema health.

Last drilled: 2026-10-06 — PR #268 exact-head CI run 37545036997 (real PostgreSQL restore drill passed).
