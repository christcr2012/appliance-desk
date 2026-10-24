# ACC-1 — My account for everyone on the desk

Design: `docs/designs/ACCOUNTS-AND-SIGN-IN.md` section 4. Base: `main` at `a37b985`. Batch ACC, first of five (ACC-2…ACC-5 follow).
Risk: **auth** (read `docs/AI-PR-READ-FIRST.md`: unknown or missing role data still denies; email results are checked, never assumed).

## Why
The owner has no way to change his own password, name or email, see his signed-in devices in one place, or make new backup
codes. Staff and admins have none of it either. Today only "forgot password" works.

## Acceptance
- New page **Desk → My account** (More → My account; every role on the desk). It shows only the signed-in person's own account;
  no person id is ever read from the address or a form.
- **Name and phone** save to the person's own row (row locked, active-actor re-check, audit `account.profile_update` with only the
  last four phone digits, notice email). A new phone number is saved as "not confirmed yet" (the code check arrives with ACC-3).
- **Password**: current + new (10–128 characters), "sign me out on my other devices" ticked by default, audit + notice.
- **Sign-in email**: needs the current password; the link goes to the NEW address; nothing changes until it is used; the OLD
  address gets a notice at request time and again when it completes. The answer is the same whether or not the address is free.
- **Devices**: list, sign out other devices (existing domain function), sign out this device.
- **Two-step**: new backup codes (password required, shown once, old ones stop), turn off only when the role does not require it
  (turning it off ends every session and emails a notice).
- Team members can no longer call change-password, change-email, turn-off-two-step or new-backup-codes straight from the browser
  (they would skip the audit row and the notice); customers can never change a sign-in email. Our own server code is not affected.
- Additive migration `20261024040000_user_phone` (`User.phone`, `User.phoneConfirmedAt`).

## Build contract
- `src/domains/account/rules.ts` (pure rules), `policy.ts` (which library calls are guarded), `index.ts` (database work, audit, notices).
- `src/app/desk/account/` page, forms, server actions. Library calls use `auth.api.*` with the request headers.
- `src/lib/auth.ts`: `user.changeEmail.enabled`, a `before` guard using `decideAccountAuthPath`, `afterEmailVerification` records a finished change.
- The library's own "sign out everywhere" option is NOT used (it would sign this browser out too); `revokeOtherSessions` from
  `src/domains/security/sessions.ts` is used instead.

## Tests
- `tests/acc1-account-rules.test.ts` (no database): phone and name rules, the guard decisions for every role and path.
- `tests/acc1-my-account-integration.test.ts` (throwaway Postgres): own row only, confirmation reset, audit contents, no-op saves,
  removed account refused, two saves at once, finishing an email change is recorded once.
- `e2e/my-account.spec.ts` (browser shard b): More → My account, save details, wrong current password refused, direct
  change-password call refused. `/desk/account` is in the accessibility route list.

## Not in this card
Text/email sign-in codes and phone confirmation (ACC-3), invitations and roles (ACC-2), reset-their-sign-in, failed-attempt pause and
sign-in-from-new-device notices (ACC-4), job roles (ACC-5). Replacing the authenticator app (the existing setup page still does the
first set-up). Real-inbox acceptance of the three emails is an owner-checklist-free observation: the emails send in production only.
