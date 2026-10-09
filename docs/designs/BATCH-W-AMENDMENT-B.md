# Design — Batch W Amendment B: the connected business

Status: **APPROVED** (Chris, 2026-10-09: "Yes I approve of the plan" — IN-69; IN-70 answered with the set/out-of-service
rules in D-WB8). W-0C first; then the order in section 8. Written 2026-10-09 against `main` 53c1e65 after a read-only audit of intake, tax, the desk and the
portal (findings in section 1, with code references).

Chris, 2026-10-09: *"The whole thing should have a system that flows for anything that should be interconnected … so
that I can work with things as they come up."* … *"a washer and dryer set is not an item … it's just a grouping of
those 2 items"* … *"if I get audited, I want to be able to show: this is where this was covered, this appliance, I paid
tax on it here"* … *"anything showing a monetary value … in dollars and cents … layman's terms … a little info icon I
can click for a brief explanation"* … *"Read my intent here and build upon it."*

This amendment extends Batch W (approved, `BATCH-W.md`) from "tell the owner what to do" to "everything that is
connected in real life is connected in the app". It also amends Batch V (screens, section 9) and Batch F part 2
(final integration proof, section 10), and records what later batches inherit (section 11).

---

## 1. What the audit found (2026-10-09)

**Purchasing and inventory**
- Group intake (`src/app/desk/inventory/new-appliance-form.tsx`, `createApplianceUnits` in
  `src/domains/inventory/index.ts:188-260`) gives every unit the same model and **drops serial numbers** when the
  quantity is more than 1; the form tells the owner to add serials later, one appliance at a time.
- Nothing records that appliances were bought together: there is no purchase/receipt record, no seller field, and a
  receipt photo can belong to only one appliance (`Appliance.acquisitionReceiptPhotoId @unique`). The total seller tax
  is split equally across units (not by price), and the form mixes "cost each" with "total tax for the group".
- Purchase orders handle parts only, with no tax question and no link to appliances.
- **"Washer + Dryer Set" is an appliance type** (`prisma/seed.ts`, asset prefix "WDS"), so a set can be added to
  inventory as if it were one machine. Rentals already allow one line with several appliances (`RentalLine` →
  `ApplianceAssignment[]`, `itemMonthlyPriceCents` splits the line price) — the rental side is close; the catalog and
  inventory side is wrong.

**Flow between screens (dead ends, most important first)**
1. Ending a rental sets appliances to "awaiting pickup" but creates no pickup visit and no To do, and the ended
   agreement offers no "schedule pickup" button.
2. **Failed automatic card charges may never reach Today**: the past-due rule needs an invoice `dueDate`, which
   Stripe leaves empty on auto-charged invoices; partly paid invoices are ignored; the item links to the customer, not
   the invoice. (Must be verified first — W-0C.)
3. A failed payment at signing or for a quote deposit is only written to the audit log.
4. The owner is not told when a quote is approved or an agreement is signed; nothing says "signed, no delivery yet".
5. Converting a quote only refreshes the page; a converted lead offers "New agreement" but not "Create quote".
6. A customer's pickup request from the portal arrives as a repair request and defaults to a repair visit.
7. A failed inspection does not start a repair; there is no cleaning step between return and "available".
8. A new repair request appears on Today only after 2 days.
9. The agreement progress card has no button on most of its steps.

**Words and money on screen**
- Three settings screens still ask for amounts **in cents** (`desk/sales-tax/setup`, `desk/tax/use-tax-settings`).
  Money elsewhere goes through `formatCents`, but some panels format by hand and there is no shared money input.
- There is no info-icon component; explanations are scattered (`help` prop under fields, a few `<details>`).

**Customer portal** (`src/app/account`): customers can see rentals, end or renew them, see invoices and statements,
report problems and manage their card through Stripe — but cannot pay an overdue invoice in place, and they see no
"what happens next" after a request.

---

## 2. Rules for every screen (apply to all remaining batches; CI-checked where possible)

**R1 — Money is always dollars and cents.** Every amount a person sees reads like `$1,234.56`; every amount a person
types is in dollars (`12.50`), converted to whole cents only inside the app. No label, error, column or help text
says "cents". Negative amounts read "−$12.50" or "credit of $12.50" in words where it matters. One shared display
component (`<Money>`) and one shared input (`<MoneyInput>`) — no hand-written `/100`. *CI:* the plain-words check
(D-W7) fails on "cents" in user-visible desk/portal/public strings and on raw `/ 100` money formatting in `src/app`
and `src/components`.

