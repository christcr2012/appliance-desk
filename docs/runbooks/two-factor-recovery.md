# Two-factor recovery runbook

Use this only when the **OWNER** has lost access to every second-step method (authenticator app, text/email codes) and every unused backup code. For a staff member or admin, the owner uses **Desk → Settings → Team → Reset sign-in** instead (see [ACCOUNT-RECOVERY.md](ACCOUNT-RECOVERY.md)); no script is needed.

1. First try an unused backup code on the normal **Two-step login** screen (the **Backup code** tab). Each code is single-use. If you chose text or email codes, also try **Text or email code → Send me a code**.
2. If no backup code remains, use a trusted machine with the Appliance Desk repository and the correct database environment.
3. Run the recovery command with the exact account email:
   ```bash
   npx tsx scripts/reset-two-factor.ts --email person@example.com --confirm
   ```
   The script refuses to run without `--confirm`, deletes only that user's two-factor record, sets `twoFactorEnabled=false` (and clears the chosen second-step method), and writes `security.two_factor.recovery_reset` audit evidence.
4. Have the user sign in with their normal password. If their role is required by Settings → Security, Appliance Desk sends them directly to `/desk/security/setup`.
5. Enroll a new authenticator, verify a new 6-digit code, and save the new set of ten backup codes somewhere separate from the phone.
6. Review Desk → Activity for the reset evidence and investigate if the loss may have involved account compromise.

Never disable the required-role policy just to bypass a lost authenticator. Never copy an old encrypted TOTP secret or backup-code record from a recovery database.

## Drill

Automated G-2 tests cover required-role enforcement, setup exemptions, encrypted Better Auth TOTP/backup-code behavior, and one-time backup-code login.

Last drilled: pending G-2 exact-head CI/browser run.
