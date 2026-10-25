# Leads workspace — a real sales pipeline that still works at 10,000 leads (Batch LD)

Status: **designed 2026-10-25 at Chris's request; not built.** Units LD-1…LD-4 in `work-index.json` (execution cards
written when each starts). Texting stays dormant until Chris switches it on (AGENTS section 1); everything else is
ordinary source work. Follows the "quiet screens" rule in [DESIGN-SYSTEM.md](../DESIGN-SYSTEM.md).

## 1. The problem (Chris, 2026-10-25)

> "This page's links were upgraded to look like buttons, but the page still looks like a jumbled mess … does this look
> like a robust leads page that a major company uses? What happens if my company succeeds and scales massively? …
> I can't have you filling up my screens with explanations, guidance, and directions … maybe a small informational
> icon that can be clicked … tool tips."

## 2. What exists today (checked against `main`, 2026-10-25)

- `/desk/leads`: page title, a sentence of explanation, "Add a lead", **two rows of filter chips** (status: All / New /
  Contacted / Converted / Lost; view: All next actions / Quote awaiting reply / No next task), a search box with its
  own "Search leads" button, then cards showing `NEW · Score 42`, source, and the latest note/task/quote. Fixed sort:
  score, then newest. Page-number pagination. (`src/app/desk/leads/page.tsx`, `src/domains/leads/workspace.ts`)
- Data already there: contact details, what they want (term, start date, quantity, appliances), address and service
  area, score + reasons + high-value flag, `lastRealContactAt`, `nextFollowUpOn`, lost reason, notes log, staff tasks,
  estimates (with SENT/VIEWED), communication timeline, conversion to customer. To do already has `NEW_LEAD_CONTACT`
  and `LEAD_FOLLOW_UP`.
- Missing for a serious pipeline: a stage for "quote sent", **who owns the lead**, how long a new lead has waited,
  one-tap call/text/email from the list, sorting choices, bulk actions, duplicate detection, conversion numbers, and
  indexes/search that hold up with large numbers of leads.

## 3. Quiet-screen rules applied here

- **One line at most under a page title** — usually none. No paragraphs of guidance.
- **Explanations live behind an ⓘ** using the existing `InfoTip` (glossary entries in `src/lib/glossary.ts`), e.g.
  next to "Score", "Speed to lead", "Pipeline value".
- **Filters live in one place:** stage tabs with counts across the top, everything else in a single "Filter" sheet.
  Active filters show as small removable chips; no permanent walls of chips.
- **The list tells you what to do next**; the screen does not.
- **Empty states are one line plus one button** ("No leads waiting. Add a lead").

## 4. LD-1 — Pipeline stages, ownership and scale foundations

**Stages** (what the owner sees), computed from existing data so nothing is re-entered:

| Stage | Rule |
|---|---|
| New | `status = NEW` and no real contact yet |
| Contacted | `CONTACTED`, or any real contact recorded, and no open quote |
| Quote sent | an estimate `SENT` or `VIEWED` and not converted |
| Won | `CONVERTED` (links to the customer) |
| Lost | `LOST` (reason required, as today) |

The stored `LeadStatus` enum is unchanged; "Quote sent" is derived, so no backfill can be wrong. A pure
`leadStage()` function in `src/domains/leads` is the single definition, used by the list, counts, detail page,
insights and To do.

**Ownership.** Add `Lead.assignedToUserId` (nullable, OWNER/ADMIN/STAFF with lead access). Owner setting "New leads
go to": **me** (starting value — one-person business), a chosen person, or "take turns" (round-robin among active
people who can see leads). Reassign from the list or detail; audited; the new owner gets the To do item. Staff see
leads only if their job role allows it (ACC-5 "Office"); filtered on the server.

**Speed to lead.** Add `Lead.firstContactedAt` (set once, with the first real call/text/email/note marked as contact;
backfilled from `lastRealContactAt` where it is the only contact). Owner setting "Answer new leads within":
**15 minutes** during business hours (starting value), measured in business hours from the existing phone-hours
setting. `NEW_LEAD_CONTACT` turns urgent when the target passes.

**Scale.** Indexes: `(assignedToUserId, status, nextFollowUpOn)`, `(status, createdAt)`, `(createdAt)`; Postgres
`pg_trgm` GIN indexes on contact name, company, phone digits, email and city for fast "type to search" (Neon
supports the extension; migration `CREATE EXTENSION IF NOT EXISTS pg_trgm`). Stage counts from one grouped query.
The list switches to **cursor pagination** (stable at any size) with 50 rows per load and "Load more"/infinite scroll.
Target: list, counts and search each under 150 ms at 50,000 leads on the 0.25 CU database (proved by a capacity test
in `tests/perf`, added to the existing Performance Baselines job).

