# Build spec — Final sweep: every desk screen on the kit, plain words everywhere, phone check, permissions audit (AR-10)

Card: `docs/pr-cards/AR-10.md`. Design: `docs/designs/APP-REDESIGN.md` section 8 row AR-10 ("every remaining screen on
the kit; guards with an empty allow-list except legal text; full browser + axe + phone pass; visual review notes in
STATUS"). Runs last in the AR order (after AR-5, AR-6, AR-8, AR-9; KIT.md 9 "AR-10 makes the list all desk pages").
Also absorbs three carried items: the O-3B approvals browser test (PLAN.md ~line 341: "the browser test is planned in
AR-10"), the 360 px check of every page, and the universal permissions audit Chris asked for on 2026-10-21
(`docs/END-USER-AUTHORITY.md` "Sol 5.6 remaining verification and correction contract", MASTER-ROADMAP "Universal
permissions audit overlay").

## 0. Start: measure what is left (no guessing)
Write `scripts/ar10-inventory.mjs` (prints, changes nothing): every `src/app/desk/**/page.tsx` and whether it is in
`docs/build-specs/migrated-pages.json`; every file under `src/components/ui` / `src/components/desk` and how many
files import it; every `EVERYDAY_BANNED` hit outside migrated pages; every `manualOnlyReason` route in
`e2e/route-inventory.ts`. Paste the output into the PR body. Expected leftovers (verify with the script; on
2026-10-25 these desk folders had no redesign unit): `account` (My account), `activity`, `approvals`, `automations`
(System health — MCP-1/MCP-3 change its content; AR-10 converts the frame only), `launch`, `notices`, `paperwork`,
`phone-orders`, `privacy`, `sales`, `search`, `security/setup`, `tasks`, and `_text` (call/text panels).

## 1. Convert the leftovers
Each leftover page becomes one of the four page types (KIT 5): lists → work queue (5.1), single things → record page
(5.2), multi-step → guided flow (AR-4 `Wizard`), settings-like → AR-8 `SettingRow`s. Rules:
- Same URL, same server actions, same domain reads; only layout, words and kit components change (README "definition
  of done").
- Specific choices already decided: `approvals` = work queue with `StatusTabs` "Waiting {n}", "Approved, not
  finished {n}", "Done", rows open a `SidePanel` with the request and Approve/Decline (ConfirmDialog using KIT 6.6
  money format for refund/deposit/credit amounts); `tasks` = work queue (existing `getTaskWorkspace` filters as
  `StatusTabs`/filters); `activity` = work queue, read-only, `Timeline`-style rows; `search` = the AR-1 command bar
  result page (grouped `DataTable`s); `notices` = work queue; `paperwork`, `privacy`, `launch` = record pages with
  `NextStepCard`; `phone-orders` = guided flow; `account` and `security/setup` = settings pages; `_text` panels =
  kit `Sheet`s opened from record pages.
- Delete what nothing imports any more: `src/lib/desk-navigation.ts`, `src/lib/desk-sections.ts` (NAVIGATION.md says
  AR-10 deletes them), `GlobalSearchBox`, and each `src/components/ui` / `src/components/desk` file the inventory
  shows with zero importers. Never delete a file still imported; run `npx tsc --noEmit` after each deletion batch.

## 2. Plain words everywhere
- `scripts/check-owner-wording.mjs`: apply `EVERYDAY_BANNED` (AR-12) to **every** scanned file (`src/app/desk`,
  `src/components/desk`, `src/components/kit`, the exceptions rules files, and `src/app/account` from PORTAL-1), not
  only migrated pages. Fix every hit with the dictionary (APP-REDESIGN 4D.6).
- Allowed exceptions (each an entry in `scripts/owner-wording-allowlist.json` with a reason ≥ 15 characters, as the
  loader already requires): the accountant area (`src/app/desk/books/**` "For your accountant" pages), legal document
  renderers (agreement, bill/invoice document, tax return worksheets), and words that are names of official forms
  (e.g. "DR 0100"). Nothing else.
- `scripts/kit-guard-allowlist.json`: empty except legal/tax wording entries (KIT guard 9.3); test asserts every
  remaining entry's reason mentions "legal" or "tax".

## 3. Every page at phone width
The existing accessibility inventory already checks no sideways scrolling at 360 px and axe in light and dark
(`e2e/accessibility-route-helpers.ts`, `DEFAULT_VIEWPORTS = [360, 1440]`). AR-10 makes it cover every page:
- `tests/accessibility-route-inventory.test.ts` already fails when a page has no inventory row; keep it.
- Cut `manualOnlyReason` routes (33 on 2026-10-25) to only those that truly can't be seeded: give the rest a fixture by
  creating records in `e2e/global-setup.ts` on the throwaway CI database (one customer with an active rental, a
  quote, a bill, a job, a message thread with synthetic text, an appliance, a part, a purchase order, a tax period) and
  pointing `fixture` at their ids through a small `e2e/.fixtures.json` written by the setup. Routes that stay manual
  (one-use tokens such as `/tenant/repair/[token]`, `/join/[code]`) must name the spec that covers them; the inventory
  test checks that file exists.
- Add 390 px to `DEFAULT_VIEWPORTS` for desk routes only (`[360, 390, 1440]`); the README's five sizes stay for the
  new specs each unit wrote.

## 4. The approvals browser test (carried from O-3B)
`e2e/approvals.spec.ts` (add to a shard). CI has no Stripe keys, so the test proves the parts that don't call Stripe
and the honest "not finished" state; the Stripe sending path stays proved by the O-3B database tests with a fake
Stripe.
1. Owner sets a credit limit of $10 on Settings › Approval limits (existing form, `e2e/owner-controls.spec.ts` shows
   the selectors).
2. Admin (existing `e2e/.auth/admin.json` session) applies $25 of a seeded customer's credit → sees "Waiting for the
   owner"; nothing applied (bill balance unchanged on the bill page).
3. Owner opens `/desk/approvals` → the request → Approve → the credit is applied once (bill balance down $25); a
   double click makes one application.
4. Admin starts a $40 refund over a $20 refund limit → waits; owner Declines with a reason → admin sees "Declined".
5. Admin starts another refund; owner Approves → with no Stripe configured the request shows "Approved, not finished"
   and the plain Stripe state; "Check and finish" is not shown before two minutes.
6. Axe on the approvals page, phone and desktop, light and dark; keyboard-only approve.

## 5. Permissions audit (Chris, 2026-10-21; Sol 5.6 contract)
The contract's steps 1–7 apply; this section makes them concrete and repeatable as tests that keep guarding later
changes.
1. **Server actions inventory** — `tests/server-action-auth-inventory.test.ts`: parse every file under `src/app`
   that starts with `"use server"` with the TypeScript compiler API (`typescript` is installed). For each exported
   function: it passes if its body (or a same-file helper it calls) calls one of `requireRole`, `requireSession`,
   `requireAllowedRole`, `requireRoleForTwoFactorSetup`, `getServerSession`, `assertActiveTeamActor`,
   `lockAgreementForActor`; otherwise it must be listed in `tests/fixtures/server-action-auth.json` as `{ file, name,
   guardedBy, reason, test }` where `test` is an existing test file that proves the refusal. Starting list from a
   2026-10-25 scan (verify; nothing unguarded was found): `src/app/desk/tasks/actions.ts` five actions → `createTask`/
   `updateTask`/`completeTask`/`reopenTask`/`deleteTask` call `requireRole` (`src/domains/tasks/index.ts` ~line 31);
   `linkMessageContextAction` → `linkMessageContext` (`requireRole` + `assertActiveTeamActor`); `runPreviewStorageCheck`
   → `verifyPreviewPrivateStorage` (owner check); public by design: `publicPrivacyRequestAction` (rate-limited public
   form), `acceptInvitationAction` (invitation code), `submitTenantRepairAction` (tenant link token),
   `chooseQuoteLanguage` (quote link; changes only that quote's language). A new action with neither a guard nor a
   listed reason fails CI.
2. **Desk pages inventory** — `tests/desk-page-auth-inventory.test.ts`: every `src/app/desk/**/page.tsx` either
   calls a guard directly or every domain read it awaits is listed in `tests/fixtures/desk-page-reads.json` with the
   guard it contains (15 pages on 2026-10-25 rely on their domain read's `requireRole`, e.g. `jobs/[id]/work-order` →
   `getWorkOrderDetail`, `search` → `searchAll`, `parts/[id]` → `getPartMovementHistory`). Layouts never count (they
   don't re-run on navigation — the PR #594 lesson).
3. **API routes inventory** — `tests/api-route-auth-inventory.test.ts`: every `src/app/api/**/route.ts` handler calls
   a session guard, the cron secret check (`src/lib/cron-auth.ts`), a provider signature check (Stripe/Twilio
   webhooks), a token/key check (`authorizeOpsRequest`, MCP routes), or is listed public with a reason.
4. **Customer A/B matrix** — `tests/customer-ab-matrix-integration.test.ts` (throwaway Postgres, customers A and B,
   one STAFF, one archived customer): for every customer-reachable read, action and download — portal home, rentals,
   repairs (list + create with B's appliance), bills (list, bill page, Pay now, statement), properties and on-site
   contacts, privacy requests, `/api/photos/[id]`, `/api/documents/*`, `/api/feedback-attachments/[id]` (when MCP-10a
   is merged), signing page reads — A gets only A's data, B's ids look exactly like missing ones, the archived customer
   gets nothing, and no row changes on a refused call (compare row counts and `updatedAt`). One test per entry; the
   test file's entry list is checked against a constant `CUSTOMER_SURFACES` that new units must extend.
5. **Sessions** — extend `e2e/session-deactivation.spec.ts`: removing a team member or archiving a customer while
   signed in → the next page load and the next server action are refused; sign-out then sign-in as another person
   never shows the first person's data (back button included).
6. **Findings** — anything the audit finds is fixed in this PR if it is small and in a page this unit touches;
   otherwise (and always for a real hole on `main`) in its own PR immediately (AGENTS section 6), with a STATUS line.

## 6. Visual review notes
STATUS entry lists, per area, anything that still looks off at 360 px or 1920 px after the sweep (with the page) —
honest notes, not "all good" without looking (AGENTS section 3).

## 7. Tests summary
`scripts/ar10-inventory.mjs` (no test; output in PR), `tests/kit-guards.test.ts` (list = all desk pages),
`scripts/check-owner-wording.test.mjs` (extend: everyday list everywhere; allow-list reasons), `tests/accessibility-route-inventory.test.ts`
(manual routes name a spec), `e2e/accessibility-routes-desk-*.spec.ts` (360/390/1440), `e2e/approvals.spec.ts`, the
three inventory tests, the A/B matrix, `e2e/session-deactivation.spec.ts`.
