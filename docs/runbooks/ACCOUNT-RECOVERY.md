# Account recovery runbook

Use this for a forgotten password, suspected stolen session, staff access removal, or owner lockout. There is no support backdoor and no public sign-up path.

## Password reset

1. Go to **Forgot password** (`/forgot-password`) and enter the account email. Provisioned customer/staff activation uses the same Better Auth reset flow.
2. Open the one-time reset link from the account mailbox and set a new password. The link expires and is single-use.
3. A successful reset revokes existing sessions because `revokeSessionsOnPasswordReset: true` is set in `src/lib/auth.ts`. Sign in again on trusted devices; do not reuse an old session as evidence the reset failed.
4. If the email outcome is uncertain, check message/provider evidence before requesting repeated mail. Do not expose or set a password for another user.

## A staff member or admin cannot get in (lost phone, no codes, forgot everything)

1. The OWNER opens **Desk → Settings → Team**, finds the person and chooses **Reset sign-in** (owner only; never available for your own account or another owner).
2. This turns off their second step, signs them out everywhere, cancels any earlier reset link and emails them a fresh link (works once, for the invitation-link days setting, 7 to start) to choose a new password. They also get a short notice email without a link (`team.reset_sign_in` is recorded in Activity).
3. They open the link, choose a new password, sign in, and set up the second step again (**Desk → Settings → Security → Set up**).
4. If the "link not sent" warning appears, choose **Reset sign-in** again; it sends a fresh link and stops the old one.

## Wrong passwords (sign-in paused)

After the owner's number of wrong passwords on one account (starting value 10 within 15 minutes, **Settings → Security → Wrong passwords**), that account waits and the person gets an email. It clears when the wait ends, after a correct password, or after a reset. **Forgot password** still works during the wait.

## Staff and admin access removal

1. OWNER (or an admin, for staff only) removes access from **Desk → Settings → Team** (**Remove access**). The account is archived, every live session is deleted and the audit entry is written in one transaction; the person gets an email notice.
2. Confirm the account is shown **Removed** and a prior session can no longer reach protected pages.
3. **Restore access** is a separate action (owners restore admins). It does not create a new account or erase the access history.

## Owner lockout

0. The owner has no "reset" button (that is deliberate: a stolen owner session must not be able to remove the owner's second step). Use a **backup code** at the sign-in screen first. Keep your backup codes somewhere separate from your phone.
1. Use the same `/forgot-password` flow for the owner mailbox.
2. If password email is unavailable, restore the email/provider configuration first; do not create a second OWNER, disable server authorization, or edit credential/session rows by hand.
3. If the owner mailbox itself is inaccessible, recover that mailbox through its provider's identity-recovery process first. Appliance Desk intentionally has no weaker bypass.
4. After access returns, reset the password, verify old sessions are revoked, and review recent audit/provider activity if compromise was suspected.

## Drill

Automated evidence: `tests/password-email-integration.test.ts` covers password mail/reset plumbing, `tests/staff-accounts.test.ts` proves staff deactivation removes live sessions atomically, and `tests/acc4-recovery-integration.test.ts` covers the owner's reset of a sign-in, the wrong-password pause and new-device notices.

Last drilled: **2026-10-06 (automated CI coverage); manual owner-lockout mailbox drill not separately recorded.**
