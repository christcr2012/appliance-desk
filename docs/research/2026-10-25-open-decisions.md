# Open decisions — researched starting values (2026-10-25)

Why this exists: Chris's rule (AGENTS.md section 1, 2026-10-25): open questions never stop building. Each one runs on
the most likely answer for a new, small appliance-rental business in Greeley, Colorado, is changeable in the app, and
waits in Settings › Decisions & reviews (DEC-1) for Chris, his CPA, attorney or translator. Chris approved applying
these to the live app (DECISIONS.md 2026-10-25), never touching signed or billed history.

This file is the **source of truth for the registry's `recommended` values** (DEC-2). Every source was opened on
2026-10-25. "Confidence" means how sure the public sources make us, not how sure Chris is.

**What could not be read this session** (so is not confirmed): Greeley's municipal code (library.municode.com was
blocked), Greeley's use-tax form, the IRS record-keeping page, IRS Publication 946's asset table, and the draft DOR
Special Rule 47. Everything about **Greeley's own rules** therefore uses the most careful choice (the one that never
under-collects) until the CPA, or one call to the Greeley Sales Tax Division, answers. Greeley's contact details are on
its public sales-tax page (link below).

## Tax subjects (audience: CPA)

| Code | Setting (field = value) | Why (short) | Confidence | Runs live? |
|---|---|---|---|---|
| IN-33 | `shortTermLeaseElection = PAY_ON_ACQUISITION` | Paying tax when buying the appliance is the default rule; collecting on rent needs DOR permission (DR 0440) filed *before* buying. Rent is then exempt from state and state-collected local tax. | High (state) | Yes |
| IN-33-GREELEY | Greeley `TaxabilityRule` RENTAL = `TAXABLE` (provisional) | Greeley is home-rule and its code could not be read; taxing rent never under-collects. | Low | Yes (careful choice) |
| IN-34-*-STATE | DELIVERY, INSTALLATION, REMOVAL, DAMAGE_WAIVER, EARLY_TERMINATION = `TAXABLE`; LATE_PAYMENT_FEE = `EXEMPT`; MERCHANDISE, USED_APPLIANCE_SALE = `TAXABLE` (provisional) | DOR: lease payments "including any associated charges" are taxable; delivery/installation are untaxed only when optional and separately stated (here they are not optional); a separately stated late fee is not taxed. The likely true answer under pay-at-purchase (these are exempt with the exempt lease) needs the CPA, so the starting value is the careful one. | Low–Medium | Yes |
| IN-34-*-GREELEY | every category above = `TAXABLE` (provisional), LATE_PAYMENT_FEE included | Greeley code unread; careful choice. | Low | Yes |
| IN-79 | `setupFeeTaxTreatment = TAXABLE` | A documentation fee was ruled "inseparable from the lease"; the setup fee is the same kind of charge. Matches the existing planning value. | Medium | Yes |
| IN-35 | Each `TaxFilingAccount`: `basis = ACCRUAL`, `frequency = MONTHLY` until the frequency printed on the license is entered | DOR assigns frequency by tax collected (≤$50/mo annual, <$1,100/mo quarterly, else monthly; due the 20th). Monthly never misses a due date. Accrual reports tax when billed, so never under-reports. | High (thresholds) / Low (basis) | Yes |
| IN-36 | no change: the engine's "lease longer than 36 months is taxable" uses the **current agreement or renewal term**, never the customer's running total | DOR: renewals and extensions are evaluated separately. | High | Yes |
| IN-37 | `rdfHandling = PAY_MYSELF`; `rdfThresholdCents = 50000000` (unchanged) | Short-term leases without DR 0440 permission owe no retail delivery fee; a new business with no prior-year Colorado retail sales is a qualified (exempt) business; paying any fee yourself avoids the "collected fees must be remitted / cannot be refunded" trap. Rate $0.31 for 1 Jul 2026 – 30 Jun 2027. | High | Yes |
| IN-39-BADDEBT | `badDebtTaxRecovery = NO` | DR 0100 line 8 allows deducting bad debts where tax was paid, but its conditions are unconfirmed and it does not apply on cash basis; NO never under-pays. | Medium | Yes |
| IN-39-1099 | `vendor1099ThresholdCents = 200000` (unchanged) | IRS 2026 instructions: $2,000 for 1099-NEC and 1099-MISC rents/other income. | High | Yes |
| IN-39-DEPR | `depreciationMonthsDefault = 60` (book, unchanged); tax class shown as "5-year (expected, not confirmed)" | Pub 946 table unreadable; household rental appliances that are not rent-to-own are expected to be 5-year GDS. 100% bonus depreciation restored for property acquired after 19 Jan 2025 (Pub 946 What's New). | Low (tax class) | Book yes; tax figure is labelled an estimate |
| IN-44 | `deductionLabels`: exempt short-term rent → A13-1 "Other exempt sales" with note "short-term lease, tax paid on acquisition, C.R.S. 39-26-713(1)(a)"; nontaxable services/fees → A3-1; exempt customers → A4-1; resale → A1-1; bad debts → A8-1. Exempt amounts are included in gross sales and then deducted. | Exact 2026 DR 0100 Schedule A line names. Including-then-deducting is the more transparent choice and does not change tax due. | High (names) / Low (placement) | Yes (the app prepares numbers; Chris files) |
| IN-46 | Parts and used-appliance sales taxed like other goods: picked up at the shop → shop address rate; delivered → customer address rate (destination). Resale stock: **buy with tax paid** (no resale certificate used) until the CPA answers. Scrap sales to a scrap yard: not taxed, recorded as one income amount per check. | Colorado sources delivered sales to the delivery address; paying tax at purchase never under-pays; scrap-yard sales are sales for resale. | Medium / Low (scrap) | Yes |
| IN-56 | Retired appliance: book disposal writes off remaining book value once (existing BA engine); tax gain/recapture is shown as an **estimate** labelled "Estimate — your CPA confirms"; unknown history shows "Unknown — ask your CPA", never a made-up number | No public source can settle a specific asset's basis; the estimate uses 5-year MACRS (see IN-39-DEPR). | Low | Book yes; tax figure is an estimate only |
| IN-65 | State use tax = Colorado tax minus tax legally paid to another state (capped at the Colorado amount, applied to state tax first). Greeley use tax: full, no credit. `useTaxMonthlyThresholdCents = 30000` (unchanged). | C.R.S. 39-26-713(2)(f); GIL-26-003; DR 0252 monthly above $300/mo. Greeley unread → careful choice. | High / Low | Yes |
| IN-71 | `recordRetentionYears = 7`, counted from when the appliance leaves the fleet (unchanged) | DOR: 3 years after the return's due date; IRS: until the limit for the year the property is disposed of. 7 years after disposal covers both. | Medium-High | Yes |

Greeley's city rate: the city FAQ's worked example uses 4.11%. Ballot measure 2F (+0.6%) is on the 3 Nov 2026 ballot;
the rate table must be re-checked after the result is certified (registered as subject `GREELEY-RATE-2F`, audience
OWNER, starting value "4.11% until the city publishes a new rate").

## Rental-terms and wording subjects

| Code | Starting value | Source | Audience |
|---|---|---|---|
| IN-84 | Late fee **$5 flat**, **10-day grace for every rental** (fee on day 11 — Chris 2026-10-25, following Colorado's UCCC rule for simplicity), **0%**, once per overdue bill; owner/admin may waive with a reason. Applies to agreements created from now on (each signed agreement keeps the late-fee terms it shows). | Chris, 2026-10-13 (OWNER-INPUTS IN-84) — **Confirmed by the owner** | ATTORNEY (wording only) |
| IN-06 | Delivery zones as answered (0–15 mi free, >15–30 $75, >30–50 $125, >50 off) | Chris, 2026-10-13 — Confirmed by the owner | — |
| IN-76 | Cancellation refunds as answered (full refund before delivery; larger orders 72-hour full refund, then keep setup fee) — each refund still needs the owner's approval | Chris, 2026-10-13 — Confirmed by the owner | ATTORNEY (contract wording) |
| IN-52 | Voicemail as answered (greeting editable, 90-day retention, transcription off) | Chris, 2026-10-13 — Confirmed by the owner | ATTORNEY (privacy wording) |
| IN-78 | Property-manager rules as answered | Chris, 2026-10-13 — Confirmed by the owner | ATTORNEY |
| IN-83 | Spanish reviewed by trusted fluent people Chris knows | Chris, 2026-10-13 — Confirmed by the owner | TRANSLATOR |
| IN-21 | Current built month-to-month and 30-day change-notice wording | Built wording | ATTORNEY |
| IN-31 | Notice methods as built (mail, own-mailbox email, handed copy, text/app only with text opt-in; a phone call doesn't count). Yearly reminder for month-to-month rentals: a To do 30 days before each 12-month anniversary of delivery, plus the reminder text already built. | Built behavior; Colorado yearly-reminder requirement per the ordinary-lease law review | ATTORNEY |
| IN-38 | Agreement and signing page say "Sales tax for your address, currently {rate}%" instead of a fixed rate | More accurate as rates change (see 2F) | ATTORNEY |
| IN-07 | Legal business details and rental terms stay as currently approved | Existing approval | ATTORNEY |

Live customer email, live texting and live payments stay **off** regardless of any answer here (AGENTS.md section 1).

## Sources (all accessed 2026-10-25)
- Colorado DOR, Sales & Use Tax Topics: Leases — https://tax.colorado.gov/sales-use-tax-topics-leases and PDF
  (revised July 2026) https://tax.colorado.gov/sites/default/files/documents/SUTT_Leases_Jul_2026.pdf
- C.R.S. 39-26-713 (secondary copy) — https://colorado.public.law/statutes/crs_39-26-713
- GIL-18-003 — https://tax.colorado.gov/sites/tax/files/documents/GIL-18-003.pdf
- GIL-08-023 (amended 2013) — https://tax.colorado.gov/sites/tax/files/documents/GIL-08-023.pdf
- GIL-15-006 — https://tax.colorado.gov/sites/tax/files/documents/GIL-15-006.pdf
- PLR-17-007 — https://tax.colorado.gov/sites/tax/files/documents/PLR-17-007.pdf
- GIL-26-003 — https://tax.colorado.gov/sites/default/files/documents/GIL-26-003.pdf
- DOR Sales Tax Filing Information — https://tax.colorado.gov/sales-tax-filing-information
- DR 0100 (effective 1 Jan 2026) — https://tax.colorado.gov/sites/default/files/documents/DR0100SS_2026.pdf
- DOR Consumer Use Tax Guide (Jan 2026) — https://tax.colorado.gov/sites/tax/files/documents/Consumer_Use_Tax_Guide_January_2026.pdf
- DOR Special Topics: Retail Delivery Fees — https://tax.colorado.gov/special-topics-retail-delivery-fees
- DOR Retail Delivery Fee Rates — https://tax.colorado.gov/retail-delivery-fee-rates
- DOR RDF Retailers — https://tax.colorado.gov/retail-delivery-fee-retailers
- IRS Instructions for Forms 1099-MISC and 1099-NEC — https://www.irs.gov/instructions/i1099mec
- IRS Publication 946 (What's New) — https://www.irs.gov/publications/p946
- City of Greeley Sales Tax — https://greeleyco.gov/Business/Business-Operations/Sales-Tax

DOR letters (GIL/PLR) are not binding on the Department; they are the best public evidence, which is why each tax
row stays "Starting value — not confirmed" until the CPA answers.

## Added 2026-10-25 (tax/fee autopilot and compliance center)
| Code | Starting value (careful choice) | Audience |
|---|---|---|
| RDF-RENT-COUNTS | Count rent toward the $500,000 test | CPA |
| RDF-FREE-DELIVERY | A delivery by the business's truck counts as a delivery even when free | CPA |
| CMP-ENTITY | Single-member LLC taxed on Schedule C | CPA |
| CMP-BPP-RENTAL-EXEMPT | The rental fleet is **not** exempt from business personal property tax until confirmed | Weld Assessor / CPA |
| CO-1099-COPY | Colorado does not need 1099 copies when no Colorado tax was withheld | CPA |
| CO-ESTIMATE-METHOD | Colorado estimates use the same ratio of last year's Colorado tax as the federal safe harbor | CPA |
| GREELEY-LICENSE | Greeley business license renews every 2 years; reminder 60 days ahead | Owner (call Greeley) |
| CMP-PAYROLL-HOW | Use a payroll service when hiring; track it in the app | Owner |
Sources: `docs/research/2026-10-25-tax-fee-rules.md`, `docs/research/2026-10-25-federal-colorado-compliance.md`.

## Added 2026-10-25 (records, operations)
| Code | Starting value (careful choice) | Audience |
|---|---|---|
| OPS-RECALL-RENTAL | Renting counts as distribution: hold recalled units, contact renters, consider CPSC reports | Attorney |
| OPS-CO-REFRIGERANT | Follow the federal rule; keep the signed statement 6 years | Owner (ask the scrap yard / CDPHE) |
| OPS-MEDCARD | A medical card is required at 16,001–26,000 lb GVWR intrastate | Owner (Colorado State Patrol) |
| OPS-MILEAGE-METHOD | Standard mileage rate in the first year | CPA |
| OPS-INSURANCE-LIMITS | Ask your agent; no limits assumed | Insurance agent |
| OPS-LATE-FEE-CAP | App caps every late fee at $15 and charges $5 (Colorado UCCC rule applied to all, Chris 2026-10-25); attorney confirms the agreement wording | Attorney |
| CONT-SUCCESSOR | Add a successor-member clause to the operating agreement | Attorney |
| VAULT-BANK | Bank logins may be stored in the vault (password manager suggested) | Owner |

## Added 2026-10-25 (tax benefits)
| Code | Starting value | Audience |
|---|---|---|
| TAXBEN-DE-MINIMIS | De minimis safe harbor elected each year ($2,500 per item) | CPA |
| TAXBEN-179-VS-BONUS | 100% bonus depreciation rather than §179 | CPA |
| TAXBEN-CLASS | Rental appliances 5-year property | CPA |
| TAXBEN-BEGAN | Business began on the first day an appliance was available or the first lead, whichever is earlier | CPA |
| TAXBEN-SOLO401K-DEADLINE | First-year Solo 401(k) by Apr 15 without extensions | CPA |
| TAXBEN-EZ-FLEET | Delivered fleet doesn't qualify for the enterprise-zone credit | CPA |

## Added 2026-10-25 (late-fee law)
| Code | Starting value (careful choice) | Audience |
|---|---|---|
| FEE-UCCC-6-12 | Household 6/12-month rentals are UCCC consumer leases (the app already applies the 10-day / $15 rule to every rental) | Attorney |
| FEE-UCCC-FILING | File the UCCC notification before the first 6/12-month household rental | Attorney / Owner |
| FEE-REASONABLE | $5 is reasonable (Reg M 1013.4(q), C.R.S. 4-2.5-504) | Attorney |
| FEE-AUTOPAY-CONSENT | Fee named in the agreement and mandate + 10-day notice is enough; inside 10 days → separate non-auto bill | Attorney |
| FEE-VISA-CHANGE | Treat a disclosed fee as needing advance notice (10 days) | Attorney |
| FEE-SCRA | No automatic fee for flagged servicemembers; never take an appliance back without a court order | Attorney |
| FEETAX-GREELEY-LEASE | Greeley taxes rentals ≤36 months at 4.11% even though tax was paid at purchase (taxed until confirmed) | Greeley Sales Tax / CPA |
| FEETAX-GREELEY-SERVICE | Optional, separately stated delivery/installation/pickup/haul-away taxed in Greeley until confirmed | Greeley Sales Tax / CPA |
| FEETAX-GREELEY-OTHER | Damage waiver, late fee, admin fee taxed in Greeley until confirmed | Greeley Sales Tax / CPA |
| FEETAX-SOURCING | Rentals taxed by the place the customer keeps the appliance | CPA |
| FEETAX-LOCAL-3YR | Pay-at-purchase also covers state-collected county/district taxes on rent | CPA |
| FEETAX-SR46 | New Special Rule 46 (Leases, effective 2026-08-30) doesn't change the above | CPA |
| FEETAX-ADMIN-FEE | Keep the required $45 setup fee (IN-74); option to fold it into optional installation to lower tax | Owner |
| ZONE-NAMES | Zone names "Local — free delivery", "Nearby", "Extended", "Outside our delivery area — pickup only" | Owner |
| ZONE-DISTANCE | Zones measured in a straight line from central Greeley (matches the map; IN-06 said driving miles — a 50-mile circle can be 60+ road miles) | Owner |
| ZONE-PICKUP-PRICE | Picking the appliance up at the end costs the same as delivery in that zone | Owner |
| ZONE-PUBLISH-PRICES | Delivery prices hidden on the website until Chris switches them on (IN-06) | Owner |
| FEETAX-LABOR-RATE | Hourly cost for the price-vs-cost check (no source; starts at the IRS mileage rate for miles and $0 labor until set) | Owner |
| FEETAX-CITY-LICENSES | Don't deliver into a city that needs its own license until Chris has it (per the 50-mile table) | Owner / CPA |
| FEE-TAX | Late fee tracked as its own line; Colorado treats a separately stated late fee as not taxed (state), Greeley careful: taxed (see DEC-2) | CPA |
