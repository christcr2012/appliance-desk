# Build spec — Write-offs and tax benefits, found automatically (TAXBEN-1, TAXBEN-2)

Chris, 2026-10-25: "the system needs to be built to automatically handle write offs and other benefits, including
specific things to small businesses, new businesses, etc. I will have a cpa do my taxes and periodically check my
books, but the system needs to be handling everything." Facts: `docs/research/2026-10-25-tax-benefits.md` (seed every
number into the TFA-1 rule book with its source). Depends on BA-1 (books autopilot), TFA-1, CMP-2 (Schedule C packet),
DEC-1. Everything here is **prepared** by the app and **confirmed by the CPA**; the app never files a return. Owner
approval rule applies to elections and anything sent out.

## TAXBEN-1 — Every expense lands in the right deduction, and the year's benefits are worked out

### 1. Classification that needs nothing from Chris
- Every books expense account gets `deduction: { scheduleCLine, percent (100 default; meals 50), kind: "ORDINARY" |
  "CAPITAL" | "PERSONAL_SHARE" }` in `system-chart.json` (CMP-2 already adds `scheduleCLine`). Mixed-use accounts
  (phone, internet, home utilities) take a **business-use percent** owner setting each (starting value: none — the app
  asks once, in the guided setup, "About what share of your phone is for the business?"; until answered, 0% is deducted
  and a To do asks).
