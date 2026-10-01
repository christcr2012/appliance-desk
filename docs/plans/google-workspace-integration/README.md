# Google Workspace runtime integration (authorized 2026-09-30)

**Read this first.** This folder exists because the overhaul plan says Drive,
Calendar and mail integrations "stay conditional and require their own
authorized card before runtime sync is built." On 2026-09-30 Chris authorized
that work, in writing, after a full day of Google Workspace setup done with
Claude. This document is the authorized card's specification. The card itself
is **O32** in [`../overhaul/TASKS.md`](../overhaul/TASKS.md).

## Why this is here

Chris's goal for Appliance Desk is one system he runs the whole business
from, without bouncing to Google. Three things make that true:

1. Jobs appear on the Google calendar his phone already shows, and moving one
   there moves it in the desk.
2. Signed agreements, invoices and statements file themselves into Drive
   folders he can open from anywhere.
3. Every email to or from a customer shows on that customer's record, and he
   can reply from there as support@.

Everything Google-side is already in place as of 2026-09-30 (see "What
already exists"). This spec is the app-side half.

## When to focus on it

**Not yet.** Do this work only after all three are true:

1. **Overhaul Releases A and B are merged and verified** (O01, O02 and the
   daily-use cards through O11). The customer record tab (O07) is where the
   Messages tab lands; the Today screen (O06) is where calendar state shows.
   Building this earlier means building it twice.
2. **Chris has done the live walkthrough** of the existing system with test
   data (his "Stage 1: prove it"). Integration bugs are far harder to tell
   from core bugs when both are new.
3. **The connector-side prerequisites are done**: cards P4-1 through P4-3 in
   the `google-workspace-mcp` repo plan (`docs/plan/TASKS.md` there). They give
   the app the stable calendar and folder IDs and the delegation pattern.

The right moment is the start of what the Completion Plan calls **Stage 4**.
If an implementer is reading this during Release A–C work: note it, don't
start it. If Chris asks for it earlier, show him this section and ask once.

## What already exists (do not recreate)

| Thing | Value | Created |
| --- | --- | --- |
| Business mailbox | `ops@robinsonappliancerentals.com`, aliases chris@, leads@, support@, billing@, no-reply@, dmarc@ | 2026-09-27 / 09-30 |
| Send-as identities | chris@ (default, "Chris Robinson"), support@, billing@, ops@, all with the Evergreen signature | 2026-09-30 |
| Gmail labels + filters | Leads, Support, Billing, filtered by to: alias | 2026-09-30 |
| Business calendar | "Deliveries & Service", `America/Denver`, ID `c_dd214eeba2ec27ed60d341f7aed60beb32c7a883034f39be4153111ce846996d@group.calendar.google.com` | 2026-09-30 |
| Drive root | "Robinson Appliance Rentals" `13yNQodb3ELaaOwnjziqpolwHtVYbKLaJ` | 2026-09-30 |
| Drive subfolders | 01 Brand Kit `13wK6i7n_c0WFARlglC3-glM1f8jkwcQN` · 02 Customers `11bDit510A-4ixh9M4qmH4wZPog-_VPEg` · 03 Agreements (signed) `1CGtqQkv2chVccMYchnxWYFQ1SaJeyuNq` · 04 Invoices & Statements `1NchC9MD3Ye4KcOUoQNtEEyABwx0lhmea` · 05 Receipts & Expenses `164ROifSztV2fOb198y3KwIj_51Y4O204` · 06 Inventory & Appliance Photos `1DNb1-yFU2WflZneApP-aLTIikQIOnWFA` · 07 Legal & Insurance `18ozbbrhiSo8h4xzophgbD6lWoA5qBFuB` · 08 Marketing `1lSOjP4cnfsZiPapxT2-LY445iMjjNqXF` · 09 Taxes & Accounting Exports `121jD7vdNwNq5BhH7sKkcRfiCdNlGw_7L` | 2026-09-30 |
| Org unit | `/Robinson Appliance Rentals LLC` (the mailbox lives here) | 2026-09-30 |
| Email authentication | SPF, Google DKIM, Resend DKIM present; DMARC `p=none` added by Chris | 2026-09-30 |
| Pattern to copy | The connector's service account + domain-wide delegation, scoped to two Gmail-settings permissions | 2026-09-30 |

Treat these IDs as **defaults** in `BusinessSettings`, editable in
`/desk/settings`, never hard-coded.

## Identity and permissions

- **A separate service account for the app**, not the connector's. Name
  `appliance-desk-google`, created in Google Cloud by Chris (15 minutes; steps
  at the end). JSON key in the appliance-desk Vercel project as
  `GOOGLE_SERVICE_ACCOUNT_JSON`. Never committed.
- Domain-wide delegation entry in the Admin console for its client ID with
  **exactly** these three scopes:
  `https://www.googleapis.com/auth/calendar`,
  `https://www.googleapis.com/auth/gmail.readonly`,
  `https://www.googleapis.com/auth/gmail.send`.
  Drive uses the separate owner OAuth connection below. Read-only plus send, not
  `gmail.modify`, so the app can never delete or relabel mail.
- The app always impersonates `GOOGLE_IMPERSONATE_USER` =
  `ops@robinsonappliancerentals.com`. Refuse to start any sync if unset.
- One module, `src/lib/google.ts`: builds the JWT client, exposes
  `calendar()`, `gmail()` via delegation and `drive()` via owner OAuth,
  retries safe reads on 429/5xx with
  backoff (max 5); mutation retries follow their durable operation ledger,
  maps Google errors to plain English, and never logs credentials.
- Preview deployments: the existing preview-safety work (O02A) suppresses
  non-production email/SMS. Extend it: in non-production, Google sync runs in
  **dry-run** (logs the payload, writes nothing) unless
  `GOOGLE_SYNC_ALLOW_PREVIEW=1` is set for a deliberate test.

### Drive identity for the existing folders

Drive filing uses an owner-authorized OAuth web client with `drive.file`,
separate from the delegated Calendar/Gmail service account. In Settings, the
owner connects the rentals mailbox and uses Google Picker with that same OAuth
client to authorize the existing customer and document parent folders. Store
only those verified folder IDs and an encrypted refresh token server-side;
never expose it to client props, logs, audit payloads or previews. The Drive
worker uses that owner's refreshed OAuth token, not the service-account JWT.

Before enabling filing, verify each configured parent with `files.get`, then
create/read a synthetic child and its shortcut using this exact connection.
Reject an unselected or inaccessible parent and report it in Settings; folder
IDs alone, Drive sharing alone, or delegation alone do not satisfy this gate.
A revoked connection disables only Drive filing and preserves queued work.
Do not broaden to full-drive scope or recreate the existing business folders.
See [Google's scope guidance](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

## Feature 1 — Jobs ↔ Calendar (two-way, conservative)

**Schema (additive).** `Job.googleEventId String?`, `Job.googleCalendarId
String?`, `Job.googleSyncedAt DateTime?`, `Job.googleEtag String?`.
`BusinessSettings.googleCalendarId String?` defaulting to the ID above.

**App → Calendar (the app owns whether an event exists).** On job create,
reschedule, reassign, complete or cancel, enqueue a sync task (table
`GoogleSyncTask`: kind, targetId, attempts, lastError, nextAttemptAt). The
worker (daily cron plus an immediate attempt in the server action) creates or
patches the event: summary `"<JobType> · <Customer> · <City>"`, location =
service address, description = desk URL + appliance list + notes, times from
the job's schedule (default 2 h), `extendedProperties.private.applianceDeskJobId`.
Cancelled → event status `cancelled`. Completed → summary prefixed "✓ ".
Store `eventId` and `etag`. Existing-event writes must use the stored ETag
as a conditional precondition. On a version conflict, read the current event,
record the conflicting calendar and job revisions, then deliberately apply
the app-wins rule with the new precondition. Retry if it changes again; never
unconditionally overwrite a phone edit before recording the conflict.

**Calendar → App (time only).** Daily cron `/api/cron/calendar-sync` and a
Google push channel (`events.watch`, renewed weekly by the same cron) read
changed events carrying the private property. If start/end differ and the
event's `updated` is newer than `googleSyncedAt`, update the job's schedule and
write an `AuditLog` entry "Rescheduled from Google Calendar". Never create or
delete jobs from the calendar. If both sides changed since last sync, the app
wins and the conflict is logged.

**UI.** Job detail: "On Google Calendar ✓" linking to `htmlLink`, or "Not
synced: <plain reason>" with Retry. `/desk/settings` → Google: connection
status (impersonated mailbox name), calendar name, last sync, failures.

## Feature 2 — Documents → Drive

**Schema (additive).** `RentalAgreement.googleFileId`, `Invoice.googleFileId`,
`Customer.googleFolderId`, `BusinessSettings.googleDriveRootFolderId` plus the
four type-folder IDs (Customers, Agreements, Invoices & Statements, Inventory
Photos), defaulting to the IDs above.

**Behavior.** When an agreement is signed or an invoice/statement/work-order
PDF is generated, upload it to `02 Customers/<Customer name> (<id>)` (create on
first use, store `googleFolderId`) and add a shortcut in the matching type
folder. File name `YYYY-MM-DD <Type> <Number> - <Customer>.pdf`. Idempotent:
skip if `googleFileId` set. Failures never block the business action; they go
to `GoogleSyncTask` for retry.

**UI.** Document rows show a Drive icon linking to `webViewLink`.

## Feature 3 — Customer email history (read + send)

**Schema (additive).** `CustomerMessage`: customerId?, leadId?, direction
IN/OUT, gmailMessageId (unique), threadId, fromAddress, toAddresses[],
subject, snippet, sentAt, labelIds[], hasAttachments, bodyHtml? (lazy).
`BusinessSettings.gmailHistoryId String?`.

**Ingest.** Cron every 15 minutes `/api/cron/gmail-sync` via Gmail
`history.list` from the stored `historyId`; on first run or a 404 history gap,
fall back to `messages.list q=newer_than:2d`. A message is stored **only** if
From or To matches a `Customer.email`, a `CustomerContact.email`, or a
`Lead.email` (then stored as `LeadNote` kind EMAIL as well). Nothing else in
the mailbox is ever read into the database. Metadata and snippet by default;
body fetched when opened.

**Send.** From the customer record: composer sends via
`gmail.users.messages.send` **as `support@robinsonappliancerentals.com`**
(the send-as identity exists) with the Evergreen signature, threading on
`threadId` when replying. Before contacting Gmail, atomically record an O26 send intent, stable request
key, RFC Message-ID, payload and reserved rate-limit slot. Repeated submissions
return that same operation. Store confirmed sends as OUT with Gmail's ID and
write `AuditLog`. A timeout after submission is UNKNOWN, not a failed send:
retain the draft, reconcile sent mail by the stable Message-ID, and prohibit
another send until the outcome is resolved. Never blindly retry ambiguous
`messages.send` calls. Rate limit
50/day, a `BusinessSettings` value. Resend remains the sender for all
automated/transactional mail; Gmail is for human replies only.

**UI.** Customer record → Messages tab (this is O27's "communication
visibility", fed by Gmail instead of only by Resend events): timeline newest
first, direction badge, open-in-Gmail link, reply box. Lead record → same.

## PR sequence (one card each, follows AGENTS.md Definition of Done)

1. `google-identity` — `src/lib/google.ts`, env vars, Settings → Google
   status showing the impersonated mailbox, plus the separate Drive OAuth/Picker
   connection and access proof. No filing/sync features. Blocks everything.
2. `calendar-sync-out` — app → calendar, job detail link, dry-run in previews.
3. `calendar-sync-in` — cron + watch channel, time-only inbound, conflict log.
4. `drive-filing` — agreements and invoices, retry queue, Drive icons.
5. `gmail-ingest` — metadata ingest, Messages tab read-only, lead matching.
6. `gmail-send` — composer, send-as support@, audit log, rate limit.

Each PR: behavioral tests (payload builders, matcher, conflict rule, naming),
`docs/ARCHITECTURE.md` updated with new env vars and the delegation entry,
`docs/HANDOFF.md` entry, ledger row in `../overhaul/TASKS.md`.

## What Chris does once (15 minutes), before PR 1 merges

1. Google Cloud (the `robinsons-toolkit-mcp` project is fine): IAM & Admin →
   Service Accounts → Create `appliance-desk-google` → Keys → Add key → JSON.
   Copy its Unique ID.
2. admin.google.com → Security → Access and data control → API controls →
   Manage Domain Wide Delegation → Add new: that Unique ID, scopes
   `https://www.googleapis.com/auth/calendar,https://www.googleapis.com/auth/gmail.readonly,https://www.googleapis.com/auth/gmail.send`.
3. Vercel → appliance-desk → Environment Variables:
   `GOOGLE_SERVICE_ACCOUNT_JSON` (whole file), `GOOGLE_IMPERSONATE_USER`
   `= ops@robinsonappliancerentals.com`. Production only at first.
4. For Drive, create an OAuth web client restricted to the app's exact callback
   URL, enable Google Picker, and store its client ID/secret as server-side
   production configuration. Connect the rentals mailbox in Settings and select
   the existing parent folders with Picker. Verify folder access with the
   synthetic-file proof above; this is additional setup beyond delegation.
5. After PR 1 deploys, open `/desk/settings` → Google: it should show
   "Connected as Robinson Appliance Rentals".

## Related

- Connector plan: `google-workspace-mcp` repo, `docs/plan/` (P4 cards and the
  same spec under `APPLIANCE-DESK-INTEGRATION.md`).
- Chris's "Appliance Desk Completion Plan" (Claude doc), Stage 4.
- `../overhaul/CLAUDE-WORKSPACE-SETUP.md` GW-01–GW-14: most are now done;
  that register should be reconciled by O00/O31, not here.
