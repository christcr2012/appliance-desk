# ACC-2 — Team invitations, access levels, remove and restore

Design: `docs/designs/ACCOUNTS-AND-SIGN-IN.md` sections 5 and 9. Base: `main` at `0adc574`. Batch ACC, second of five.
Risk: **auth / permissions** (read `docs/AI-PR-READ-FIRST.md`: roles are enforced in the database transaction, not by hiding buttons).

## Why
Admins cannot be created in the app, staff accounts are created with a password link that lasts one hour, and there is no way to
change someone between Staff and Admin. The owner asked for invitations with a longer-lived link and clear roles.

## Acceptance
- **Settings → Team** replaces the old Staff section. It lists owner, admins and staff (access level, two-step on/off, last signed in,
  Active/Removed) and a separate **Invitations** list (Invited with the date the link stops working, Expired, Cancelled).
- **Invite a team member** (name, email, optional phone, access level Staff or Admin). An invitation is NOT a login: the person's
  account is created only when the link is used, in the same transaction that marks the invitation used (invitation row locked,
  single use; two people racing create exactly one account).
- Only a hash of the long random link code is stored; the code is only ever in the email. The Team list never includes codes or hashes.
- The link works for **7 days by default (owner setting, 1–30)**. Expired, cancelled, used or replaced links all show the same plain
  message: "This link no longer works. Ask the owner for a new one." **Send again** makes a new code and the old one stops at once;
  **Cancel invitation** stops it.
- Admin permission switches can be set while inviting an admin; they are in force at the first sign-in.
- An email that already belongs to a customer or a team member, or already has an open invitation, is refused.
- **Admins never create or promote admins** (refused in the database transaction). Admins may invite staff only if the owner turned on
  **Admins may invite staff** (starting value off).
- Owner only: **Make admin** (starts with every admin permission OFF except the ones ticked) and **Make staff**. Either signs the
  person out everywhere, is recorded (`team.role_change`) and emails them a notice. Not for yourself, not for an owner.
- **Remove / restore access** works for staff and admins (admins may only touch staff). Nobody removes themselves; an owner cannot be removed here.
- Every change is recorded (`team.invite.create|resend|cancel|accept`, `team.role_change`, `team.remove`, `team.restore`, `team.settings`).
- If an email is not confirmed sent, the screen says so plainly ("saved but the email was not sent … do not invite them twice").
- Additive migration `20261024050000_team_invitation` (`TeamInvitation` table, `BusinessSettings.invitationLinkDays`, `adminsMayInviteStaff`).

## Build contract
- `src/domains/team/rules.ts` (pure rules), `index.ts` (database work). `src/app/desk/settings/team-section.tsx` + `team-actions.ts`.
- Public `/join/[code]` page (`src/app/join/[code]`): shows name, email and access level read-only; the person chooses a password.
- The old "Add staff account" form and its actions are removed; `src/domains/staff` functions stay for the existing lifecycle tests.
- `src/domains/capabilities/labels.ts` holds the permission names so screens can import them without the database.

## Tests
- `tests/acc2-team-rules.test.ts` (no database): codes and hashes, 1–30 days, expiry, who may invite / remove, password check.
- `tests/acc2-team-invitations-integration.test.ts` (throwaway Postgres): not a login until used, admin cannot invite admins, email collisions,
  accept once, racing accept, expired / cancelled / replaced links refused, invited admin's limits in force on first action, level change
  signs out and starts everything off, owner / admin removal rules, no codes in the Team list.
- `e2e/team-invitations.spec.ts` (browser shard b): bad link message, owner invites from Settings → Team. `/join/[code]` is in the accessibility route list.

## Not in this card
Job roles (ACC-5), editing an invitation's details (cancel and invite again instead), sign-in codes (ACC-3), reset-their-sign-in and failed-attempt
pause (ACC-4), ownership transfer. Real-inbox acceptance of the invitation email is a production-only observation.
