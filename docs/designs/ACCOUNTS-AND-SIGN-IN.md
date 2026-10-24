# Accounts and sign-in — team invitations, roles, self-service and recovery (Batch ACC)

Status: **design approved for building, 2026-10-23 (Chris asked for it).** Build cards are JIT (`docs/pr-cards/ACC-*.md`,
listed in `work-index.json`). Nothing here is built yet. Turning on text-message codes is a live-SMS switch and stays
Chris's decision (AGENTS section 1); everything else is ordinary source work.

## 1. What Chris asked for (2026-10-23, his words, condensed)

1. Account creation: **Chris sets up the employee's info, assigns their role and permissions, and the app emails them a
   link**; the employee clicks it and sets up their own login.
2. A real process for **password reset, account recovery**, and so on.
3. **The owner account has no way to manage itself** (no change password, no account page).
4. Two-step sign-in today needs an **authenticator app**; Chris would rather get a **text or an email code**, and asked
   whether that comes automatically once Twilio is set up.

## 2. What exists today (checked against `main` at `ce95c1a`, 2026-10-23)

| Area | Today | Where |
|---|---|---|
| Roles | OWNER, ADMIN, STAFF, CUSTOMER (`User.role`) | `src/lib/auth.ts`, `prisma/schema.prisma` |
| Add an employee | Owner types name + email; account created as **STAFF only**; activation email sent | `src/domains/staff/index.ts`, `src/app/desk/settings/staff-accounts-section.tsx` |
| Admins | **Cannot be created, promoted, demoted or listed** on the Staff screen; only set up outside the app | — |
| Admin limits | Owner can take any of 7 money/settings permissions from one admin | `src/domains/capabilities`, `/desk/settings/permissions` |
| Staff extra abilities | None; giving staff money/report access is an open owner decision (IN-13, checklist section E) | — |
| Invitation link | It is a **password-reset link**. Better Auth's reset link lasts **1 hour** (library default `resetPasswordTokenExpiresIn = 3600`, not overridden in `auth.ts`) — an employee who opens it the next day gets an expired link | `src/lib/auth.ts`, `src/lib/password-email.ts` |
| Forgot password | Works for everyone from the login page (`/forgot-password` → `/reset-password`); signs out every other device | `src/app/forgot-password`, `src/app/reset-password` |
| Change my password / name / email | **Not built for anyone on the desk** (owner included) | — |
| My devices | Not built (only the owner's "sign everyone out" button) | `src/app/desk/settings/session-controls.tsx` |
| Two-step sign-in | **Authenticator app only** + 10 backup codes; required for OWNER and ADMIN by default (owner setting) | `src/domains/security/two-factor.ts`, `/desk/security/setup`, `/login/two-factor` |
| Manage two-step | Can't regenerate backup codes, switch method or turn it off in the app | — |
| Lost phone | Backup code, otherwise a **developer script** (`scripts/reset-two-factor.ts`) | `docs/runbooks/two-factor-recovery.md` |
| Text messages | Twilio code exists but is **dormant**: sends only in production, with keys set, and with the texting switch on; number not bought, carrier registration not done | `src/lib/sms.ts`, OWNER-CHECKLIST section B |
| Email | Resend; activation/reset emails already send in production | `src/lib/email.ts`, `src/lib/password-email.ts` |

**Answer to Chris's question:** text codes will **not** appear on their own when Twilio is finished. The sign-in
screens need new work (ACC-3 below). Email codes need nothing from Twilio and can ship as soon as ACC-3 is built.
Text codes then wait only for Twilio to be live and for Chris to switch "Send sign-in codes by text" on.

The library already supports this: Better Auth 1.7.6's two-factor plugin has a one-time-code mode
(`otpOptions.sendOTP`, routes `/two-factor/send-otp` and `/two-factor/verify-otp`) next to the authenticator mode, plus
`/two-factor/generate-backup-codes`, `/two-factor/disable`, `/change-password`, `/change-email`, `/list-sessions` and
`/revoke-other-sessions`. No new sign-in provider or paid service is needed.

## 3. Design principles (apply to every ACC card)

- **Public sign-up stays off.** Every account still starts from a trusted server action; the invitation only lets a
  person who controls the invited inbox choose their own password.
- **Nobody can give more than they have.** Only the owner creates or promotes an admin. An admin can never create,
  promote or restore an admin, change the owner, or touch their own role. There is always exactly one active owner.
- **Access changes take effect immediately**: role change, revoke or sign-in reset ends that person's sessions in the
  same transaction (same rule as today's revoke).
- **Every account change is in the audit log** (who, whom, what, before/after) and sends the affected person a short
  "this changed on your account" email, so a takeover is noticed.
- **Never lock the owner out.** Every second-step method has a fallback (another method, backup code, documented
  recovery). A failed text never strands anyone.
- **Plain words on screen**; settings follow the owner-configurable rule (starting value, why, who can change it,
  restore recommended).
- Server-side enforcement at the query/DTO boundary, row locks + `assertActiveTeamActor` on every write (AGENTS section 4).

## 4. ACC-1 — "My account" for everyone on the desk (owner first)

New page **Desk → My account** (link in the top menu and on Settings), for OWNER, ADMIN and STAFF.

- **Name and phone number** — editable. Phone is stored for sign-in codes (ACC-3); saving a new phone requires
  confirming a code sent to it once texting is on, otherwise it is saved as "not confirmed yet".
- **Email address** — change requires the current password; Better Auth `changeEmail` sends a confirmation link to the
  **new** address and a notice to the **old** one. The change only happens after the new link is clicked.
- **Password** — current password + new password (minimum 10, existing rule), with a "sign me out everywhere else" box
  ticked by default (`revokeOtherSessions`). Notice email sent.
- **My devices** — list of signed-in devices (browser, approximate time last used; no IP shown in plain view),
  "sign out this device" and "sign out all other devices".
- **Two-step sign-in** — shows the method(s) on, lets the person: add/replace the authenticator app, choose email or text
  codes (ACC-3), **make new backup codes** (old ones stop working; shown once), and turn two-step off only when their
  role does not require it.
- Every change: audit row (`account.*` actions) + notice email; nothing about another person is ever shown.

Tests: change password with wrong current password refused; other sessions revoked; email change does not apply until
confirmed; staff cannot reach another user's account through any id in a form; backup-code regeneration invalidates old
codes; turning off two-step refused when the role requires it. Migration: phone fields only (see section 9).

## 5. ACC-2 — Team invitations and roles (what Chris described)

**Settings → Team** replaces the Staff section (same place, wider).

### Adding someone (owner; admins may add Staff only if Chris allows — starting value: **owner only**)

Form: name, email, mobile phone (optional), **access level** (Staff or Admin — Admin only shown to the owner), **job
role** (ACC-5; "No job role yet" until then), and for Admin the same seven permission switches as today's
"What each admin may do" page so limits are set **before** the person ever signs in.

Saving creates a **TeamInvitation** (not a User yet) and emails the link. The person sees "Robinson Appliance Rentals
invited you to Appliance Desk", clicks, lands on `/join/<code>`, sees their name, email and access level (read-only),
chooses a password, then is sent straight to two-step setup if their role requires it. The User + credential are
created **in the same transaction that consumes the invitation** (row locked `FOR UPDATE`, single use).

- Link lifetime: **7 days** starting value (owner setting "How long an invitation link works", 1–30 days). Separate
  from the 1-hour forgot-password link, which stays short on purpose.
- Only a hash of the code is stored; the code is long and random; using it twice, after expiry or after it was
  cancelled shows a plain "this link no longer works — ask Chris for a new one" page.
- Invitation states shown on Team: **Invited** (with "sent on…, works until…"), **Expired**, **Cancelled**, **Active**,
  **Removed**. Actions: resend (makes a new code, old one stops), cancel, change details before accepted.
- If the email already belongs to a customer or team member, saving is refused with a plain reason (no merging).

### Managing people after they join

- Team list shows **owner, admins and staff together** with access level, job role, two-step status (on / not set up)
  and last sign-in date.
- **Change access level** (owner only): Staff ⇄ Admin. Sessions refreshed, audit row, notice email. Promoting to Admin
  starts with every permission **off** except what the owner ticks in the same dialog (safer than today's all-on
  default for new admins; existing admins unchanged).
- **Remove / restore** works for admins too (today staff only). Owner can't remove themselves; the last active owner
  can't be removed or demoted.
- Existing staff accounts created the old way keep working; their unused 1-hour links can be replaced by "resend
  invitation", which now sends a 7-day invitation link instead of a reset link.
- Transferring ownership to someone else is **not** in scope (ROADMAP).

Tests (throwaway Postgres): admin cannot create/promote admins (server refuses, not just hidden); last-owner guard;
racing accept of one invitation creates one user; expired/cancelled/resent codes refused; role change revokes sessions;
invited admin's limits are in force on first action; customer email collision refused; DTO for Team never includes
codes or hashes.

## 6. ACC-3 — Sign-in codes by email or text

Each team member chooses **how they get their second step**: authenticator app, **text message code**, or **email
code**. Backup codes always exist alongside. Codes: 6 digits, valid **5 minutes**, a few tries before a new code is
needed, resend limited (rate limit already stored in the database). Uses the existing Better Auth two-factor plugin's
one-time-code mode; `sendOTP` looks up the person's chosen method and sends through the existing email path or a new
**security text** path.

- **Email codes**: work as soon as ACC-3 ships (production email already works).
- **Text codes**: hidden until all of these are true: production, Twilio keys present, **Chris has switched on
  "Send sign-in codes by text"** (a new switch, separate from customer texting, listed on the Switches page). Agents
  never turn it on (live SMS, AGENTS section 1). The person's phone must be confirmed by a code first.
- If a text cannot be sent (switch off, provider error, number opted out with STOP) the screen offers the person's
  other methods — email code, authenticator or a backup code — never a dead end. Outcome recorded like other messages.
- "Trust this device for 30 days" checkbox (library supports it; starting value 30 days, owner setting, 0 = off).
- **Owner setting — which methods each level may use.** Starting value: Owner and Admins may use authenticator **or text**;
  Staff may use any of the three. Email codes for the owner/admins are off (Chris answered IN-85 "no" on 2026-10-23);
  he can turn them on later in the setting.

**Why email codes are weaker for the owner** (shown in plain words on the setting): the forgot-password link also goes
to email, so anyone who gets into your email inbox could reset your password **and** receive your sign-in code. A text or
the authenticator app keeps the two steps on different things. Text codes have a smaller risk (a thief talking your
phone carrier into moving your number), which is why the authenticator stays available.

Tests: method choice enforced server-side by role policy; code expiry and reuse refused; text path never calls Twilio
when the switch is off (NOT_ATTEMPTED) and falls back; backup code still works; owner can't select a method the policy
forbids; changing the policy doesn't lock out anyone already enrolled — they're asked to switch at next sign-in.

## 7. ACC-4 — Account recovery and security notices

- **Forgot password** (exists) — unchanged, plus a notice email after the reset.
- **Lost phone / no codes** — at the code screen: "Use a backup code" (exists), "Send a code another way" (ACC-3), and
  "I can't get into my account", which explains: employees ask the owner; the owner uses backup codes or the
  recovery steps in [runbooks/ACCOUNT-RECOVERY.md](../runbooks/ACCOUNT-RECOVERY.md) and
  [runbooks/two-factor-recovery.md](../runbooks/two-factor-recovery.md) (both exist today; ACC-4 updates them for the
  new methods and the owner's "reset their sign-in" button).
- **Owner resets an employee's sign-in** (Team → person → "Reset their sign-in"): turns off their two-step, signs them
  out everywhere, emails them a fresh 7-day link to choose a new password and set up two-step again. Audit row +
  notice. Owner only; can't be used on the owner's own account (prevents a stolen owner session from quietly removing
  the owner's second step).
- **Owner's own recovery**: strongly prompted to keep **two** methods (for example text + authenticator) and backup
  codes stored off the phone; Today shows one reminder while the owner has only one method and no unused backup codes.
  Last resort stays the existing trusted developer script (`scripts/reset-two-factor.ts`, documented in the two-factor
  runbook; needs Chris present).
- **Security notice emails** to the affected person: password changed, email changed, two-step changed or reset, new
  backup codes made, access level changed, account removed/restored, sign-in from a new device. Short, no links that
  sign anyone in; "If this wasn't you, contact the owner" (for the owner: the recovery runbook steps).
- **Repeated wrong passwords**: after 10 failed attempts on one account within 15 minutes, further attempts on that
  account wait 15 minutes and the person gets a notice email. (Existing per-IP rate limiting stays.)

Tests: reset-their-sign-in revokes sessions and 2FA and refuses the owner's own account; notices sent once per event;
failed-attempt pause triggers and clears; no notice email contains a sign-in link.

## 8. ACC-5 — Job roles (what someone can see and do)

Access level (Staff/Admin) stays the safety boundary. **Job roles** are named bundles on top of it that Chris can pick
when inviting and edit later (owner-configurable, Settings → Team → Job roles):

| Starting job role | Level | Unlocks |
|---|---|---|
| Driver / technician | Staff | Today, my visits, equipment, maintenance (what staff see now) |
| Office | Staff | Driver set + customers, scheduling, messages inbox (no money) |
| Bookkeeper | Admin | Money screens; "Change business settings" off by default |
| Manager | Admin | Everything an admin can do (today's admin) |

- A job role can only **narrow** what its level allows, never widen it. Giving a **staff** member money or report access
  is not possible until Chris answers IN-13 / the checklist section E decision; ACC-5 builds the bundles so that answer
  becomes a switch, not new code.
- Screens are enforced on the server per job role (page guard + data query), not by hiding menu items.
- Changing someone's job role refreshes their sessions and is audited.

## 9. Data changes (all additive)

- `TeamInvitation`: id, email, name, phone?, accessLevel (STAFF|ADMIN), jobRoleId?, adminCapabilityLimits (json),
  codeHash (unique), expiresAt, status (INVITED|ACCEPTED|CANCELLED|EXPIRED), invitedById, acceptedUserId?, timestamps.
- `User`: phone?, phoneConfirmedAt?, secondStepMethod? (TOTP|SMS|EMAIL), jobRoleId?, failedSignInCount, signInPausedUntil?.
- `JobRole`: id, label, accessLevel, screens (json list of known keys), isStarter, archivedAt.
- `BusinessSettings`: invitationLinkDays (7), secondStepMethodsByLevel (json), securitySmsEnabled (false),
  trustedDeviceDays (30), adminsMayInviteStaff (false).
- New audit actions: `team.invite.*`, `team.role_change`, `team.reset_sign_in`, `account.*`, `security.*`.

## 10. Build order and sizing

ACC-1 (my account) → ACC-2 (invitations and roles) → ACC-3 (email/text codes) → ACC-4 (recovery and notices) →
ACC-5 (job roles). ACC-1 first because the owner has no way to change his own password today. Each is one complete PR
with its tests; none needs a purchase or a live switch to merge. Slot: right after O-2B finishes (Chris confirmed
2026-10-23).

## 11. Owner decisions and checklist rows created by this design

- **IN-85** — may the owner/admins use email codes? **Answered 2026-10-23: no** (text or app); starting value of the setting.
- **IN-13** (existing) — whether staff ever get money/report access; ACC-5 makes the answer a switch.
- Checklist: Twilio campaign registration must include **one-time sign-in codes** as a use case; after Twilio is live,
  switch on "Send sign-in codes by text" and switch your own account to text codes; set up a second method and store
  backup codes.

## 12. Out of scope (see ROADMAP)

Ownership transfer; sign-in with Google; passkeys/fingerprint sign-in (library supports passkeys — a later option);
customer-portal two-step; voice-call codes; single sign-on.