**R2 — Plain words.** Buttons say what happens ("Schedule pickup", "Mark paid", "File and pay"); menus use everyday
names; statuses show their label, never the code (`AWAITING_PICKUP` → "Waiting for pickup"). The D-W7 banned-phrase
list grows with every PR that finds a new one.

**R3 — An ⓘ wherever something needs explaining.** A shared, accessible `<InfoTip>`: a small ⓘ button next to a label
or number; tap or click (or keyboard Enter) opens a two-to-four-sentence explanation in plain words, with "Learn more"
only when an owner-guide section exists; Escape or tapping elsewhere closes it; screen readers announce it. Texts live
in one glossary (`src/lib/glossary.ts`) so the same term is explained the same way everywhere (use tax, SUTS, set
price, prepaid discount, custody, …). Every setting, every tax number and every derived number gets one.

**R4 — Every save says what happens next** (D-W2, unchanged): a confirmation with the next step as a button, and the
item on To do if it is not done now.

**R5 — No dead ends.** Every record page shows a **Related** panel: the other records it is connected to, each one
click away (section 7). Every To do item and progress step has a working button (no `href: null`).

**R6 — Works on a phone.** Intake, visits, pickups and inspections are done standing in a garage or a laundry room:
those screens are designed phone-first (large targets, no sideways scrolling at 360 px, camera for photos and serial
numbers where the phone supports it).

---

## 3. Decisions

### D-WB1 — A purchase is a record: one receipt, many appliances, each with its own model and serial

New **Purchase** record = one seller, one date, one receipt: seller (an existing supplier, or a name typed for a
private seller/auction), purchase date, invoice/receipt number (optional), the receipt photo or PDF (one or more
pages), subtotal, **the tax exactly as printed on the receipt** and what kind it was (Colorado tax / another state's
tax / none / not sure yet), delivery or other charges, notes. Each appliance created from it links back to it.

**Intake becomes "Record a purchase"** (replaces "Add appliances you've obtained"):
1. *Who did you buy from, when, and the receipt* (photo from the phone camera or a file).
2. *What did you buy* — a grid, one row per appliance: type (Washer, Dryer, …), manufacturer, **model**, **serial**,
   price, condition, color. "Add another" adds a row; "Same as above" copies manufacturer/model/price down;
   "Bought several of the same model" asks how many and creates that many rows to fill in serials. On phones the
   serial field offers "Scan" (camera barcode reading where the browser supports it; typing always works).
3. *Tax on this receipt* — "Did the seller charge sales tax?" (no default, D-W2): **Yes** → "How much tax is on the
   receipt?" in dollars, and "Was it Colorado tax?"; **No**; **I'll check the receipt later**. The app splits the tax
   across the appliances **by price** (largest-remainder, so the pieces add up to the cent; equal split only when no
   prices) and shows the split before saving.
