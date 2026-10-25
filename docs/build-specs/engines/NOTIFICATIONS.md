# Build spec — In-app notifications bell (AR-13)

Card: `docs/pr-cards/AR-13.md`. Design: `APP-REDESIGN.md` 4.3 ("Notifications (in-app bell): new lead, quote viewed,
signature done, payment failed, approval requested; each opens the record. Email/text delivery of these follows
existing switches; nothing goes live automatically.") and 4D.7 ("Notifications you control"). Depends on AR-1 (top bar,
profile menu) and AR-2 (Today inbox, `INBOX_GROUP`). Risk: **new writes on public paths** (public lead form, customer
quote view, signing, Stripe webhooks) — a notification must never make those fail or slow them down. Read
`docs/AI-PR-READ-FIRST.md` (public forms, webhooks, email).

## 1. What a notification is (and is not)

- **To do** (`src/domains/exceptions`) stays the record of everything that needs action. It is computed from the
  data, so it is always right even if a notification was missed.
- A **notification** is a short "this just happened" message to one person, with a link to the record. It can be read
  and dismissed. Missing one is harmless: the obligation (if any) is on To do.
- When the event also shows on To do, the notification says so in its last line: "It's on your To do list."

## 2. Data (additive migration `20261031000000_notifications`)

```prisma
model Notification {
  id          String   @id @default(cuid())
  userId      String                                   // recipient
  user        User     @relation("NotificationRecipient", fields: [userId], references: [id], onDelete: Cascade)
  kind        NotificationKind
  title       String   @db.VarChar(160)
  body        String   @db.VarChar(300)
  href        String   @db.VarChar(400)                // must start with "/desk/" (checked on write)
  entityType  String   @db.VarChar(40)
  entityId    String
  dedupeKey   String   @db.VarChar(200)                // e.g. "LEAD_NEW:{leadId}"
  createdAt   DateTime @default(now())
  readAt      DateTime?
  @@unique([userId, dedupeKey])
  @@index([userId, readAt, createdAt])
  @@index([createdAt])
}
model NotificationPreference {
  userId    String
  user      User     @relation("NotificationPreferences", fields: [userId], references: [id], onDelete: Cascade)
  kind      NotificationKind
  inApp     Boolean  @default(true)
  email     Boolean  @default(false)
  updatedAt DateTime @updatedAt
  @@id([userId, kind])
}
enum NotificationKind { LEAD_NEW QUOTE_VIEWED SIGNATURE_DONE PAYMENT_FAILED APPROVAL_REQUESTED }
```
User relations: `notifications Notification[] @relation("NotificationRecipient")`, `notificationPreferences
NotificationPreference[] @relation("NotificationPreferences")`. No row = defaults (in app on, email off).
Setting (owner-configurable, Settings › Advanced row, SETTINGS.md): `BusinessSettings.notificationKeepDays Int
@default(90)` (30–365; "How long read notifications are kept. Starting value 90 days — long enough to look back on a
season, short enough to keep the list small."). Unread notifications are never removed by age.
Backup policy: `Notification: null` (short-lived messages, recreated by nothing — leaving them out of backups loses
nothing important), `NotificationPreference: "notificationPreference"`. Privacy: notifications name customers/leads
only by the name already visible to the recipient; a privacy deletion of a customer deletes notifications whose
`entityId` is that customer's lead/estimate/agreement/invoice ids (add to `fulfillPrivacyDeletion`).

## 3. Who gets what (`src/domains/notifications/rules.ts`, pure)

| Kind | Created when (exact place) | Recipients (active, not archived) | Title · body · link |
|---|---|---|---|
| `LEAD_NEW` | after `createLead` commits (`src/domains/leads/index.ts` — the public form path) and after `createLeadManually` commits | OWNER and ADMIN users whose job role allows `/desk/leads` (`jobRoleAllowsPath`); when LD-1 assigns the lead, also the assignee; **never the person who created it by hand** | "New lead: {contactName}" · "{city or 'No city'} · {first appliance requested or 'No appliance chosen'}. It's on your To do list." · `/desk/leads/{id}` |
| `QUOTE_VIEWED` | when `getEstimateForApproval` (`src/domains/estimates/index-base.ts` ~593) claims SENT → VIEWED (`claimed.count === 1`) | OWNER and ADMIN; plus the quote's creator if they are OWNER/ADMIN | "{name} opened quote #{number}" · "Sent {relativeBusinessDay(sentAt)}." · `/desk/estimates/{id}` |
| `SIGNATURE_DONE` | after `signAgreement` (`src/domains/agreements/index.ts:577`) commits a signature | OWNER and ADMIN | "{name} signed their rental" · "Next: schedule the delivery. It's on your To do list." · `/desk/agreements/{id}` |
| `PAYMENT_FAILED` | after the webhook transaction commits for `handleInvoicePaymentFailed` (~896) and `handleCheckoutSessionAsyncPaymentFailed` (~796) in `src/domains/billing/webhooks-base.ts`, once per Stripe event | OWNER and ADMIN | "Payment failed: {name}" · "{formatMoney(amount)} for bill #{number}. It's on your To do list." · the bill page `/desk/billing/customer/{customerId}/invoice/{invoiceId}` |
| `APPROVAL_REQUESTED` | after `storeRequest` (`src/domains/approvals/index.ts:110`) commits a new request (not on `ALREADY_WAITING`) | OWNER only (only the owner decides) | "Approval needed: {summary}" · "Asked by {requester name} · {formatMoney(amountCents)}." · `/desk/approvals` |

Recipient queries filter on the server (`role`, `archivedAt: null`, job role). A CUSTOMER is never a recipient. The
title/body use only fields the recipient can already see on the linked page.

## 4. Writing them (`src/domains/notifications/index.ts`)

```ts
export async function notify(event: NotificationEvent): Promise<void>
```
- Called **after** the main transaction commits, never inside it, wrapped by the callers as
  `void notify(…).catch((e) => reportBackgroundError(e, "notify:{kind}"))` — the public request returns without
  waiting for it and nothing the person does can fail because of it. (On Vercel, use `after()` from `next/server` so
  the work finishes after the response — read `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`
  first; where `after` is not available — the webhook route already runs inside a request, so it is — call it
  directly.)
- Resolves the permission-eligible recipients (section 3) once; then **per channel**: rows only for recipients with
  `inApp` on, via `createMany({ data, skipDuplicates: true })` — the `(userId, dedupeKey)` unique makes webhook retries and double
  clicks harmless. `dedupeKey`: `LEAD_NEW:{leadId}`, `QUOTE_VIEWED:{estimateId}`, `SIGNATURE_DONE:{agreementId}`,
  `PAYMENT_FAILED:{stripeEventId}`, `APPROVAL_REQUESTED:{requestId}`.
- **Email** (from the same eligible list, for recipients with `email: true` — independent of `inApp`; test `inApp:
  false, email: true` → an email and no row): one message per recipient through the existing owner/staff
  internal email path (`deliverMessage` with `customerFacing: false`, `templateKey: "notification"`, `idempotencyKey`
  = `notification:{dedupeKey}:{userId}`), which already respects the email switches; text messages are not offered
  (the preference screen shows "Texts: available when texting is turned on" disabled). No live customer email or SMS
  is turned on by this card.
- Body and title are cut to their column lengths; `href` must start with `/desk/` or `notify` throws (bug, reported).

## 5. Reading and marking (`src/domains/notifications/index.ts`, all re-read the session user)
- **Current permissions decide what is shown, not the permissions when it was sent.** Every read and count filters by
  `allowedKindsFor(user)` (pure, `rules.ts`): the kinds the user's **current** role and job role may receive — the same
  table as section 3's recipients (LEAD_NEW needs `/desk/leads` allowed; QUOTE_VIEWED/SIGNATURE_DONE/PAYMENT_FAILED need
  OWNER/ADMIN and the job role allowing the linked screen; APPROVAL_REQUESTED needs OWNER) — and drops rows whose
  `href` the user's job role can't open (`jobRoleAllowsPath`). The session user is re-read (role, job role, archived)
  per request. In addition, `changeAccessLevel` and the job-role change function (`src/domains/team/index.ts`) delete,
  in their own transaction, the user's notifications of kinds they can no longer receive (audit
  `notifications.removed_on_access_change` with the count). Archived users get none.
