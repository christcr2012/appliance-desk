# Retired rental appliances: resale value, tax basis and depreciation recapture

Status: **Owner-requested design clarification, 2026-10-08 — not live functionality.**
Implementation belongs to **K-6 (book fixed assets and disposition)** and **M-2C (sale of retired appliances)**, after their JIT cards are prepared and approved; the T-7C/T-7D tax-filing implementation is not expanded. This addendum overrides incompatible retirement/write-off wording in BATCH-K D-K9/posting matrix/S-K6 and BATCH-M D-M4. Legal and tax calculations require current-year CPA confirmation (IN-56). Do not make live filings, paid provider calls, money transfers, or automatic prices.

## 1. Legal and accounting boundary

- An OWNER may list and sell a legitimately owned rental unit at a negotiated market price, including at or above its original cost. **Depreciation imposes no legal maximum resale price.** Warn about estimated gain and tax, never cap or automatically discount a lawful sale based on cost, depreciated balance or reserve.
- A unit originally used as the company's rental fixed asset is **not automatically newly purchased resale inventory** merely because its plan changes to SELL. Classify original use and tax treatment separately from ordinary merchandise. A purchase originally intended for resale follows the merchandise rules instead.
- Colorado customer sales tax (and applicable state-administered/local rates and exemptions) is assessed from actual taxable resale location, delivery/pickup and sale date, using Batch T / M taxability engine. **Tax the sale independently of whether the original acquisition included sales or use tax.** Do not count tax collected for the state as the company's income-tax sales proceeds. A Colorado taxable delivered retail sale also goes through Batch T's retail delivery fee decision; do not charge RDF on free pickups or assume it is universally exempt.
- Book financial statements and **federal/state income tax returns are distinct**. Batch K's straight-line `depreciationMonths` and salvage percentage produce *management book depreciation*, not the CPA's Form 4562 or asset-by-asset tax depreciation. The CPA owns classification, cost basis, capitalization versus expensing, placed-in-service date, tax method/life/convention, Section 179, special/bonus depreciation, dispositions, previous tax treatment, and Form 4797 reporting.
- For depreciable §1245 rental equipment, ordinary-income depreciation recapture is generally **min(tax gain, depreciation allowed or allowable)**, subject to relevant federal rules. Tax adjusted basis generally equals original tax basis plus permitted capital improvements/adjustments, less depreciation *allowed or allowable* (whichever is greater). Selling costs can affect gain. If sale exceeds historical cost, gain above recapture can have different treatment (such as §1231 for qualifying held-over-one-year property), for CPA determination. If basis or deductions are uncertain, do **not** show a precise tax amount.
- If the original purchase was properly **expensed instead of capitalized** (e.g. qualified de minimis safe-harbor expense), or the item is classified as inventory, don't invent a §1245 depreciation record. Record CPA-confirmed classification and report income as the appropriate business sale. A fully expensed asset can still have taxable proceeds.
- An appliance may be removed from the *rentable* fleet, but that status **does not by itself prove abandonment, sale, zero tax basis or a tax-deductible loss**. Federal depreciation cessation/disposition rules depend on actual facts; track retirement-from-service and the subsequent disposal date separately.

**Illustration only (before transaction costs):** tax basis $600, allowed/allowable tax depreciation $400, adjusted basis $200. Sale price $600 → tax gain $400, usually $400 §1245 ordinary-income recapture; sale price $750 → gain $550, recapture up to $400 and $150 of other gain for the CPA to classify. These are **taxable gain amounts, not tax due**. Original basis may include capitalizable acquisition sales tax and fees; sales tax collected on resale is a separate liability.

IRS source references: Publication 544 (Sales and Other Dispositions of Assets); Instructions for Form 4797; Publication 946 (How To Depreciate Property). Colorado Department of Revenue Sales Tax Guide and Retail Delivery Fee Guide. Reverify current versions and CPA advice at implementation.

## 2. Sale-preparation and checkout experience (M-2C)

