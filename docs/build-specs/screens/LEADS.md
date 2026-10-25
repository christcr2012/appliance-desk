# Screen spec — Leads: the work queue and the lead record

Built in **AR-4b** (replaces design units LD-2 and LD-3). Needs **LD-1** (`engines/LEADS-PIPELINE.md`) merged first:
stages, owner, first contact, duplicates, queue query. Roles: OWNER and ADMIN only (unchanged). Kit: KIT.md.
**No lead rule changes** beyond LD-1: every button calls an existing (or LD-1) server action.

## 1. Fixes found while specifying (do them here)
- The lead page lists quotes as `Estimate #{n} · {e.status}` (stored codes like "VIEWED"). Use the word **quote** and
  the plain status words in section 3.5.
- The page header carries a status sentence as a description; quiet screens: remove it (the stage pill and next step
  say it).

## 2. Leads queue — `/desk/leads` (same URL)

**Params** (`src/app/desk/leads/params.ts`, zod) = `LeadQueueParams` (LD-1 section 6) as URL params: `stage` (`new`
default when count > 0, else `contacted`; values new, contacted, quoted, won, lost), `q`, `owner` (`me`, `unassigned`,
or a user id), `source` (multi, values = distinct `howHeard` values — load the list with one `findMany distinct`),
`area` (`in`, `out`), `high` (`1`), `appliance` (multi, appliance type ids), `created` (date presets), `quote` (`1`),
`sort` (`next-up` default, `newest`, `score`, `value`, `activity`), `cursor`. **Old links:** `?status=NEW|CONTACTED|
CONVERTED|LOST` → stage new/contacted/won/lost; `?view=awaiting-reply` → stage quoted; `?view=no-next-task` →
stage contacted + sort next-up; `?page=` ignored.

**Layout (phone, KIT 5.1):**
1. `ScreenHeader` "Customers" (area title); ⋯: "Export leads (CSV)" (new route `/desk/leads/export` returning the
   current filtered list as CSV — same columns as the desktop table, OWNER/ADMIN, max 10,000 rows, built like the
   existing customers export `ExportCsvLink` uses), "Lead settings" (the settings section that holds response time and
   assignment).
2. `StatusTabs` "Lead stage": "New {n}", "Contacted {n}", "Quote sent {n}", "Won", "Lost".
3. `Toolbar`: search "Name, phone, email or city"; filters Owner (select: Me, Unassigned, each assignable person),
   How they heard (multi), Service area (In area / Out of area), High value (toggle), Appliances (multi), Created
   (date presets), Has a quote (toggle); sorts "Next up", "Newest", "Highest score", "Biggest monthly value", "Last
   activity"; built-in views (AR-12 `leads`): "New", "Follow up today", "My new leads" ({stage:new, owner:me}),
   "Property managers" ({…, pm: 1} — add `pm` to the params).
4. Cards: title = contact name (company under it when a business; "Property manager" chip when set) · line 2 =
   `"{city} · {applianceSummary}{ · desiredTerm words}"` (term words: `month-to-month` "Month to month", `6-month`
   "6 months", `12-month` "12 months") · right: stage pill + score badge (`score` with InfoTip listing `scoreReasons`
   one per line, glossary `"lead-score"`) and "High value" chip · **next step line** (pure `leadNextStep(row, now)`
   in `src/domains/leads/next-step.ts`, first match):
   | Condition | Text | Tone |
   |---|---|---|
   | stage new | `"Call — waiting {relative age}"` (e.g. "waiting 2 h", "waiting 3 days") | attention when past the response-days target (`addBusinessDays(createdAt, responseDays)` < now), else info |
   | follow-up date before today | `"Follow up — {n} day(s) overdue"` | attention |
   | follow-up today | "Follow up today" | info |
   | quoted and viewed | `"Quote viewed {relativeBusinessDay(viewedAt)} — follow up"` | info |
   | quoted, not viewed | `"Quote sent {relativeBusinessDay(sentAt)}"` | neutral |
   | follow-up later | `"Follow up {formatShortDate(nextFollowUpOn)}"` | neutral |
   | won | "Became a customer" | good |
   | lost | `lostReason` (first 60 chars) | neutral |
   | otherwise | "Set a follow-up date" | neutral |
   · owner initials circle (title = owner name; "Unassigned" outline circle) · actions: **Call** (`tel:`, primary when
   stage new or follow-up due), **Email** (`mailto:` when email), ⋯ (row actions below). Text appears only when texting
   to customers is live and the lead has consent — use the existing check the lead page's `SendTextPanel` uses
   (render the menu item "Send a text…" only if that panel would allow sending).
5. Fab "Add lead" → `/desk/leads/new`.
6. Empty states: new "No new leads waiting." + "Add lead"; other stages "No leads here"; filtered "No leads match" +
   "Clear filters".

