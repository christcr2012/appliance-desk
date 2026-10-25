# Build spec — App feedback box, people-only first (MCP-10a)

Card: `docs/pr-cards/MCP-10a.md`. Design: `docs/mcp/FEEDBACK.md` (full scope; this spec builds the part Chris
asked for first, 2026-10-25: "Human part first"). Owner, staff and customers report a problem with the app or
suggest an improvement; Chris (and admins) read and answer them inside the app. **No AI access in this unit**: every
report is stored `aiReview = HUMAN_ONLY` and no tool, export or API gives report content to an agent. The AI opt-in,
agent tools and repair tracking are MCP-11 and need MCP-3/4 first.

Read first: `docs/AI-PR-READ-FIRST.md` (it is a form open to signed-in customers, with file uploads). Depends on
AR-0a for kit components (if AR-0a is not merged yet, build the screens with today's desk components and add the
pages to `docs/build-specs/migrated-pages.json` only when converted).

## 1. Words (exact; feedback must never be confused with appliance repairs)
- Entry label everywhere: **"App feedback"**. Form title: **"Tell us about the app"**. Choice: "Something isn't
  working" (BUG) / "I have an idea" (IMPROVEMENT).
- Under the form title, always: "This is for problems with this website or app. **Appliance not working?** [Request a
  repair](/account/maintenance/new)" (customers) or "[Open repairs](/desk/maintenance)" (team).
- Privacy line above the submit button: "Chris and his team read these. Don't include passwords, card numbers or
  access codes."
- Reporter-facing state words: SUBMITTED "Received", TRIAGED "Being looked at", NEEDS_INFORMATION "We have a
  question", ACCEPTED "Planned", IN_PROGRESS "Being worked on", AWAITING_VERIFICATION "Ready to check", RESOLVED
  "Fixed", DUPLICATE "Already reported", DECLINED "Not planned", CLOSED "Closed".
- Owner-facing words are the same, plus pills: SUBMITTED "New" (attention), NEEDS_INFORMATION "Waiting on them"
  (neutral), reporter replied "They answered" (attention).

