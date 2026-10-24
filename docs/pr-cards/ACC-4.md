# ACC-4 — Account recovery and security notices

Design: `docs/designs/ACCOUNTS-AND-SIGN-IN.md` section 7. Base: ACC-3 (stacked). Batch ACC, fourth of five.
Risk: **auth** (read `docs/AI-PR-READ-FIRST.md`: unknown or missing role data still denies; email results are checked, never assumed).

## Why
A staff member who loses their phone has no way back in except the owner running a developer script, wrong-password guessing is only limited per address,
and several account changes (a forgotten-password reset, a new device) are not announced to the person.

## Acceptance
- **Reset sign-in** (Settings → Team, owner only; staff and admins only, never yourself, never an owner, not someone removed): turns off their second step (and clears their chosen method), signs them out everywhere, cancels any earlier open reset link, and emails them a fresh single-use link (the invitation-link days setting) to choose a new password; they set up the second step again at next sign-in. Recorded (`team.reset_sign_in`, `team.reset_sign_in.complete`); the person also gets a short notice without a link. A not-sent link is shown as a warning, never as success.
- **Wrong-password pause**: after the owner's number of wrong passwords on one account within the window (starting value 10 within 15 minutes; both owner settings, 3-50 and 1-240) the account waits that long, the person gets one email, and it is recorded. A correct password, a finished wait or a reset clears it. Tries during the wait do not extend it or send more email. The per-address rate limit stays. Unknown addresses are ignored.
- **Notices** (no sign-in links): after a forgot-password reset; on a pause; when a team member signs in from a device (kind of device and browser) not seen before (the first-ever sign-in only records the device); when the owner resets a sign-in; when the second-step method is switched.
- Login code screen gets "I can't get into my account" help text.
- Runbooks updated: `docs/runbooks/ACCOUNT-RECOVERY.md`, `docs/runbooks/two-factor-recovery.md` (the developer script is now owner-only last resort and also clears the chosen method).
- Additive migration `20261024070000_sign_in_recovery` (`User.failedSignInCount/failedSignInWindowStartedAt/signInPausedUntil`, `TeamInvitation.purpose/targetUserId`, `BusinessSettings.signInPauseAttempts/signInPauseMinutes`).

## Build contract
- `src/domains/security/sign-in-guard-rules.ts` (pure), `sign-in-guard.ts` (database), hooks `before`/`after` in `src/lib/auth.ts` (every failure in the follow-up is swallowed: it can never block a correct sign-in), `resetTeamSignIn` in `src/domains/team`.
- Reset reuses the invitation machinery (`TeamInvitation.purpose = RESET`, `/join/<code>`), so it is single-use, hashed, expiring, and restricted to the owner.

## Tests
- `tests/acc4-sign-in-guard-rules.test.ts` (no database): counting, window, pause, range.
- `tests/acc4-recovery-integration.test.ts` (throwaway Postgres, email mocked): owner-only settings, pause triggers/notice once/clears, the real sign-in call counts wrong passwords and refuses a paused account even with the right password, new-device notice rules, reset turns off two-step and sessions and works once, a second reset replaces the first, owner/removed targets refused, no notice contains a link.

## Not in this card
- A Today reminder for the owner to keep a second method and unused backup codes: the system keeps one chosen method per person, and counting unused backup codes means reading the encrypted list, so it is left for a later card (the runbook and owner guide say to keep backup codes).
- Notices for sign-ins by customers (team only for now).
- Job roles (ACC-5).
