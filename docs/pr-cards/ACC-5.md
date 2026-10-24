# ACC-5 — Job roles (what someone can see and do)

Design: `docs/designs/ACCOUNTS-AND-SIGN-IN.md` section 8. Base: ACC-4 (stacked). Batch ACC, last of five.
Risk: **auth / permissions** (read `docs/AI-PR-READ-FIRST.md`: missing or unknown role data denies; hiding a menu entry is never the protection).

## Why
Staff and admins today all see the same screens for their level. The owner wants a bookkeeper who sees the money screens but cannot change business settings, and a driver who does not need the customer list, without inventing new access levels.

## Acceptance
- **Job roles** (Settings → Team → Job roles, owner only): a name, a level (Staff or Admin), the list of desk screens it can open, and for admin roles a list of admin permissions switched off. Four starting roles come with the migration: Driver / technician (Staff), Office (Staff), Bookkeeper (Admin, "Change business settings" off), Manager (Admin, every screen). Owner can create, edit, archive (not while people have it), restore and "Restore recommended" a starting role.
- **Only narrows.** The access-level checks everywhere are unchanged. A job role can only remove screens from what the level allows. **Staff roles cannot include money or settings screens** (Quotes, Money/reports, Taxes, Books, Expenses, Suppliers, Settings and the other management screens) until the owner answers IN-13: one constant (`STAFF_MONEY_SCREENS_ALLOWED`) makes that a switch later. People with **no job role keep exactly what their level gave them** (nothing changes for anyone until the owner assigns a role).
- **Enforced on the server**, not by hiding links: the desk layout and `requireRole` (pages and server actions) refuse a screen the job role does not include (page: back to Today with a note; action: an error), the menu and More page only list allowed screens, and global search does not query the categories the role excludes. Unknown addresses are refused for a person who has a job role. Today, My account, Security, Notices, Search and More are always allowed.
- **Assigning** (owner only; Staff/Admin, not yourself or an owner): a role must fit the person's level; it signs them out, is recorded (`team.job_role.assign`) and emails them a short notice. An admin role switches its listed permissions off and never any on. A job role can be chosen when inviting (and applies when the link is used); changing someone's level clears their job role. A job role that is gone or no longer fits the level grants only Today/My account (fails closed).
- Additive migration `20261024080000_job_roles` (`JobRole` table with the four starting rows, `User.jobRoleId`, `TeamInvitation.jobRoleId`; plain ids, no database link, so backups restore in any order). `JobRole` is part of backups.

## Build contract
- `src/domains/team/job-role-rules.ts` (pure: screens, address-to-screen map, validation, starting roles), `job-roles.ts` (database: owner-only writes under row locks, `screensForUser`), `src/lib/job-role-guard.ts` (request check used by `requireRole` and the desk layout), `desk-navigation.ts` and `domains/search` take the person's screens.
- Page addresses and server actions are checked against the page they were used on (the proxy stamps the address; client values are overwritten).

## Tests
- `tests/acc5-job-role-rules.test.ts` (no database): address-to-screen map, allow/deny including unknown addresses, menu and More filtering, validation, starting roles.
- `tests/acc5-job-roles-integration.test.ts` (throwaway Postgres): starting roles, owner-only edits, staff never get money screens, assign signs out and audits, level/role mismatch, admin limits via the real capability check, level change clears the role, in-use roles cannot be archived, restore recommended, invitation with a job role applied on accept.
- `e2e/job-roles.spec.ts`: owner sees the four roles; a staff role cannot tick money screens.

## Not in this card
- API download/upload routes under `/api/...` are still limited by access level only (they are not desk screens; a job role does not narrow them yet).
- A server action used from a page that is allowed but acting on a screen that is not (for example a shared button on Today) is checked as the page it sits on; the access-level check inside the action still applies.
- Staff money/report access (waits for IN-13; the constant above is the switch).