## 2. Data (one additive migration `20261027020000_feedback`)
```prisma
model FeedbackReport {
  id              String   @id @default(cuid())
  number          Int      @unique @default(autoincrement())   // shown as "#{number}"
  reporterUserId  String
  reporter        User     @relation("FeedbackReporter", fields: [reporterUserId], references: [id], onDelete: Restrict)
  reporterRole    Role                                         // role at submission (for filtering)
  kind            FeedbackKind                                 // BUG | IMPROVEMENT
  title           String   @db.VarChar(160)
  description     String   @db.VarChar(8000)
  expected        String?  @db.VarChar(2000)
  steps           String?  @db.VarChar(4000)
  routeTemplate   String   @db.VarChar(200)                     // e.g. "/account/rentals/[id]"
  appRevision     String?  @db.VarChar(40)
  safeContext     Json                                          // { language, browser, device } only
  aiReview        FeedbackAiReview @default(HUMAN_ONLY)         // HUMAN_ONLY | ALLOWED | WITHDRAWN (only HUMAN_ONLY used here)
  state           FeedbackState    @default(SUBMITTED)
  awaitingTeam    Boolean  @default(true)                      // true when the reporter wrote last
  duplicateOfId   String?
  duplicateOf     FeedbackReport? @relation("FeedbackDuplicate", fields: [duplicateOfId], references: [id], onDelete: SetNull)
  duplicates      FeedbackReport[] @relation("FeedbackDuplicate")
  requestKey      String   @db.VarChar(64)
  contentRemovedAt DateTime?                                    // privacy deletion
  version         Int      @default(1)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  closedAt        DateTime?
  entries         FeedbackEntry[]
  attachments     FeedbackAttachment[]
  events          FeedbackEvent[]
  @@unique([reporterUserId, requestKey])
  @@index([reporterUserId, createdAt, id])
  @@index([state, kind, updatedAt, id])
}
model FeedbackEntry {
  id           String   @id @default(cuid())
  reportId     String
  report       FeedbackReport @relation(fields: [reportId], references: [id], onDelete: Cascade)
  authorUserId String
  author       User     @relation("FeedbackEntryAuthor", fields: [authorUserId], references: [id], onDelete: Restrict)
  visibility   FeedbackVisibility                              // REPORTER | INTERNAL
  body         String   @db.VarChar(4000)
  createdAt    DateTime @default(now())
  @@index([reportId, createdAt, id])
}
model FeedbackAttachment {
  id          String   @id @default(cuid())
  reportId    String
  report      FeedbackReport @relation(fields: [reportId], references: [id], onDelete: Cascade)
  uploaderId  String
  pathname    String   @unique                               // feedback/{reportId}/{id}.webp in the PRIVATE store
  sizeBytes   Int
  sha256      String   @db.Char(64)
  width       Int
  height      Int
  deletedAt   DateTime?
  createdAt   DateTime @default(now())
  @@index([reportId])
}
model FeedbackEvent {
  id        String   @id @default(cuid())
  reportId  String
  report    FeedbackReport @relation(fields: [reportId], references: [id], onDelete: Cascade)
  actorUserId String?
  action    String   @db.VarChar(40)   // SUBMITTED | STATE_CHANGED | REPLIED | NOTE_ADDED | DETAILS_ADDED | MARKED_DUPLICATE | REOPENED | CLOSED_BY_REPORTER | CONTENT_REMOVED | ATTACHMENT_ADDED
  fromState FeedbackState?
  toState   FeedbackState?
  reason    String?  @db.VarChar(500)  // never report text
  createdAt DateTime @default(now())
  @@index([reportId, createdAt])
}
enum FeedbackKind { BUG IMPROVEMENT }
enum FeedbackAiReview { HUMAN_ONLY ALLOWED WITHDRAWN }
enum FeedbackVisibility { REPORTER INTERNAL }
enum FeedbackState { SUBMITTED TRIAGED NEEDS_INFORMATION ACCEPTED IN_PROGRESS AWAITING_VERIFICATION RESOLVED DUPLICATE DECLINED CLOSED }
```
User relations: `feedbackReports @relation("FeedbackReporter")`, `feedbackEntries @relation("FeedbackEntryAuthor")`.
Settings (BusinessSettings, additive, owner-editable in Settings › App feedback with the usual explanation and
"restore recommended"): `feedbackMaxAttachments Int @default(3)` (0–3), `feedbackMaxAttachmentMb Int @default(5)`
(1–5; 5 is also the hard technical ceiling), `feedbackReopenDays Int @default(90)`.
Backup: add all four models to `BACKUP_MODEL_POLICY` (`src/domains/backup/manifest.ts` — typecheck forces it) as
recoverable business data. Media: add `feedback` to the `isPrivatePhotoPath` regex (`src/lib/photo-storage.ts`) so the
nightly media copy includes screenshots; update its test. The client-upload token path (`canUploadPhoto`) must
**not** accept `feedback/` (uploads go through the server, section 4) — add a test that it refuses.
Report text is stored as ordinary private database text (the database is private; do not claim "encrypted" on
screen).

## 3. Domain (`src/domains/feedback/index.ts`; every function re-reads the session user)
Actor rules: `reporter` = any signed-in, non-archived user. `triage` = OWNER or ADMIN (`assertActiveTeamActor(tx, id,
["OWNER","ADMIN"])`). STAFF and CUSTOMER see **only their own** reports; every read query includes `reporterUserId =
session.user.id` unless the caller is triage. Not found and not yours return the same "Not found" (no existence leak).

```ts
submitFeedback(input: { kind; title; description; expected?; steps?; path: string; requestKey: string;
  attachments: File[] }): Promise<{ id: string; number: number }>
listMyFeedback(cursor?): Promise<Page<MyFeedbackRow>>            // own reports, newest first, KIT cursor rule
getMyFeedback(id): Promise<MyFeedbackDetail>                     // own; entries with visibility REPORTER only
addFeedbackDetails(id, expectedVersion, body, attachments?)      // reporter; NEEDS_INFORMATION → TRIAGED
closeMyFeedback(id, expectedVersion)                             // reporter; any open state → CLOSED
reopenMyFeedback(id, expectedVersion, why)                       // reporter; RESOLVED/DECLINED/CLOSED/DUPLICATE → TRIAGED within feedbackReopenDays of closedAt
listFeedbackForTriage(params): Promise<Page<TriageRow>>          // triage; tabs below
getFeedbackForTriage(id)                                         // triage; all entries, events, attachments
replyToReporter(id, expectedVersion, body, nextState?)           // triage; REPORTER entry; optional state change
addInternalNote(id, body)                                        // triage; INTERNAL entry
setFeedbackState(id, expectedVersion, toState, reason)           // triage; allowed transitions only
markDuplicate(id, expectedVersion, ofNumber)                     // triage; state DUPLICATE, link; the reporter sees only "Already reported"
```
- Every write: one transaction; `SELECT … FROM "FeedbackReport" WHERE id = $1 FOR UPDATE`; compare `version` →
  "This report changed since you opened it"; `version + 1`; write a `FeedbackEvent`; `awaitingTeam` = true when the
  reporter writes, false when triage replies or changes state.
