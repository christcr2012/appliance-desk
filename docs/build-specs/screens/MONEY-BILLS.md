# Screen spec — Money › Bills (today's "Billing")

Route: **`/desk/billing` (same URL)**. Visual targets: `samples/InvoicesPhone.dc.html`, `samples/InvoicesDesktop.dc.html`.
Built in **AR-0** (reference screen); AR-3 adds inline payment sheets and moves deposits and "Waiting for Stripe" to
Payments.
Roles: OWNER and ADMIN only (`requireRole("OWNER","ADMIN")`, unchanged). Everyday word: **bill** (never "invoice").

## 1. URL parameters (`src/app/desk/billing/params.ts`, zod)

| Param | Values | Default |
|---|---|---|
| `status` | `open`, `past-due`, `paid`, `closed`, `drafts` (old value `processing` falls back to `open`) | `open` |
| `q` | text ≤ 80 chars (customer name, company, email, or bill number digits) | — |
| `type` | `rent`, `sale`, `other` (multi, comma-joined) | all |
| `due` | `this-month`, `last-month`, `last-30`, `custom` (+ `from`,`to` YYYY-MM-DD) | — |
| `autopay` | `on`, `off` | — |
| `sort` | `due-asc`, `due-desc`, `owed-desc`, `customer-asc` | `due-asc` for open/past-due/drafts; `due-desc` for paid/closed |
| `view` | built-in: `by-customer`, `deposits`, `waiting` (legacy tabs kept until AR-3) | — |
| `open` | a bill id (desktop side panel) | — |
| `cursor` | see KIT 5.1 | — |

**Old links keep working:** `?filter=delinquent` → `status=past-due`; `?filter=statements` → `view=by-customer`;
`?filter=deposits` → `view=deposits`; `?filter=waiting` → `view=waiting` (redirect inside the page with
`redirect()`; keep `page` ignored).

## 2. Status rules (one pure function, `src/domains/billing/bill-status.ts`)

```ts
export type BillTab = "open" | "past-due" | "paid" | "closed" | "drafts";
export function billTabWhere(tab: BillTab, now: Date): Prisma.InvoiceWhereInput
export function billPill(bill: { status: InvoiceStatus; dueDate: Date | null; amountDueCents: number;
  amountPaidCents: number }, now: Date): { label: string; tone: Tone }
```
- **open:** status in `OPEN, PARTIALLY_PAID, DELINQUENT, FAILED` and `amountDueCents > amountPaidCents`.
- **past-due:** open AND `dueDate < start of today (Denver, businessDayBounds(now).start)`.
- **No "Processing" tab in AR-0.** Nothing in the payment paths records "the bank is still confirming this bill's
  payment" today (no `ProviderOperation` is written for invoice payments, and payments are recorded only once they
  succeed or fail). A tab built on missing evidence would always be empty, so it is left out. Unfinished Stripe
  requests stay visible through the existing "Waiting for Stripe" view (`?view=waiting`). Recording that evidence is
  new payment-path work — it is on `docs/ROADMAP.md`, not in this card.
- **paid:** `PAID`. **closed:** `VOID, WRITTEN_OFF, REFUNDED`. **drafts:** `DRAFT` (tab hidden when 0).
- **Pill** (first match wins): FAILED → "Payment failed" (attention);
  past due → `"{n} day(s) late"` where n = calendar days between the due date and today in Denver (attention);
  due today → "Due today" (neutral); open with due date → `"Due {formatShortDate(dueDate)}"` (neutral);
  open without due date → "Open" (neutral); PAID → "Paid" (good); VOID → "Cancelled" (neutral);
  WRITTEN_OFF → "Given up" (neutral); REFUNDED → "Refunded" (neutral); DRAFT → "Draft" (neutral).
- InfoTips on pills (add to `GLOSSARY`, shape `{ title, description }`): `"bill-failed"` { "Payment failed", "The card or bank refused the payment. Take payment again or send a reminder." },
  `"bill-given-up"` { "Given up", "You decided not to collect this bill. It still counts in your records." }.

## 3. Data (new read functions, `src/domains/billing/bills-list.ts`)

```ts
export type BillRow = { id: string; number: number; customerId: string; customerName: string; companyName: string | null;
  forText: string; amountCents: number; owedCents: number; status: InvoiceStatus; dueDate: Date | null;
  paidCents: number; autopay: boolean; createdAt: Date };
export async function getBills(params: BillsParams, now = new Date()): Promise<{ rows: BillRow[]; nextCursor: string | null; capped: boolean }>
export async function getBillCounts(params: Omit<BillsParams, "status">, now = new Date()): Promise<Record<BillTab, number>>
export async function getBillTotals(params: BillsParams, now = new Date()): Promise<{ count: number; owedCents: number }>
```
- Select only the fields needed (no `include` of whole rows — see the 2026-10-24 capacity fix).
- `customerName` = `user.name ?? user.email`; `forText`: rental bill (agreementId set) →
  `"{Month name} rent"` from `billingPeriodStart` (plus `" · {n} units"` when the agreement has >1 service address
  line — skip if not cheaply available; then omit); shop sale (`saleKind` set) → "Shop sale"; else the first line
  item's description, else "Bill".
- `owedCents = max(0, amountDueCents − amountPaidCents)`. `autopay = customer.stripeDefaultPaymentMethodId != null`.
- Search `q`: digits only → `invoiceNumber = Number(q)`; otherwise case-insensitive `contains` on user name, user
  email, company name. (Trigram indexes come in LD-1/CU-1; do not add them here.)