A retired rental appliance moves through:
`RENTED/AVAILABLE → RETIRED` (off all rental availability) → `DECIDE_LATER | SELL | SCRAP | STRIP | DISPOSE | DONATE_OTHER` → completed disposal.
For SELL, allow `LISTED → SALE_PENDING → SOLD`. The retirement-to-sell step and listing by themselves **do not realize a sale** or finalize income-tax gain.

On "Sell this retired appliance" show a review with:
1. Original acquisition, serial/asset ID, placed-in-service date, purchase price and known acquisition sales tax; any separately capitalized improvements; date removed from rental fleet; condition and asking price (editable; no depreciation-based ceiling).
2. Separate **book** cost / accumulated depreciation / remaining carrying value / final disposal treatment, and **tax** historical basis / CPA-confirmed accumulated depreciation including Section 179/bonus / adjusted tax basis, clearly labeled. Never copy book depreciation into tax without explicit CPA-supplied evidence.
3. Net sale proceeds before buyer sales tax (selling price less applicable seller transaction costs), estimated taxable gain/loss, **maximum potential §1245 recapture** and any gain left for CPA classification. Label recapture as income classification, **not** money paid to the IRS. Show tax due as "Not calculated" unless CPA supplies an approved rate and tax-year scenario; even then call it an **estimate**, never a filing.
4. Buyer sales tax, locality, any retail delivery fee, invoice, payment/refund status and final disposition date as separately auditable amounts; preserve evidence of item, invoice and customer transaction. Note when buyer pays tax on top of the selling price.
5. Clear owner warning: **"Selling above depreciated tax basis may trigger ordinary-income depreciation recapture. You can still sell at your chosen price."** Missing tax basis, missing allowed/allowable amount, expensed-item ambiguity, ownership/bundled sale, conflicting prior disposal, or CPA classification ⇒ badge "CPA review needed", no fabricated recapture/tax due.
6. For sales after a previous book write-off, surface the historical entry and require a valid, audited accounting classification/reversal strategy so the same fixed-asset basis/loss is never expensed twice. Sale invoice must not quietly post all gross proceeds as recurring rental revenue.

The legitimate owner can complete an otherwise authorized sale even if income-tax records need CPA review, provided invoice/sales-tax/legal gates are met; mark the tax package **incomplete** and create an owner CPA-follow-up exception. Do not accidentally block lawful operational disposal waiting for a tax estimate. Finance permissions: OWNER controls disposition and tax data; ADMIN may inspect books and authorized sale data; STAFF may only use existing explicitly approved sale permissions, never change basis/depreciation policy.

## 3. Book disposition timing, one posting path only (K-6 → M-2C)

**Supersedes automatic book `APPLIANCE_RETIRED` = entire remaining value to disposal loss on the day of initial retirement.** Retirement removes a unit from rental operations and stops further management depreciation, but for `SELL` or `DECIDE_LATER` it **preserves the carried value as a separately tracked retired asset pending disposition**. No unconditional loss simply because the owner no longer wants to rent it. A later switch to scrap/dispose/donate has its own dated, audited outcome.

- Upon intended sale, track current book carrying value, any approved impairment/held-for-sale measurement adjustments (CPA/bookkeeper policy), and remaining tax basis **separately**; these are not invented from the same formula.
- On actual completed used-appliance sale, record seller proceeds (excluding pass-through sales tax), remove remaining book carrying value exactly once, and produce the true book gain/loss on disposal in a **dedicated gain/loss/disposition category** rather than treating the entire payment as rental-service income. For revenue dashboards, the **gross used-appliance proceeds can still be displayed in a separate shop/disposition sales metric** without being double-counted in financial income; preserve current invoice and sales-tax line linkage.
- For final unrecoverable disposal (scrap/throw away), recognize remaining book disposal value **when disposal is supported by evidence and business accounting policy**; scrap income/expenses may be lumped per check/trip as already approved. For STRIP_FOR_PARTS, avoid double-valuing salvaged parts; record the final remainder status and any CPA-approved allocations or loss.
- Never post BOTH the original `APPLIANCE_RETIRED` remaining-value loss and a second sale-time cost write-off. If a legacy retirement entry already posted, create explicit audit-linked reversal/reclassification and reconciliation or a controlled alternative ledger mapping reviewed by the accountant. Preserve immutable journal evidence and bank reconciliation history; no delete or silent backdating.
- No extra tax-basis writeoff merely for moving to the SELL picker. Retired physical custody, location and every invoice/payment/refund are traceable to exactly one asset and its sale.
- For forecasting and reports, show cash proceeds, taxable sales, book disposal gain/loss, and possible federal recapture **as different metrics**. Book depreciation previously recognized does not become an extra new sales expense.