- Allowed triage transitions: SUBMITTED → TRIAGED | NEEDS_INFORMATION | ACCEPTED | DUPLICATE | DECLINED;
  TRIAGED → NEEDS_INFORMATION | ACCEPTED | DUPLICATE | DECLINED; ACCEPTED → IN_PROGRESS | DECLINED; IN_PROGRESS →
  AWAITING_VERIFICATION | ACCEPTED; AWAITING_VERIFICATION → RESOLVED | IN_PROGRESS; any non-final → RESOLVED only
  with a reason (recorded human resolution). Final = RESOLVED, DUPLICATE, DECLINED, CLOSED (set `closedAt`).
  A reason (3–500 chars) is required for DECLINED, DUPLICATE and RESOLVED.
- `submitFeedback`: validate with zod (title 5–160, description 10–8000, expected ≤2000, steps ≤4000, trimmed);
  rate limit `isRateLimited("feedback:" + userId, { max: 5, windowMs: 3_600_000 })` → "You've sent several reports
  in the last hour. Please try again later."; insert with `requestKey` (client generates one UUID per form open); on
  the unique violation return the existing report (double-click = one report). `routeTemplate` =
  `toRouteTemplate(path)` (pure, `src/domains/feedback/context.ts`): drop query and hash; must start with `/desk`,
  `/account`, `/sign` or `/` (public); replace any segment that is ≥16 characters of `[A-Za-z0-9_-]`, or all digits,
  or a UUID, with `[id]`; cap at 200 chars; anything else → `"/"`. `safeContext` from the request's user-agent only:
  `browser` ∈ chrome|safari|firefox|edge|other, `device` ∈ phone|tablet|computer, `language` = the app language
  setting. `appRevision` = first 12 chars of `VERCEL_GIT_COMMIT_SHA` (absent locally → null). Nothing else is
  captured — no full URL, cookies, page content or logs.

