# Screen spec — Schedule: board, visits, my route (with offline), repairs, visit record, hand-offs

Built in **AR-5**. Design: `APP-REDESIGN.md` sections 4.1 (Schedule area), 4.2 (work queue, record page), 4.3
(hand-offs), 4B (phone first; "today's route cached read-only"), 7 (page map). Kit: KIT.md. Navigation tabs come
from NAVIGATION.md (Schedule: Board `/desk/dispatch`, Visits `/desk/jobs`, My route `/desk/driver`, Repairs
`/desk/maintenance`). Everyday words: **visit** (not job), **repair request** (not maintenance request), **pickup**
(REMOVAL), **delivery**, **appliance number** (asset number). **No scheduling or completion rule changes:** every
button calls a server action that exists today (`createJobAction`, `scheduleJobAction`, `updateJobStatusAction`,
`completeJobAction`, `markJobNoShowAction`, `addJobPhotoAction`, `updateJobChecklistAction`,
`updateMaintenanceStatusAction`, the maintenance schedule action) unless this spec says otherwise.

Roles (unchanged, enforced on the server):
- OWNER/ADMIN: everything below.
- STAFF: Board and Visits read-only lists (no "Schedule a visit", no reassign), My route, the visit record through
  `getDeskJobById` (staff branch — no money), Repairs list and record read-only. Staff writes on a visit go through
  `assertJobScopeInTx` (assigned to them, or unassigned when the owner setting `staffMayWorkUnassignedJobs` is on).

## 1. Fixes found while specifying (do them in this card)

1. **"My route" shows everyone's visits** (`src/app/desk/driver/page.tsx`, title "Shared team route", via
   `getDriverJobsForToday()` which has no person filter). A staff member then sees buttons on visits they are not
   allowed to work, and the server refuses them ("This job is assigned to someone else"). Fix in section 5:
   `getRouteForToday({ who })` returns, for STAFF, only visits assigned to them plus unassigned ones when
   `staffMayWorkUnassignedJobs` is on; OWNER/ADMIN default to their own and may switch to "Everyone".
2. **Raw codes on screen:** the board's local `jobTypeLabel` lower-cases the stored code ("maintenance visit",
   "removal"); the visit record's `<h1>` prints `{job.type}` ("DELIVERY"); the driver card pill prints
   `job.status.replace(/_/g," ")` ("IN PROGRESS"); the repair record prints "Priority: URGENT" and its visits as
   `{j.type} — {j.status}`; the repairs list prints `request.priority` raw. Use `jobTypeLabel`, `jobStatusLabel`,
   `maintenanceStatusLabel` (`src/lib/status-labels.ts`) and a new `maintenancePriorityLabel` (LOW "Low", NORMAL
   "Normal", HIGH "High", URGENT "Urgent", with Spanish entries in `SPANISH_STATUS_LABELS`: "Baja", "Normal",
   "Alta", "Urgente").
3. **Times in the server's time zone:** the visits list (`new Date(job.scheduledAt).toLocaleString()`), the repairs
   list (`toLocaleDateString()`), the repair record (`toLocaleString()` twice) format in UTC on Vercel. Use the
   business-date helpers (`formatShortDate`, `formatBusinessTime`, `formatBusinessDate`) — America/Denver.
