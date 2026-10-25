# Build spec — Remember this device, and better new-device notices (ACC-6)

Card: `docs/pr-cards/ACC-6.md`. Design: `docs/designs/ACCOUNTS-AND-SIGN-IN.md` sections 6–7 and 9 (it lists
`BusinessSettings.trustedDeviceDays (30)`, never built) and ACC-3's card ("Trusted device for 30 days … left for a
later card"). Part of the approved ACC batch. Risk: **sign-in / second step** — read `docs/AI-PR-READ-FIRST.md` and say
in the PR how each auth item is honored.

## 1. What ACC-1…ACC-5 already built (checked 2026-10-25) and what is missing
Built: password/email/backup-code/two-step changes with notices (ACC-1, `src/domains/account/index.ts`); invitations,
roles, remove/restore (ACC-2, `src/domains/team/index.ts`); email/text codes (ACC-3, `src/domains/security/second-step.ts`);
wrong-password pause and notices including "sign-in from a new device" for **team members** (ACC-4,
`src/domains/security/sign-in-guard.ts` `noteCompletedSignIn`, called from the `after` hook in `src/lib/auth.ts`); job
roles (ACC-5).
Missing / wrong (fixes found while specifying):
1. **No "remember this device".** The setting `trustedDeviceDays` from the design does not exist; every login form
   sends `trustDevice: false` (`src/app/login/two-factor/two-factor-login-form.tsx` ~lines 36–46).
2. **The server still accepts `trustDevice: true`.** Better Auth 1.7.12's two-factor verify endpoints honor a
   client-sent `trustDevice` (`node_modules/better-auth/dist/plugins/two-factor/verify-two-factor.mjs` ~line 41) and
   then skip the second step for 30 days (its default `trustDeviceMaxAge`). A person who already passed both steps
   can turn this on with a hand-made request. It is not a way in for someone else (they need the password and the
   code first), but it bypasses the owner's policy. Low severity; fixed in this unit (section 3).
3. **"New device" means "new browser type".** `noteCompletedSignIn` compares `sessionDeviceLabel(userAgent)`
   ("Safari on iPhone") with the person's earlier labels, reading up to 200 audit rows with no `orderBy`. A second
   iPhone is never "new"; a person with more than 200 rows can get a false notice. Replace with a device cookie
   (section 2).
4. **Customers get no new-device notice** (`noteCompletedSignIn` returns `"skipped"` for CUSTOMER). The design's
   notice list is "to the affected person". Customers get it too, sent only through `sendCustomerEmail`
   (`src/lib/customer-email.ts`) so it stays off while customer email is off (AGENTS section 1) and is recorded as
   not sent.

## 2. Device identity (additive migration `20261030000000_known_devices`)
```prisma
model KnownDevice {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation("KnownDevices", fields: [userId], references: [id], onDelete: Cascade)
  deviceHash  String   @db.Char(64)        // sha256 of the device cookie value; the value itself is never stored
  label       String   @db.VarChar(80)     // sessionDeviceLabel(userAgent), for the list only
  firstSeenAt DateTime @default(now())
  lastSeenAt  DateTime @default(now())
  trustedUntil DateTime?                    // set when the person ticked "Remember this device"
  forgottenAt DateTime?
  @@unique([userId, deviceHash])
  @@index([userId, lastSeenAt])
}
```
- Cookie `ad_device` (httpOnly, Secure, SameSite=Lax, path `/`, 400 days): 32 random bytes base64url, set by the
  sign-in follow-up when missing. It is an identifier, not a credential: it never signs anyone in.
- Backup: `KnownDevice: null` in `BACKUP_MODEL_POLICY` (device data is not business data and restoring it could
  re-trust devices). Privacy deletion deletes the person's rows.
- `noteCompletedSignIn(userId, userAgent, deviceCookie)` (replaces the current body): upsert by `(userId,
  sha256(cookie))`, update `lastSeenAt`/`label`; outcome `first` (the person has no rows at all — record only),
  `known`, or `new` → notice `new_device` with the label. Team → `sendAccountNotice` (as today); CUSTOMER → a new
  `sendCustomerAccountNotice` that uses `sendCustomerEmail` and records `account.notice_not_sent` when not sent.
  Keep writing the `account.sign_in_device` audit row for history.
- `src/lib/auth.ts` `after` hook: read/set the cookie via `ctx.getCookie` / `ctx.setCookie` (Better Auth middleware
  helpers), pass it in. The hook still swallows every error (a sign-in must never fail because of this).

