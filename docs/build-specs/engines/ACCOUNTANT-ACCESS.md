# Build spec — Your accountant's own sign-in (ACCT-1)

Requested and approved by Chris 2026-10-25: "my actual accounting stuff that should only be accessible to the owner
and an actual accountant/cpa/other tax professional needs to have a way for me to send a sign in link to a cpa so they
can get the info they need or make changes, and I can delete that account if needed, or at least reset the login info
when I want to send to a new tax professional." This is an approved widening of access (AGENTS section 1) limited to
what is below. Builds on ACC (team invitations `src/domains/team/index.ts`: `inviteTeamMember`, `resendInvitation`,
`cancelInvitation`, `acceptInvitation`, `removeTeamMember`, `restoreTeamMember`, `resetTeamSignIn`; job-role path
rules `job-role-rules.ts`). Read `docs/AI-PR-READ-FIRST.md` (auth/session, permissions).

## 1. A new access level: ACCOUNTANT
- Additive migration: `ALTER TYPE "Role" ADD VALUE 'ACCOUNTANT'` (`20261104000000_accountant_role`); update
  `src/lib/session.ts` `Role`, `parseInvitableLevel` (OWNER only may invite ACCOUNTANT), labels "Accountant (CPA or tax
  professional)".
- **Second step required** at every sign-in (same `twoFactorEnrollmentRequired` rule as OWNER/ADMIN); "remember this
  device" (ACC-6) is **not** offered to accountants.
- **Access ends on a date**: `User.accessEndsOn DateTime?`, required for ACCOUNTANT (invite form: starting value the
  next May 1, i.e. after the tax deadline, editable; "Keep until I remove it" allowed with a 6-month reminder). After
  the date, sign-in shows "Your access to Robinson Appliance Rentals ended. Ask Chris for a new link." and sessions are
  revoked by the nightly sweep.
- Default deny: every check that lists roles today keeps its list; ACCOUNTANT is added **only** where this spec says.
  Unknown/unlisted → denied (existing rule). A test enumerates every `requireRole(`/`assertActiveTeamActor(` call and
  fails if ACCOUNTANT appears outside the allowlist in section 2.

## 2. What the accountant can see and do (the allowlist)
Desk areas (add `ACCOUNTANT_SCREENS = ["books", "sales-tax", "compliance", "reports-money"]` + ALWAYS_ALLOWED minus
`more`, used by `screenForPath`): the accountant's desk shows **only** Books, Taxes, Compliance, the money reports, the
Decisions questions addressed to a CPA, and Business records Chris shares (below). Customers, rentals, schedule,
equipment, messages, settings, team, vault, system health and the customer portal are not found.
| Area | Read | Change (each audited with the accountant's name) |
|---|---|---|
| Books (`src/domains/books/*`) | everything, incl. journal, accounts, reports, exports, bank matching, fixed assets | adjusting journal entries (existing manual journal path), account mapping (incl. Schedule C lines, CMP-2), bank match/unmatch, fixed-asset life/salvage/§179/bonus fields, close/reopen a month (existing close functions), "Reviewed by accountant" marks |
| Taxes (sales/use tax, RDF) | returns, packets, rules (TFA), filing accounts (account numbers masked) | taxability answers via Decisions (PROFESSIONAL answers), mark a return reviewed; **not** file, pay or change filing accounts |
| Compliance (CMP) | all filings and prepared numbers | edit prepared figures with a note; mark "Reviewed"; **not** Approve/submit (owner only) |
| Decisions | subjects with audience CPA | `recordProfessionalAnswer` (via SCREEN) with their name/firm prefilled; owner still sees and can change |
| Business records | only records Chris marks **"Share with my accountant"** (new boolean on the record, off by default; EIN letter, licenses, articles typically) — files and masked numbers | upload a document to a shared record ("Prepared by accountant") |
| Money screens | bills and payments **lists** in read-only form needed to check revenue (no take-payment, refund, write-off, send) | none |
Never: the vault (VAULT-2), full tax ids (ACCOUNTANT never gets an unlock), customer contact details beyond names on
bills, messages, any send/charge/refund/payment action, settings, users, MCP connections.
Each domain read/write function named above gets ACCOUNTANT added to its role list **explicitly** in this PR; the
functions are listed in the PR body.

## 3. Invite, replace, remove (Settings › Team, OWNER)
- **"Invite your accountant"** (OWNER only): name, email, firm, access ends on → existing invitation flow with level
  ACCOUNTANT (link expires per `invitationLinkDays`); email says "Chris Robinson invited you to see the books of Robinson
  Appliance Rentals." (existing email path and switch; if email is off, "Copy invitation link" — existing behaviour).
- The team list shows the accountant with firm, access ends on, last sign-in, and actions: **Remove** (existing
  `removeTeamMember` — archives, revokes sessions; their audit history stays), **Reset sign-in** (existing
  `resetTeamSignIn` — new password link, sessions revoked; use when the same person needs a new password), **Change
  access end date**, and **Replace with a new accountant** (one flow: remove the current one, then the invite form
  pre-filled with "access ends on" — two audited steps, so history shows who had access when). Restoring a removed
  accountant needs a new end date.
- To do for the owner: "{name}'s access ends on {date}" 14 days before; after removal, nothing.

## 4. What Chris sees
- **"Changes by your accountant"** feed on Books home (and a Today card when there are new ones since he last looked):
  each change in plain words ("Moved $120 from Supplies to Repairs — note: 'Hose kit is a repair part'"), with a link to
  the entry. Owner can reverse a journal adjustment with the existing reversal path.
- Every accountant action is in the activity log with their name and firm.

## 5. Tests
Invite (owner only; admin refused), accept with second step required, access-end enforcement (sign-in refused,
sessions revoked nightly), allowlist test (section 1), each area's read/change allowed and every other desk route and
domain function refused (route inventory + a sample of 30 domain functions), vault never readable, shared-records-only,
remove/reset/replace flows, feed of changes. `e2e/accountant-access.spec.ts` (shard): owner invites → accountant signs
in → sees only Books/Taxes/Compliance/Decisions → makes an adjustment → owner sees it in the feed → owner removes them →
their next request is refused. Axe, phone/desktop.