- `getUnreadCount()` → `count({ where: { userId, readAt: null, kind: { in: allowedKinds } } })` (index `[userId,
  readAt, createdAt]`); capped display "99+".
- `listNotifications({ cursor })` → own rows of allowed kinds, newest first, 20 per page (KIT cursor rule); unread rows
  are shown bold with a dot (no separate unread-first sort).
- Regression tests: an ADMIN with PAYMENT_FAILED notifications is demoted to STAFF → count 0, list empty, rows deleted;
  a job role narrowed to remove `/desk/leads` → LEAD_NEW rows hidden and removed; re-promotion doesn't bring deleted
  rows back.
- `markRead(id)` (`updateMany({ where: { id, userId, readAt: null } })` — no lock needed: a single conditional update),
  `markAllRead()` (`updateMany({ where: { userId, readAt: null } })`).
- Server actions in `src/app/desk/notifications/actions.ts`; every one calls `requireSession()` and passes only the
  session user id — no id from the client except the notification id, which is always paired with `userId`.

## 6. Screens

**Bell** (`NotificationBell`, kit, client) in AR-1's `TopBar`: desktop right side (left of where the search trigger
ends), phone between the search button and the profile button. `Icon bell`, accessible name "Notifications" or
"Notifications, {n} unread" (add `bell` to the kit `Icon` set, KIT 4.21 — copy the path from `lucide-static@0.468.0`). Count pill `bg-danger text-white` when n > 0.
- The count is fetched with the `getUnreadCountAction` server action on mount, when the tab becomes visible again,
  and every 60 s while the page is visible **and** the person used it in the last 10 minutes (the same rule as AR-11's
  live freshness, so an idle tab does not keep the database awake — cost rule).