## 3. Remember this device (team members; customers have no second step)
- Setting `BusinessSettings.trustedDeviceDays Int @default(30)` (0–90; 0 = off). Settings › Security next to the
  wrong-password pause (`src/app/desk/settings/page.tsx` ~line 263 section, `updatePauseSettings` pattern: OWNER only,
  `assertActiveTeamActor`, audit, "Restore recommended"). Explanation: "On a phone or computer someone ticks 'Remember
  this device', the app skips the code there for this many days. Starting value 30 days, a common choice for small
  business apps. Set 0 to always ask." It is also a Decisions & reviews subject (DEC-1 registry, audience OWNER,
  `recommended: 30`, why: "Most banking and business apps remember a device for about 30 days; shorter is safer,
  longer is more convenient.", no legal source — say so).
- Better Auth config: `twoFactor({ …, trustDeviceMaxAge: 90 * 86400 })` (the hard ceiling); the owner's shorter
  setting is enforced by the app (below), because the library value is fixed at start-up.
- Login form: checkbox "Remember this device for {n} days" (unchecked by default; hidden when `trustedDeviceDays =
  0`), sends `trustDevice: checked`. Not shown on the two-step **setup** form (`two-factor-setup-form.tsx` keeps
  `false`).
- `before` hook in `src/lib/auth.ts`, paths starting with `/two-factor/verify`: if the body has `trustDevice: true`
  and (`trustedDeviceDays = 0` or the user's role is not OWNER/ADMIN/STAFF) → remove it from the body before the
  library runs: return `{ context: { body: { ...ctx.body, trustDevice: false } } }` from the hook (Better Auth merges a before-hook's returned `context`; see `runBeforeHooks` in `node_modules/better-auth/dist/api/dispatch.mjs`). Test that a hand-made request cannot trust a device when off.
- `after` hook on `/two-factor/verify*` with a successful session and `trustDevice` true: set the device's
  `trustedUntil = now + trustedDeviceDays`, and clamp the library's new `Verification` row (identifier prefix
  `trust-device-`, value = user id, newest) to the same `expiresAt`. On each later trusted sign-in (the library rotates
  the row in its own `/sign-in/email` after-hook) our `after` hook clamps the new row to `trustedUntil` of that device
  (never extends it): trust lasts `trustedDeviceDays` from when it was ticked, not "30 days since last use".
- **Forget trust** — `forgetTrustedDevices(userId, { deviceId? })`: delete `Verification` rows with identifier
  `trust-device-%` and value = userId (all, since the library's rows cannot be tied to one device; when `deviceId` is
  given also clear that device's `trustedUntil`, otherwise all), set `forgottenAt` for the device(s), audit
  `security.trusted_devices_forgotten`. Called by: password change (`finishPasswordChange`), forgot-password reset
  (the ACC-4 reset path), email change, two-step turned off or method switched (`confirmMethodSwitch`), owner's "reset
  sign-in" (`resetTeamSignIn`), remove member (`removeTeamMember`), access level change (`changeAccessLevel`), "sign
  out everywhere" (`revokeStaffSessionsByOwner`, `revokeOtherSessions`), and the setting being lowered (clamp every
  `trustedUntil` and row to the new value; 0 → forget all). Each call happens inside the same transaction as the
  change where one exists (Verification rows are ordinary Prisma rows).
- My account › Devices (`DevicesCard` in `src/app/desk/account/account-forms.tsx`): list `KnownDevice` rows (label,
  last used `relativeTime`, "Remembered until {formatShortDate}" when trusted) and **Forget remembered devices**
  (ConfirmDialog "You'll be asked for a code next time on every device."). The existing session list stays.

## 4. Tests
- `tests/trusted-devices-integration.test.ts` (throwaway Postgres, Better Auth test instance as in
  `tests/acc4-recovery-integration.test.ts`): tick → next sign-in skips the code; after `trustedDeviceDays` it asks
  again; setting 0 → a hand-made `trustDevice: true` is ignored; customer cannot trust; password change, method
  switch, reset, remove, role change and sign-out-everywhere each make the next sign-in ask for a code; lowering the
  setting clamps; rotation never extends past `trustedUntil`.
- `tests/known-devices.test.ts`: first sign-in records only; same cookie → known; new cookie → notice once; customer
  notice goes through `sendCustomerEmail` and is recorded not sent while customer email is off; hook errors never
  fail sign-in; backup policy excludes the table (manifest test).
- `e2e/my-account.spec.ts` (extend): remembered device shown and forgotten; login form checkbox hidden when 0.
