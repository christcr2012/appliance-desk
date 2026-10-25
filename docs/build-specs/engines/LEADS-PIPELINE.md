# Engine spec — Leads pipeline: stages, who owns a lead, first contact, duplicates, scale (LD-1)

Built in **LD-1**. Design: `docs/designs/LEADS-WORKSPACE.md` sections 4 and 8 — **this spec corrects that design where
the code disagrees** (section 0). Screens are `screens/LEADS.md` (AR-4b). Roles: leads are OWNER/ADMIN only today
(`getLeadWorkspace` calls `requireRole("OWNER", "ADMIN")`); this card keeps that. Giving staff lead access would widen
access and needs Chris (owner checklist question below), so it is not built here.

## 0. Corrections to the design (checked against `main`, 2026-10-25)

1. **"New = no real contact yet" cannot use `lastRealContactAt`.** Both `createLead` (website form) and
   `createLeadManually` set `lastRealContactAt: new Date()` when the lead is created, and `addLeadNote` sets it for
   every note. Used as the design says, the "New" stage would always be empty. This spec adds a separate
   `firstContactedAt` that only an outbound contact sets (section 2). `lastRealContactAt` keeps its current meaning
   (win-back staleness) and its writers are not changed.
2. **One response-time setting, not two.** The app already has "answer new leads within N business days"
   (`getLeadResponseDays`, recommended 0 = same day), which drives the `NEW_LEAD_CONTACT` due date. The design's new
   "15 minutes" setting would compete with it. Decision: keep the existing setting as the only target. Speed to lead is
   *measured* (LD-4 insights) in minutes, not configured twice.
3. **Assignable people** are active OWNER and ADMIN users whose job role allows the `leads` screen
   (`jobRoleAllowsScreen`). Staff cannot open leads today, so they are never assignable.
4. **`updateLeadStatus` writes without a row lock or actor check, and the follow-up date is saved in a second,
   separate write** (`updateLeadStatusAction`). AGENTS section 4 requires `SELECT … FOR UPDATE` and
   `assertActiveTeamActor`. This card makes status + lost reason + follow-up one transaction (section 5).

## 1. Data (additive migration `20261026020000_leads_pipeline`)

```prisma
// Lead (add)
assignedToUserId   String?
assignedTo         User?     @relation("LeadAssignee", fields: [assignedToUserId], references: [id], onDelete: SetNull)
firstContactedAt   DateTime?
firstContactEstimated Boolean @default(false)   // true only for rows backfilled from history
phoneDigits        String?                      // digits only, maintained on every write of phone
emailLower         String?                      // trimmed lower-case email, maintained on every write
possibleDuplicateOfLeadId String?               // set at create when a match exists (section 4)
mergedIntoLeadId   String?                      // set when this lead was merged away (hidden from lists)
mergedAt           DateTime?
@@index([assignedToUserId, status, nextFollowUpOn])
@@index([status, createdAt])
@@index([createdAt])
@@index([phoneDigits])
@@index([emailLower])
@@index([mergedIntoLeadId])

// LeadNote (add)
kind String @default("NOTE")   // "NOTE" | "CONTACTED" | "ATTEMPT"

// BusinessSettings (add)
leadAssignmentMode   String  @default("OWNER")   // "OWNER" | "PERSON" | "ROTATE"
leadAssignmentUserId String?                     // used when mode = PERSON
leadRotationCursor   String?                     // last user id given a lead in ROTATE mode
```
User model: add the back-relation `assignedLeads Lead[] @relation("LeadAssignee")`.

Migration SQL also (all additive, idempotent):
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
UPDATE "Lead" SET "phoneDigits" = NULLIF(regexp_replace("phone", '\D', '', 'g'), '');
UPDATE "Lead" SET "emailLower" = NULLIF(lower(trim("email")), '');
-- History: leads already past NEW were contacted at some point; the best record we have is lastRealContactAt.
UPDATE "Lead" SET "firstContactedAt" = "lastRealContactAt", "firstContactEstimated" = true
  WHERE "status" <> 'NEW' AND "firstContactedAt" IS NULL AND "lastRealContactAt" IS NOT NULL;
