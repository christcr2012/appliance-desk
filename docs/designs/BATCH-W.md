# Design — Batch W: Workflows that tell Chris what to do

Status: **APPROVED** (Chris, 2026-10-09: "Approved, yes to drafts, same day, combine screens" — IN-57…IN-60). Each PR
still needs its card in `docs/pr-cards/` before it starts (W-0A and W-0B have cards). Written 2026-10-09 against `main` aea29ba3 (#335) after a read-only audit of the owner's
journeys (tax and intake, rental lifecycle, navigation and wording).

Chris, 2026-10-09: *"The tax screen in my owner portal is confusing and makes no sense to me, nor does there seem to be
any workflow logic built in so the system knows and tells me when to do certain things. For example, when I add new
inventory, and the seller didn't charge me sales and use tax, I don't think it adds a step for me to file the form with
the state, or applicable local government … My robust system isn't useful to me if it isn't intuitive and work the way
I need it to work."*

**Placement (approved):** right after COM-L, **before V** (visual polish) and F-part-2 (final proof). A beautiful screen
that doesn't tell the owner what to do is still not usable; F-part-2's owner walkthrough should prove these journeys.
**W-0 (defect fixes) should go first, as soon as approved** — it fixes money/tax behavior that is broken today.

---

## 1. What the audit found (evidence, not opinion)

The parts mostly exist; the app rarely connects them into "here is what to do next, by when".

**Broken today (W-0):**
- **Use tax on a new appliance can never be calculated from the screens.** It needs the business tax address to be
  verified; Setup saves it as `NEEDS_REVIEW` (`src/domains/tax/setup.ts:77`) and no screen calls
  `locateBusinessTaxAddress` (`src/domains/tax/locations.ts:503`) or confirms that location. Every untaxed appliance
  silently stays "unknown".
- **Re-saving after fixing setup does nothing:** the "equivalent choice" early return (`src/domains/tax/acquisition.ts:92-104`)
  skips recalculation, and no job catches up.
- **Use tax with no linked use-tax account never gets a filing period** (`use-tax.ts:135-145`), so it can never show as
  overdue (`acquisition-attention.ts:26-39`).
- **Today link to a page that doesn't exist:** "N delivery fee records need review" → `/desk/tax`
  (`acquisition-attention.ts:84`); there is no `/desk/tax` page and no screen to resolve those records.
- **The intake result is thrown away:** the amount owed is computed but the save returns only "Appliance added."
  (`src/app/desk/inventory/actions.ts:88-120`, `new-appliance-form.tsx:90`).

**Doesn't guide (W-1 … W-7):**
- Intake asks "Purchase tax evidence", **defaults to "later"**, and never says what is owed, to whom, or by when.
- Purchase orders never ask about tax (`new-purchase-order-form.tsx`); use tax on parts is never recorded.
- Use tax lives outside the Sales tax area (`/desk/tax/use-tax-*`, not in the menu); its threshold is typed **in cents**.
- The return page never names or links the filing website and never starts with "pay $X by <date>".
- Today items carry no due date or amount; only tax items have buttons; most rules fire only *after* things go wrong
  (repair requests after 2 days, term ended after the end date). Missing entirely: new lead, quote approved, failed
  payment, held payment, deposit decision, unassigned/untimed job, "ending soon", "schedule the pickup".
- Signing creates no delivery job and no email to the customer (he copies the link himself); ending a rental creates no
  pickup job; "Mark as Contacted" asks for no follow-up date.
- Navigation: 26 entries, four similar money screens, tax split across two areas, real screens missing from the menu
  (Notices, Held payments), developer tools shown to the owner (preview storage check).
- Wording: about 30 legal/technical phrases on owner screens ("taxability rule matrix", "election", "remit", "frozen
  worksheet", "milli-percent", raw statuses like `AWAITING_SIGNATURE`).
- No first-time setup checklist.

## 2. Decisions

### D-W1 — Today becomes the one "To do" list, and every item says what, why, how much, by when, and has one button

Extend `ExceptionItem` (`src/domains/exceptions/rules.ts`) with `dueOn?: Date`, `amountCents?: number`,
`primaryAction: { label: string; href: string }` (required for new items; existing rules get one in W-1), and show on
each row: the title, one plain sentence of why, the amount if any, **"Due Oct 20 (in 6 days)" / "Overdue 2 days"**, and
the button ("File now", "Schedule pickup", "Call customer"). Items sort by due date, then severity. "Snooze until…" with
a reason on every item (owner/admin), stored, shown in the item's history. No item may link to a page that doesn't
exist (a test walks every rule's `href` against the route inventory).

### D-W2 — Every save that creates an obligation tells you right away

After a save that creates something to do, the screen shows a **"What happens next"** card: what you owe or need to do,
how much, by when, where, and "We added this to your To do list." Example for intake when the seller charged no tax:

> **You owe $X use tax on this dryer** (example layout — real amounts and areas come from the tax engine):
> Colorado $A · Greeley $B
> - **Colorado** — on your state use-tax return (Form DR 0252), due **January 20, 2027** (yearly while your total stays
>   at $300 or less). [Open the form]
> - **Greeley** — filed with the City of Greeley (not the state), due **…** [How to file]
>
> Added to your To do list. Nothing to do today.

If the app can't calculate yet, it says exactly why and what to do: *"I can't work out the tax yet because your business
address isn't confirmed for tax. [Confirm it now — 1 minute]"* — never a silent "unknown".

### D-W3 — The app creates the next step itself at every known turning point

| When this happens | The app does this (dated, on To do) |
|---|---|
| Appliance added, seller charged no tax | use-tax line(s) on the right return(s) + D-W2 card |
| Parts received on a purchase order | asks "Did the seller charge tax?" per line; no → use tax recorded like intake |
| New lead arrives | To do "Contact <name>" due within the owner's response-time setting (starting value: same day) |
| Lead marked contacted | asks "Next follow-up date?" (prefilled +2 days) |
| Quote approved by the customer | To do "Turn <name>'s approved quote into a rental" due today |
| Rental sent for signature | emails the signing link to the customer (when customer email is live; otherwise To do "Send <name> the signing link" with a copy button) |
| Rental signed | draft delivery visit created (no time yet) + To do "Schedule <name>'s delivery" due tomorrow |
| Visit has no technician or no time 2 days before it's needed | To do "Assign / set a time" |
| Payment fails | To do "<name>'s payment failed — $X" the same day, with "Retry charge" / "Send reminder" / "Record payment" |
| Held payment or deposit decision appears | To do with the decision buttons |
| Rental ends in 30 days (setting) | To do "<name>'s rental ends Nov 9 — renewing, month-to-month, or pickup?" with three buttons |
| Rental ending is decided / month-to-month end set | draft pickup visit + To do "Schedule <name>'s pickup" |
| Repair request arrives | To do immediately (not after 2 days) "Review <name>'s repair request" |
| Tax return period closes | To do "File <month> sales tax — $X due <date>" opening the guided page (exists — gets amount and due date) |

Drafts never charge, email or text anyone by themselves; existing live-send gates stay.

### D-W4 — Taxes in one place, in plain words

One menu entry **"Taxes"** with tabs **"To file", "Use tax", "Rates & areas", "Setup"** (Exemptions and What's taxed
move under Setup as "Customers who don't pay tax" and "What gets taxed"). `/desk/tax/use-tax-*` move under it
(old URLs redirect). The return page starts with one line: **"File and pay $X on Colorado's sales tax website (SUTS) by
Oct 20. [Open SUTS]"**, then the numbers to copy, then "I filed and paid it". Use tax gets the same shape, with state and
Greeley separated. Money is always typed in dollars. A glossary tooltip explains any unavoidable term (SUTS, use tax).

### D-W5 — First-time setup checklist

A "Get set up" card on Today (owner only) until done, in order, each step one short screen: business details → service
area → prices → **tax setup in plain questions** (license number, how often you file, first period, your business
address — confirmed on the spot, use-tax accounts for Colorado and Greeley) → payments → email. Each step shows "Done ✓"
or the one thing missing.

### D-W6 — Fewer, clearer menu entries

From 26 to about 14: **Today** · Customers (Leads, Customers, Quotes) · Rentals · Schedule (Dispatch + Jobs + Driver view
as one screen with views) · Repairs · Equipment (Inventory with Parts and Purchase orders as tabs) · Money (Billing,
Reports — Revenue/Fleet/Business overview become report tabs) · Taxes · Settings. Growth, Launch list, System health,
Privacy, Activity, Suppliers move under "More". Developer-only screens (preview storage check) leave the owner desk.
The phone bottom bar uses the same names as the menu.

### D-W7 — Plain-words check in CI

`scripts/check-owner-wording.mjs` (runs in the `static` job): a reviewed list of banned phrases on `src/app/desk/**`
user-visible strings with their plain replacements (e.g. "taxability matrix" → "what gets taxed", "remit" → "pay",
"election" → "choice", raw status enums → their labels, "(cents)" in labels → dollars). Adding to the allowlist needs a
reason in the PR.

## 3. PRs (each needs a card in `docs/pr-cards/` before it starts)

| PR | Builds | Risk |
|---|---|---|
| **W-0a** | Business tax address: confirm it from Setup and from the D-W2 card; recalculation when an appliance's tax answer is re-saved after setup changes; nightly catch-up for appliances stuck "unknown" because setup was incomplete; use tax with no linked account becomes a setup To do (never silently unfiled) | money |
| **W-0b** | Fix the broken `/desk/tax` link; a screen to resolve delivery-fee records awaiting a decision or rate; route test for every Today `href` | money/screens |
| W-1 | To do model (D-W1): due date, amount, button, snooze; every existing rule gets them; sort by due date | screens |
| W-2 | Intake "what happens next" (D-W2); plain intake question with no default ("Did the seller charge sales tax?" Yes / No / I'll check the receipt later → dated To do in 3 days); purchase-order tax question (D-W3 row 2) | money |
| W-3 | Taxes in one place (D-W4): menu, tabs, use tax moved in, return page headline + SUTS link, dollars not cents | screens |
| W-4 | Rental turning points (D-W3): signed → draft delivery + To do; ending in 30 days; ending decided → draft pickup; untimed visits | operations |
| W-5 | Money turning points: failed payment, held payment, deposit decision on To do with buttons | money |
| W-6 | Leads and quotes: new lead To do, follow-up date on "contacted", approved quote To do | sales |
| W-7 | Setup checklist (D-W5) | screens |
| W-8 | Menu (D-W6) + wording check (D-W7) + wording fixes it finds | screens |

## 4. Chris's decisions (answered 2026-10-09)

- **IN-57** Design approved; W-0A/W-0B now, ahead of COM-L; W-1 … W-8 after COM-L, before V.
- **IN-58** Yes — the app creates **draft** delivery and pickup visits automatically (no time, no technician, nothing sent).
- **IN-59** New-lead response time starting value: **same day** (owner setting).
- **IN-60** Yes — Dispatch, Jobs and Driver view become one "Schedule" screen with views; rarely used screens move under
  "More".

## 5. Stop-and-ask

- A journey needs a customer-facing message that is not yet approved (existing live-send gates win).
- A D-W3 row would change money (charge, refund, fee) automatically — always ask first.
- A tax rule here conflicts with a CPA answer recorded in `docs/OWNER-INPUTS.md`.