**Row actions (⋯):** "Set follow-up…" (Sheet: date picker default `defaultFollowUpKey(now)`, submit → LD-1
`updateLeadStatus(…, "CONTACTED", …, followUpOn)` via the existing `updateLeadStatusAction` with the follow-up key;
optimistic per AR-11 with Undo restoring the old date), "Assign to…" (Sheet: select of assignable people + Unassigned
→ `reassignLeadAction` (new thin action over LD-1 `reassignLead`)), "Log a contact…" (Sheet: kind "I reached them" /
"Tried, no answer" + note → new `logLeadContactAction` creating a LeadNote with kind CONTACTED/ATTEMPT; CONTACTED also
sets stage contacted per LD-1), "Mark lost…" (Sheet: reason select from the existing list in
`lead-actions-panel.tsx` — "Too expensive", "Went with a competitor", "Outside our service area", "Never heard back
after contacting them", "Changed their mind / no longer needed" — move it to `src/domains/leads/lost-reasons.ts` so
both screens share it; plus "Other" free text → existing `updateLeadStatusAction(id, "LOST", reason)`),
"Convert to customer" (ConfirmDialog "Make {name} a customer?" summary "This creates their customer record and
account. Their notes and quotes stay linked." → existing `convertLeadAction`; on success go to the new customer page).

**Desktop:** columns ☐ · Name · Wants · Stage · Score · Next step · Owner · Created · ⋯; row click opens the
`SidePanel` with the lead record's header, next step and activity (section 3) and "Open full page". **Bulk actions**
(multi-select bar): "Assign to…", "Set follow-up…", "Mark lost…" (one reason for all), "Export selected (CSV)". Each
bulk action loops over the existing single-lead domain functions in one server action
`bulkLeadAction(kind, ids, payload)` that runs each id in its own transaction, collects per-id errors and returns
`{ done, failed: { id, message }[] }`; toast `"Updated {done} leads"` (+ `" · {n} couldn't be changed"` with a
"Show" link listing them). Max 200 ids per call. **Board view** toggle (`?layout=board`, desktop only): columns New,
Contacted, Quote sent (cards = same as phone cards, compact); drag New → Contacted calls the CONTACTED status action;
any column → Lost opens the Mark lost Sheet; Quote sent and Won accept no drops (they move only by sending a quote or
converting) — the drop target shows "Send a quote to move here" / "Convert to move here" while dragging. Keyboard
alternative: each card's ⋯ has the same moves (drag is never the only way).

## 3. Lead record — `/desk/leads/[id]` (same URL)

Data: what the page loads today (`getLeadById`, `getTasksForLead`, `getLeadEstimates`, `getMessageHistory("Lead")`,
communication timeline) + LD-1 fields (stage, owner, firstContactedAt, possibleDuplicateOf (id, name), merged into
(id, name)) + `leadNextStep`.

**3.1 Header** (`RecordHeader`): back "← Leads"; title contact name (+ company); pills: stage pill, "High value" when
set; subtitle `"{city} · came in {formatShortDate(createdAt)} · {howHeard words}"`; contact phone/email; owner shown as
`"Owner: {name}"` with ⋯ "Change owner…".
**3.2 Stage stepper** (kit `Stepper`, read-only): New → Contacted → Quote sent → Won (Lost shown as a red pill instead
of the stepper).
**3.3 Next step card** (always one for open leads) = `leadNextStep` with buttons:
| Stage / condition | Buttons |
|---|---|
| new | "Call" (`tel:`), "Log a contact…" |
| contacted, no quote | "Send a quote" (→ `/desk/estimates/new?leadId={id}`, section 3.6), "Set follow-up…" |
| quoted | "Open the quote" (`/desk/estimates/{id}` of the newest open quote), "Set follow-up…" |
| follow-up due | "Call", "Log a contact…", "Set follow-up…" |
| won | "Open customer" (`/desk/customers/{convertedCustomerId}`) |
**3.4 Banners** (one line each, attention): possible duplicate → "This may be the same person as {name}." + "Compare
and merge…" (Sheet: two columns of the main fields, choose which lead to keep (default the older), ConfirmDialog
"Merge these leads?" summary "Notes, quotes, tasks, messages and consent move to the lead you keep. This can't be
undone." → `mergeLeadsAction(keepId, mergeId)` over LD-1 `mergeLeads`); merged → "This lead was merged into {name}."
+ "Open {name}"; customer match (audit `lead.matches_customer`) → "This may be an existing customer." + "Open
customer".
**3.5 Tabs:** "Activity" (phone default; desktop right column) = composer at top ("Add a note" / "Log a contact"
segmented control, textarea, Save → `addLeadNoteAction` for NOTE, `logLeadContactAction` for CONTACTED/ATTEMPT),
then the existing `LeadCommunicationTimeline` + notes + `MessageHistoryPanel` merged into one `Timeline` sorted
newest first (if merging the three sources is not cheap, render them as three stacked groups "Messages", "Notes",
"Calls and texts" — say which in the PR); "What they want" (read rows: appliances, term, start date, how many, address + "In area"/"Out of area",
best time, how they heard, notes; an "Edit" button opens a Sheet form → `updateLeadDetailsAction`, section 3.7); "Quotes" (list: `"Quote #{estimateNumber}"` · status word (DRAFT "Draft", SENT "Sent", VIEWED "Viewed",
APPROVED "Approved", CHANGES_REQUESTED "Changes asked", DECLINED "Declined", EXPIRED "Expired", CONVERTED "Became a
rental") · `formatShortDate(sentAt ?? createdAt)` → `/desk/estimates/{id}`; "New quote" button as in 3.3); "Tasks"
(existing `LinkedTasksPanel`).
**Closing actions** (header ⋯ for open leads): "Convert to customer" (same ConfirmDialog as the queue), "Mark lost…",
"Send a text…" (existing `SendTextPanel` Sheet, same props), "Call log…" (existing `CallPanel` Sheet), "Add a task".

**3.6 Quote for an existing lead (missing today).** Today a quote can only be started for an existing *customer*
(`/desk/estimates/new?customerId=`) or together with a *brand-new* lead (`createEstimateDraftForNewLead`); there is
no way to quote a lead that already exists. Add:
- `createEstimateDraftForLead(userId, leadId, estimateInput: NewEstimateForLeadInput)` in
  `src/domains/estimates/index-base.ts`: one transaction; `SELECT … FROM "Lead" … FOR UPDATE`;
  `assertActiveTeamActor(tx, userId, ["OWNER","ADMIN"])`; refuse CONVERTED, LOST or merged leads ("This lead is
  closed. Reopen it or use the customer's record."); create the estimate with `leadId` exactly like
  `createEstimateDraftForNewLead` does (same fields, same `estimate.create` audit row in the same transaction).
- `/desk/estimates/new` accepts `?leadId=`: the form shows "Quote for {contact name}" (read-only, link to the lead)
  instead of the customer picker / new-lead fields, prefills the title `"{applianceSummary} · {term words}"`, and
  submits to a new `createEstimateForLeadAction` → the function above → redirect to the quote page (same as today's
  flows). `customerId` and `leadId` together → `leadId` is ignored.
- While here, make `createEstimateDraftForNewLead` one transaction too (today the lead is created, then the estimate in
  a separate write, so a failure leaves a lead without its quote): move both creates and the audit row into one
  `prisma.$transaction`, passing `tx` into the lead creation (add a `tx` parameter to `createLeadManually`'s inner
  create; keep its public signature working).
- Tests: integration for each refusal, the audit row, the one-transaction rollback (force the estimate insert to fail →
  no lead left), and the form's prefill.

**3.7 Editing what a lead wants (missing today).** There is no lead edit action (`lead.update` is only used for status
and follow-up). Add `updateLeadDetailsAction(leadId, input)` + `updateLeadDetails` in `src/domains/leads/index.ts`:
zod schema for contactName, companyName, isBusiness, isPropertyManager, phone, email, bestTimeToContact, howHeard,
desiredTerm (`month-to-month` | `6-month` | `12-month` | empty), desiredStartDate, quantity (1–50), addressLine1,
city, zip, notes (same limits as `newLeadSchema` / `leadFormSchema`); one transaction, row lock, actor check, refuse
CONVERTED/merged; write `leadContactKeys` (LD-1); recompute `inServiceArea` with the same function `createLead` uses
when zip/city change, and the score with `scoreLead` + the current policy (store `scoringPolicyVersion`); audit
`lead.details` with only the changed fields (old/new). Appliance requests are edited in the quote, not here.
Tests: validation messages, audit diff, score recomputed, closed leads refused.

## 4. Words (exact)
"Leads", "← Leads", "New", "Contacted", "Quote sent", "Won", "Lost", "Name, phone, email or city", "Owner", "How they
heard", "Service area", "In area", "Out of area", "High value", "Appliances", "Created", "Has a quote", "Next up",
"Newest", "Highest score", "Biggest monthly value", "Last activity", "Add lead", "No new leads waiting.", "No leads
here", "No leads match", "Clear filters", "Call", "Email", "Send a text…", "Set follow-up…", "Assign to…", "Log a
contact…", "I reached them", "Tried, no answer", "Mark lost…", "Convert to customer", "Make {name} a customer?",
"Unassigned", "Owner: {name}", "Change owner…", "Compare and merge…", "Merge these leads?", "Became a customer", every
next-step text and quote status word above. Glossary `"lead-score"` { "Score", "How likely this lead is to rent,
from what they asked for. The reasons are listed here." }.

## 5. Tests
- `tests/leads-params.test.ts`: defaults, legacy `status`/`view` mapping.
- `tests/lead-next-step.test.ts`: every row of both next-step tables, response-days target across a weekend.
- `tests/lead-bulk-integration.test.ts`: per-id transactions, partial failure reporting, 200-id cap, admin/staff rules.
- `tests/lead-contact-log-integration.test.ts`: CONTACTED sets firstContactedAt once; ATTEMPT and NOTE do not.
- `e2e/leads.spec.ts`: stage tabs and counts; Call/Email buttons; set follow-up with Undo; mark lost with reason;
  convert through the confirmation lands on the customer; merge two seeded duplicates; board drag New → Contacted and
  the keyboard alternative; axe + 5 sizes.