- Counts: one query per tab is acceptable (≤6 counts) using the same filters; wrap in `Promise.all`.
- Cursor per KIT 5.1 with the sort column (`dueDate` nulls last, then `invoiceNumber`).

## 4. Layout

**Phone:**
1. `ScreenHeader` title "Money" (the area title), search icon button (command bar later).
2. Area tabs: **not on this page.** `src/app/desk/billing/layout.tsx` keeps rendering the existing
   `<SectionTabs section="money" />` in AR-0; AR-1 replaces every area layout's tabs at once with the kit `AreaTabs`
   (NAVIGATION.md), so all Money pages change together.
3. `StatusTabs` label "Bill status": `Open {n}`, `Past due {n}`, `Paid`, `Closed`,
   `Drafts {n}` (hide 0). Paid/Closed show no count.
4. `Toolbar`: search placeholder "Name or bill number", label "Search bills"; filters Type (multi: "Rental bills",
   "Shop sales", "Other"), Due date (date presets), Autopay (select: "On", "Off"); sort options "Oldest due first",
   "Newest first", "Most owed first", "Customer A–Z"; views: built-in "Past due" (`?status=past-due`),
   "By customer" (`?view=by-customer`), "Deposits" (`?view=deposits`), "Waiting for Stripe" (`?view=waiting`),
   then saved views.
5. Summary line (`text-sm text-ink-soft font-semibold`): `"{count} bills · {formatMoney(owedCents)} still owed"`
   (for paid/closed: `"{count} bills"`); right side: current sort label.
6. Cards (`DataTable.mobileCard`): customer name (title) · `forText` + `" · Bill #{number}"` · right: amount
   (`owedCents` for open tabs, `amountCents` otherwise) and the pill · detail line when PARTIALLY_PAID:
   `"Paid {paid} of {amount}"`; when FAILED: "Last card payment failed" · actions: **Take payment** (primary, link
   `/desk/billing/customer/{customerId}/invoice/{id}#take-payment`), **Remind** (link same page
   `#take-payment`), ⋯ (row actions below). Paid/closed cards have no buttons; the card is a link to the bill.
7. `Fab` "New bill" → `/desk/sales/new` (the existing local bill/sale creation; if a better existing route for a
   one-off bill exists, use it and note it).
8. Empty states: open "No open bills"; past-due "Nothing is late"; paid "No paid bills yet"; closed "No closed
   bills"; with filters/search: "No bills match" + action "Clear filters".

**Desktop (`lg:`):** sidebar shell (existing AppShell until AR-1); header row "Money" + "+ New bill" button; (area tabs come from the layout);
one row with StatusTabs (segmented) + search (max 320 px) + Filter + "View: {name} ▾"; table columns:
☐ · Customer · Bill (`#number`) · For · Amount (right) · Still owed (right, bold) · Status (pill) · ⋯.
Row click opens the **SidePanel** (`?open=`). Below the table the summary line.

**Row actions (⋯):** "Take payment" (link as above), "Record cash or check" (link
`/desk/billing/customer/{customerId}#record-payment`), "View customer" (`/desk/customers/{customerId}`),
"Download PDF" (only if the existing invoice page has a PDF route — otherwise omit), "Give up on this bill…" (link to
the bill page's existing write-off section; never a direct action here).

**Bulk (desktop):** none in AR-0 (no bulk money actions). AR-3 may add "Export selected".

## 5. Side panel (desktop, `?open=<id>`)

Data: `getInvoiceDetail(id)` (existing). Content top to bottom:
- Eyebrow `"Bill #{number}"`, title customer name, pill (billPill).
- StatStrip (2 columns inside the panel): "Still owed" (bold), "Was due"/"Due" (`formatBusinessDate`, long form), "For"
  (`forText`), "Card on file" (`"{brand} ···{last4}"` if the detail exposes it; otherwise "None").
- Actions: Take payment (primary link), Send reminder (link `#take-payment`), ⋯ (same as row actions).
- "What happened" Timeline built from: bill created (`createdAt`, actor "automatic" unless created by a person),
  each payment (`"Payment received · {amount}"` good / `"Card declined"` or `"Payment failed"` attention, actor
  "automatic" for card/Stripe, the recorder's name for manual), refunds ("Refunded · {amount}").
- "Open full bill →" link to the bill page.

## 6. Legacy views kept (until AR-3)

`?view=by-customer` renders the existing customer balances list (current `customerBalances` table) inside the new
layout with a one-line title "Who owes money"; `?view=deposits` renders the existing `DepositsTab`;
`?view=waiting` renders the existing `WaitingTab`. Overflow menu on the header (⋯): "Held payments"
(`/desk/billing/held-payments`), "Check against Stripe" (`/desk/billing/reconciliation`). Remove the old
`FilterBar` and the explanatory paragraph.

## 7. Anchors on the existing bill pages (small changes)

- Wrap `PaymentLinkPanel` on `/desk/billing/customer/[id]/invoice/[invoiceId]` in `<div id="take-payment">`.
- Wrap `RecordPaymentForm` on `/desk/billing/customer/[id]` in `<div id="record-payment">`.

## 8. Tests

- `tests/bill-status.test.ts`: tab `where` builders (snapshot of the where objects) and the pill table, including
  DST and "due today" at 23:59 / 00:01 Denver.
- `tests/bills-list-integration.test.ts` (throwaway Postgres): each tab returns the right bills; search by number and name; cursor returns each bill once across pages; counts match rows.
- `tests/billing-params.test.ts`: zod defaults, legacy `filter=` redirects, invalid values fall back.
- `e2e/money-bills.spec.ts`: owner opens Past due, opens side panel (desktop), phone card buttons present, staff gets
  the existing access refusal; axe + 5 sizes.
