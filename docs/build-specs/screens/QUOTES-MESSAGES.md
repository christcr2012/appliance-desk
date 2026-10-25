# Screen spec — Quotes list and Messages inbox (AR-4d)

Built in **AR-4d**. Kit: KIT.md. Roles unchanged: Quotes OWNER/ADMIN; Messages OWNER/ADMIN/STAFF (staff see only
threads assigned to them — `authorizeThreadInTx` and `safeFilters` already enforce it; keep that).

## 1. Fixes found while specifying
- `getAllEstimates()` loads **every** quote with all its lines on each visit (no paging) and has no role check of its
  own; `getEstimateDetail()` has no role check either (`src/domains/estimates/index-base.ts`). Replace the list read
  with a paged query (section 2) and add `requireRole("OWNER","ADMIN")` to `getEstimateDetail` (its callers are
  OWNER/ADMIN pages; update tests that call it to provide a session like PR #594 did).
- The Messages inbox shows stored codes ("OPEN", "WAITING", "CLOSED", "UNRESOLVED") and a raw `<select>` of them.

## 2. Quotes — `/desk/estimates` (same URL; the word on screen is **quote**)

**Params** (`params.ts`, zod): `status` = `open` (default: DRAFT, SENT, VIEWED, CHANGES_REQUESTED) | `approved`
(APPROVED, not converted) | `won` (CONVERTED) | `closed` (DECLINED, EXPIRED) | `drafts` (DRAFT only); `q` (name,
company, quote number digits); `who` = `customers` | `leads`; `sort` = `newest` (default) | `oldest-sent` |
`value-desc` | `expires`; `cursor` (KIT 5.1).
**Data** `src/domains/estimates/list.ts` `getQuotes(params)` / `getQuoteCounts(params)`: select id,
estimateNumber, status, title, sentAt, viewedAt, respondedAt, validUntil, createdAt, depositCents, customer (id,
name, company), lead (id, contactName, company), and `monthlyCents`/`oneTimeCents` as SUMs over line items (a
`groupBy` on `EstimateLineItem` by `estimateId` for the page's ids — one extra query, not per row).
**Status words** (pill): DRAFT "Draft" (neutral), SENT "Sent" (info), VIEWED "Viewed" (info), CHANGES_REQUESTED
"Changes asked" (attention), APPROVED "Approved — make it a rental" (attention), CONVERTED "Became a rental" (good),
DECLINED "Declined" (neutral), EXPIRED "Expired" (neutral). (Owner-side words; the existing `estimateStatusLabel` stays
for customer-facing text.)
**Layout:** `ScreenHeader` "Customers"; `StatusTabs` "Open {n}", "Approved {n}" (hide 0), "Won", "Closed", "Drafts
{n}" (hide 0); search "Name or quote number"; filter "For" (Customers / Leads); sorts "Newest", "Waiting longest",
"Biggest", "Expiring soonest". Card: name (customer or lead, with "Lead" chip for leads) · `"Quote #{n} · {title}"` ·
right: `"{formatMoney(monthly)}/mo"` (+ `" + {formatMoney(oneTime)} once"`) and pill · detail: SENT/VIEWED
`"Sent {relativeBusinessDay(sentAt)}{ · viewed {relativeBusinessDay(viewedAt)}}"`; expiring within 3 days `"Expires
{formatShortDate(validUntil)}"` (attention). Actions: APPROVED → **Make it a rental** (link to the quote page's
existing convert panel `/desk/estimates/{id}#convert` — add `id="convert"` to `ConvertEstimatePanel`'s wrapper);
DRAFT → **Finish and send** (link `/desk/estimates/{id}`); SENT/VIEWED → **Follow up** (`tel:` when a phone is known,
else `mailto:`). ⋯: "Open", "View customer"/"View lead". Fab "New quote" → `/desk/estimates/new`. Desktop columns:
Who · Quote · Monthly · Once · Status · Sent · ⋯; row click opens the quote page (no side panel — the quote page is a
document editor).
Empty: "No open quotes" + "New quote".

## 3. Messages — `/desk/communications` (same URL)

**Params:** `status` = `open` (default; OPEN) | `waiting` (WAITING) | `done` (CLOSED); `who` = `all` | `mine` |
`unassigned` (existing `assignment`); `match` = `known` (RESOLVED) | `unknown` (UNRESOLVED) | `several` (AMBIGUOUS);
`cursor` (existing inbox cursor). Old params `status=OPEN|WAITING|CLOSED`, `resolution=…`, `assignment=…` map to
these.
**Data:** keep `listSmsInbox` (it deliberately lists no message text before thread authorization). Add to its
`select` only the thread's `customer { id, user { name } , companyName }` and `lead { id, contactName }` names
(names are already visible to these roles on the customer/lead pages; no message content) and the assigned user's
name. Counts per status: three `count` calls with the same `safeFilters`.
**Words:** status OPEN "Needs a reply" (attention when unread, else info), WAITING "Waiting on them" (neutral), CLOSED
"Done" (good); match UNRESOLVED "Unknown number" (attention, with action "Link to a person…"), AMBIGUOUS "Matches more than one
person" (attention, same action), RESOLVED (no chip).

**"Link to a person…" (missing today).** The code says an ambiguous thread "needs explicit staff review"
(`src/domains/messaging/inbound-resolution.ts`), but no screen or action does it; the thread page's
`linkMessageContextAction` links a *message* to a Job/Repair/Bill, not the number to a person. Add:
- `linkThreadIdentity(actorId, threadId, target: { customerId } | { leadId })` in
  `src/domains/messaging/thread-identity.ts`, OWNER/ADMIN: one transaction; `SELECT … FROM "CommunicationThread" …
  FOR UPDATE`; `assertActiveTeamActor`; the target must exist (not archived/merged); revoke (`revokedAt = now`) every
  other active `ContactBinding` for the thread's `externalContactPointId` that points at a different person; create
  (or keep, if identical) a binding `{ contactPointId, customerId | leadId, source: "STAFF", verifiedAt: now }`; set
  the thread `resolution = "RESOLVED"`, `customerId`/`leadId`, `version + 1`; audit `communication.identity_linked`
  with old/new person and revoked binding ids. Consent records are not changed (consent belongs to the contact point
  and stays as recorded).
- `unlinkThreadIdentity(actorId, threadId)` ("This isn't them"): revoke the thread's person binding, set
  `resolution = "UNRESOLVED"`, clear the person, audit `communication.identity_unlinked`.
- Thread page: a Sheet "Who is this?" with a `SearchablePicker` (customers and leads, labelled) and, when other
  bindings will be revoked, a `ConfirmDialog` "Link this number to {name}? It will stop matching {other names}."
- Tests (throwaway Postgres): unknown → linked; ambiguous with two bindings → one kept, one revoked; a later inbound
  message on that number resolves to the linked person (run `resolveInboundContact` on the new bindings); staff
  refused; concurrent link of the same thread → one wins, the other sees "This conversation changed".
**Layout:** `ScreenHeader` "Customers"; `StatusTabs` "Needs a reply {n}", "Waiting {n}", "Done"; filters Who
(All / Mine / Unassigned) and Number (Known / Unknown / Several); cards: name (customer/lead name, or "Unknown
number") · `"{relativeBusinessDay(lastActivityAt)} · {assigned name or 'Unassigned'}"` · unread dot (with sr-only
"Unread") · pill; tap → `/desk/communications/{id}` (unchanged thread page). Empty per tab: "Nothing needs a reply",
"Nothing waiting", "No finished conversations". When texting is not live yet (the existing switch), a one-line notice
"Texting with customers isn't turned on yet." with InfoTip explaining it is the owner's switch in Settings.

## 4. Tests
`tests/quotes-list-integration.test.ts` (tabs, sums, search by number, cursor), `tests/estimate-detail-role.test.ts`,
`tests/messages-params.test.ts` (legacy mapping), `tests/inbox-names.test.ts` (names added, no message text selected,
staff still only their threads), `e2e/quotes-messages.spec.ts` (tabs, make-it-a-rental anchor, staff inbox), axe +
5 sizes.
