# Design — Batch M: Shop sales (merchandise) and what happens to retired appliances

Status: **APPROVED DESIGN — implement from this document** (Chris, 2026-10-07: "I plan on also reselling … small items
… washer hoses, power cords for dryers … If I retire an appliance, I may choose to sell it … I may tear it down for scrap
metal … receive a check … or I just have to dispose of it in the garbage, in which case it may cost me money").
Runs **after Batch K** (Chris, 2026-10-07, IN-47: "Preferably not until after launch … I am really trying to get this
system done before I actually begin business" — so no shop sales before launch and no reason to move this batch up).
Needs Batch T (tax engine, returns, delivery fee) and Batch K (expenses, book values). Three PRs.

> **Implementation gate (2026-10-07).** A readiness audit found that the PRs built from this design are larger than the
> PR budget and leave some details open (exact signatures, permissions, migration ownership, a few contradictions).
> They are being turned into **one implementation card per PR** in `docs/pr-cards/` — a short, self-contained file that
> settles every open detail, lists exactly what to read, which files to touch and which tests to run, and overrides
> this section where they differ. **Do not start M-1, M-2 or M-3 (or any split of them) until its card exists in `docs/pr-cards/`. If it does not, stop
> and report.** The decisions and reasons in this section stay authoritative.

**Until Batch M is built the app cannot record a shop sale.** Selling items before then means recording the sale and its
sales tax outside the app and adding it to the SUTS return by hand — the owner guide says so.

---

## 0. Verify before starting

| # | Assumption | How to check |
|---|---|---|
| M-A1 | Parts stock is an append-only ledger: `PartRecord.quantityOnHand` + `PartStockMovement` (kinds `OPENING_BALANCE RECEIPT USAGE ADJUSTMENT RECOUNT REVERSAL`), receiving via purchase orders, `recordPartUsage` for repairs. | schema lines around `model PartRecord` / `PartMovementKind`; `src/domains/purchasing` |
| M-A2 | Appliances have `status RETIRED` and a guided "retire" action (`retireApplianceAction`) on the appliance page; RETIRED is final. | `src/app/desk/inventory/[id]/guided-actions-panel.tsx` |
| M-A3 | Batch T is merged: `computeTax`, `TaxChargeCategory`, local invoices with `InvoiceTaxLine`, the manual-payment action, D-T14 manual-payment-only local invoices, the retail delivery fee (section 12), `PurchaseUseTax` (3.6). | `src/domains/tax` |
| M-A4 | Batch K is merged: expenses (D-K8), depreciation and the disposal write-off (D-K9); S-K6 points here. | `docs/designs/BATCH-K.md` |

## 1. Decisions

### D-M1 — Items for sale are parts marked "sold to customers" (one stock ledger, not two)

A hose may be installed during a delivery *or* sold over the counter, so merchandise reuses the parts ledger.
`PartRecord` gains `sellable Boolean @default(false)`, `retailPriceCents Int?` (owner-set price, shown with "your cost"
and margin) and `defaultForResale Boolean @default(false)` (only pre-ticks the "bought for resale" box on new purchase
order lines for this item — it never decides tax by itself). New movement kind **`SALE`** (stock down, linked to the
invoice line). Screens: Parts gets a filter "Items I sell" and the item form gains a "Sell to customers" section (price,
"usually bought for resale") — explained on screen.

**Resale is tracked per purchase, not per item (review fix).** The same hose can have some units bought tax-paid and
later units bought tax-free with a resale certificate, so the answer lives on each purchase:
- `PurchaseOrderLineItem.forResale Boolean @default(false)` — ticked on the purchase order line (pre-ticked from
  `defaultForResale`), frozen once the line is received.
- `PartRecord.resaleUnitsOnHand Int @default(0)` — how many of `quantityOnHand` came from resale purchases (always
  `0 ≤ resaleUnitsOnHand ≤ quantityOnHand`; a database CHECK enforces it), and `PartStockMovement.resaleUnits Int
  @default(0)` — how many of that movement's units were resale units (same sign as `quantityDelta`).
- **Which units a movement uses (fixed rule, no choice):** a `RECEIPT` adds `resaleUnits = quantity` when its line is
  `forResale`, else 0. A `SALE` takes resale units first: `resaleUnits = −min(qty, resaleUnitsOnHand)`. A `USAGE` or a
  downward `ADJUSTMENT`/`RECOUNT` takes ordinary units first and only the shortfall from resale units:
  `resaleUnits = −max(0, qty − (quantityOnHand − resaleUnitsOnHand))`. `SALVAGE` (D-M4) adds ordinary units. A
  `REVERSAL` undoes exactly the original movement's `resaleUnits`. Upward `ADJUSTMENT`/`RECOUNT` add ordinary units.
- **Resale cost on hand (moving average — review fix):** `PartRecord.resaleCostOnHandCents Int @default(0)` holds the
  total cost of the resale units still in stock. A resale `RECEIPT` adds `quantity × unitCostCents`. A movement that
  takes resale units removes `round_half_up(|resaleUnits| × resaleCostOnHandCents / resaleUnitsOnHand)` — or, when it
  takes the last resale units, exactly what remains — so the cost of sold-out batches never lingers. A `REVERSAL`
  restores exactly the cost its original movement removed (stored as `PartStockMovement.resaleCostCents Int
  @default(0)`, same sign as `resaleUnits`). **Resale unit cost** = `resaleCostOnHandCents / resaleUnitsOnHand`; used
  only for use tax below and the margin on screen. Test: sell out a $5 batch, receive a $10 batch, use one → use tax
  on $10, not $7.50.

### D-M2 — Buying for resale and taking stock for your own use (use tax)

- A purchase order line received with `forResale` creates **no use tax** (3.6 records `NOT_DUE`, reason "Bought for
  resale").
- When a `USAGE` or downward `ADJUSTMENT`/`RECOUNT` movement takes resale units (`resaleUnits < 0` by the rule in D-M1 —
  a repair, an installation, given away, lost), Colorado treats that as taking them out of resale stock for your own
  use, so the app records **use tax on their cost**: the `resaleCostCents` that movement removed (D-M1) (`PurchaseUseTax`, `sourceType
  "PART_WITHDRAWAL"`, `sourceId` = the movement id, on the use-tax return like any other — Amendment D 15.5). Tax-paid
  units never owe it, so a mixed stock is never taxed twice and never missed. A `REVERSAL` of that movement cancels the
  use-tax row (or, if its return is already filed, opens an amendment like any other change — 11.12).
- The owner guide explains giving suppliers your Colorado sales tax license / resale certificate (the CPA confirms the
  form, IN-46).

### D-M3 — Selling items: a "Sale" is a local invoice

**Desk → Customers & sales → Sales** (`/desk/sales`, OWNER/ADMIN; STAFF can ring up if the owner allows it later —
not in this batch): "New sale" for an existing customer or a **walk-in** (name optional; no portal account).
- **Walk-ins (review fix — every invoice needs a customer):** all walk-in sales belong to **one built-in "Walk-in
  sales" customer**, created on first use by `ensureWalkInCustomer(tx)` (idempotent; `Customer.isWalkIn Boolean
  @default(false)` with a partial unique index so at most one exists). Its `User` row has role CUSTOMER, name "Walk-in
  sales", email `walk-in-sales@customers.invalid` (the `.invalid` domain can never receive mail), no password and no
  login account, so nobody can sign in as it. The buyer's name, if given, goes in `Invoice.walkInName`. The walk-in
  customer is hidden from customer lists, search, notices, referral and launch lists and every customer email (a
  test proves each list excludes `isWalkIn`), but its invoices appear in sales, tax returns and exports like any other.
  A walk-in *delivery* needs an address, so a delivered sale requires an existing customer (create one first —
  the screen says so); walk-ins are pickup only.
- Lines: sellable parts (price prefilled, editable with a reason if lowered), a used appliance (D-M4), or a delivery /
  installation charge (existing categories).
- **Where the sale happens decides the tax** (Colorado is destination-based): *picked up at the shop* → the business
  location's tax areas; *delivered or installed* → the customer's address (address check like any rental address,
  D-T3). New `TaxChargeCategory` values `MERCHANDISE` and `USED_APPLIANCE_SALE` join the "What's taxed" grid; the
  "common Colorado starting answers" button fills both as Taxable (sales of goods are taxable) for the CPA to confirm.
- **Retail delivery fee:** a delivered sale of taxable goods is a retail delivery — the fee rules of section 12 of
  BATCH-T apply (status, small-business exemption, handling, return). Pickups never owe it. **Shop-sale record shape
  (review fix):** when a DELIVERED sale is completed with at least one line taxable for the state jurisdiction at the
  delivery address, write one `RetailDeliveryFeeRecord` with `saleKey = "retail:<invoiceId>"`, `invoiceId` set,
  `agreementId` and `firstJobId` null (BATCH-T 12.3 allows this only when `invoiceId` is set), `deliveredOn` = the
  sale's delivery date entered on the sale (default: the completion date, Denver), `saleOn` = the completion date (the
  sale happens then — not a first rent charge), and status/rate/amount by 12.4. When collected from the customer, the
  fee is a line on the same sale invoice (it is created before the invoice is finalized). A refund of the whole sale
  follows the 12.5 credit rules.
- Payment: recorded with the existing manual-payment action (cash, check, card on a reader outside the app) —
  card-in-portal payment is PR M-3. The receipt prints/emails from the invoice (existing invoice view).
- Stock: a `SALE` movement per line at the moment the sale is completed; a refund/return of an item creates a
  `REVERSAL` (back in stock) or an `ADJUSTMENT` (damaged, not resellable) plus the existing refund flow with its tax
  (D-K10).
- Sales flow into the SUTS return packet automatically (they are invoices with tax lines), into revenue reports as
  **"Shop sales"** (separate from rental revenue), and into Batch K as income: item lines to `MERCHANDISE_INCOME`
  "Item sales", used-appliance lines to `RETIRED_APPLIANCE_SALES` "Sales of retired appliances". **No cost of goods sold
  is posted (review fix):** Batch K D-K8 already expenses every part — resale stock included — when it is bought, so
  posting its cost again at sale would count it twice. The on-screen margin ("price − resale unit cost") is
  information only.
- **New invoice line kinds:** `InvoiceLineItemKind` gains `MERCHANDISE` and `USED_APPLIANCE`; the BATCH-T 3.1 category
  map sends them to `TaxChargeCategory.MERCHANDISE` and `USED_APPLIANCE_SALE`.

### D-M4 — Retiring an appliance: out of rental right away, then "what's next for it"

Revised 2026-10-07 after Chris's answer: *"the retire process … should pull the system out of rental availability. And
then I need to decide what category to put it into next … sell it, scrap it, or dispose of it, or even use it for parts
… strip it down … add some of its still working parts into inventory. And then I would get rid of the rest. I guess I
don't need to track scrapping or disposal fees per item. I think I just need to track what I decide to do with it."*

**Step 1 — Retire (already built, unchanged).** "Retire this appliance" on the appliance page (`retireAppliance`,
reason required) sets status RETIRED. That already takes it out of everything rentable: it cannot be put on a rental,
offered for a swap, reserved or shown as available (RETIRED is final; custody check stays). Nothing about this step
changes except that the panel now also asks step 2's question — answering it is optional ("Decide later").

**Step 2 — "What's next for it?"** One choice per retired appliance, changeable until it is marked done:

| Choice | What it means | Marked done when | Tax |
|---|---|---|---|
| **Sell it** | listed for sale; it appears in the "used appliances for sale" picker on the Sales page | the Sale (D-M3) is completed — automatic | sales tax by where the buyer takes it (D-M3); delivery fee if delivered |
| **Strip it for parts** | take the working parts, then get rid of the rest | owner adds the parts kept (step 3) and picks what happened to the rest: scrapped or thrown away | none |
| **Scrap it** | goes to a scrap yard | owner taps "Done" (date; photo optional) | none by default — a sale to a scrap dealer is normally a sale for resale; the CPA confirms (IN-46) |
| **Throw it away** | goes to the dump / garbage | owner taps "Done" (date; photo optional) | none |
| **Donate / other** | anything else | owner taps "Done" (date, short note) | none |
| *(no choice yet)* | "Decide later" | — | — |

**Step 3 — Parts kept from a stripped appliance.** "Add parts to stock" opens a short list: pick an existing part
(e.g. "Dryer heating element") or create a new one, quantity, condition note. Each line is a new stock movement kind
**`SALVAGE`** (stock in, linked to the appliance) at **$0 cost** — what the part cost is already inside the appliance's
purchase price, so counting it again would double it (screen says so; the CPA can confirm, IN-46). Salvaged parts then
behave like any other part: used on repairs (no use tax — they were not bought for resale) or, once Batch M's selling is
on, sold over the counter (taxed like any sale). The appliance page lists "Parts taken from this appliance".

**No per-appliance fees (Chris's call — agreed).** The app does **not** ask what a scrap yard paid or what the dump
charged *for each appliance*. Those amounts still matter for your income taxes, so they are recorded the ordinary way,
in a lump, when they happen:
- **Dump or disposal fees** are a normal expense (Batch K D-K8) in a seeded category **"Dump and disposal fees"** — one
  expense per trip with the receipt photo, however many appliances were on the truck.
- **Scrap-yard checks** are a lump **"Scrap money received"** entry (date, amount, scrap yard, photo of the check or
  ticket, optional note) on `/desk/inventory/retired` — one entry per check, not split by appliance. It posts to a new
  income account **`SCRAP_INCOME` "Scrap sales"** in Batch K.
- **Your own profit numbers (Batch K) — one disposition path (revised 2026-10-08):** K-6 stops rental depreciation and transfers the net book carrying value of SELL/DECIDE_LATER units into a pending-disposition asset; marking RETIRED is **not** an automatic complete disposal loss. Choosing or changing a plan never produces sale income or federal depreciation recapture. Upon actual sale M-2C posts the invoice and triggers one K-6-approved balanced asset disposal/gain-loss posting, without re-expensing original cost. Gross proceeds are a separately displayed sales metric, while book gain/loss is **proceeds minus remaining book carrying amount and seller costs**. Scrap proceeds → `SCRAP_INCOME`; dump fees → ordinary expense; both remain lump records as originally approved. Section 1245 federal recapture is a **CPA-backed tax-basis estimate**, not 60-month book depreciation and not a maximum resale-price rule. See [retired appliance sale/tax-basis design](RETIRED-APPLIANCE-RESALE-TAX-2026-10-08.md). CPA guidance on scrap allocations (IN-46) remains pending.

### Retired rental appliance resale — tax-basis preview and no price ceiling (owner clarification 2026-10-08)

A retired appliance that is sold is **not a resale-stock purchase** and must not be costed or taxed like newly purchased merchandise. Preserve its original appliance ID, acquisition receipt, original tax-paid/use-tax status, date placed in rental service, rental/repair history, retirement date/reason, disposition category and sale provenance. The original acquisition tax does **not** automatically exempt an otherwise taxable new retail sale to the buyer. Use actual customer pickup/delivery sourcing and the separate Colorado retail delivery fee decision; never charge RDF on a scrap-yard payment merely because an appliance was moved.

At `Retired > Sell it`, show a **non-blocking estimated income-tax disposition preview** with:
- Original tax basis (cost plus eligible basis additions, excluding amounts already expensed), adjusted basis, selling expenses, selling price *excluding buyer sales tax*, depreciation allowed **or allowable** (including section 179/bonus where applicable), and expected gain/loss. Capture the actual tax depreciation method and adjustments supplied by the owner/CPA; do **not** substitute Batch K's straight-line *book* depreciation for the IRS amount.
- Estimated section 1245 ordinary-income depreciation recapture = `min(max(0, recognized gain), depreciation recapture pool)` for a typical depreciable personal-property asset; any excess gain is separately identified as potentially section 1231 (depending on holding period and other rules). This is a **planning estimate, not an automatic income-tax return**. Actual disposition and Form 4797 classification remain with the CPA.
- Example (before selling costs): $500 original basis, $400 tax depreciation, $100 adjusted basis; $500 sale => $400 gain, generally all $400 section 1245 ordinary income. Even a $600 sale is **allowed**; the additional $100 gain may have different income-tax character.
- An amber **Missing tax-basis / CPA review** state if deductions, allowed/allowable amounts, capitalized improvements, sale allocation or prior entity ownership are unknown. Owner may still select 'Sell it' and create a draft price/offer; the app cannot pronounce a final tax estimate or fake $0 depreciation. Retain sale and tax-basis histories so the CPA can correct estimates without rewriting finalized receipts or posted journals.
- Sales tax / RDF on the **customer-facing sales invoice** remains independent from federal income-tax recapture. Collected sales tax is liability, not part of the owner's sales proceeds for gain calculations. A future accounting export must not double count original rental-asset cost: K already posted the remaining book-value loss at retirement, so M's later sale proceeds post **once** as asset-disposition income and are correlated to that disposal; no new COGS or second write-off.
- Owner may choose any defensible market sale price: **never block prices equal to or above original cost, depreciation claimed, or remaining basis.** Show clearly that potential tax increases with gain; do not confuse recapture with an extra tax equal to the gain.
- Recording 'sell', 'scrap', 'parts', 'donate' or 'dispose' captures an actual business-asset disposition date and method for Form 4797 / CPA review. A mere planned resale or listing is **not yet** a disposition or taxable sale.

Implementation dependency: Batch K's fixed-asset book ledger and CPA-provided tax-basis snapshot; M's sale workflow must preserve both **separately**. Neither code path may make decisions about federal elections or file a federal return. Colorado source: Department of Revenue sales/use tax guidance. Federal sources: IRS Pub. 544 and Form 4797 instructions. IN-46 remains an explicit CPA approval gate for unusual scrap and use-tax cases.

**Where to see it.** `/desk/inventory/retired` (a tab on Inventory): every retired appliance with its plan and whether
it is done, filters "Decide later / Sell / Parts / Scrap / Throw away / Done", bulk "Mark done" for a truckload, and the
"Scrap money received" list. **Reminder:** a retired appliance with no plan, or a plan not done, after
`retiredFollowUpDays` (owner setting, starting value **30 days**, 0 = never remind) shows one Today item "Retired
appliances waiting on a decision (n)" linking to that page — never per appliance, never blocking anything. Appliances
retired before Batch M simply show "Decide later".

### D-M5 — Owner-configurable

Retail prices, "bought for resale" per item, whether STAFF may ring up sales (setting starts **off**), whether the price
can be lowered at the counter and by how much (starting value: owner/admin only, any amount with a reason), the default
scrap yard name, the retired follow-up reminder days — all stored settings explained on screen. No price is hard-coded.

## 2. Schema (additive) — migration `<timestamp>_batch_m_shop_sales`

```prisma
enum RetiredPlan { SELL STRIP_FOR_PARTS SCRAP DISPOSE DONATE_OR_OTHER }
enum RetiredRemainder { SCRAPPED DISPOSED }
// PartMovementKind gains SALE and SALVAGE
// TaxChargeCategory gains MERCHANDISE, USED_APPLIANCE_SALE (and SCRAP_SALE only if IN-46 says taxable)

// PartRecord additions: sellable Boolean @default(false), retailPriceCents Int?, defaultForResale Boolean @default(false),
//   resaleUnitsOnHand Int @default(0), resaleCostOnHandCents Int @default(0)
//   -- CHECK (0 <= resaleUnitsOnHand AND resaleUnitsOnHand <= quantityOnHand AND resaleCostOnHandCents >= 0)
// PurchaseOrderLineItem addition: forResale Boolean @default(false)
// PartStockMovement additions: resaleUnits Int @default(0), resaleCostCents Int @default(0),
//   invoiceLineId String? (SALE), applianceId String? (SALVAGE)
// InvoiceLineItemKind gains MERCHANDISE, USED_APPLIANCE
// Customer addition: isWalkIn Boolean @default(false)  -- partial unique index: at most one row WHERE isWalkIn
// Invoice additions: saleKind String? ("SHOP_SALE"), walkInName String?, saleLocation String? ("PICKUP" | "DELIVERED")
// BusinessSettings addition: retiredFollowUpDays Int @default(30)

model RetiredAppliancePlan {
  id               String            @id @default(cuid())
  applianceId      String            @unique      // only RETIRED appliances
  plan             RetiredPlan
  remainder        RetiredRemainder?              // STRIP_FOR_PARTS only, required when marked done
  doneOn           DateTime?                      // null = planned, not done yet
  invoiceId        String?                        // SELL: the completed Sale
  photoId          String?
  note             String?
  decidedByUserId  String
  doneByUserId     String?
  createdAt        DateTime          @default(now())
  updatedAt        DateTime          @updatedAt
}

model ScrapPayment {
  id               String   @id @default(cuid())
  receivedOn       DateTime
  amountCents      Int                            // > 0
  scrapYard        String
  photoId          String?
  note             String?
  recordedByUserId String
  voidedAt         DateTime?                      // corrections: void with a reason, never delete
  voidReason       String?
  createdAt        DateTime @default(now())
}
```

Plan changes and "done" are audited (old → new); a done plan can be reopened by the owner only, with a reason (no
journal effect — see D-M4). Backup
coverage and schema health for both tables. Batch K additions: income account `SCRAP_INCOME` "Scrap sales", seeded
expense category "Dump and disposal fees", income accounts `MERCHANDISE_INCOME` and `RETIRED_APPLIANCE_SALES`, a
journal source for `ScrapPayment`. No journal source for plans (D-M4).

## 3. Work units and PRs

- **M-1 — WU-M1 Items for sale and shop sales:** D-M1, D-M2, D-M3 (without card payment), Sales page, Parts filter and
  item form section, stock `SALE` movements, use tax on withdrawals, revenue report split, BATCH-T matrix categories,
  delivery-fee hook. Tests (★ real Postgres): ★ `tests/shop-sale-integration.test.ts` (pickup taxed at the shop's areas,
  delivered taxed at the customer's; stock decremented once under retry; refund puts stock back and refunds tax; a
  delivered taxable sale creates one delivery-fee record when the fee applies); ★ `tests/resale-withdrawal-integration.test.ts`
  (a resale item used on a repair records use tax on its cost; a non-resale item does not); browser `e2e/shop-sales.spec.ts`
  (ring up a walk-in pickup sale at 360 px; axe clean).
- **M-2 — WU-M2 Retired appliances — what's next:** D-M4: "What's next for it?" on the retire panel and the appliance
  page, `/desk/inventory/retired` tab (plans, bulk "Mark done", scrap money list), `SALVAGE` parts movements, Today
  follow-up item, "Sell it" feeding the Sales page picker, Batch K postings (no plan postings — K's retirement-day write-off is the only one;
  used-appliance sale income, scrap income, seeded disposal expense category). Tests: ★ `tests/retired-appliance-plan-integration.test.ts` (retiring still removes the
  unit from every rentable list; a plan can be set and changed until done; selling completes the plan automatically
  and posts the price to `RETIRED_APPLIANCE_SALES`; choosing, changing, completing and reopening a plan create no journal
  entries; strip-for-parts adds parts to stock at $0 once under retry and requires the remainder choice;
  a plan cannot be set on a non-retired appliance; reopening is owner-only with a reason); ★
  `tests/scrap-payment-integration.test.ts` (lump entry posts to scrap income once; void reverses it); unit test for the
  Today follow-up threshold (29/30/31 days and 0 = off, in Denver days); browser spec extension in `e2e/shop-sales.spec.ts`
  (retire, choose "Strip it for parts", add a part, mark done at 360 px; axe clean).
- **M-3 — WU-M3 Card payment for local invoices** (also closes the ROADMAP item from BATCH-T D-T14): a "Pay by card"
  button on local invoices in the desk (and in the portal for customers with accounts) that opens a Stripe Checkout
  session for that invoice's amount through a `ProviderOperation` (`LOCAL_INVOICE_CHECKOUT`, key
  `local-invoice-checkout-<invoiceId>-<amountCents>`), reconciled by the existing webhook path into a normal payment.
  **Stop before coding** if the existing checkout/webhook code cannot attach a payment to a local invoice without a
  design change (S-M2) — write the stronger-model prompt instead.

## 4. Docs

`docs/BUSINESS-RULES.md` (shop sales, resale stock, retired-appliance plans), `docs/OWNER-GUIDE.md` ("Selling items",
"Retiring an appliance — sell, strip for parts, scrap or throw away"), `docs/DATABASE.md`, Batch K (`BATCH-K.md` S-K6 replaced by D-M4's
postings: no plan postings, used-appliance sale income, item sale income, scrap income, disposal expense category), STATUS.

## 5. Stop-and-ask

- **S-M1** The CPA says scrap sales or used-appliance sales are taxed differently from D-M3/D-M4's defaults in a way the
  matrix cannot express (for example a special rate).
- **S-M2** Card payment of local invoices needs changes to the signing checkout or webhook contracts (M-3).
- **S-M3** K-6 does not support retired pending-disposition asset value and a **single actual-sale/final-disposal book gain-loss entry** or required ledger accounts, as stipulated by the [2026-10-08 addendum](RETIRED-APPLIANCE-RESALE-TAX-2026-10-08.md). Amend K/card before implementing M; never revert to unconditional remaining-value disposal loss on initial retirement or double-charge asset cost. If CPA tax basis is unknown, label tax estimate unverified but do not invent a legal price ceiling.
