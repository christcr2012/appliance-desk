# Build spec — Fees that cover delivery and installation, with the least tax to collect (FEETAX-1, FEETAX-2)

Chris, 2026-10-25: fees should offset delivery and installation costs "in a way that we have the least amount of tax
collection requirements", for Greeley and "any place within 50 miles of the center of the city of Greeley … and a
way to be sure if I decide to deliver outside of that 50 mile limit." Research:
`docs/research/2026-10-25-fee-taxability.md` and `docs/research/2026-10-25-tax-jurisdictions-50mi.md`. Builds on the
delivery zones (`docs/build-specs/screens/SERVICE-AREA-MAP.md`, ZONE-1 — zone prices feed the delivery and pickup lines)
and the existing tax engine (`src/domains/tax/engine.ts`, `categories.ts`, `locations.ts`), the delivery mileage bands
(`src/domains/orders/delivery.ts`) and TFA-1's dated rule versions (`TaxabilityRuleVersion`). Rules: AGENTS.md
section 1 (decisions never block; tax wording questions go to Decisions & reviews) and section 4.

## The plan in plain words (what Chris gets)
1. **Rent and rental fees carry no state tax** because the business pays tax when it buys each appliance (already
   the app's "pay on purchase" choice; C.R.S. 39-26-713). Keep it.
2. **Delivery, installation, pickup at the end and hauling away the old appliance are separate, optional lines**,
   each with a real "I'll pick it up / install it myself / no haul-away" choice shown with the price **when the
   customer orders**, and the same lines on the agreement and the bill. Where the law leaves optional, separately
   stated services out of the taxed price (the state for sales; each city once confirmed), they are not taxed.
3. **The $45 setup fee stays as Chris set it** (IN-74: per new service location, waivable with a reason). Because it
   is required, home-rule cities are likely to tax it; the Settings screen says so, and Decisions question
   FEETAX-ADMIN-FEE offers the lower-tax option (fold it into the optional installation price) for Chris to choose.
4. **Prices near real cost**: the app compares each service price with what the service really costs (truck miles
   and time from OPS-3 route logs) and warns when a price is more than the owner limit above cost (starting 150%),
   because inflating service fees to shrink taxed rent is not allowed.
5. **Every delivery address is checked before it can be quoted.** The app looks up every taxing place for the
   address (state, county, city, districts). It only lets staff quote and schedule when each of those places has
   decided rules and, where the city requires it, a license on file. Otherwise: "Not ready to deliver to {city} yet"
   with a To do that walks Chris through getting ready. This works the same inside and outside 50 miles, so going
   farther is safe: a new place simply asks to be set up first.

## FEETAX-1 — Optional, separately stated service lines and per-place fee rules

### 1. Data (additive migration `20261108000000_fee_taxability`)
```prisma
enum ServiceChoice { BY_BUSINESS  CUSTOMER_DOES_IT  NOT_NEEDED }
model OrderServiceChoice {            // one row per service on an order/agreement, frozen at signing
  id              String        @id @default(cuid())
  orderId         String
  agreementId     String?
  service         TaxChargeCategory   // DELIVERY | INSTALLATION | REMOVAL (pickup at end) | HAUL_AWAY (new category)
  choice          ServiceChoice
  offeredPriceCents Int               // price shown when ordering, also when the customer declined
  alternativeShown Boolean             // the $0 "do it myself" choice was on the screen the customer used
  quoteVersion    Int                  // ties to the offer snapshot the customer saw
  decidedAt       DateTime
  @@unique([orderId, service])
}
```
- New category `HAUL_AWAY` in `TAX_CHARGE_CATEGORIES` and invoice line kind `HAUL_AWAY_FEE` (add enum value; existing
  rows untouched). `categoryForLineKind` maps it.
- `TaxabilityRule` (and TFA-1's `TaxabilityRuleVersion`) gains `optionalSeparatedTreatment Taxability?`: the answer
  for a service line when the order proves it was optional and separately stated; null = same as `taxability`.
- Settings (owner, `restore recommended`): the existing $45 setup fee unchanged (IN-74); `serviceFeeCostLimitPercent`
  starting **150**; `selfInstallAllowedCategories` starting `["WASHER","DRYER_ELECTRIC","FRIDGE","FREEZER"]` (gas
  appliances need a pro hookup — the screen says so; never offer self-install for gas).

### 2. Order flow (estimate, portal checkout, desk order)
- Each service shows as its own choice with its price and the alternative: "Delivery $75 · or pick it up at our
  shop (free)"; "Installation $40 · or install it yourself (free)"; "Haul away your old one $25 · or no thanks";
  pickup at the end is offered the same way. Defaults are "by us" (most customers want it) but the customer can switch
  with one tap; the choice and price are saved as `OrderServiceChoice` in the same transaction that saves the order
  (lock the order row first, `assertActiveTeamActor` for staff paths).
- The agreement and every bill list the chosen services as separate lines with the same names and prices.
- Where an item can't be self-installed or a place can't be picked up from, the alternative is not shown and the
  record says `alternativeShown=false` — then that service is **not** treated as optional (honest record).

### 3. Engine rule (pure, `engine.ts`)
For a service line: if the order's `OrderServiceChoice` for that service has `choice=BY_BUSINESS`,
`alternativeShown=true` and the line is separately stated (its own line — always true for these kinds), use the
jurisdiction rule's `optionalSeparatedTreatment` (when set); otherwise use `taxability`, and if the rule is
`FOLLOWS_PARENT` treat it like the rent/sale it goes with. Missing choice record (old orders) → treated as not
optional (conservative). Reasons shown on the bill review: "Optional delivery, shown separately — not taxed by
{place}".

### 4. Starting rules (seeded as "Researched — not confirmed", TFA-1 rule book with sources)
| Place | Rent (≤36 mo) | Delivery / install / pickup / haul-away | Admin fee | Damage waiver | Late fee |
|---|---|---|---|---|---|
| Colorado state (and state-collected county/district taxes, pending FEETAX-LOCAL-3YR) | Not taxed (paid at purchase) | Not taxed with a rental; on a sale: not taxed if optional + separate, else taxed | Rental: not taxed; sale: taxed | Not taxed | Not taxed |
| Greeley (home rule) | **Taxed 4.11%** (city return covers rentals; no pay-at-purchase option verified) | **Taxed** until Greeley confirms (optional-separate answer left blank = taxed) | Taxed | Taxed | Taxed until confirmed (unverified; most conservative) |
| State-collected towns and counties (S in the 50-mile table) | Not taxed (paid at purchase covers state-administered local tax; DOR Leases, High) | Not taxed | Not taxed | Not taxed | Not taxed |
| Home-rule cities with a verified rule (Fort Collins, Thornton, Broomfield, Boulder, Aurora, Westminster, Loveland, Denver) | Taxed where verified (H) | **Delivery taxed even when separate** in Fort Collins, Thornton, Broomfield, Boulder, Aurora, Westminster; separately stated **installation not taxed** in Fort Collins, Thornton, Broomfield; others taxed until confirmed | Taxed | Taxed | Taxed until confirmed |
| Other home-rule cities ("not found") | Not ready to deliver until reviewed (section 9) | | | | |

Most conservative where unverified (AGENTS section 1). When Greeley answers in writing (checklist row below), Chris
changes the rule on Taxes › Rules; future bills follow; already-issued bills follow the late-change rule (TFA 4a).

### 5. Price-vs-cost check
`serviceCostCents(service, order)` (pure): miles × `truckCostPerMileCents` (setting, starting = IRS standard
mileage rate for 2026 from the rule book) + minutes × `laborCostPerMinuteCents` (setting, starting from Chris's
target hourly pay; Decisions question). When a service price set in Settings is more than
`serviceFeeCostLimitPercent` of the typical cost, Settings shows a warning: "This is well above what the trip costs.
Tax agencies can treat over-priced service fees as part of the taxed price." Warning only; never blocks.

### 6. Decisions & reviews questions (filed by FEETAX-1)
- FEETAX-GREELEY-LEASE: Does Greeley tax rentals of 36 months or less if the business paid Greeley use tax when it
  bought the appliance? (Starting value: taxed.) Reviewer: Greeley Sales Tax Division / CPA.
- FEETAX-GREELEY-SERVICE: Are optional, separately stated delivery, installation, pickup and haul-away left out of
  Greeley's taxed price, for rentals and for sales? (Starting value: taxed.)
- FEETAX-GREELEY-OTHER: Damage waiver, late fees, admin fees in Greeley. (Starting: all taxed until confirmed.)
- FEETAX-SOURCING: Is the rental taxed by the city where the customer has it (destination)? (Starting: yes — the
  engine already taxes by the service address.)
- FEETAX-LOCAL-3YR: Does the pay-at-purchase rule also cover state-collected county and district taxes? (Starting:
  yes for rent, per DOR lease sourcing guidance; CPA.)
- FEETAX-SR46: What new Special Rule 46 (effective 2026-08-30) says about charges included in lease payments. (CPA.)
- FEETAX-ADMIN-FEE: Keep the required $45 setup fee (likely taxed in home-rule cities) or fold it into the optional
  installation price? (Starting: keep — Chris's IN-74 answer.)
- FEETAX-LABOR-RATE: Chris's hourly cost for the price-vs-cost check.
- FEETAX-2F-EFFECTIVE: If Greeley measure 2F passes, its start date and whether existing rentals change (TFA-3 §15).

### 7. Owner checklist row (third-party answer)
"Ask Greeley Sales Tax in writing about fees" — the app drafts the email (questions above in plain words) to
Greeley.SalesTax@greeleygov.com from Settings › Taxes; Chris sends it from his own email; ready when he has a written
reply; he knows it worked when he records the answer on Taxes › Rules and the question shows "Confirmed".

## FEETAX-2 — Delivery-area tax readiness (the 50-mile map and beyond)

### 8. Data (same or following additive migration)
```prisma
model JurisdictionReadiness {
  id               String   @id @default(cuid())
  jurisdictionId   String   @unique
  taxesRentals     Taxability          // from research; UNDECIDED until reviewed
  licenseRequired  LicenseRequirement  // NONE | AFTER_FIRST_DELIVERY | AFTER_SECOND_DELIVERY_IN_12_MONTHS | ALWAYS | UNKNOWN
  licenseRecordId  String?             // VAULT-1 business record holding that city's license (number, expiry)
  filesThrough     FilingChannel       // SUTS | CITY_PORTAL | STATE_RETURN | UNKNOWN
  sourceUrl        String?
  checkedOn        DateTime?
  reviewStatus     TaxReviewStatus     // NEEDS_REVIEW | REVIEWED
  notes            String?
}
model JurisdictionDeliveryCount { jurisdictionId String; deliveredOn DateTime; orderId String @unique }
```
Seeded for every place in `docs/research/2026-10-25-tax-jurisdictions-50mi.md` (all `NEEDS_REVIEW` except what that
table marks High). Rates still come from `TaxRateVersion`.

### 9. The check (`src/domains/tax/delivery-readiness.ts`)
`deliveryTaxReadiness(addressId)` → `{ ready: boolean, places: [{ name, problem? }] }`, using the existing address
lookup (`locateServiceAddress`) and its confirmed jurisdictions. Not ready when any place: has no confirmed lookup;
is `SELF_COLLECTED` with `UNDECIDED` rent or fee rules; needs a license now (`ALWAYS`, or the next delivery would cross
its delivery count) and none is on file or it has expired; or the address is outside Colorado. Called by: the estimate
builder, the portal checkout, the desk order save, and the schedule (a job can't be put on the truck for a not-ready
address). Owners may override one order with a reason (audited) only when the problem is "rules not decided" — never
for a missing required license.
- Website address check: a not-ready address shows "We don't deliver there yet — call us" (no tax detail shown).
- To do "Get ready to deliver in {city}" with steps: what the city requires (from the table and its link), license
  form/link and fee ("costs money — your choice"), how returns are filed (SUTS or the city portal), and a "done" that
  stores the license in Business records (VAULT-1) and sets the readiness row to reviewed. Buying a license is Chris's.
- Delivery counter: for `AFTER_SECOND_DELIVERY_IN_12_MONTHS` places (e.g. Fort Collins, Windsor) the order screen warns
  before the delivery that would need the license.
- Beyond 50 miles: `mileageBand` keeps "manual only" pricing; the readiness check is identical, so a farther address
  is quotable only after its places are set up. Outside Colorado: refused with "Out-of-state delivery isn't set up."

### 10. Screen — Taxes › Delivery area (`/desk/sales-tax/area`, OWNER/ADMIN read; OWNER edits)
A list (and simple map using the existing address coordinates, no paid map service) of every place within 50 miles:
ready / needs setup / not checked, rate, "taxes rentals?", license needed, how to file, source and date. "Check an
address" box runs the readiness check for any address.

## 11. Tests
- Unit (`tests/fee-taxability.test.ts`): optional + shown alternative → `optionalSeparatedTreatment`; alternative not
  shown → regular; missing record → regular; gas appliance never offers self-install; price-vs-cost warning.
- Integration on throwaway Postgres (`tests/order-service-choice-integration.test.ts`): choices saved with the order
  under the row lock; agreement and bill lines match; customer A can't read customer B's choices.
- `tests/delivery-readiness.test.ts`: undecided self-collected city → not ready; license `ALWAYS` without record →
  not ready, override refused; second-delivery rule; out of state refused; owner override audited.
- e2e `e2e/delivery-area.spec.ts` (add to a shard): Delivery area screen, "Check an address", axe.