### Minimum evidence/data model (new or existing tables via JIT card)

Per appliance: immutable acquired cost evidence, acquisition transaction-tax inclusion decision, placed-in-service and rental retirement dates, retirement plan and changes, book depreciation through retirement, book disposal value/recognized date, tax asset classification, CPA-confirmed original tax basis plus signed adjustments, allowed/allowable MACRS depreciation, Section 179/bonus history, tax depreciation cessation date, source tax year/CPA/as-of, tax basis confidence `UNKNOWN | OWNER_SUPPLIED | CPA_CONFIRMED`, proceeds/selling expenses, sale invoice/line and payment references, final disposition date, book posting source IDs and reconciliation/CPA review state. All cents safe integers, dates in business timezone. Avoid storing an assumed tax percentage or computing tax depreciation from 60-month book schedules.

Freeze a **disposition snapshot** upon completion (asset ID, version, original and adjusted basis evidence, sale date, receipt invoice, price/tax separated, seller fees, book carrying value, estimated section 1245 ordinary-income portion, unclassified residual and sources). Reversals/voids and refunds must be idempotent and explicitly linked; stale action versions conflict, changing a SELL plan doesn't rewrite a settled sale.

### Acceptance tests before enablement

- Purchase $600, tax depreciation $400, resale $600 → adjusted basis $200, estimated gain $400, potential recapture $400; no resale-price restriction.
- Same asset sale $750 → gain $550, potential recapture $400, remainder $150 CPA-classification-needed.
- Fully depreciated ($600) asset sold for $250 → gain/recapture $250; never falsely says zero gain because unit is old.
- $600 cost, zero allowed depreciation, sale $450 → potential $150 loss (subject to source facts); no fictitious §1245 recapture.
- Unknown tax depreciation → visible CPA review state, **no** inferred recapture from book depreciation; sale may proceed through ordinary legal/tax gates.
- Rental retirement-to-SELL **does not** realize gain, remove tax basis, or automatically post a full book disposal loss. Completed sale posts remaining book basis once; reversing a prior legacy write-off cannot double-post.
- Refund/void/re-sell and concurrent completion attempts remain idempotent; one appliance can have at most one completed disposition at a time. Correct sale date and sale-location tax apply independently from tax recapture; sales tax pass-through excluded from income gain.
- A purchased-for-resale appliance and a previously fully expensed item do not get invented rental fixed-asset depreciation, and the same acquisition-tax payment does not exempt a subsequent taxable retail sale.

## 4. Scope and release sequencing

- **K-6** owns the book-retirement staging/asset value policy, as-of evidence and export mappings; may expose incomplete tax-basis fields and CPA task, but **does not auto-file income taxes**.
- **M-2C** owns approved used-appliance sale completion, invoice/customer sales tax, potential delivery fee, frozen tax estimation and disposition/asset ledger link. Do not launch M sales before predecessor Batches K and T, JIT execution card, CPA policy decisions and normal merge gates.
- **T-7C/T-7D** Colorado sales/use tax filing must consume legitimate *completed taxable sale invoices* through the normal ledger once M launches; no temporary fake inventory sales, no federal recapture on the Colorado sales tax return.
- The CPA must verify federal §1245 / §1231 classification, placed-in-service and allowed-or-allowable depreciation (including §179/bonus and potential de minimis expensing), book impairment/accounting transfer, Colorado state income-tax treatment, and scrap/donation exceptions. Record these choices in IN-56; do not invent them or require a reseller to accept a maximum price.