4. *Review* — "You're adding 4 appliances from Best Buy, Oct 9, total $2,140.00, tax paid $165.85" → **Save**.
5. *What happens next* — one card per outcome (D-WA6): "Tax was paid to the seller — nothing to file, receipt kept
   as proof" / "Use tax of $X goes on your Colorado return due Nov 20 (and Greeley's)" / "Check the receipt by
   Oct 12".

A "washer and dryer bought as a set" is **two rows** (D-WB3).

### D-WB2 — Every appliance carries its tax proof; one click gives an audit pack

On each appliance page, a **Tax proof** panel: how it was acquired (purchase, seller, date, receipt link), the price,
and exactly one of:
- **Tax paid to the seller** — $X (Colorado state, county, city as split from the receipt), receipt on file.
  *Nothing is reported to Colorado for these* — the seller already sent the tax; the receipt is the proof.
- **Use tax** — $X owed on the purchase price, the return it is on (Colorado DR 0252 for the state and state-run
  districts; Greeley's city return), the period, and once filed: date filed, confirmation number, date paid.
- **Bought tax-free to rent out** — the choice made, and that customers' rent on it is taxed.
- **Not decided yet** — what is missing, with the button that fixes it.

**Audit pack** (Taxes → Records): pick a date range (a year, or any range) → the app produces one printable page set
plus a spreadsheet file: every appliance and part bought in the range with asset number, model, serial, seller,
date, price, tax paid to the seller or use tax reported, the return and its confirmation number, and links to each
receipt; the use-tax returns filed with their confirmations; the sales-tax returns filed. This is what an auditor asks
for. Records are kept for at least the period the owner sets (setting, starting value **7 years** after the appliance
is sold or scrapped — longer than Colorado's usual 3-year look-back and the IRS's usual 3–7 years; to be confirmed by
the CPA, IN-71), and the app never deletes a receipt that a filed return relies on.

### D-WB3 — Rental sets are packages of separate appliances

- **Appliance types are real machines only** (Washer, Dryer, Refrigerator, Range, …). Every machine is its own
  inventory item with its own asset number, model, serial, history and tax proof — always.
- A **Rental package** (owner-defined, e.g. "Washer + Dryer Set") lists what it contains (one Washer + one Dryer), its
  **set price** per month, whether it shows on the website, and its order. The screen shows the saving automatically:
  "Renting both separately would be $70.00 a month; the set is $60.00 — the customer saves $10.00" (ⓘ explains).
- On a rental agreement a line is either **one appliance** (that type's price) or **a package** (the set price) with
  one appliance assigned per part (a washer and a dryer). The two machines in a set can come from anywhere in the
  fleet; nothing ties a particular washer to a particular dryer.
- **If one machine of a set comes back early or is taken away**, the rules in **D-WB8** apply (Chris, IN-70).
- Website pricing shows the package next to the single machines ("Washer $35 · Dryer $35 · Set $60 — save $10").
  The quote form and leads ask for "Washer", "Dryer" or "Set". Prepaid-term discounts treat a package line as a set
  (`prepay-discount.ts` already keys on two or more appliances on a line).
- **Moving existing data:** the "Washer + Dryer Set" type becomes the "Washer + Dryer Set" package (price kept); the type
  is retired so nothing new can be created under it. Any appliance already recorded with that type becomes a To do
  "Split WDS-0003 into a washer and a dryer" with a guided screen (two rows with their own model/serial; history and
  any rental assignment carried to the right machine). Leads and quotes that asked for a set point at the package.
  Signed agreements keep their signed wording; new ones use the package.

### D-WB8 — Machines that leave a rental early, swaps, and out-of-service credits (Chris, 2026-10-09, IN-70)

Chris: *"if one part of a set is returned early, then they will be charged at the standard rate for one item, unless
there is an exchange happening. If I brought one back but I don't have a replacement ready, then they should be
prorated on the next month for any time that they did not have the item."* Three situations, each a recorded choice
on the visit that takes the machine (never guessed):

1. **Customer keeps the rest, this machine is done** (customer returns one machine of a set, or the owner decides not
   to replace one): the rental line is amended with the existing "item taken off" amendment. From the day after the
   pickup, the machine that stays is billed at **its normal single-machine price** (its appliance type's current price,
   or the price on the agreement's price list if it has one). For the rest of the current billing period the customer
   is credited on the next bill: (set share − single price share) per day, using the existing per-day setting (monthly
   price ÷ 30 by default, or ÷ days in the month) — so they pay exactly the single price from that day. The
   subscription changes from the next period (existing provider-operation path). Prepaid-in-full rentals: the owner
   decides, as with early endings (existing rule).
2. **Exchange (swap) — replacement delivered on the same visit:** nothing changes on the bill. This is the existing
   swap flow.
3. **Taken away for service, no replacement yet:** the visit can now record "Taken for repair — no replacement
   yet" (today a swap refuses to take the old unit without delivering a new one). The line keeps its price, an
   **out-of-service period** starts on that machine's line, and To do shows "Return or replace <customer>'s dryer"
   (high after 3 days, owner setting). When a repaired or replacement machine of the same type is delivered, the
   period ends. On the **next bill** the customer gets a line `Credit – dryer out of service – N days`: the machine's
   share of the line price (a set's price split evenly per machine, as for late delivery) per day, using the same
   per-day setting, rounded once, never more than was billed for it. If the owner later decides not to replace it,
   situation 1 applies from that day.
   The same out-of-service credit applies to **any** rental line, not just sets (a customer whose only washer is taken
   for repair is credited for the days without it).

The customer always sees it in the portal and on the bill, in words and dollars: "Your dryer has been out for repair
since Oct 3. You'll get a credit of $11.67 on your next bill." Pickup day counts as a day they did not have it,
consistent with "the pickup day is not billed"; delivery day of the replacement counts as a day they had it.

### D-WB4 — The business is one set of connected flows

Each row says: when this happens → the app does this, at once and on To do, with one button. Rows marked ★ close a
dead end from section 1. Everything here is draft/To do creation only: **nothing is sent to a customer and no money
moves automatically** unless an existing approved rule already does it (existing live-send and payment gates stay).

| # | When this happens | The app does this |
|---|---|---|
| **Buying** |||
| B1 | A purchase is saved (D-WB1) | Appliances created in "Getting ready" (or Available), tax outcome card + To do (D-WA6), purchase listed on the seller's page and in the audit pack |
| B2 | "I'll check the receipt later" | To do in 3 days, high 7 days before the return covering it closes (D-WA6) |
| B3 | A return period closes | "File and pay $X by <date>" (W-9), with every purchase on it listed |
| B4 | Parts received on a purchase order | Same tax question as appliances; parts purchases join the purchase records and the audit pack |
| **Selling** |||
| S1 | New lead | "Contact <name>" due same day (IN-59) |
| S2 | Lead converted | Buttons "Create quote" and "Start agreement" ★ |
| S3 | Quote approved by the customer | Owner told at once + To do "Turn <name>'s quote into a rental" ★ |
| S4 | Quote converted | Opens the new draft agreement ★ |
| S5 | Agreement sent for signature, unsigned for N days (setting, start 3) | To do "Follow up: <name> hasn't signed" |
| S6 | Agreement signed | Owner told + draft delivery visit + To do "Schedule <name>'s delivery" (IN-58) ★ |
| S7 | Payment at signing or quote deposit fails | To do "<name>'s payment didn't go through — $X" with "Send a new link" / "Record payment" ★ |
| **Delivering and renting** |||
| D1 | Delivery visit has no time/technician 2 days before | "Assign / set a time" |
| D2 | Delivery done | Appliances "Rented", billing starts (exists), installation visit drafted if the agreement includes installation |
| D3 | Automatic charge fails / invoice partly paid | Same day: "<name>'s payment failed — $X" → **the invoice**, buttons Retry / Send reminder / Record payment ★ |
| D4 | Rental ends in 30 days (setting) | "Renew, month-to-month or pickup?" (W-4) |
| **Service** |||
| M1 | Customer reports a problem | To do **at once** "Review <name>'s repair request" ★ |
| M2 | Customer asks for a pickup (portal) | Arrives as a **pickup request**, draft pickup visit, not a repair ★ |
| M3 | Repair visit finished | Request resolved or back to review (exists); "Record repair cost" if missing (exists) |
| **Ending** |||
| E1 | Rental ended (any way) | Draft pickup visit + To do "Schedule <name>'s pickup" + agreement page button ★ |
| E2 | Pickup done | Appliance "Waiting for inspection" (exists) |
| E3 | Inspection | Passed → **"Cleaning"** → Available; failed → repair visit drafted ★ |
| E4 | Appliance unrentable (owner choice) | Retire/sell/scrap flow (Batch M), tax proof and book value kept |

### D-WB5 — Connected record pages

Every main record page gets a **Related** panel and a short **History** timeline (from the existing activity log),
both styled once and reused:
- **Appliance:** purchase + receipt + tax proof · current and past rentals (customer, dates, revenue) · visits and
  repairs with costs · parts used · photos · status history · book value (after Batch K).
- **Customer:** rentals, quotes, invoices and balance, visits, repair requests, messages (after COM-L), documents.
- **Rental agreement:** customer, each line (single or package) with its appliances, visits, invoices, notices.
- **Purchase:** seller, receipt, every appliance and part on it, tax outcome and the return it went on.
- **Seller (supplier):** every purchase and purchase order, totals by year.
- **Visit/job:** agreement, customer, appliances, request it came from, parts used.
- **Invoice:** customer, agreement, payments, tax lines (and the return they were reported on).
Search finds appliances by **serial number and model**, purchases by seller or receipt number.

### D-WB6 — The customer portal follows the same flows

Customers see, in plain words and dollars: what happens next after every action ("We'll call you within one business
day to schedule your pickup"), the status of their delivery/pickup/repair as a short timeline, the next bill amount
and date, and **"Pay now" on an overdue invoice** (existing hosted payment pages; no new payment provider). A pickup
request is its own choice, not a repair. Package lines show as "Washer + Dryer Set (washer #…, dryer #…)".

### D-WB7 — Filing: as automatic as Colorado allows (restating Amendment A for clarity)

Use tax accrues **as purchases are recorded throughout the month**; one return per period carries all of them
(annual, due January 20, while the year's total is $300 or less; monthly, due the 20th of the next month, once it
passes — already built, with weekend/holiday dates). The app fills in every number and the official DR 0252 and tells
the owner exactly what to submit and when (W-9, W-10). **Colorado's GIS service only looks up tax rates — it cannot
file or pay a return**, and Revenue Online offers no way for software to submit a consumer use-tax return, so the last
click (submit and pay) stays the owner's (D-WA2). If Colorado ever offers a filing interface, W-10's guided panel is
the place to plug it in.

---

## 4. Schema (additive, one migration per PR that needs it)

- **`Purchase`** (W-14): `id`, `supplierId?` (existing `Supplier`), `sellerName?` (private seller), `purchasedOn`
  (date), `reference?` (receipt/invoice number), `subtotalCents`, `sellerTaxCents`, `sellerTaxKind`
  (`COLORADO | OTHER_STATE | NONE | UNKNOWN`), `otherChargesCents`, `notes?`, `createdByUserId`, timestamps.
  **`PurchaseDocument`**: `purchaseId`, upload reference (existing private storage), `kind` (`RECEIPT | INVOICE |
  OTHER`), `pageOrder`. `Appliance.purchaseId?` (FK). Existing per-appliance acquisition fields stay and are filled from
  the purchase (allocated tax, cost); `acquisitionReceiptPhotoId` stays for old records and is no longer written.
  `PurchaseUseTax` stays one row per appliance or part (no new source type).
- **`RentalPackage`** (W-16A): `id`, `name`, `slug`, `monthlyPriceCents`, `showOnWebsite`, `sortOrder`, `isActive`,
  `photoUrl?`; **`RentalPackageComponent`**: `packageId`, `applianceTypeId`, `quantity`. `RentalLine.packageId?` (FK);
  `EstimateLineItem.packageId?`; `LeadApplianceRequest.packageId?`. (Partial returns follow D-WB8 — single-machine
  price, decided by Chris; no setting needed.)
- **`OutOfServicePeriod`** (W-21): `rentalLineId`, `applianceId`, `startedOn`, `endedOn?`, `startJobId`, `endJobId?`,
  `creditedOnInvoiceId?`; business setting `outOfServiceEscalationDays` (start 3). Credits reuse the late-delivery
  per-day setting and invoice-line machinery.
- **`ApplianceStatus`** gains `CLEANING` (W-17); lifecycle rules in `BUSINESS-RULES.md` updated in that PR.
- Backup manifest, schema-health list and `DATABASE.md` updated in each PR (PLAYBOOK 4c).

## 5. Money, tax and permission rules

- All amounts stored as integer cents; allocation by price uses `allocateAcrossLines` (largest remainder); totals
  always reconcile to the receipt to the cent (tested).
- Purchases, packages and the audit pack: OWNER and ADMIN only (letting a staff member record purchases comes with
  Batch O's per-person permissions). Customers never see purchases, costs or tax proof.
- A purchase whose tax was already reported on a **filed** return cannot change its tax silently: editing it creates
  the amendment To do (existing `detectTaxFilingAmendments`).
- Packages never change a signed agreement's price; package price changes follow the existing scheduled price-change
  rules and are shown with their customer impact (V-C1 "used on the website and in quotes").

## 6. Work units (PRs) — each writes its card at start; order in section 8

| PR | Builds | Risk | Migration |
|---|---|---|---|
| **W-0C** | Failed automatic charges reach To do (section 6.1) — **confirmed defect, not gated on IN-69** | money | none |
| **W-18** | Plain-language kit: `<Money>`, `<MoneyInput>`, `<InfoTip>` + `src/lib/glossary.ts`; convert the three cents inputs and hand-formatted panels; extend D-W7 to fail on "cents" and raw `/100`; status labels helper | screens | none |
| **W-14** | Purchases: `Purchase` + documents + "Record a purchase" flow (seller, receipt, grid with model/serial per appliance, tax split by price, review, what-happens-next); seller page lists purchases | money | 1 |
| **W-15** | Tax proof panel on appliances; audit pack (range → printable pages + spreadsheet); retention setting with ⓘ; parts purchases (PO receiving) ask the tax question and join the records | compliance | none or 1 |
| **W-16A** | Rental packages: schema, set price with automatic "saves $X", partial-return pricing setting, migration of the set type, "split into washer and dryer" To do + guided screen | money | 1 |
| **W-16B** | Packages in quotes, agreements (assign one machine per part), leads and the public pricing page | money/screens | none |
| **W-17** | Connected records: Related panel + History on appliance, customer, agreement, purchase, seller, visit, invoice; search by serial/model/seller; `CLEANING` status and inspection → cleaning/repair (E3) | screens | 1 (enum) |
| **W-19** | Flow gaps not covered by W-4…W-6: S2, S4, S5, S7, M1 (immediate), M2 (pickup requests), E1 (pickup after any ending), progress-card buttons everywhere | operations | none |
| **W-20** | Portal follows the flows (D-WB6): next-step messages, status timelines, next bill, "Pay now" on overdue invoices via the existing hosted payment page, packages shown as sets | money/screens | none |
| **W-21** | Machines leaving early (D-WB8): single-price repricing with partial-period credit, "taken for repair — no replacement yet" visit result, out-of-service periods and credits on any line, portal/bill wording, To do to return or replace | money | 1 |

### 6.1 W-0C — failed automatic charges must reach To do (confirmed 2026-10-09; runs next, before COM-L2)

Confirmed in code at `main` 53c1e65: `handleInvoicePaymentFailed` (`src/domains/billing/webhooks-base.ts:855`)
returns early when the invoice already exists (`:869-873`), so an invoice first recorded as OPEN stays OPEN after its
charge fails; when it does create the invoice it is DELINQUENT with `dueDate` copied from Stripe's `due_date`
(`:891`), which is empty for automatically charged subscription invoices; and the Today rule
(`src/domains/exceptions/index.ts:203-206`, `:851`) only shows invoices whose `dueDate` is before now. Result: a failed
automatic charge never appears on To do. Live payments are not on yet, so no customer is affected — but it must be
fixed before any card is charged for real.

Contract (no new statuses, no schema change):
1. A failed-payment event for an invoice already on record moves it to DELINQUENT (unless it is already PAID or
   VOID), records the failed attempt, and is idempotent per Stripe event (existing evidence/dedupe).
2. "Needs attention" for invoices = DELINQUENT (any `dueDate`), PARTIALLY_PAID, or OPEN past its `dueDate`; the item
   shows the amount still owed in dollars, links to **the invoice page** (`/desk/billing/customer/{customerId}/invoice/
   {invoiceId}`), and sorts by the failure date when there is no due date.
3. Late fees keep their current rule (they need a due date) — record in BUSINESS-RULES that auto-charge invoices get
   their late-fee clock from the first failed attempt only if the owner later approves it (not in this PR).
Tests: webhook replay — existing OPEN invoice + failed event → DELINQUENT once; new invoice with no `due_date` →
appears on Today; PARTIALLY_PAID appears; PAID never regresses; link resolves (route inventory).

Existing W PRs absorb these rows: **W-2** (intake next steps) now builds on W-14's purchase flow; **W-4** covers D4/E1
drafts already planned; **W-5** covers D3 after W-0C; **W-6** covers S1/S3; **W-8**'s menu adds "Purchases" under
Equipment and "Records" under Taxes.

## 7. Tests (each PR)

- Purchase: 4 appliances, 1 receipt with $165.85 tax → each appliance has its own model/serial, tax split by price sums
  to $165.85 exactly; private seller; seller tax "another state" → CPA To do (IN-65); edit after the return was
  filed → amendment To do.
- Audit pack: a year with seller-taxed, use-taxed and tax-free-for-rent appliances → every serial appears once with
  the right proof, returns with confirmation numbers; spreadsheet columns stable; customers and staff without
  permission get 404.
- Packages: set price + saving shown; line with a washer and a dryer from different purchases; one returns early →
  single price from the day after pickup and the partial-period credit is exact; swap changes nothing; taken for repair
  without replacement → credit for exactly the days without it (pickup day counted, replacement-delivery day not),
  never more than billed; same on a single-machine line; old "set" appliance split keeps its history; website and quote show packages.
- Flows: each ★ row has a test that the trigger creates exactly one To do (idempotent on re-run) with a working
  button (route inventory check), and that nothing is sent or charged.
- Kit: CI check catches "cents" in a label and a raw `/100`; `<InfoTip>` passes axe and keyboard tests; `<MoneyInput>`
  rejects "12.345" and accepts "1,234.50".

## 8. Order (replaces the W order in `MASTER-ROADMAP.md`)

**W-0C next** (after the PR in flight) → COM-L … COM-L15 → **W-1 → W-18 → W-14 → W-2 → W-15 → W-3 → W-4 → W-5 →
W-6 → W-7 → W-8 → W-9 → W-10 → W-16A → W-16B → W-21 → W-19 → W-17 → W-20** → V → F-part-2. W-11/W-12/W-13 run when their
outside gates clear. (`docs/pr-cards/work-index.json` holds the same chain.)

## 9. Batch V amendment (screens)

V keeps its approved visual direction and adds:
- **The kit everywhere:** every V screen uses `<Money>`, `<MoneyInput>`, `<InfoTip>` and status labels; V acceptance
  adds "no 'cents' anywhere a person can read it" and "every setting, tax number and derived number has an ⓘ".
- **New screens to style** (built in W, styled in V): Record a purchase (phone-first grid with Scan), Tax proof panel,
  Audit pack, Rental packages, Related panel and History timeline, portal status timelines and Pay now.
- **Phone-first acceptance** for intake, visits, pickups and inspections at 360 px; desk and portal navigation use the
  W-8 names.
- **V-3 (desk and portal polish)** grows from "polish only" to "polish plus consistent Related/History/To do
  components"; behavior still comes from W (V does not change routes, permissions, money or statuses).

## 10. Batch F part 2 amendment (final integration)

F-part-2 proves the whole business works as connected flows, through the real screens and database:
- **New scenario files** (added to WU-F3): 13 purchase-to-audit (receipt with 4 appliances → use tax → period closes
  → File now → confirmation → audit pack shows every serial); 14 set lifecycle (package quote → agreement with a
  washer and a dryer → one returns early → repricing → pickup → inspection → cleaning → available); 15 ending to ready
  (each ending path creates the pickup, inspection, cleaning/repair chain); 16 failed charge to recovery (auto-charge
  fails → To do → customer pays now in the portal → To do clears); 17 portal journeys (request pickup, report a
  problem, see status, pay now).
- **Connection check:** an automated walk of every record page asserting its Related panel links resolve and every
  To do item's button opens a real page (extends the route inventory).
- **Owner walkthrough** (`10-owner-workflow`) adds: record a purchase of a washer and dryer with serials, see the use
  tax land on the return, create a set rental, end it and follow the pickup chain, produce an audit pack.
- **Plain-words and money audit:** the D-W7 check runs over the final product with zero allowlist growth unexplained.

## 11. What later batches inherit (log in `CHANGES-SINCE-DESIGN.md`)

- **K (books):** purchases are the source documents for the asset register, depreciation and expenses (K-6 reads
  `Purchase` and its allocated costs); the audit pack's year view is the base of the year-end package.
- **M (sales/retirement):** retiring or selling a machine starts from its appliance page (Related shows the purchase
  and tax proof); selling a "set" means two machines.
- **COM-L / COM-N:** customer messages at flow turning points (S6, D1, E1, M2) reuse these triggers; send gates stay.
- **BP (commercial):** commercial bundles build on rental packages.
- **O (settings history):** the new settings (out-of-service escalation days, unsigned follow-up days, retention years)
  join settings history and undo.

## 12. Owner decisions

- **IN-69** — approve this amendment (sections 2–11).
- **IN-70** — answered 2026-10-09: single-machine price unless it is an exchange; out-of-service days credited (D-WB8).
- **IN-71** — how long to keep purchase and tax records (starting value 7 years after the appliance leaves the fleet;
  ask the CPA).

## 13. Stop-and-ask

- A flow row would send a customer message or move money automatically — ask first (gates stay).
- The failed-charge verification (W-0C) shows a different cause than section 1 describes — record evidence, then fix.
- Splitting an existing "set" appliance would change a signed agreement — keep the signed record; ask.
- A CPA answer (IN-44, IN-65, IN-71) contradicts a rule here.
