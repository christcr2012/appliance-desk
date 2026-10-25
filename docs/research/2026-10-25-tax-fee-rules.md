# Tax and fee rules — facts, dates and windows (researched 2026-10-25)

Source of the seeded rule versions in TFA-1 (`docs/build-specs/engines/TAX-FEE-AUTOPILOT.md`). All pages accessed
2026-10-25. **H** = official source read; **M** = official source, partly read/paraphrased; **U** = unverified (the app
uses the most careful choice and files a Decisions question). Complements `2026-10-25-open-decisions.md`.

## Colorado retail delivery fee (RDF) — C.R.S. 43-4-218, 1 CCR 201-20
- Amounts (**H**, https://tax.colorado.gov/retail-delivery-fee-rates, DR 1786 2026): Jul 2023–Jun 2024 $0.28;
  Jul 2024–Jun 2025 $0.29; Jul 2025–Jun 2026 $0.28; **Jul 2026–Jun 2027 $0.31** (six parts: community access 0.0792,
  clean fleet 0.0609, clean transit 0.0344, general 0.0965, bridge and tunnel 0.0310, air pollution 0.0080).
- Changes: inflation-adjusted each state fiscal year; DOR "shall publish the amount no later than April 15"; effective
  **July 1** (fixed date). Source to watch: the rates page (HTML table). (**H**, SB23-143)
- Qualified business (exempt): prior calendar year Colorado retail sales ≤ $500,000 → exempt the whole current year.
  New retailer (no prior-year sales): exempt "until the first day of the month after the ninetieth day" after its
  sales pass $500,000. Re-tested every January 1. (**H**, statute). The DR 1786 form says "period"; the statute says
  "month" — the app follows the statute.
- Whether tax-exempt short-term rent counts toward the $500,000 (**U**): the app counts all rent (careful choice) and
  files Decisions question `RDF-RENT-COUNTS` for the CPA.
- No fee: customer pickup; delivery outside Colorado; purchaser exempt from state sales tax on the item (incl.
  resale with a valid license/certificate); every item in the order exempt; delivery not by motor vehicle (must be
  provable). One fee per retail sale however many trips. (**M**, Special Topics Oct 2026)
- Short-term lease without DR 0440 permission (Chris's case): "the lease is not subject to retail delivery fees";
  with permission: collected once, on the first lease payment. (**M**)
- Line wording: one separate item called **"retail delivery fees"**, not combined with tax or other charges (**H**).
- Paying it instead of charging: chosen at the first qualifying sale and applied consistently (**M**).
- Returns: the retailer may not refund the fee on a returned item. Cancelled before shipment with full refund of
  price, fee and tax → the retailer may take a credit. Free exchange/replacement → no new fee. (**M**)
- Return DR 1786, same schedule as sales tax, due the 20th (next business day); a return is required even with no
  deliveries. Late: greater of $15 or 10% + 0.5%/month (max 18%) plus interest. (**H**)
- Chris also pays RDF to sellers who deliver appliances to him (informational; part of the purchase cost).

## Colorado sales tax filing
- Frequency (**M**, Sales Tax Guide May 2026 p.19): monthly by default; quarterly allowed when average tax is under
  $1,100 and over $50 a month; annual when $50 or less. DOR reviews yearly and moves a retailer to a more frequent
  schedule effective **January 1**; it never moves to less frequent by itself — the retailer asks.
- Due the 20th of the following month (next business day); electronic payments by end of the due date (**M**).
- Late: greater of $15 or 10% + 0.5%/month (max 18%); 2026 interest 11% regular, 8% discounted (set yearly)
  (**H**, https://tax.colorado.gov/index.php/tax-topics-penalties-and-interest).
- License expires **December 31 of odd years** (next 12/31/2027) (**M**).
- Service (vendor) fee: none on state sales tax from **Jan 1, 2026**; state-collected local taxes may allow one (rates in
  DR 1002) (**H**). Weld County has no county tax and Greeley self-collects, so no state-side fee applies to Chris (**M**).

## Consumer use tax (DR 0252) (**H**, DR0252_2026.pdf)
- Under $300 for the year → one return by **January 20** of the next year. When the running total at any month end is
  over $300 → monthly returns due the 20th of the following month for the rest of the year. Each new year starts over.
- DOR doesn't administer city use taxes: Greeley use tax is filed with Greeley. Credit for tax legally paid elsewhere.

## Local rates
- State-collected local changes only on **January 1 or July 1**; local governments notify DOR at least 45 days ahead;
  DR 1002 is an interactive report (not machine-readable) (**H/M**).
- Greeley address: state 2.9% + Greeley 4.11% (Weld County none, not in RTD) = 7.01% (**M**). Greeley is home-rule,
  self-collected; its changes are by city ordinance, any date. The Nov 3, 2026 ballot asks for an extra **0.6%** for
  40 years (**M**; effective date if passed **U**).
- SUTS address lookup and API need an authenticated account (IN-61); bulk lookup paused until 1/1/2027.

## Short-term leases (**H/M**, Leases Jul 2026)
- 36 months or less; renewals/extensions tested separately; DR 0440 permission must be granted before purchase.
- Selling a used rental appliance is taxable at state and state-collected local rates; delivery charges taxable unless
  separable and separately stated.

## Federal (**H** unless noted)
- 1099: $2,000 for payments in tax years after 2025; "may be adjusted for inflation beginning in calendar year 2027".
  1099-NEC to payee and IRS by Jan 31; 1099-MISC to payee Jan 31, to IRS Feb 28 (paper) / Mar 31 (electronic).
- Section 179 2026: limit $2,560,000, phase-out from $4,090,000. Bonus depreciation 100% for property acquired after
  Jan 19, 2025 (optional 40%). Rented household appliance class: expected 5-year (**U**, CPA).
- Records: 3 years generally; 6 if income under-reported >25%; 7 for bad-debt claims; property records until the
  limit runs for the year it is disposed of.

## Exemption certificates (**M**, 1 CCR 201-4 Rule 39-26-105-3)
- Verify license/certificate is current at the time of sale; re-verify at the first sale after it expires. Forms:
  DR 0715 (exempt organization), DR 5002 (wholesale/exempt declaration), MTC uniform certificate; **DR 0563 is
  eliminated**. If records fall short at audit, 120 days to fix (+60 for good cause).

## Still unverified (Decisions questions)
RDF on "free" delivery (FAQ answer hidden; app treats delivery by its truck as a delivery either way), rent in the
$500,000 test, Greeley's rate breakdown/ballot effective date/filing/license/vendor-fee rules, depreciation class,
Colorado postmark rule, exempt-organization certificate life.
