# Design — Batch M: Shop sales (merchandise) and what happens to retired appliances

Status: **APPROVED DESIGN — implement from this document** (Chris, 2026-10-07: "I plan on also reselling … small items
… washer hoses, power cords for dryers … If I retire an appliance, I may choose to sell it … I may tear it down for scrap
metal … receive a check … or I just have to dispose of it in the garbage, in which case it may cost me money").
Runs **after Batch K** by default (disposals need K's book values); **move it right after Batch T if Chris wants to sell
items before launch** (IN-47) — then the K-dependent parts (12 below) wait for K. Needs Batch T (tax engine, returns,
delivery fee). Three PRs.

**Until Batch M is built the app cannot record a shop sale.** Selling items before then means recording the sale and its
sales tax outside the app and adding it to the SUTS return by hand — the owner guide says so.

---

## 0. Verify before starting

| # | Assumption | How to check |
|---|---|---|
| M-A1 | Parts stock is an append-only ledger: `PartRecord.quantityOnHand` + `PartStockMovement` (kinds `OPENING_BALANCE RECEIPT USAGE ADJUSTMENT RECOUNT REVERSAL`), receiving via purchase orders, `recordPartUsage` for repairs. | schema lines around `model PartRecord` / `PartMovementKind`; `src/domains/purchasing` |
| M-A2 | Appliances have `status RETIRED` and a guided "retire" action (`retireApplianceAction`) on the appliance page; RETIRED is final. | `src/app/desk/inventory/[id]/guided-actions-panel.tsx` |
| M-A3 | Batch T is merged: `computeTax`, `TaxChargeCategory`, local invoices with `InvoiceTaxLine`, the manual-payment action, D-T14 manual-payment-only local invoices, the retail delivery fee (section 12), `PurchaseUseTax` (3.6). | `src/domains/tax` |
| M-A4 | Batch K (if merged) has the asset register, depreciation and a disposal entry (D-K9) with S-K6 excluding sale proceeds. | `docs/designs/BATCH-K.md` |

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

### D-M4 — What happens to a retired appliance: one of four endings

The appliance page's "Retire" panel becomes **"Retire this appliance"** with a required **"What happened to it?"**:

| Choice | What the app records | Tax | Money in books (Batch K) |
|---|---|---|---|
| **Sold it** | creates a Sale (D-M3) with a `USED_APPLIANCE_SALE` line for that appliance (price, buyer — existing customer or walk-in) | sales tax by where the buyer takes it (D-M3); delivery fee if delivered | sale income; cost and depreciation removed; **gain or loss** = price − remaining book value |
| **Scrapped it** | joins a **scrap trip** (several appliances, one scrap-yard payment): date, scrap yard, total received, photo of the check or ticket | none by default — a sale to a scrap dealer is normally a sale for resale; the CPA confirms (IN-46); if the CPA says taxable, the matrix gets a `SCRAP_SALE` answer and the trip becomes a Sale | scrap income split across the trip's appliances by remaining book value (`allocateAcrossLines`); gain/loss per appliance |
| **Threw it away** | date, where, **cost paid** (dump fee), receipt photo | none (a disposal fee you pay is an expense, not a sale) | disposal expense; remaining book value written off as loss |
| **Donated / other** | date, note, value if any | none | remaining book value written off |

The ending is recorded once (corrections by the owner with a reason, audit row). Scrap trips: `/desk/inventory/scrap`
lists them; "New scrap trip" picks retired-but-not-yet-ended appliances (several at once), enters the yard's payment
once. An appliance retired before Batch M shows "Ending not recorded" with a Today task to fill it in (optional — "Not
known" is allowed).

### D-M5 — Owner-configurable

Retail prices, "bought for resale" per item, whether STAFF may ring up sales (setting starts **off**), whether the price
can be lowered at the counter and by how much (starting value: owner/admin only, any amount with a reason), the default
scrap yard name — all stored settings explained on screen. No price is hard-coded.

## 2. Schema (additive) — migration `<timestamp>_batch_m_shop_sales`

```prisma
enum ApplianceEnding { SOLD SCRAPPED DISPOSED DONATED_OR_OTHER UNKNOWN }
// PartMovementKind gains SALE
// TaxChargeCategory gains MERCHANDISE, USED_APPLIANCE_SALE (and SCRAP_SALE only if IN-46 says taxable)

// PartRecord additions: sellable Boolean @default(false), retailPriceCents Int?, boughtForResale Boolean @default(false)
// PartStockMovement additions: invoiceLineId String?  (SALE movements)
// Invoice additions: saleKind String? ("SHOP_SALE"), walkInName String?, saleLocation String? ("PICKUP" | "DELIVERED")

model ApplianceEndingRecord {
  id              String          @id @default(cuid())
  applianceId     String          @unique
  ending          ApplianceEnding
  endedOn         DateTime
  amountCents     Int?            // + money received (sale price or scrap share), − money paid (disposal fee)
  invoiceId       String?         // SOLD
  scrapTripId     String?         // SCRAPPED
  counterparty    String?         // scrap yard / dump / buyer note (no customer data needed)
  receiptPhotoId  String?
  note            String?
  recordedByUserId String
  createdAt       DateTime        @default(now())
}

model ScrapTrip {
  id              String   @id @default(cuid())
  tripOn          DateTime
  scrapYard       String
  totalReceivedCents Int
  receiptPhotoId  String?
  note            String?
  recordedByUserId String
  endings         ApplianceEndingRecord[]
  createdAt       DateTime @default(now())
}
```

(`ApplianceEndingRecord.scrapTripId` relates to `ScrapTrip`.) Backup coverage and schema health for both tables.

## 3. Work units and PRs

- **M-1 — WU-M1 Items for sale and shop sales:** D-M1, D-M2, D-M3 (without card payment), Sales page, Parts filter and
  item form section, stock `SALE` movements, use tax on withdrawals, revenue report split, BATCH-T matrix categories,
  delivery-fee hook. Tests (★ real Postgres): ★ `tests/shop-sale-integration.test.ts` (pickup taxed at the shop's areas,
  delivered taxed at the customer's; stock decremented once under retry; refund puts stock back and refunds tax; a
  delivered taxable sale creates one delivery-fee record when the fee applies); ★ `tests/resale-withdrawal-integration.test.ts`
  (a resale item used on a repair records use tax on its cost; a non-resale item does not); browser `e2e/shop-sales.spec.ts`
  (ring up a walk-in pickup sale at 360 px; axe clean).
- **M-2 — WU-M2 Appliance endings and scrap trips:** D-M4 (sold → Sale; scrapped → trip with allocation; disposed →
  fee; donated/other), retire panel change, scrap page, Today task for endings not recorded; Batch K postings if K is
  merged (else recorded and posted when K lands — K reads the ending records). Tests: ★ `tests/appliance-ending-integration.test.ts`
  (sale creates a taxed invoice and ends the appliance; scrap trip of 3 splits $90 by book value with the remainder on
  the last; disposal fee becomes an expense; an ending cannot be recorded twice; RETIRED stays final).
- **M-3 — WU-M3 Card payment for local invoices** (also closes the ROADMAP item from BATCH-T D-T14): a "Pay by card"
  button on local invoices in the desk (and in the portal for customers with accounts) that opens a Stripe Checkout
  session for that invoice's amount through a `ProviderOperation` (`LOCAL_INVOICE_CHECKOUT`, key
  `local-invoice-checkout-<invoiceId>-<amountCents>`), reconciled by the existing webhook path into a normal payment.
  **Stop before coding** if the existing checkout/webhook code cannot attach a payment to a local invoice without a
  design change (S-M2) — write the stronger-model prompt instead.

## 4. Docs

`docs/BUSINESS-RULES.md` (shop sales, resale stock, appliance endings), `docs/OWNER-GUIDE.md` ("Selling items",
"Retiring an appliance — sell, scrap or dispose"), `docs/DATABASE.md`, Batch K (`BATCH-K.md` S-K6 replaced by D-M4's
postings: disposal entry also records proceeds and gain/loss), STATUS.

## 5. Stop-and-ask

- **S-M1** The CPA says scrap sales or used-appliance sales are taxed differently from D-M3/D-M4's defaults in a way the
  matrix cannot express (for example a special rate).
- **S-M2** Card payment of local invoices needs changes to the signing checkout or webhook contracts (M-3).
- **S-M3** Batch K's disposal entry cannot take proceeds without changing its posting rules — amend K's design first.