- Opening it: desktop = popover 380 px wide, max height 70 vh; phone = `Sheet` "Notifications". Header "Notifications"
  + "Mark all as read" (when any unread). Rows: kind icon, title (bold when unread), body, `relativeTime(createdAt)`
  with the exact time in `title`. Tap/Enter → `markRead` then navigate to `href`. "Load more" at the end. Empty:
  "Nothing new." Footer link "Choose what you get" → `/desk/account/notifications`.

**Preferences** `/desk/account/notifications` (every desk user; in "Your account"): one row per kind the person can
receive (computed by the same recipient rules, e.g. STAFF without leads access sees no "New lead" row — STAFF today
receive none of the five, so their page says "You don't get notifications yet."), each with two switches "In the app"
and "By email", and the InfoTip "What this is": the row's "Created when" in plain words. Save per switch
(`setNotificationPreferenceAction(kind, channel, on)`: `requireSession`, kind must be one the person can receive,
upsert own row, audit `notification.preference`). Starting values: in the app on, email off ("Email is off to start
so your inbox stays quiet; turn it on for the ones you never want to miss.").

**Clean-up** — add to the nightly `system-issues-sweep` work (billing-reconcile cron, no new cron): delete read
notifications older than `notificationKeepDays`, at most 5,000 per run (`deleteMany` by id batch), counted in the run.

## 7. Words (exact)
"Notifications"; "Notifications, {n} unread"; "Mark all as read"; "Nothing new."; "Choose what you get"; "Load
more"; the titles/bodies in section 3; preference labels "New lead", "Quote opened", "Rental signed", "Payment
failed", "Approval needed"; "In the app"; "By email"; "Texts: available when texting is turned on"; "You don't get
notifications yet."

## 8. Tests
- `tests/notifications-rules.test.ts`: recipients per kind and role; job-role narrowing; manual lead creator skipped;
  archived users skipped; customers never.
- `tests/notifications-integration.test.ts` (throwaway Postgres): each of the five events creates one row per
  recipient; replaying the same webhook event / double view creates no duplicates; `inApp: false` skips; a failing
  `notify` (forced error) does not fail `createLead`, `signAgreement`, the quote view or the webhook (assert their
  results and that the error was reported); `markRead` cannot touch another user's row; clean-up keeps unread and
  recent rows; privacy deletion removes the customer's notifications.
- `tests/notification-email.test.ts`: email only with `email: true`, idempotency key stable, internal path only.
- `e2e/notifications.spec.ts` (shard): submit the public lead form → owner's bell shows 1 → open → lands on the lead,
  count clears; preferences page switches save; staff sees no bell count and "You don't get notifications yet."; axe
  + 5 sizes; keyboard opens the bell, arrows/Tab through rows, Escape returns focus.
