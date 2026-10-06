# Account recovery runbook

Use this for a forgotten password, suspected stolen session, staff access removal, or owner lockout. There is no support backdoor and no public sign-up path.

## Password reset

1. Go to **Forgot password** (`/forgot-password`) and enter the account email. Provisioned customer/staff activation uses the same Better Auth reset flow.
2. Open the one-time reset link from the account mailbox and set a new password. The link expires and is single-use.
3. A successful reset revokes existing sessions because `revokeSessionsOnPasswordReset: true` is set in `src/lib/auth.ts`. Sign in again on trusted devices; do not reuse an old session as evidence the reset failed.
4. If the email outcome is uncertain, check message/provider evidence before requesting repeated mail. Do not expose or set a password for another user.

## Staff access removal

1. OWNER removes a STAFF login from **Desk → Settings**. `deactivateStaffAccount` archives that user, deletes all live sessions and writes the audit entry in one transaction.
2. Confirm the staff account is shown inactive and a prior session can no longer reach protected pages.
3. Reactivation is a separate owner action. It does not silently create a new account or erase the access history.

## Owner lockout

1. Use the same `/forgot-password` flow for the owner mailbox.
2. If password email is unavailable, restore the email/provider configuration first; do not create a second OWNER, disable server authorization, or edit credential/session rows by hand.
3. If the owner mailbox itself is inaccessible, recover that mailbox through its provider's identity-recovery process first. Appliance Desk intentionally has no weaker bypass.
4. After access returns, reset the password, verify old sessions are revoked, and review recent audit/provider activity if compromise was suspected.

## Drill

Automated evidence: `tests/password-email-integration.test.ts` covers password mail/reset plumbing and `tests/staff-accounts.test.ts` proves staff deactivation removes live sessions atomically.

Last drilled: **2026-10-06 (automated CI coverage); manual owner-lockout mailbox drill not separately recorded.**
