# AR-2 — Today inbox, finished: tasks, approvals and notices handled in place

Design: `docs/designs/APP-REDESIGN.md` sections 4.1 (Today), 4.3 (inbox rules). Build spec:
`docs/build-specs/screens/TODAY.md` (built in AR-0) — this card adds the pieces below. Depends on **AR-0b**, **AR-1**,
**AR-11** (optimistic helper). Risk: **money** (approvals approve refunds, write-offs, deposits, credits, expenses).
Read `docs/AI-PR-READ-FIRST.md`. No money rule changes: the same domain functions run with the same arguments.

## Why
Chris should be able to clear his day from Today without opening other pages: finish a task, answer an admin's
approval request, deal with a notice.

## Decisions already made
- Approving is a money action: **always a confirmation, never optimistic, never Undo** (KIT 6.6 format).
- The approvals To do item stays **one item** ("Requests waiting for your approval (n)", existing rule in
  `src/domains/exceptions/approval-attention.ts`); its button opens the list of requests in a Sheet.
- Snooze stays where it is (Today only).
- `/desk/approvals`, `/desk/tasks` and `/desk/notices` keep working (Today › Tasks tab and links from items).

## Steps (in order)
1. **Move the approval server actions** `decide` and `finish` out of `src/app/desk/approvals/page.tsx` into
   `src/app/desk/approvals/actions.ts` (exported `decideApprovalAction`, `finishApprovalAction`), unchanged except:
   they return `{ outcome }` instead of redirecting when the form has `inline=1`, and revalidate both
   `/desk/approvals` and `/desk/today`. Move `OUTCOME_WORDS` and `STATUS_WORDS` to
   `src/domains/approvals/words.ts`. The approvals page imports them (same behavior with no `inline`). Test: the
   existing approvals tests pass; a new test covers `inline=1` returning the outcome.
2. **Approvals Sheet on Today (OWNER only).** When the inbox has the `APPROVAL_REQUEST` item, the page also loads
   `listWaitingApprovals()` (owner only, existing). The item's primary action becomes "Review requests" (opens a
   Sheet "Waiting for your approval"). One card per request: summary (title), `"Asked by {requestedBy} ·
   {formatShortDate(createdAt)} · {formatMoney(amountCents)}"`, `"Expires {formatShortDate(expiresAt)}"` or
   "Expired — can no longer be approved" (then only Decline is offered). Buttons: **Approve…** → `ConfirmDialog`
   title `"Approve {formatMoney(amountCents)}?"`, summary `"{summary}. It happens right away, as you. This can't be
   undone."`, an optional "Note" input (max 300), confirm label "Approve and do it now"; **Decline…** →
   `ConfirmDialog` title "Decline this request?", summary "Nothing will change.", optional note, confirm "Decline".
   After either: toast with `OUTCOME_WORDS[outcome]` (danger tone for `failed`, `uncertain`, `refused`), remove the
   card, and when none remain close the Sheet. The ⋯ on the item keeps "Open approvals page" (`/desk/approvals`).
3. **Tasks in the inbox.** Items of group `tasks` come from `getDueTaskSummary` (existing; up to 6 + "Showing 6 of
   {total}" with a link button "See all tasks" → `/desk/tasks`). Card: eyebrow `"Task · {due label}"` (overdue →
   attention tone "Overdue"), title = task title, detail = linked record name when the select has it. Primary **Mark
   done** → a server action in `src/app/desk/today/page.tsx` `completeTaskFromToday(fd)` reading `id` and `version`
   and calling the existing `completeTaskAction(id, version)` (it returns `{ status: "success" }` or
   `{ status: "error" | "conflict", message }`; treat anything but success as a failure with that message); optimistic via `useOptimisticAction` with Undo calling
   `reopenTaskAction(id, version + 1)` (completing increments the task's `version` by exactly 1).
   Secondary "Open" → `/desk/tasks` (the tasks page; deep link to the task if the page supports `?open=`).
   Staff see only their own due tasks — keep the existing `selection(role)` and where clauses.
4. **Notices.** Items of the `NOTICE_*` categories keep their primary link to `/desk/notices/{id}` (existing
   `todoAction`) and get no inline secondary: every notice action (`recordNoticeDeliveryAction`,
   `confirmEmailOutcomeAction`, `resolveMissedNoticeAction`) needs details typed on the notice page.
5. Browser spec `e2e/today-inline.spec.ts`: owner approves a seeded request through the confirmation and sees the
   outcome toast; declines another; staff never sees approvals; a task marked done disappears and Undo brings it back;
   axe + 5 sizes.

## Acceptance
- [ ] Approve/Decline from Today call the same domain functions as the approvals page (unit test spies), always
      through the confirmation, owner only (admins/staff get no Sheet and the action refuses them).
- [ ] The approvals page still works the same way.
- [ ] Tasks can be finished from Today with Undo; staff see only their own.
- [ ] `ci` green at the exact head; every review comment read.

## Not in this card
Dashboard and control-center content (AR-9 Insights; control-center already redirects in AR-1); notifications bell.

## Progress
Not started.