4. **`getMaintenanceRequestById` has no role check** (`src/domains/maintenance/index.ts`; callers
   `src/app/desk/maintenance/[id]/page.tsx` and `src/app/desk/jobs/new/page.tsx` check, the function does not). Add
   `await requireRole("OWNER", "ADMIN", "STAFF")` (same reason as PR #594: layouts don't re-render on navigation).
5. **Visits list order and paging:** `getJobsPage` sorts every status by `scheduledAt asc` with offset paging, so
   "Completed" shows the oldest first and pages can shift while someone works. Replace with the cursor list in
   section 4 (newest-first for finished visits).
6. **Repairs has no area tabs** (`src/app/desk/maintenance` has no `layout.tsx`; the other Schedule pages render
   `SectionTabs section="schedule"`). AR-1's area layout covers it; until AR-1 is merged add the same 10-line layout.
7. **Completing from My route bounces staff to the full visit page**, which is fine (it holds the per-appliance
   result form), but the card says "Mark complete" and then shows nothing about why it navigated. Rename to
   "Finish visit…" and open the visit record at `#finish` (add `id="finish"` to the completion form wrapper in
   `job-detail-panel.tsx`).

## 2. Shared pieces

- `src/domains/jobs/words.ts` (pure): `visitTitle(job)` = `"{jobTypeLabel(type)} · {customer name or 'No customer'}"`;
  `visitWhen(job, now)` = `"{relativeBusinessDay(scheduledAt)} at {formatBusinessTime(scheduledAt)}"` or "No time
  yet"; `VISIT_PILL: Record<JobStatus, { label; tone }>` = SCHEDULED "Booked" (info), IN_PROGRESS "Under way"
  (attention), COMPLETED "Done" (good), CANCELLED "Cancelled" (neutral); a no-show (`noShowAt` set) shows "Nobody
  home" (attention) instead of Cancelled. Unit-test every status.
- `REPAIR_PILL: Record<MaintenanceStatus, …>` = SUBMITTED "New" (attention), REVIEWING "Looking at it" (info),
  SCHEDULED "Visit booked" (info), IN_PROGRESS "Being fixed" (attention), RESOLVED "Fixed" (good), CLOSED "Closed"
  (neutral). Priority chips: URGENT danger, HIGH attention, NORMAL/LOW none (shown only in the detail line).
- Glossary entries (KIT `GlossaryKey`, kebab-case): `visit-booked`, `visit-under-way`, `nobody-home`,
  `double-booked`, `unassigned-visit`, `repair-request`.

## 3. Board — `/desk/dispatch` (same URL)

**Params** (`src/app/desk/dispatch/params.ts`, zod, unknown → defaults): `view` = `day` (default) | `week` |
`agenda`; `date` = `YYYY-MM-DD` (Denver; default today; existing `dispatchAnchor`); `who` = `everyone` (default for
OWNER/ADMIN) | `mine` | `unassigned` | a team member id (OWNER/ADMIN only; ignored for STAFF, whose default is
`everyone` read-only — the board is the shared calendar). `open` (visit id for the side panel).

**Data:** keep `getDispatchBoardJobs(rangeStart, rangeEnd)` and add an optional `who` filter applied to both the
scheduled and unscheduled queries (`assignedToUserId = x`, or `null` for unassigned). Cap the **unscheduled** query
with `take: 51` (shows 50 and "{n}+ waiting for a time — open Visits" link to `/desk/jobs?status=no-time`); today it
is unbounded. The conflict candidates stay as they are (they are bounded by the date range).

**Layout:**
- `ScreenHeader` "Schedule" (area title), primary "Schedule a visit" → `/desk/jobs/new` (OWNER/ADMIN only).
- Under it a row: segmented control Day · Week · Agenda (links), date stepper "‹ {label} ›" (Earlier/Later links with
  `aria-label` "Earlier" / "Later") and "Today"; label = Day `formatWeekdayDate(anchor)`, Week `"Week of
  {formatShortDate(monday)}"`, Agenda `"Next 2 weeks"`. Filter (Toolbar, one select "Who": Everyone, Mine,
  Not assigned, then each assignable team member from `getAssignableTeamMembers()`; OWNER/ADMIN only).
- **Waiting for a time** (when unscheduled > 0): collapsible card at the top, open by default when ≤ 5, each row a
  `VisitRow` with action "Set a time" (OWNER/ADMIN) → opens the **Schedule sheet**.
- **Day:** a vertical list grouped by hour (`formatBusinessTime` of the hour as a small heading). `VisitRow` =
  time · `visitTitle` · address `"{line1}, {city}"` · who ("Not assigned" in attention tone) · length (`"{n} min"`;
  default length shown as `"{n} min (usual)"`) · checklist `"{done}/{total}"` when a checklist exists · pill. A visit in
  the conflict set gets an attention chip "Double-booked" (InfoTip `double-booked`: "{name} has another visit that
  overlaps this one. Change a time or the person."). Row tap: phone → `/desk/jobs/{id}`; desktop → `?open={id}`
  (SidePanel shows the visit record's Overview tab, section 6).
- **Week:** desktop (`lg:`) a 7-column grid, each day a column of compact rows (`time · type · customer first name`);
  phone: 7 day chips (Mon–Sun with counts) above the Day list for the chosen chip (`date` param), not a squeezed grid.
- **Agenda:** the Day list repeated per day for 14 days, days with nothing collapsed into one line "Nothing on {date}".
- Row ⋯ (OWNER/ADMIN): "Open", "Change time or person…" (Schedule sheet), "Text the customer…" (existing
  `SendTextPanel` families `job_scheduled`/`job_reminder` — only where the text switch allows), "Call" (`tel:`).
- **Schedule sheet** (`Sheet`, OWNER/ADMIN): date + time (`<input type="datetime-local">` in Denver, same conversion
  as `job-schedule-panel.tsx`'s `denverLocalInput`), length (minutes; empty = usual length, helper "Usual length is
  {n} minutes — change it in Settings"), person (select of assignable members + "Not assigned"). Submit → existing
  `scheduleJobAction`; on `status: "conflict"` show the existing conflict list (`schedule-conflicts.tsx`) inside
  the sheet with "Book it anyway" (re-submit with `confirmedConflictJobIds`) — the same two-step the visit page uses.
  Success toast "Visit booked for {weekday} at {time}".
- Empty: Day "Nothing booked for {label}" + "Schedule a visit" (OWNER/ADMIN); Week/Agenda "Nothing booked".

## 4. Visits — `/desk/jobs` (same URL)

**Params** (`src/app/desk/jobs/params.ts`): `status` = `upcoming` (default: SCHEDULED and IN_PROGRESS with a time) |
`no-time` (SCHEDULED/IN_PROGRESS, `scheduledAt` null) | `done` (COMPLETED) | `cancelled` (CANCELLED incl. no-show);
`type` = `delivery` | `pickup` (REMOVAL) | `repair` (MAINTENANCE_VISIT) | `swap` | `installation`; `who` (as Board);
`q` (customer name/email contains, address line1 contains, appliance number exact); `when` = `this-week` |
`next-week` | `last-30` (date presets on `scheduledAt` for upcoming, `completedAt` for done); `sort` = `soonest`
(default for upcoming/no-time: scheduledAt asc / createdAt asc) | `latest` (default for done/cancelled:
completedAt or updatedAt desc); `cursor`. Old links: `?status=SCHEDULED|IN_PROGRESS` → upcoming,
`COMPLETED` → done, `CANCELLED` → cancelled, `?page=` ignored.
**Data** `src/domains/jobs/visits-list.ts`: `getVisits(params, now)` / `getVisitCounts(params, now)` (KIT 5.1 cursor
rule, `requireRole("OWNER","ADMIN","STAFF")`), selecting only `JOB_OPERATIONAL_SELECT` fields the row uses (no
money). Search by appliance number uses the `JobAppliance → appliance.assetNumber` relation.
**Layout:** `ScreenHeader` "Schedule", primary "Schedule a visit" (OWNER/ADMIN); `StatusTabs` "Upcoming {n}",
"Needs a time {n}" (hide 0), "Done", "Cancelled"; Toolbar search "Name, address or appliance number", filters Type,
Who, When; sorts "Soonest first" / "Latest first"; built-in views (add a `visits` entry to AR-12's built-in view registry): "My visits this week",
"Pickups to book", "Repairs not finished". Cards: `visitTitle` · `visitWhen` · address · who · pill. Desktop
columns: When · Visit · Address · Person · Status · ⋯. Row ⋯ as the Board. Empty per tab: "No upcoming visits",
"Every visit has a time", "No finished visits yet", "No cancelled visits".

## 5. My route — `/desk/driver` (same URL), with today's route kept for poor signal

**Data** `getRouteForToday({ actor, who })` in `src/domains/jobs/route.ts` (replaces `getDriverJobsForToday`, which is
deleted with its only caller): `requireRole("OWNER","ADMIN","STAFF")`; today's Denver bounds; status SCHEDULED or
IN_PROGRESS; filter — STAFF: `assignedToUserId = me` OR (`assignedToUserId = null` AND setting
`staffMayWorkUnassignedJobs`); OWNER/ADMIN: `who=mine` (default) as STAFF without the setting check, `who=everyone`
no filter. Order `scheduledAt asc, id asc`; visits with no time are not on a route (they are on the Board). Select
the existing driver fields plus `assignedToUserId`, `version`, `checklist`, and the private location fields that
`getJobLocationPrivacy` already allows this actor (unit label, access notes) — never more than the visit page shows
the same person.
**Layout (phone first; `max-w-md` centered on desktop):** header "My route" with `"{n} stops today"`; OWNER/ADMIN get a
two-option toggle "Mine" / "Everyone". One card per stop, in order, numbered "1", "2"…:
- `"{formatBusinessTime} · {jobTypeLabel}"`, pill `VISIT_PILL`, customer name, unit label if any, appliances
  (`"{type} #{assetNumber}"`), notes, access notes (only when allowed).
- Buttons (big, thumb zone): **Directions** (`https://maps.google.com/?q=` + full address, new tab), **Call** (`tel:`
  when a phone is allowed), **Start** (SCHEDULED → existing `updateJobStatusAction(id, "IN_PROGRESS")`; toast
  "Started — {customer} has been marked as under way"), **Finish visit…** (IN_PROGRESS → `/desk/jobs/{id}#finish`),
  **Add photo** (existing upload field + `addJobPhotoAction`), **On my way** text (existing `job_on_the_way` family,
  only when texting is live and the person may text this customer — same rule as the visit page).
- A stop the person may not work (OWNER/ADMIN viewing "Everyone") shows the buttons disabled with the reason "Assigned
  to {name}" (KIT 6.5).
Empty: "Nothing on your route today" + (OWNER/ADMIN) "See the board".

**Offline (exact rules — AR-11's service worker never caches desk pages or data; this is the one deliberate
exception, kept on the device by the page itself):**
- On every successful render, the client component `RouteSnapshot` writes a JSON snapshot to **IndexedDB** database
  `desk-route`, store `snapshot`, key `today`: `{ v: 1, userId, dateKey, savedAt, stops: [{ id, time, type label,
  status label, customer name, address line, phone?, unit?, appliances[], notes? }] }` — exactly what is on the screen,
  nothing else (no money, no email addresses, no access notes; access notes stay online-only because they can contain
  door codes).
- When the page cannot load (the AR-11 offline page is shown for navigations) the offline page checks IndexedDB: if a
  snapshot exists for the signed-in `userId` (read from a non-secret `desk-user` value the app frame stores in
  `sessionStorage` on load) and `dateKey` = today in Denver, it shows **"Today's route (saved {time}) — you're
  offline"** with the stops read-only: Directions and Call still work (they are plain links), Start/Finish/Photo are
  hidden with the line "Changes are paused until you're back online."
- The snapshot is deleted: on sign-out (extend AR-11's sign-out cleanup: `indexedDB.deleteDatabase("desk-route")` in
  try/catch), when its `dateKey` is not today (checked on read and on every write), and when `userId` differs.
- IndexedDB access is wrapped in try/catch everywhere; private-mode browsers simply show the plain offline page.
- Tests: `tests/route-snapshot.test.ts` with `fake-indexeddb` (dev dependency pinned at the version current two weeks
  before the build date; record it in the PR) — write, read today, refuse yesterday, refuse other user, delete on
  sign-out, fields allowlist (a test that a snapshot never contains `@`, `$` or the access-notes field).
  `e2e/route-offline.spec.ts`: opt in to the service worker exactly as AR-11's offline test does, load My route, go
  offline, reload, see the saved stops and no Start button.

## 6. Visit record — `/desk/jobs/[id]` (same URL)

Data: everything the page loads today, unchanged (`getDeskJobById`, private location, team, parts, completion scope,
pending deliveries, waiver, W-24 fee data, substitutes). Run the five owner-only follow-up reads (`feeData`,
`feePolicy`, `providerFees`, waiver, substitute choices) inside one `Promise.all` after the first read instead of
one after another.

**Header** (`RecordHeader`): back "← Visits" (`/desk/jobs`; when `?from=board` "← Board"); eyebrow "Visit"; title
`"{jobTypeLabel(type)} for {customer}"`; pill `VISIT_PILL`; subtitle `visitWhen`; contact = phone (when allowed),
address. Overflow ⋯: "Print work order" (`/desk/jobs/{id}/work-order`), "Text the customer…", "Call", "Mark nobody
home…" (existing no-show flow, same permission as today).
**StatStrip:** "When" (`formatBusinessDate` + time, or "No time yet") · "Person" (name or "Not assigned", attention)
· "Length" · "Appliances" (count) · OWNER/ADMIN only "Rental" (link text "Open rental" when `agreementId`).
**Next step** (`visitNextStep(job, scope)`, pure, `src/domains/jobs/next-step.ts`): no time → "Set a time" (Schedule
sheet); no person and OWNER/ADMIN → "Choose who goes" (Schedule sheet); SCHEDULED and today → "Start the visit"
(form → `updateJobStatusAction(id, "IN_PROGRESS")`); IN_PROGRESS → "Finish the visit" (scrolls to `#finish`);
COMPLETED with `outcome = PARTIAL` → "Some items weren't done — a follow-up task was added" + "Open tasks"
(`/desk/tasks`); COMPLETED REMOVAL with a refundable deposit not refunded → "Settle the deposit" →
`/desk/billing/deposits/{depositId}` (OWNER/ADMIN; the deposit is the agreement's `Deposit` with `refundedAt` null);
else none.
**Tabs:** "Visit" (schedule panel, checklist, appliances and the completion form `#finish`, parts used for repairs,
W-24 fees, late-return waiver — the existing panels in today's order) · "Messages" (the existing text/call panels and
`ContextCommunicationPanel`) · "Activity" (`RecordConnections` + photos). Phone: sticky `ActionBar` with the next-step
action as primary.

## 7. Hand-offs after finishing a visit (toast + next-step card; no rule changes)

`completeJobAction` returns, in addition to `status: "success"`, `handoff: { type, outcome, startedBilling: boolean,
rentalClosed: boolean, depositId?: string }` built from `completeJob`'s existing result
(`handoffIds` → read their `kind`; `returnClose?.outcome === "CLOSED"`; the agreement's unrefunded deposit). The
form shows one toast:
| Situation | Toast | Toast action |
|---|---|---|
| DELIVERY/INSTALLATION COMPLETE and a `START_RECURRING_BILLING` hand-off | "Delivered. Monthly billing starts automatically." | "Open rental" |
| DELIVERY/INSTALLATION COMPLETE, no billing hand-off (prepaid or already running) | "Delivered." | "Open rental" |
| REMOVAL COMPLETE and rental closed, deposit waiting | "Picked up. The rental is closed — settle the deposit next." | "Settle deposit" |
| REMOVAL COMPLETE and rental closed, no deposit | "Picked up. The rental is closed." | — |
| REMOVAL COMPLETE, rental still has appliances out | "Picked up. Other appliances are still at the customer's." | "Open rental" |
| MAINTENANCE_VISIT COMPLETE | "Repair visit finished." | "Open repair request" (when linked) |
| any PARTIAL | "Saved. Some items weren't done — a follow-up task was added." | "Open tasks" |
A replayed completion (same `completionKey`) shows "Already saved." and no action. Staff toasts never mention money:
billing/deposit lines are replaced by "Delivered." / "Picked up." for STAFF. Unit-test the mapping (pure function
`handoffToast(handoff, role)`).

## 8. Repairs — `/desk/maintenance` and `/desk/maintenance/[id]` (same URLs)

**List params:** `status` = `open` (default: SUBMITTED, REVIEWING, SCHEDULED, IN_PROGRESS) | `new` (SUBMITTED) |
`fixed` (RESOLVED) | `closed` (CLOSED); `priority` = `urgent` | `high`; `q` (customer name, appliance number, problem
text contains); `sort` = `newest` (default) | `oldest` | `priority`; `cursor`. Old `?status=SUBMITTED` etc. map.
**Data** `getRepairRequests(params)` / `getRepairCounts(params)` in `src/domains/maintenance/list.ts` (cursor rule,
role check as today), selecting id, status, priority, openedAt, problem (first 120 chars only), customer name,
appliance (assetNumber, type name), and the next scheduled visit (`jobs` where SCHEDULED/IN_PROGRESS, `take: 1`).
**Layout:** `StatusTabs` "Open {n}", "New {n}" (hide 0), "Fixed", "Closed"; cards: customer · `"{type}
#{assetNumber}"` or "General" · problem excerpt · priority chip · pill · detail `"Reported
{relativeBusinessDay(openedAt)}"` + next visit `visitWhen` or "No visit yet" (attention when status is not New).
Row action: "Schedule a visit" (OWNER/ADMIN; SUBMITTED/REVIEWING with no open visit) → `/desk/jobs/new?maintenanceRequestId=`.
**Record:** `RecordHeader` "Repair request for {customer}", pills status + priority, subtitle `"{type} #{asset}"`;
StatStrip "Reported" · "Priority" · "Visits" (count) · "Photos" (count); next step: New → "Look at it" (form →
`updateMaintenanceStatusAction(id, "REVIEWING")`) or "Schedule a visit"; SCHEDULED → "Open the visit"; RESOLVED → "Close
it" (→ CLOSED); tabs "Problem" (full text, photos via the existing private read route), "Visits" (rows with
`visitTitle`/`visitWhen`/pill), "Messages" (existing panel). Status buttons use the existing transition graph (only
allowed transitions shown, labels from `REPAIR_PILL`).

## 9. Tests
- Unit: `tests/visit-words.test.ts` (labels, pills, no-show), `tests/visit-next-step.test.ts`,
  `tests/handoff-toast.test.ts`, `tests/schedule-params.test.ts` (old links map), `tests/route-snapshot.test.ts`.
- Throwaway Postgres: `tests/visits-list-integration.test.ts` (tabs, search by appliance number, cursor, order per tab),
  `tests/route-for-today-integration.test.ts` (staff sees own + unassigned only when the setting is on; owner mine vs
  everyone; tomorrow's visits absent), `tests/maintenance-role-check.test.ts` (refused without a team session),
  `tests/board-who-filter-integration.test.ts` (unscheduled capped at 51).
- Browser (add to a shard in `e2e/shards.json`): `e2e/schedule.spec.ts` — owner books a waiting visit from the Board
  sheet including the double-booked confirm; staff sees no schedule buttons; finish a delivery and see the billing
  toast; finish a pickup and see "Settle deposit"; `e2e/route-offline.spec.ts`. Axe and the five sizes
  (360×740, 390×844, 820×1180, 1280×800, 1920×1080), light/dark, keyboard.
- Add the pages to `docs/build-specs/migrated-pages.json`.
