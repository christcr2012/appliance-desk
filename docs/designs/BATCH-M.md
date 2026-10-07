# Design — Batch M: Shop sales (merchandise) and what happens to retired appliances

Status: **APPROVED DESIGN — implement from this document** (Chris, 2026-10-07: "I plan on also reselling … small items
… washer hoses, power cords for dryers … If I retire an appliance, I may choose to sell it … I may tear it down for scrap
metal … receive a check … or I just have to dispose of it in the garbage, in which case it may cost me money").
Runs **after Batch K** (Chris, 2026-10-07, IN-47: "Preferably not until after launch … I am really trying to get this
system done before I actually begin business" — so no shop sales before launch and no reason to move this batch up).
Needs Batch T (tax engine, returns, delivery fee) and Batch K (expenses, book values). Three PRs.

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
and margin), `boughtForResale Boolean @default(false)` (owner ticks it for stock bought tax-free with a resale
certificate). New movement kind **`SALE`** (stock down, linked to the invoice line). Screens: Parts gets a filter
"Items I sell" and the item form gains a "Sell to customers" section (price, bought for resale) — explained on screen.

### D-M2 — Buying for resale and taking stock for your own use (use tax)

- Stock with `boughtForResale` creates **no use tax** when received (3.6 records `NOT_DUE`, reason "Bought for resale").
- When such an item is instead **used** (a repair, an installation, given away) — a `USAGE` movement — Colorado treats
  that as taking it out of resale stock for your own use, so the app records **use tax on its cost** at that time
  (`PurchaseUseTax`, `sourceType "PART_WITHDRAWAL"`, on the use-tax return like any other — Amendment D 15.5).
- The owner guide explains giving suppliers your Colorado sales tax license / resale certificate (the CPA confirms the
  form, IN-46).

### D-M3 — Selling items: a "Sale" is a local invoice

**Desk → Customers & sales → Sales** (`/desk/sales`, OWNER/ADMIN; STAFF can ring up if the owner allows it later —
not in this batch): "New sale" for an existing customer or a **walk-in** (name optional; no portal account).
- Lines: sellable parts (price prefilled, editable with a reason if lowered), a used appliance (D-M4), or a delivery /
  installation charge (existing categories).
- **Where the sale happens decides the tax** (Colorado is destination-based): *picked up at the shop* → the business
  location's tax areas; *delivered or installed* → the customer's address (address check like any rental address,
  D-T3). New `TaxChargeCategory` values `MERCHANDISE` and `USED_APPLIANCE_SALE` join the "What's taxed" grid; the
  "common Colorado starting answers" button fills both as Taxable (sales of goods are taxable) for the CPA to confirm.
- **Retail delivery fee:** a delivered sale of taxable goods is a retail delivery — the fee rules of section 12 of
  BATCH-T apply (key `retail:<invoiceId>`, status, small-business exemption, handling, return). Pickups never owe it.
- Payment: recorded with the existing manual-payment action (cash, check, card on a reader outside the app) —
  card-in-portal payment is PR M-3. The receipt prints/emails from the invoice (existing invoice view).
- Stock: a `SALE` movement per line at the moment the sale is completed; a refund/return of an item creates a
  `REVERSAL` (back in stock) or an `ADJUSTMENT` (damaged, not resellable) plus the existing refund flow with its tax
  (D-K10).
- Sales flow into the SUTS return packet automatically (they are invoices with tax lines), into revenue reports as
  **"Shop sales"** (separate from rental revenue), and into Batch K as merchandise income and cost of goods sold (at
  the stock's average cost).

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
- **Your own profit numbers (Batch K):** when an appliance's plan is marked done, its remaining book value is written off
  as "Loss on retired appliances" (the entry Batch K already has); a sold appliance instead shows gain or loss = sale
  price − remaining book value. Scrap money is income in the month received. Your CPA does the tax-return version; if
  the CPA wants scrap proceeds per appliance (IN-46), the scrap entry can gain an optional "which appliances" list later
  — not built now.

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

// PartRecord additions: sellable Boolean @default(false), retailPriceCents Int?, boughtForResale Boolean @default(false)
// PartStockMovement additions: invoiceLineId String? (SALE movements), applianceId String? (SALVAGE movements)
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

Plan changes and "done" are audited (old → new); a done plan can be reopened by the owner only, with a reason. Backup
coverage and schema health for both tables. Batch K additions: income account `SCRAP_INCOME` "Scrap sales", seeded
expense category "Dump and disposal fees", journal sources for `ScrapPayment` and for the write-off when a plan is done.

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
  follow-up item, "Sell it" feeding the Sales page picker, Batch K postings (write-off on done, scrap income, seeded
  disposal expense category). Tests: ★ `tests/retired-appliance-plan-integration.test.ts` (retiring still removes the
  unit from every rentable list; a plan can be set and changed until done; selling completes the plan automatically
  and records gain/loss; strip-for-parts adds parts to stock at $0 once under retry and requires the remainder choice;
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
postings: write-off when a plan is done, gain/loss on a sold appliance, scrap income, disposal expense category), STATUS.

## 5. Stop-and-ask

- **S-M1** The CPA says scrap sales or used-appliance sales are taxed differently from D-M3/D-M4's defaults in a way the
  matrix cannot express (for example a special rate).
- **S-M2** Card payment of local invoices needs changes to the signing checkout or webhook contracts (M-3).
- **S-M3** Batch K's disposal entry cannot take a sale price (gain/loss on a sold appliance) without changing its posting
  rules — amend K's design first.