## 4. Screenshots (server-side, no client upload token)
- In `submitFeedback` / `addFeedbackDetails`, the server action receives the files (FormData). Per report at most
  `feedbackMaxAttachments` in total; each ≤ `feedbackMaxAttachmentMb` MiB before decoding; only `image/png`,
  `image/jpeg`, `image/webp` by **magic bytes** (check the first bytes, not the browser's type); reject anything else
  with "Screenshots must be PNG, JPEG or WebP pictures under {n} MB."
- Decode with `sharp` (already a dependency) with `limitInputPixels: 40_000_000` (decompression-bomb guard),
  `.rotate()` (apply orientation) then `.resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })`
  `.webp({ quality: 82 })` — the re-encode drops EXIF/GPS and all other metadata. Store with `put(pathname, bytes, {
  token: store.token, access: "private", contentType: "image/webp", addRandomSuffix: false })` using
  `getPrivatePhotoStore()`; if storage is not configured, submit **without** pictures and tell the person "Your report
  was sent, but pictures can't be saved right now." Write the attachment row after the put succeeds; if the database
  write fails, delete the blob (best effort) and rethrow.
- Read route `src/app/api/feedback-attachments/[id]/route.ts` (copy the structure of `src/app/api/photos/[id]/route.ts`):
  signed in; triage or the report's reporter; not deleted and the report's `contentRemovedAt` is null; otherwise 404.
  Stream from the private store with `Cache-Control: private, no-store`, `Content-Type: image/webp`,
  `Content-Disposition: inline`, `X-Content-Type-Options: nosniff`.

## 5. Screens
**Reporter form** `/desk/feedback/new` and `/account/feedback/new` (same component `FeedbackForm`, prop `area`). Opened
from: Desk user menu "App feedback", `/desk/help` page link, and a footer link "App feedback" on every `/account`
page (in `account-shell.tsx` below the nav, not a nav tab); `?from=` carries the page the person was on (the form
passes it as `path`, never showing it). Fields: kind (two large radio cards), "What happened?" / "What's your idea?"
(title), "Tell us more" (description), for BUG only "What did you expect?" and "Steps, if you remember them"
(optional, collapsed under "Add more detail"), "Add screenshots" (file input, `accept="image/png,image/jpeg,image/webp"`,
shows count left), a read-only "What we'll also see" box listing the captured context in plain words ("Page: Rentals ›
a rental · App version abc123 · Safari on a phone"). Submit "Send". Success screen: "Thanks — report #{number} was
sent. We'll answer here." with "See my reports".
**My reports** `/desk/feedback/mine`, `/account/feedback`: cards `#{number} · {title}` · state word · "Updated
{relativeBusinessDay}"; "We have a question" cards first with an attention dot. Empty: "You haven't sent any app
feedback." + "App feedback".
**My report** `/…/feedback/[id]`: title, state, conversation (reporter's own text, then REPORTER entries labelled
"{first name} at Robinson Appliance Rentals" or "You"), screenshots (thumbnails via the read route), and actions by
state: NEEDS_INFORMATION → "Answer" box (required) ; open → "Add details", "Close this report"; final within reopen
days → "It's still not right" (reason box) → reopen. Never shown: internal notes, events' actors, duplicate target.
**Triage** `/desk/feedback` (OWNER/ADMIN; add `feedback` to the owner/admin job-role screens, not staff):
`StatusTabs` "New {n}", "They answered {n}", "Open", "Waiting on them", "Planned", "Done"; filter Kind and From
(Customers / Team); search title or `#number`. Rows: `#{number}` · title · reporter name and role chip · kind ·
state pill · updated. Report page `/desk/feedback/[id]`: everything, plus the reporter's other reports count (link
filtered to them), internal notes (yellow, labelled "Only your team sees this"), timeline of events, and actions:
"Reply" (sheet: message + optional "and mark as" select of allowed states), "Add a note", "Change status…"
(ConfirmDialog with reason when required), "Mark as already reported…" (enter the other report's number).
**To do**: category `FEEDBACK_WAITING` (severity medium) computed in `src/domains/exceptions/index.ts`: one item per
report with `awaitingTeam = true` and a non-final state, title "App feedback #{number}: {title truncated to 60}",
detail "New" or "They answered", href `/desk/feedback/{id}`, action label "Read". OWNER/ADMIN only.

## 6. Privacy (extend the existing machinery, `src/domains/privacy/index.ts`)
- `buildPrivacyExport`: include the person's reports (title, description, expected, steps, state, created), their own
  entries and REPORTER entries on their reports (not INTERNAL), and attachment file names.
- `fulfillPrivacyDeletion`: for the person's reports set `title = "Removed"`, `description = "Removed at the
  person's request"`, `expected = steps = null`, `contentRemovedAt = now`; replace their entry bodies with
  "Removed"; delete their attachments from the private store and set `deletedAt`; add `CONTENT_REMOVED` events. Keep
  report number, state and dates (needed history). Add the models to the `PSEUDONYMIZED` list the function returns.
- The nightly media copy must not restore a deleted screenshot: after deletion the pathname is listed in the existing
  media tombstones (`deletePrivatePhotoWithRecovery` in `src/domains/backup/media-deletion.ts` — use it instead of a raw
  `del`).

## 7. Tests
- `tests/feedback-context.test.ts`: route templates (ids, digits, UUIDs, query/hash removed, unknown prefix → "/"),
  user-agent buckets.
- `tests/feedback-integration.test.ts` (throwaway Postgres): customer submits; double submit with the same
  requestKey → one report; rate limit; customer B and STAFF cannot list, open, add details, close, reopen or download
  (each returns Not found); staff sees own report; triage transitions allowed/refused; reasons required; reopen window;
  concurrent replies → one wins, other sees "changed"; awaitingTeam flips; To do item appears and clears.
- `tests/feedback-media.test.ts`: magic-byte check (a PNG named .jpg is fine, an SVG/HTML renamed .png is refused),
  oversize refused, decompression bomb refused, EXIF GPS gone after re-encode (write a JPEG with GPS via sharp
  `withMetadata`, re-read the stored output and assert no exif), `canUploadPhoto` refuses `feedback/…`,
  `isPrivatePhotoPath` accepts it.
- `tests/feedback-privacy-integration.test.ts`: export includes REPORTER entries only; deletion removes content and
  media, keeps numbers; nothing shows content afterwards.
- `tests/feedback-no-ai.test.ts`: no module under `src/app/api/ops`, `src/mcp` or any MCP tool imports
  `src/domains/feedback` (grep-style test), and every report is `HUMAN_ONLY`.
- `e2e/feedback.spec.ts` (add to a shard in `e2e/shards.json`; reuse global-setup sessions): customer sends a report
  with a screenshot from a rental page → sees "Received"; owner sees the To do, replies "We have a question" → customer
  answers → owner marks Fixed with a reason → customer reopens. Axe, phone and desktop, light and dark, keyboard only.