**Duplicates.** On create (website form or manual), find existing leads/customers with the same phone digits or email;
the lead is created and flagged "Possible duplicate of …" with one-tap **Merge** (moves notes, tasks, estimates,
messages and consent to the kept lead; audited; never merges converted customers automatically).

Tests (throwaway Postgres): stage rule table; round-robin fairness and skipping inactive people; staff without lead
access refused at query level; speed-to-lead in business hours across DST; duplicate flag + merge keeps every child
record and consent; cursor pagination returns each lead once under concurrent inserts; capacity baseline.

## 5. LD-2 — The work queue (the Leads screen)

**Header:** "Leads" · stage tabs with live counts — **New 4 · Contacted 7 · Quote sent 3 · Won · Lost** (All via a
menu) · search field that filters as you type (no separate button) · **Filter** · **Sort** · **+ Add lead**.

**Default sort "Next up"**, which is the workflow:
1. Follow-ups that are overdue, oldest first;
2. New leads not yet contacted, longest waiting first (shows "waiting 2 h", red past the target);
3. Follow-ups due today;
4. Quotes awaiting reply, oldest first;
5. Everything else by score.
Other sorts: Newest, Highest score, Biggest monthly value, Last activity.

**Each row (phone card / desktop table row)**, scannable in one glance:
- Name (company under it if a business) · city · "2 washers · 12 months"
- Stage pill · score badge with ⓘ (shows the score reasons) · "High value" mark when set
- **Next step with timing:** "Call — overdue 2 h", "Quote viewed yesterday — follow up", "Follow up Thu"
- Owner's initials
- One-tap **Call**, **Text** (hidden until texting is live and the lead consented), **Email**
- Swipe (phone) or row menu (desktop): Set follow-up · Assign · Mark lost · Convert

**Filter sheet:** owner (Me / anyone / unassigned), source ("how heard"), service area in/out, high value, appliance
type, created date range, has quote. Saved as a **saved view** using the O-7 saved-views mechanism (add `leads` to
`SAVED_VIEW_ROUTES`), e.g. "My new leads", "Property managers".

**Desktop extras:** sortable table columns, checkbox **bulk actions** (assign, set follow-up, mark lost with one
reason, export CSV), and a **Board** toggle (columns per stage, drag to move between New / Contacted / Lost;
"Quote sent" and "Won" move only through sending a quote or converting).

Tests/browser: Next-up order table test; search-as-you-type debounced and server-filtered; filters and saved views
round-trip; bulk actions audited and permission-checked; phone width, keyboard, axe; no explanatory paragraphs
(BA-6/quiet-screen guard).

## 6. LD-3 — Lead detail as a workspace

`/desk/leads/[id]`:
- **Header:** name, stage stepper (New → Contacted → Quote sent → Won), owner, score ⓘ, Call / Text / Email.
- **Next step card** (always one): e.g. "Call within 15 min", "Send a quote", "Follow up on the quote (viewed
  Tuesday)"; buttons do it (log call, start quote with their details pre-filled, set follow-up).
- **What they want:** appliances, term, start date, address with in/out of area — editable inline.
- **Activity:** the existing communication timeline + notes + tasks, newest first, one composer ("Add a note / log a
  call").
- **Quotes:** list with status; "New quote" pre-filled.
- **Convert to customer** and **Mark lost** (reason pick-list) as the two closing actions.
- Possible-duplicate banner with Merge (LD-1).

Tests: next-step rules; inline edits validated and audited; convert/lost paths unchanged in behavior; customer A/B
isolation unaffected.

## 7. LD-4 — Lead insights

A compact **Insights** tab on Leads (owner/admin): this month vs last — new leads, median **speed to lead**, quote rate,
win rate, **pipeline value** (monthly rent on open quotes), leads by source with win rate, top lost reasons, and a
12-week trend. Numbers only from recorded data; each metric has an ⓘ definition. No goals changes (O-5 stays).

Tests: metric definitions on fixed fixtures; business-hours math; numbers match the list filters.

## 8. Data changes (additive)

`Lead.assignedToUserId String?` (+ relation, index), `Lead.firstContactedAt DateTime?`, `Lead.duplicateOfLeadId
String?`, `Lead.mergedIntoLeadId String?`; `BusinessSettings.leadAssignmentMode String @default("OWNER")`,
`leadAssignmentUserId String?`, `leadResponseTargetMinutes Int @default(15)`; `pg_trgm` extension + GIN indexes;
saved-view route `leads`. Glossary entries: score, speed to lead, pipeline value, win rate, quote rate.

## 9. Build order

LD-1 (stages, ownership, scale, duplicates) → LD-2 (work queue) → LD-3 (detail) → LD-4 (insights). Each one complete
PR. LD-2 is the visible change; LD-1 must land first so the queue is built on the real rules and indexes.

## 10. Owner decisions

None required to build. Starting values Chris can change in Settings: new leads go to him; answer within 15 business
minutes; round-robin available when he hires. Texting from the list appears only after texting is live.