- **Capital vs expense** for every purchase (fleet, tools, truck), decided by rules in this order, each recorded on the
  purchase with the reason shown in plain words:
  1. **De minimis safe harbor** (`ruleAsOf("us.de_minimis_per_item")`, seed $2,500): items whose invoice line (incl.
     its share of delivery/installation on the same invoice) is ≤ the limit are **expensed**, when the year's election
     is on (setting `deMinimisElection` per tax year; starting value **on** — the common choice for small businesses —
     with Decisions question `TAXBEN-DE-MINIMIS` for the CPA). Expensed units **stay in the asset register** (fleet
     tracking, county declaration needs "expensed assets with a life over 1 year").
  2. Otherwise **capitalize** and depreciate: 100% bonus by default (`us.bonus_depreciation`, acquired and placed in
     service after 1/19/2025, used property not from a related party — the purchase form asks "bought from a relative or
     your own other business?"), or §179 if the CPA prefers (Decisions `TAXBEN-179-VS-BONUS`; starting value bonus,
     because bonus isn't limited by business income and keeps the Colorado enterprise-zone credit possible).
  3. Class life: 5-year for rental appliances (Decisions `TAXBEN-CLASS`, CPA), truck by GVWR (> 6,000 lb not a
     passenger auto; ≤ 6,000 lb → auto caps from the rule book), tools 7-year.
- **Written accounting policy**: the app generates "Capitalization policy — Robinson Appliance Rentals" (items at or
  under $2,500 per item are expensed), dated and signed by Chris on screen, stored as a business record (VAULT-1); a To do
  each December to re-sign for the next year (the safe harbor needs the procedure in place at the start of the year).
- **Placed-in-service date** = the first day a unit is AVAILABLE (exists in the fleet history), not the purchase date.

### 2. Start-up costs (new business)
- Setting `businessBeganOn` (Compliance facts; starting value: the date the first appliance became AVAILABLE or the
  public site took its first lead, whichever is earlier — Decisions `TAXBEN-BEGAN`, CPA). Expenses dated before it are
  tagged **start-up** automatically (excluding fleet purchases, interest and taxes). Year total → deduction
  `min(5,000, max(0, 5,000 − (total − 50,000)))` and the rest over 180 months from that month (amounts from the rule
  book); shown on the Schedule C packet and the 4562 Part VI worksheet.

### 3. The benefit list (computed nightly into a "Tax benefits {year}" page, CPA-visible)
Each row: what it is in plain words, estimated amount, how sure, the condition the app checked, the deadline (timing
rule; BENEFITS → as soon as allowed), and what the CPA must confirm.
- Depreciation and expensing totals (with a **mid-quarter warning**: when Q4 purchases would push more than 40% of the
  year's depreciable basis into the last 3 months, a To do in October/November explains it before more buying — de
  minimis and §179 amounts excluded from the test).
- **Vehicle**: mileage-rate deduction (OPS-3 log × 72.5¢) vs actual costs (fuel, repairs, insurance, registration,
  depreciation × business %), both shown; the first-year rule ("choose the mileage rate in the first year to keep both
  options"; not allowed after bonus/§179 on that vehicle).
- **Home office**: simplified ($5/sq ft, ≤ 300 sq ft) vs Form 8829 regular method using home costs Chris enters once
  (sq ft of the office, home sq ft, rent/mortgage interest, utilities, insurance); exclusive-use attestation each year.
- **QBI** (20%, $400 minimum when QBI ≥ $1,000) estimate after half-SE-tax, SE health insurance and retirement.
- **Half of SE tax**, **SE health insurance** (premiums Chris enters; monthly "eligible for an employer plan
  (yours or your spouse's)?" checkbox), **retirement**: SEP-IRA (~20% of net profit, max $72,000; set up and fund by the
  return due date incl. extensions) vs Solo 401(k) ($24,500 deferral + employer share, max $72,000; first-year plan by
  Apr 15 **without** extensions — Decisions `TAXBEN-SOLO401K-DEADLINE` U); the app shows the comparison in January–March
  and a deadline To do (BENEFITS → early).
- **Colorado enterprise zone**: if the business or storage address is inside a zone (Chris confirms with the OEDIT map —
  setting `enterpriseZone: YES | NO | UNKNOWN`, starting UNKNOWN with a setup step), a **January** To do "Pre-certify
  before you buy equipment this year" (the credit is lost for property bought before pre-certification); fleet used
  outside the zone (delivered to customers) likely doesn't qualify (Decisions `TAXBEN-EZ-FLEET`).
- **Colorado business personal property**: running Jan 1 actual value vs $56,000 (CMP-4 uses it).
- **Bad debts**: none for unpaid rent on the cash method (the app explains why); unreturned appliances → their remaining
  basis as a possible loss for the CPA.
- **Losses**: first-year loss → NOL carryforward note; hobby-loss evidence kept automatically (separate bank account,
  licenses, marketing, business plan — links from VAULT-1).
- **Ordinary deductions checklist**: the accounts list (CPA fees, Stripe/bank fees, software, insurance, interest,
  advertising, licenses, registered agent, tools, safety gear, dump/disposal and refrigerant fees, parts and repairs) each
  with this year's total; any account with $0 that usually has spending (e.g. no phone expense) gets a gentle "Missing
  anything?" prompt.

## TAXBEN-2 — Elections and statements ready for the CPA
- For each election the year needs, the app produces the statement text for the CPA to attach (de minimis safe
  harbor statement with name, address, TIN; bonus elect-out by class if chosen; §195 note), on the CMP-2 accountant
  packet, with the return due date (and extension date) from the rule book.
- A "Year-end tax planning" To do every **November 15** (BENEFITS → early enough to act): estimated profit so far, the
  retirement contribution room, whether buying needed equipment before Dec 31 changes the tax (shown as information,
  never advice to buy), the mid-quarter status, and the questions for the CPA.
- ACCT-1 accountant sees and can edit all of this (changes listed for Chris).

## Tests
Classification rules (≤ $2,500 per item incl. delivery share; related-party purchase excluded from bonus; placed in
service date), start-up formula at $10k/$52k/$60k, mid-quarter detector, mileage vs actual, home office both methods,
QBI with the minimum, SEP calculation, the expensed unit still in the asset register and the county snapshot, policy
document generation, CPA edits audited. Every number read from the rule book (no literals in code — a lint test greps
the TAXBEN module for dollar literals).