-- New leads get an owner: the business owner (the oldest active OWNER user).
UPDATE "Lead" SET "assignedToUserId" = (SELECT "id" FROM "User" WHERE "role" = 'OWNER' AND "archivedAt" IS NULL ORDER BY "createdAt" ASC LIMIT 1)
  WHERE "assignedToUserId" IS NULL AND "status" IN ('NEW','CONTACTED');
CREATE INDEX IF NOT EXISTS "Lead_contactName_trgm" ON "Lead" USING gin ("contactName" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Lead_companyName_trgm" ON "Lead" USING gin ("companyName" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Lead_city_trgm" ON "Lead" USING gin ("city" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Lead_emailLower_trgm" ON "Lead" USING gin ("emailLower" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Lead_phoneDigits_trgm" ON "Lead" USING gin ("phoneDigits" gin_trgm_ops);
```
Declare the trigram indexes in `schema.prisma` too, so Prisma does not try to drop them:
`@@index([contactName(ops: raw("gin_trgm_ops"))], type: Gin, map: "Lead_contactName_trgm")` (and the other four).
(`User.role`, `User.archivedAt` and `User.createdAt` exist with these names — checked 2026-10-25.) Run `npx prisma migrate diff` against the migration to confirm no drift.

`phoneDigits`/`emailLower` are written by a single helper `leadContactKeys({ phone, email })` in
`src/domains/leads/keys.ts`, called by `createLead`, `createLeadManually`, `addLeadEmailAction`'s domain function and
any other `lead.update` that changes `phone` or `email` (grep `phone:` / `email:` inside `lead.update` / `lead.create`).
A test greps the leads domain and fails if a lead write sets `phone` or `email` without the helper's keys.

## 2. Stages (pure, `src/domains/leads/stage.ts`)

```ts
export type LeadStage = "new" | "contacted" | "quoted" | "won" | "lost";
export function leadStage(l: { status: LeadStatus; firstContactedAt: Date | null;
  openQuote: boolean /* an estimate SENT or VIEWED */ }): LeadStage
export const leadStageWhere: Record<LeadStage, Prisma.LeadWhereInput>   // the same rules as database filters
```
Rules (first match): CONVERTED → won; LOST → lost; open quote → quoted; NEW and `firstContactedAt` null → new;
otherwise → contacted. All list/count queries add `mergedIntoLeadId: null`. Unit-test the table and that
`leadStageWhere[x]` selects exactly the leads `leadStage` puts in x (integration test over a fixture of 20 leads).

**First contact** — `markFirstContactInTx(tx, leadId, at)` in `src/domains/leads/contact.ts` sets
`firstContactedAt = at` only when it is null (one `updateMany` with `firstContactedAt: null` in the where). Called by:
- `recordLeadMessageContactInTx` and the `workflow-text.ts` ACCEPTED branch (outbound messages actually handed over);
- the new "Log a contact" action (LeadNote `kind: "CONTACTED"`);
- `updateLeadStatus` when the new status is CONTACTED;
- **not** by `createLead`, `createLeadManually`, plain notes (`kind: "NOTE"`) or attempts (`kind: "ATTEMPT"`).
`NEW_LEAD_CONTACT` (lead-turning-points.ts) changes its `where` from `{ status: "NEW" }` to
`leadStageWhere.new` (NEW and never contacted) — same due date rule.

## 3. Who owns a lead

`src/domains/leads/assignment.ts`:
```ts
export async function assignableLeadOwners(tx): Promise<{ id: string; name: string }[]>   // section 0.3, ordered by createdAt, id
export async function chooseOwnerForNewLeadInTx(tx, now): Promise<string | null>
export async function reassignLead(actorId: string, leadId: string, toUserId: string | null): Promise<void>
```
- `chooseOwnerForNewLeadInTx`: locks the settings row (`SELECT … FROM "BusinessSettings" WHERE id='singleton' FOR
  UPDATE`). OWNER mode → the oldest active OWNER; PERSON → `leadAssignmentUserId` if still assignable, else fall back
  to OWNER mode; ROTATE → the next assignable person after `leadRotationCursor` in the ordered list (wrap around;
  skip people no longer assignable), then save the cursor. Called inside `createLead` and `createLeadManually`
  transactions (move their create into a transaction if it is not one).
- `reassignLead`: OWNER/ADMIN; `SELECT … FOR UPDATE` the lead; `assertActiveTeamActor`; target must be assignable or
  null ("Unassigned"); audit `lead.assign` with old/new; revalidate the leads pages. Admins may reassign any lead
  (same as today: admins see all leads).
- Settings: "New leads go to" — option cards "Me" (starting value, "You get every new lead."), "One person" (+ a
  select of assignable people), "Take turns" ("Each new lead goes to the next person, in order."). OWNER only; audited
  `settings.lead_assignment`. Lives in Settings › Sales (AR-8 places it; until then on the existing settings page
  next to the lead response setting).
- Tests: OWNER/PERSON/ROTATE choices; rotation fairness over 9 leads and 3 people; a removed person is skipped;
  concurrent creates in ROTATE give different people (two transactions, settings row lock); reassign refused for a
  staff target.

## 4. Duplicates and merge

- **Flag at create** (website and manual): inside the create transaction, look for another lead (not merged, not
  CONVERTED) or a customer with the same `phoneDigits` (≥ 7 digits) or `emailLower`. If a lead matches, set
  `possibleDuplicateOfLeadId` to the oldest match. If only a customer matches, write an audit `lead.matches_customer`
  with the customer id (shown on the lead page as "This may be an existing customer"). The lead is always created.
- **Merge** `mergeLeads(actorId, keepId, mergeId)` in `src/domains/leads/merge.ts`, OWNER/ADMIN:
  1. One transaction. Lock both lead rows in id order (`SELECT … FOR UPDATE … ORDER BY id`). `assertActiveTeamActor`.
  2. Refuse when: same id; either is CONVERTED or already merged; either has an estimate that is APPROVED or
     converted (`customerId` set).
  3. Move children from `mergeId` to `keepId`: `LeadNote`, `LeadApplianceRequest`, `Estimate`, `StaffTask`,
     `ContactBinding`, `ConsentRecord`, `CommunicationThread` (all `leadId`), and `MessageDelivery` rows where
     `recipientType = "Lead"` and `recipientId = mergeId`, and **`CommunicationLink` rows with `entityType = Lead` and
     `entityId = mergeId`** (workflow-text history and the recent-duplicate check in
     `src/domains/messaging/workflow-text.ts` read these). Because of `@@unique([messageId, entityType, entityId])`,
     first find links whose `messageId` is already linked to `keepId` — those are exact duplicates of a link the kept
     lead already has; remove only those duplicate link rows (the message itself is untouched) — then `updateMany` the
     rest to `entityId = keepId`. Count both in the `lead.merge` audit. Test: after a merge the kept lead's text
     history shows the merged lead's texts, and sending the same text again inside the repeat window still warns. These are every table that points at a lead today
     (checked 2026-10-25); a test reads `schema.prisma` and fails if a new `leadId` column appears that merge does not
     move.
  4. Kept lead: keep its own contact fields; fill only empty ones from the merged lead (email, company, address,
     city, zip, best time, how heard, desired term/start, notes appended with "From merged lead: …");
     `firstContactedAt` = the earlier of the two; `lastRealContactAt` = the later; `score` recomputed with the
     existing scoring function; `nextFollowUpOn` = the earlier non-null.
  5. Merged lead: `mergedIntoLeadId = keepId`, `mergedAt = now`, `status = LOST`, `lostReason = "Merged into another
     lead"`, `possibleDuplicateOfLeadId = null`. Its page shows "This lead was merged into {name}" + link.
  6. Clear `possibleDuplicateOfLeadId` on the kept lead if it pointed at the merged one. Audit `lead.merge` on both.
  Consent is never combined or rewritten — the rows move with their original dates and sources.
- **A merged lead can't be converted, quoted or edited.** `canConvertLead` (`src/domains/leads/index.ts`) gains
  `mergedIntoLeadId === null` as a condition, and `convertLeadToCustomerInTx` re-reads the lead **after** its row lock
  and refuses a merged one with "This lead was merged into {name}. Open that lead instead." The same locked check goes
  into every lead write (status change, notes, follow-up date, estimate create from a lead). Regression test: open the
  convert form, merge the lead in another session, submit the stale form → refused, no customer created.
- Tests: every child kind moves; consent rows keep their timestamps; refused cases; two people merging the same pair
  at once → one succeeds, one gets "This lead changed. Refresh and try again."; merged leads never appear in lists,
  counts, search or To do.

## 5. Status changes, one transaction

`updateLeadStatus(userId, leadId, status, lostReason?, followUpOn?)` becomes: one `prisma.$transaction`; `SELECT
"id" FROM "Lead" WHERE "id" = $1 FOR UPDATE`; `assertActiveTeamActor(tx, userId, ["OWNER","ADMIN"])`; refuse
CONVERTED/merged leads; set status, lost reason and `nextFollowUpOn` (only for CONTACTED; null otherwise) in **one**
update; `markFirstContactInTx` when CONTACTED; audit `lead.status` as today (plus `nextFollowUpOn` in newValue).
`updateLeadStatusAction` calls it once and no longer calls `setLeadFollowUp` separately. Update the unit fakes
(AGENTS section 4: `$queryRaw`, the same `tx` calls, `$transaction` handing the callback that `tx`).

## 6. List, counts and search (used by LEADS.md)

`src/domains/leads/queue.ts`:
```ts
export type LeadQueueParams = { stage?: LeadStage; q?: string; owner?: "me" | "unassigned" | string;
  source?: string[]; area?: "in" | "out"; highValue?: boolean; appliance?: string[]; created?: DatePreset;
  hasQuote?: boolean; sort: "next-up" | "newest" | "score" | "value" | "activity"; cursor?: string };
export async function getLeadQueue(p: LeadQueueParams, now: Date): Promise<{ rows: LeadRow[]; nextCursor: string | null; capped: boolean }>
export async function getLeadStageCounts(p: Omit<LeadQueueParams, "stage" | "sort" | "cursor">): Promise<Record<LeadStage, number>>
```
- Search `q` (≥ 2 characters): digits-only input of ≥ 4 digits → `phoneDigits LIKE %q%`; otherwise `contactName
  ILIKE %q%` OR `companyName ILIKE` OR `city ILIKE` OR `emailLower LIKE lower(q)%`. The trigram indexes make
  `ILIKE '%…%'` fast. Use Prisma `contains` + `mode: "insensitive"` (it produces ILIKE).
- **"Next up" order** (design section 5) as one SQL `ORDER BY` with a computed rank, via `prisma.$queryRaw` with
  parameters only (no string building): rank 1 = CONTACTED with `nextFollowUpOn` before today (Denver), oldest first;
  2 = stage new, oldest `createdAt` first; 3 = follow-up due today; 4 = quoted, oldest open quote `Estimate.sentAt` first (`Estimate` has `sentAt`, `viewedAt`, `respondedAt`;
  "open quote" = status `SENT` or `VIEWED`);
  5 = everything else by `score` desc. Cursor = `{ rank, key, id }`. Other sorts use plain Prisma ordering with the
  KIT 5.1 cursor rule.
- Row fields: id, contactName, companyName, city, isBusiness, isPropertyManager, isHighValue, score, scoreReasons,
  stage, assignedTo (id, name initials), phone, email, nextFollowUpOn, createdAt, firstContactedAt,
  applianceSummary (`summarizeApplianceRequests`), desiredTerm, openQuote (status, sentAt, viewedAt), monthlyValueCents
  (sum of the newest open quote's monthly lines; null if none).
- Counts: one `groupBy` is not possible for a derived stage; use 5 `count` calls with `leadStageWhere` in
  `Promise.all`.
- Capacity test `tests/perf/leads-queue.perf.test.ts` (added to the existing Performance Baselines job): seed 50,000
  leads in throwaway Postgres; list, counts and search each under 150 ms on the CI database (record the measured
  times in the test output; the 0.25 CU production figure is checked on the owner row only if Chris wants it).

## 7. Owner checklist question (once)
"**Should staff be able to see and work leads?** Today only you and admins can. If yes, the agent adds a 'Leads'
screen to staff job roles (you choose per role) and staff can be given leads. Recommendation: no for now — answer
when you hire someone who sells." This blocks nothing.

## 8. Tests summary
`tests/lead-stage.test.ts`, `tests/lead-stage-integration.test.ts`, `tests/lead-assignment-integration.test.ts`,
`tests/lead-merge-integration.test.ts`, `tests/lead-status-tx.test.ts` (fakes) + integration,
`tests/lead-keys.test.ts`, `tests/leads-queue-integration.test.ts` (Next-up order table, cursor once-each, search by
phone digits/name/email), `tests/perf/leads-queue.perf.test.ts`, migration passes `scripts/check-migrations.mjs`.
