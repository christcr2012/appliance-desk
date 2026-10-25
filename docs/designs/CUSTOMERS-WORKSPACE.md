# Customers workspace — one place for everyone you sell to (Batch CU)

Status: **designed 2026-10-25 at Chris's request; not built.** Units CU-1…CU-3 in `work-index.json`. Follows the
"Quiet screens" and "No bare link lists" rules in [DESIGN-SYSTEM.md](../DESIGN-SYSTEM.md) and builds on the Leads
design ([LEADS-WORKSPACE.md](LEADS-WORKSPACE.md)). No provider or live switch involved.

## 1. The problem (Chris, 2026-10-25)

> "This page is so basic … either the designer … completely failed to design a robust customer management system, or
> the functionality belongs added to another appropriate page instead of having its own page."

## 2. What exists today (checked against `main`, 2026-10-25)

- **List** `/desk/customers`: a sentence, "Add customer", "Export CSV", and a table of name (+ company, property
  manager pill), email, number of agreements, number of properties. Newest first, page numbers. **No search, no
  filters, no money, no status, no next visit.** (`src/app/desk/customers/page.tsx`, `getCustomersPage`)
- **Bug found:** the page count uses `getCustomersCount()`, which counts the hidden built-in walk-in customer, while
  the list excludes it — the total and last page can be off by one.
- **Detail** `/desk/customers/[id]` is richer: tabs for overview, properties, rentals, service, billing and notes;
  next visit, customer login, contacts, service addresses, tax exemptions, billing context, timeline.
- **Menu:** Leads and Customers are two separate entries, so a person's history is split at the moment they convert.

## 3. Answer to Chris's question: own page, but one area

Customers deserves its own place — it is the core record every rental, bill, visit and message hangs off — but it
should be **one "Customers" area with Leads inside it**, not two unrelated pages. A real business thinks "people we
sell to", at different stages. So:

- Menu entry **Customers** opens an area with tabs: **Leads · Customers · Insights** (same tab pattern as Schedule,
  Equipment and Money in `src/lib/desk-sections.ts`). The bottom bar's Customers button lands here.
- **One search** at the top of the area finds a person whether they are a lead or a customer (name, company, phone,
  email, address, asset number on their rental).
- A converted lead's customer record shows "Became a customer on … (from lead)" and keeps the lead's notes and
  messages in its timeline.

## 4. CU-1 — The customer list as a working tool (and data foundations)

**Segments as tabs with counts:** **Active 18 · Owes money 2 · Ending soon 3 · Setting up 1 · Past 7** (All in a menu).

| Segment | Rule |
|---|---|
| Setting up | has a draft/awaiting-signature agreement or signed agreement not yet delivered; no active rental |
| Active | at least one ACTIVE agreement |
| Owes money | open balance due > $0 past its due date |
| Ending soon | an active agreement ending, or a pickup scheduled, within the owner's "rental endings" window |
| Past | no active or pending agreement, had one before |

One pure `customerSegment()` rule in `src/domains/customers` (a customer can be in "Owes money" and another segment).

**Each row**, readable at a glance (phone card / desktop table):
- Name (company or "Property manager · 12 properties" under it) · city
- Status pill (segment) · "Pays on time" / "Paid late 2 of last 6" badge (from existing payment history; ⓘ explains)
- **Monthly rent** (sum of active lines) · **Balance due** (red if past due) · **Autopay on/off** (saved card on file)
- **Next:** "Delivery Tue 9–11", "Bill due Nov 1", "Pickup Fri" — the soonest upcoming thing
- Row menu: Take payment · Schedule visit · New quote · Message · Open

**Sort:** Needs attention (past due first, then ending soon, then setting up) · Name · Monthly rent · Balance ·
Newest · Customer since. **Filter sheet:** city/service area, property managers, autopay off, has open service
request, appliance type rented, customer since range. **Saved views** via O-7 (add `customers` to `SAVED_VIEW_ROUTES`).
Desktop: sortable columns, bulk export, bulk "send a message" (only once email/texting to customers is live).

**Scale:** search with `pg_trgm` GIN indexes (shared with LD-1) on name, company, phone digits, email, street and
city; denormalized, transaction-maintained read model `CustomerSummary` (segment flags, monthly rent cents, balance
cents, past-due cents, next event date/kind, autopay, last payment date) refreshed in the same transaction as the
agreement/invoice/payment/job change that affects it, plus a nightly repair pass; cursor pagination, 50 rows per load.
Target: list, counts and search under 150 ms at 20,000 customers / 60,000 properties on the 0.25 CU database (capacity
test in `tests/perf`). Fix the walk-in count bug (count with the same `where` as the list).

Tests (throwaway Postgres): segment rule table; summary stays equal to a from-scratch recompute after every money,
agreement and job action (property test) and after the nightly repair; staff see only what their job role allows,
filtered on the server; customer A/B isolation unchanged; capacity baseline; count matches the list.

## 5. CU-2 — The customer record header and next step

On `/desk/customers/[id]`, above the existing tabs:
- **Summary strip:** monthly rent · balance due (with "Take payment") · next bill date · autopay · rentals · next visit.
- **One next-step card** when something is due: "Payment 6 days late — take payment or send a reminder",
  "Delivery not scheduled", "Agreement waiting for signature (sent 3 days ago)", "Rental ends Nov 15 — renew or
  schedule pickup". Buttons do it; links into the existing workflows (no new money rules).
- **Quick actions:** Call · Email · Text (when live) · New quote · Schedule visit · Add note.
- Tabs keep today's content but follow quiet screens: remove explanatory paragraphs, move help behind ⓘ, empty
  states one line + one button.

Tests: next-step rules table; actions respect existing permissions; no explanatory paragraphs (guard from BA-6).

## 6. CU-3 — One Customers area, shared search and insights

- Area tabs **Leads · Customers · Insights** with section routing in `desk-sections.ts`; old URLs unchanged.
- Shared search across leads and customers (one result list, labelled Lead / Customer).
- **Insights** (owner/admin): active customers and change this month, new customers, customers lost and why (ended
  agreements with reason), average monthly rent per customer, average customer lifetime and revenue so far, share on
  autopay, share paying late, top cities. Each figure has an ⓘ definition; numbers only from recorded data. Lead
  funnel numbers come from LD-4 on the same tab.

Tests: shared search returns each person once with the right label; insights on fixed fixtures; tab permissions.

## 7. Data changes (additive)

`CustomerSummary` table (customerId PK, segment flags, monthlyRentCents, balanceCents, pastDueCents, nextEventAt,
nextEventKind, autopay, lastPaymentAt, latePaymentsLast6, updatedAt); trigram GIN indexes; saved-view route
`customers`; area config in `desk-sections.ts`; glossary entries (pays on time, balance due, monthly rent, lifetime).

## 8. Build order and owner decisions

CU-1 → CU-2 → CU-3. CU-1 can start after LD-1 (shared search indexes) or include them if it lands first. No owner
decision required; "Ending soon" uses the existing rental-endings window setting.
