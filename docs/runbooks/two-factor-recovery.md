# Two-factor recovery runbook

Use this only when an Owner/Admin/required Staff user has lost access to both the authenticator and every unused backup code.

1. First try an unused backup code on the normal **Two-step login** screen. Each code is single-use.
2. If no backup code remains, use a trusted machine with the Appliance Desk repository and the correct database environment.
3. Run the recovery command with the exact account email:
   ```bash
   npx tsx scripts/reset-two-factor.ts --email person@example.com --confirm
   ```
   The script refuses to run without `--confirm`, deletes only that user's two-factor record, sets `twoFactorEnabled=false`, and writes `security.two_factor.recovery_reset` audit evidence.
4. Have the user sign in with their normal password. If their role is required by Settings → Security, Appliance Desk sends them directly to `/desk/security/setup`.
5. Enroll a new authenticator, verify a new 6-digit code, and save the new set of ten backup codes somewhere separate from the phone.
6. Review Desk → Activity for the reset evidence and investigate if the loss may have involved account compromise.

Never disable the required-role policy just to bypass a lost authenticator. Never copy an old encrypted TOTP secret or backup-code record from a recovery database.

## Drill

Automated G-2 tests cover required-role enforcement, setup exemptions, encrypted Better Auth TOTP/backup-code behavior, and one-time backup-code login.

Last drilled: pending G-2 exact-head CI/browser run.
