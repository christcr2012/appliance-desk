# Design — Batch T: Colorado sales and use tax

Status: **PROPOSED — waiting for Chris's approval.** Do not implement until this line says APPROVED.
Written 2026-10-06 by Claude Opus 5.5 against `main` 23eff64 (#260), after reading the tax, checkout, webhook,
agreement, pickup-billing and settings code this document names. Plain-English summary for Chris:
`docs/plans/TAX-AND-BOOKS-OVERVIEW.md`. Scope and acceptance: `docs/PLAN.md` → Batch T.

**Who this is written for.** An implementing model (for example ChatGPT Sol 5.6 or Claude Sonnet 5.5) that follows
it literally. Every decision in section 1 is made. Do not re-decide; do not add tables, columns, enums, settings,
libraries or patterns this document does not name. Where it is silent on something that matters, stop (section 8).

**Nothing in this batch gives tax advice or guesses a tax answer.** Every tax *policy* (what is taxable, which
election Chris makes, cash or accrual reporting) is an owner setting whose starting value is **"Not decided yet"**,
and billing is blocked until it is decided. The code builds the machinery; Chris and his CPA supply the answers
(`docs/OWNER-INPUTS.md` IN-33 … IN-38).

---

## Why this batch exists (read once)

Today the app has **one** business-wide tax rate (`BusinessSettings.taxRateMilliPercent`, currently 7.375% in the
owner's notes), copied onto each agreement and sent to Stripe as **one** Stripe Tax Rate named "Sales tax"
(`getOrCreateTaxRate` in `src/domains/billing/checkout.ts`). The "tax rate confirmed" tick box
(`taxRateConfirmed`) only changes wording on the pricing page; it does not block billing.

Colorado is one of the hardest US states for sales tax:

1. **Destination-based, address-exact.** The rate depends on the delivery address, not the ZIP or the mailing city.
   Many "Greeley" mailing addresses are in unincorporated Weld County, Evans, Garden City or Windsor.
2. **Two kinds of local tax.** *State-collected* local taxes (counties, most towns, special districts) are filed with
   the state on SUTS. *Home-rule, self-collected* cities (Greeley, Loveland, Fort Collins, Windsor's neighbours, …)
   write their own rules and are filed with each city. Greeley is home-rule, self-collected, taxes leases/rentals
   of tangible personal property, and (per the state's SUTS jurisdiction list as found 2026-10-06) is **not** a SUTS
   participating city, so it is filed directly with Greeley. Public sources give Greeley 4.11% city + 2.9% state =
   7.01% combined, not 7.375%. **Chris's CPA must confirm** (IN-17 stays open for this).
3. **Rentals have a special state rule.** C.R.S. 39-26-713(2)(f): a lease of 3 years or less is **exempt** from state
   (and state-administered local) sales tax **if the lessor paid Colorado sales or use tax when acquiring the
   item**. Alternatively, with the Department's permission, the lessor may buy tax-free and collect tax on every
   lease payment. This is an *election* that changes what the app charges. Home-rule cities do not have to follow
   it (Greeley taxes lease payments). The Department published a draft rewrite of its lease rule ("Special Rule 47")
   in February 2026 — the CPA should say whether it changes anything.
4. **Use tax.** Under the "paid on acquisition" election, every appliance bought without Colorado tax (private
   sellers, out-of-state online stores) owes **use tax** to the state and to Greeley, reported on separate returns.
5. **Retail Delivery Fee** (a flat ~30¢ per delivery containing a *taxable* item). Businesses with $500,000 or less of
   Colorado retail sales in the prior year are exempt. Likely not applicable — CPA confirms (IN-37).

Colorado's free **GIS rate lookup** (Department of Revenue) answers "which jurisdictions and rates apply at this exact
address", including counties, cities and special districts, through an API with a key obtained after registering on
SUTS. Its exact request/response format is only published inside SUTS, so this design isolates it behind one small
adapter (section 3.3) and works fully with manual entry until the key exists.

Sources (2026-10-06): tax.colorado.gov/GIS-API, tax.colorado.gov/SUTS-info, tax.colorado.gov/SUTS-Jurisdictions,
C.R.S. 39-26-713, Colorado "Sales Tax Topics: Leases" publication, greeleyco.gov Sales Tax page, Stripe Tax docs
for Colorado (home-rule registrations, retail delivery fee), Stripe Tax Rates and "collect taxes for recurring
payments" docs.

---

## 0. Verify before starting (drift check — every row takes under a minute)

Checked against 23eff64 on 2026-10-06. If `main` has moved, re-check every row; a false row is a stop.

| # | Assumption | How to check |
|---|---|---|
| T-A1 | Tax arithmetic lives in `src/domains/billing/tax.ts` (`taxCentsForLine`, `sumTax`, milli-percent units, half-away-from-zero per line). | read the file |
| T-A2 | The only Stripe tax-rate creation is `getOrCreateTaxRate` in `src/domains/billing/checkout.ts`, attached as `tax_rates` on subscription items; `subscription-line.ts` copies existing `item.tax_rates` when it changes items. | `grep -rn "taxRates\.\|tax_rates" src` |
| T-A3 | Agreement tax is a snapshot `RentalAgreement.taxRateMilliPercent`, set by the rental builder (`src/app/desk/agreements/actions.ts`) and copied by `renewal-data.ts`. Local invoices tax with it in `pickup-billing-events.ts`, `early-return.ts`, `late-return-waiver.ts`. | `grep -rn "taxRateMilliPercent" src` |
| T-A4 | Stripe invoices are mirrored in `src/domains/billing/webhooks-base.ts` `recordPaidInvoice` (and the payment-failed path), writing one `TAX` `InvoiceLineItem` from `invoice.total_taxes`. | read `extractTaxCents` and its callers |
| T-A5 | `taxRateConfirmed` gates only display text (`src/domains/billing/tax.ts` ~line 86, pricing page). Nothing blocks billing setup on tax. | grep |
| T-A6 | `ServiceAddress` has `line1, line2, city, state, zip`; agreements reference one service address. | `prisma/schema.prisma` |
| T-A7 | Provider calls use `ProviderOperation` claims with idempotency keys (`claimProviderOperation`) and are reconciled by `src/domains/billing/reconciliation*.ts`. | grep `claimProviderOperation` |
| T-A8 | Cron routes check `CRON_SECRET` and wrap work in `runAutomation` (`src/domains/automation/runs.ts`); schedules live in `vercel.json`. | read `src/app/api/cron/late-fees/route.ts` |
| T-A9 | `requireRole` and `assertActiveTeamActor` are the permission primitives; settings screens follow the pattern of `src/app/desk/settings/pickup-billing-form.tsx` (explained in-screen, "Restore recommended values"). | read them |
| T-A10 | Production has no customers, agreements or subscriptions (`docs/STATUS.md`). If that changed, the backfill in WU-T2 must be proved on a copy first, and Chris must approve. | STATUS; ask Chris |
| T-A11 | Batch E2 (redesign) has merged; new screens use the Evergreen components it produced. If E2 is still open, build T's screens with the same components E2 uses and say so in the PR. | STATUS / git log |

---

## 1. Decisions (made — do not re-open)

### D-T1 — Appliance Desk is the tax engine; Stripe only collects. Stripe Tax is **not** turned on.

The app computes every tax amount from its own tables (rates from Colorado's GIS, rules from the owner's settings).
Stripe receives the result as ordinary **Tax Rate** objects (free) attached to subscription items. Stripe Tax
(automatic calculation, 0.5% of taxed volume on top of Billing's fees) and "set up tax in the Stripe dashboard" (the
same product, no-code) are both rejected because:

1. The biggest Colorado rental rule (D-T4) depends on whether Chris paid tax when he bought each appliance — Stripe
   cannot know that. Using Stripe Tax would still need per-jurisdiction "customizations" maintained by hand.
2. The app already creates its own invoices (late returns, early returns, pickups, waivers) that Stripe never
   calculates. Two engines would disagree; one engine cannot.
3. Greeley is not on SUTS, so Greeley returns are filed by hand either way; Stripe's filing partners cost extra.
4. Cost: roughly 0.5% of every taxed payment for a calculation the state gives away free.

**When to revisit** (write it in `docs/ROADMAP.md`): selling goods outright (not renting), operating outside
Colorado, or more than about 15 tax areas in regular use. The engine is behind one interface
(`src/domains/tax/engine.ts`), so swapping later is a contained change.

### D-T2 — One tax area per jurisdiction, one immutable rate row per change

`TaxJurisdiction` = one taxing body (the state, a county, a city, a special district). `TaxRateVersion` = its rate
from a date onward; never edited once any invoice used it — a change is a new row. Each version gets its own Stripe
Tax Rate (Stripe forbids changing a rate's percentage). Colorado local rate changes normally take effect on
January 1 or July 1; the app does not enforce that (dates are owner-entered), but the reminders in D-T9 use it.

### D-T3 — Every address is located, not guessed

Each `ServiceAddress` gets an `AddressTaxLocation`: the list of jurisdictions at that exact address, where the answer
came from (Colorado GIS, a bulk file from the state's bulk lookup page, or manual entry), and a status:
`VERIFIED`, `NEEDS_REVIEW` (ambiguous match, manual entry not yet confirmed, or a jurisdiction nobody has reviewed),
or `FAILED`. ZIP code and city name are never used to choose a rate. A `NEEDS_REVIEW` or `FAILED` address cannot
start billing (D-T7).

### D-T4 — The short-term lease election is a business setting

`BusinessSettings.shortTermLeaseElection`: `UNDECIDED` (starting value) | `PAY_ON_ACQUISITION` | `COLLECT_ON_RENTALS`.

- `PAY_ON_ACQUISITION`: rent (category `RENTAL`, and `LATE_RETURN`, which is rent) is **exempt** in every
  *state-collected* jurisdiction, for leases of 36 months or less; use tax is due on appliances bought untaxed
  (section 3.6).
- `COLLECT_ON_RENTALS`: rent is **taxable** in every state-collected jurisdiction; appliance purchases owe no use tax
  (the owner records the Department's permission number in the setting's note).
- `UNDECIDED`: billing is blocked.

Self-collected (home-rule) jurisdictions **never** inherit this; each has its own rule rows. A month-to-month rental
counts as 36 months or less. An exception card is raised when one customer has continuously rented the same appliance
for more than 36 months (renewals included) — the CPA decides what happens then (IN-36); the app does not change
the tax automatically.

### D-T5 — Taxability is an owner-maintained matrix, never inferred

`TaxabilityRule(jurisdiction or "all state-collected", charge category) → TAXABLE | EXEMPT | UNDECIDED`, with a
plain-words reason and an optional "CPA confirmed on" date. Charge categories map from `InvoiceLineItemKind`
exactly as in section 3.1. Resolution order is in section 3.2. `DEPOSIT` is never a sale and is not in the matrix
(always non-taxable, hard-coded with a comment citing this decision). Starting values: every rule `UNDECIDED`,
except the matrix screen offers a one-click "Fill in the common Colorado starting answers" that writes the values in
section 3.1's "Suggested" column with reason text *and leaves "CPA confirmed" empty*. A Today card nags until every
rule in use has a CPA-confirmed date (it does not block billing; `UNDECIDED` does).

### D-T6 — Rounding: per line, per jurisdiction

Tax = `taxCentsForLine(lineAmountCents, rateMilliPercent)` for **each line and each taxable jurisdiction**, summed.
This makes every jurisdiction's return total equal the sum of its invoice amounts (no penny drift between returns) and
matches how Stripe computes multiple tax rates on one line. The customer sees one combined "Sales tax" line plus the
breakdown on the invoice detail.

### D-T7 — Billing is blocked until tax is decided (replaces the decorative `taxRateConfirmed` gate)

`assertTaxReadyForAgreement(tx, agreementId)` throws `TaxNotReadyError` with a plain-English list when any of these is
true: the election is `UNDECIDED`; the agreement's address has no current `VERIFIED` location; any jurisdiction at
the address is `NEEDS_REVIEW`; any jurisdiction lacks a rate version effective today; any category the agreement can
charge (`RENTAL`, plus each fee the agreement carries) resolves to `UNDECIDED`. It is called by: rental-builder
"send for signature", billing setup in `checkout.ts` (before any Stripe call), and local invoice creation. The
pricing page stops printing a rate; it says "plus sales tax for your address" (wording from site settings).
`taxRateConfirmed` stays in the schema (additive rule) but nothing reads it after WU-T5; its settings control is
removed and the cleanup is listed in `docs/ROADMAP.md`.

### D-T8 — Stripe-mirrored invoices keep Stripe's amounts; the engine checks them

For a Stripe invoice the taxed amounts come from Stripe (it charged them). The webhook mirror maps each Stripe tax
rate back to a `TaxRateVersion` (by `stripeTaxRateId`) and writes `InvoiceTaxLine` rows with `source = STRIPE`. It
also runs the engine for the same lines and dates: exempt portions are written as `source = ENGINE` rows (Stripe
never sees exempt jurisdictions), and any taxed amount that differs from the engine by 1 cent or more raises an
exception card "Stripe charged different tax than expected" with both numbers. It never edits Stripe.

### D-T9 — Rate changes are applied the day before they start

A daily automation (`tax-rate-changes`, 18:05 UTC ≈ midday Denver) finds rate versions starting tomorrow (Denver) and,
for every live subscription whose address includes that jurisdiction and whose rent is taxable there, replaces the
subscription items' `tax_rates` (proration `none`) through a `ProviderOperation` `SUBSCRIPTION_TAX_UPDATE` with key
`sub-tax-<agreementId>-<rateVersionId>`. Subscriptions are billed at Colorado midnight (IN-28), so a change applied at
midday is in place for the next morning's invoices. Reminders: Today cards on **November 15** and **May 15**:
"Check Colorado's list of local rate changes for January 1 / July 1 and enter any that affect your areas" (link to
the state's rate-change page from site settings). On January 1 and July 1, and monthly, a re-check job re-runs the GIS
lookup for every current address and raises a card for any difference.

### D-T10 — Exemptions are per customer, with a certificate on file

`CustomerTaxExemption` (resale, government, charitable, other) with certificate number, a photo of the certificate
(existing private upload system), validity dates and scope (all jurisdictions, or a chosen list). An expired or
revoked exemption stops applying on its end date; a Today card warns 30 days before expiry. Only the owner adds,
verifies or revokes one.

### D-T11 — Filing is tracked; money still moves outside the app

`TaxFilingAccount` = a place Chris files ("Colorado — SUTS", "City of Greeley"), with frequency, due day, account
number and the jurisdictions it covers. `TaxFilingPeriod` = one return. The app produces the worksheet (section 3.5),
reminds before the due date, and records "filed on / confirmation number / amount paid". When a period is marked
filed its worksheet is frozen; later corrections to invoices in that period appear on the **next** period's worksheet
as "Corrections to earlier periods", never by silently changing a filed number. Each account's reporting basis
(`ACCRUAL` by invoice date, or `CASH` by payment date) is a setting starting at `UNDECIDED` (IN-35); an `UNDECIDED`
basis shows the worksheet with a warning instead of totals.

### D-T12 — Permissions

OWNER: everything. ADMIN: view all tax screens, confirm addresses, review new jurisdictions' *names and levels*,
enter rate versions; cannot change the election, taxability rules, exemptions, filing accounts or mark a return
filed. STAFF and CUSTOMER: nothing (customers see only their own invoice breakdown). Enforce in the domain functions
with `requireRole` / `assertActiveTeamActor`, never only by hiding links.

### D-T13 — The Colorado GIS key is optional at runtime

With `COLORADO_GIS_API_KEY` unset, the lookup source is "manual": address saves create `NEEDS_REVIEW` locations, and
the owner/admin picks jurisdictions from a list (or imports the state's bulk-lookup result file). Nothing else
changes. The key is never logged, never sent to the browser and never stored in the database.

---

## 2. Schema changes (additive only) — migration `<timestamp>_batch_t_sales_tax`

Name the folder with a timestamp later than the newest migration on `main`. Add every new table to backup/export
coverage (`src/domains/backup`) and to `src/lib/schema-health.ts`; the populated-upgrade drill must show old rows keep
sane defaults.

```prisma
enum TaxJurisdictionLevel { STATE COUNTY CITY SPECIAL_DISTRICT }
enum TaxAdministration { STATE_COLLECTED SELF_COLLECTED }
enum TaxReviewStatus { NEEDS_REVIEW REVIEWED }
enum TaxChargeCategory { RENTAL LATE_RETURN DELIVERY INSTALLATION REMOVAL DAMAGE_WAIVER EARLY_TERMINATION LATE_PAYMENT_FEE OTHER_CHARGE }
enum Taxability { TAXABLE EXEMPT UNDECIDED }
enum TaxRateSource { COLORADO_GIS BULK_FILE MANUAL }
enum TaxAddressStatus { VERIFIED NEEDS_REVIEW FAILED }
enum ShortTermLeaseElection { UNDECIDED PAY_ON_ACQUISITION COLLECT_ON_RENTALS }
enum TaxReportingBasis { UNDECIDED ACCRUAL CASH }
enum TaxFilingFrequency { MONTHLY QUARTERLY ANNUAL }
enum TaxFilingStatus { OPEN FILED }
enum TaxExemptionReason { RESALE GOVERNMENT CHARITABLE OTHER }
enum TaxLineSource { ENGINE STRIPE }
enum UseTaxStatus { DUE NOT_DUE FILED }

model TaxFilingAccount {
  id                    String             @id @default(cuid())
  name                  String             // "Colorado — SUTS", "City of Greeley"
  accountNumber         String?            // license/account number (not a secret)
  frequency             TaxFilingFrequency @default(MONTHLY)
  dueDayOfFollowingMonth Int               @default(20)
  basis                 TaxReportingBasis  @default(UNDECIDED)
  portalUrl             String?
  active                Boolean            @default(true)
  jurisdictions         TaxJurisdiction[]
  periods               TaxFilingPeriod[]
  createdAt             DateTime           @default(now())
  updatedAt             DateTime           @updatedAt
}

model TaxJurisdiction {
  id               String               @id @default(cuid())
  code             String               @unique // as Colorado's GIS returns it; manual ones are "MANUAL-<slug>"
  name             String
  level            TaxJurisdictionLevel
  administration   TaxAdministration
  filingAccountId  String?
  filingAccount    TaxFilingAccount?    @relation(fields: [filingAccountId], references: [id])
  reviewStatus     TaxReviewStatus      @default(NEEDS_REVIEW)
  reviewedByUserId String?
  reviewedAt       DateTime?
  notes            String?
  rates            TaxRateVersion[]
  rules            TaxabilityRule[]
  addresses        AddressTaxJurisdiction[]
  createdAt        DateTime             @default(now())
  updatedAt        DateTime             @updatedAt
}

model TaxRateVersion {
  id               String          @id @default(cuid())
  jurisdictionId   String
  jurisdiction     TaxJurisdiction @relation(fields: [jurisdictionId], references: [id])
  rateMilliPercent Int             // thousandths of a percent, as tax.ts
  effectiveFrom    DateTime        // Colorado midnight of the first day, stored UTC
  source           TaxRateSource
  sourceNote       String?
  recordedByUserId String?
  stripeTaxRateId  String?         @unique
  createdAt        DateTime        @default(now())

  @@unique([jurisdictionId, effectiveFrom])
}

model TaxabilityRule {
  id                String            @id @default(cuid())
  jurisdictionId    String?           // null = the rule for every state-collected jurisdiction
  jurisdiction      TaxJurisdiction?  @relation(fields: [jurisdictionId], references: [id])
  category          TaxChargeCategory
  taxability        Taxability        @default(UNDECIDED)
  reason            String?
  cpaConfirmedOn    DateTime?
  updatedByUserId   String?
  updatedAt         DateTime          @updatedAt

  @@unique([jurisdictionId, category])
}

model AddressTaxLocation {
  id                 String           @id @default(cuid())
  serviceAddressId   String?          // null only for the business's own location (forBusinessLocation)
  serviceAddress     ServiceAddress?  @relation(fields: [serviceAddressId], references: [id])
  forBusinessLocation Boolean         @default(false)
  status             TaxAddressStatus
  source             TaxRateSource
  normalizedAddress  String?
  reviewNote         String?          // plain words: why it needs review
  lookedUpAt         DateTime
  confirmedByUserId  String?
  isCurrent          Boolean          @default(true)
  jurisdictions      AddressTaxJurisdiction[]
  createdAt          DateTime         @default(now())

  @@index([serviceAddressId, isCurrent])
}

model AddressTaxJurisdiction {
  addressTaxLocationId String
  location             AddressTaxLocation @relation(fields: [addressTaxLocationId], references: [id], onDelete: Cascade)
  jurisdictionId       String
  jurisdiction         TaxJurisdiction    @relation(fields: [jurisdictionId], references: [id])

  @@id([addressTaxLocationId, jurisdictionId])
}

model InvoiceTaxLine {
  id                String            @id @default(cuid())
  invoiceId         String
  invoice           Invoice           @relation(fields: [invoiceId], references: [id], onDelete: Cascade)
  invoiceLineItemId String?
  jurisdictionId    String
  rateVersionId     String
  category          TaxChargeCategory
  taxableCents      Int               // amount taxed (0 when exempt)
  exemptCents       Int               @default(0)
  exemptReason      String?
  taxCents          Int
  source            TaxLineSource
  createdAt         DateTime          @default(now())

  @@index([invoiceId])
  @@index([jurisdictionId, createdAt])
}

model CustomerTaxExemption {
  id                String             @id @default(cuid())
  customerId        String
  customer          Customer           @relation(fields: [customerId], references: [id])
  reason            TaxExemptionReason
  certificateNumber String?
  certificatePhotoId String?           // existing private upload id
  jurisdictionIds   Json               @default("[]") // empty = every jurisdiction
  validFrom         DateTime
  expiresOn         DateTime?
  revokedAt         DateTime?
  verifiedByUserId  String
  notes             String?
  createdAt         DateTime           @default(now())

  @@index([customerId])
}

model TaxFilingPeriod {
  id                      String           @id @default(cuid())
  filingAccountId         String
  filingAccount           TaxFilingAccount @relation(fields: [filingAccountId], references: [id])
  periodStart             DateTime
  periodEnd               DateTime
  dueOn                   DateTime
  status                  TaxFilingStatus  @default(OPEN)
  worksheet               Json?            // frozen copy of section 3.5's shape when FILED
  filedOn                 DateTime?
  confirmationNumber      String?
  amountPaidCents         Int?
  serviceFeeRetainedCents Int?
  filedByUserId           String?
  notes                   String?
  createdAt               DateTime         @default(now())
  updatedAt               DateTime         @updatedAt

  @@unique([filingAccountId, periodStart])
}

model PurchaseUseTax {
  id                 String       @id @default(cuid())
  sourceType         String       // "APPLIANCE" | "PURCHASE_ORDER_LINE" | "EXPENSE" (Batch K)
  sourceId           String
  purchasedOn        DateTime
  purchaseAmountCents Int
  vendorTaxCents     Int          // tax the seller charged, allocated to this jurisdiction
  jurisdictionId     String
  rateVersionId      String
  useTaxDueCents     Int
  status             UseTaxStatus
  filingPeriodId     String?
  createdAt          DateTime     @default(now())

  @@unique([sourceType, sourceId, jurisdictionId])
}
```

Additions to existing models (relations only where Prisma needs the back-reference):

- `BusinessSettings`: `shortTermLeaseElection ShortTermLeaseElection @default(UNDECIDED)`,
  `shortTermLeaseElectionNote String?`, `retailDeliveryFeeDecision String @default("UNDECIDED")`
  (values `UNDECIDED`, `NOT_LIABLE`, `COLLECT`; `COLLECT` only records the answer — collecting is not built, see
  section 8), `businessTaxAddress Json @default("{}")` (`{ line1, city, zip }`, used for use tax).
- `ProviderOperationKind`: add `TAX_RATE_CREATE`, `SUBSCRIPTION_TAX_UPDATE`.
- `Invoice`: `taxLines InvoiceTaxLine[]`. `ServiceAddress`: `taxLocations AddressTaxLocation[]`. `Customer`:
  `taxExemptions CustomerTaxExemption[]`.

Raw SQL in the same migration (Prisma cannot express partial uniques):

```sql
CREATE UNIQUE INDEX "TaxabilityRule_default_category_key" ON "TaxabilityRule"("category") WHERE "jurisdictionId" IS NULL;
CREATE UNIQUE INDEX "AddressTaxLocation_one_current_key" ON "AddressTaxLocation"("serviceAddressId") WHERE "isCurrent" AND "serviceAddressId" IS NOT NULL;
CREATE UNIQUE INDEX "AddressTaxLocation_one_business_key" ON "AddressTaxLocation"("forBusinessLocation") WHERE "isCurrent" AND "forBusinessLocation";
```

Seed rows written by the migration (data, not fixtures; safe on production because they describe law, not people):
the jurisdiction `CO` ("State of Colorado", STATE, STATE_COLLECTED, REVIEWED) with **no rate version** (the owner
enters 2.900% with the effective date after the CPA confirms — the app never ships a rate), and one `UNDECIDED`
default rule per category. No filing accounts are seeded.

---

## 3. Shared primitives (new folder `src/domains/tax/`)

### 3.1 Category mapping — `categories.ts` (pure)

| `InvoiceLineItemKind` | `TaxChargeCategory` | Suggested starting answer for state-collected (only with "Fill in starting answers"; CPA must confirm) |
|---|---|---|
| RENTAL | RENTAL | from the election (D-T4) |
| LATE_RETURN, LATE_RETURN_WAIVER | LATE_RETURN | same as RENTAL (it is rent) |
| DELIVERY_FEE | DELIVERY | EXEMPT when separately stated — "Separately stated delivery charge" |
| INSTALLATION_FEE | INSTALLATION | EXEMPT when separately stated — "Separately stated installation labor" |
| REMOVAL_FEE | REMOVAL | EXEMPT — "Separately stated service charge" |
| DAMAGE_WAIVER | DAMAGE_WAIVER | UNDECIDED — ask the CPA |
| EARLY_TERMINATION_FEE | EARLY_TERMINATION | UNDECIDED — ask the CPA (this is IN-25) |
| LATE_FEE | LATE_PAYMENT_FEE | EXEMPT — "Late payment charge is not a sale" |
| ADJUSTMENT, CREDIT, PREPAY_DISCOUNT | follows the line it reduces (see 3.2 step 5) | — |
| DEPOSIT | not taxable, never in the matrix | — |
| TAX | not a taxable line | — |

For **self-collected** jurisdictions the "Fill in" button writes nothing — the owner sets each one (Greeley's screen
links to Greeley's tax page). `export function categoryForLineKind(kind): TaxChargeCategory | "NOT_TAXABLE" | "FOLLOWS_PARENT"`.

### 3.2 Engine — `engine.ts` (pure, no Prisma import)

```ts
export type EngineJurisdiction = {
  id: string; code: string; name: string;
  administration: "STATE_COLLECTED" | "SELF_COLLECTED";
  rate: { versionId: string; rateMilliPercent: number } | null; // version effective on the tax date
  rules: Partial<Record<TaxChargeCategory, "TAXABLE" | "EXEMPT" | "UNDECIDED">>; // jurisdiction-specific rows
};
export type EngineInput = {
  taxDate: Date;                       // business date the charge is for (invoice period start, or invoice date)
  leaseTermMonths: number | null;      // null = month-to-month
  election: "UNDECIDED" | "PAY_ON_ACQUISITION" | "COLLECT_ON_RENTALS";
  defaultRules: Partial<Record<TaxChargeCategory, "TAXABLE" | "EXEMPT" | "UNDECIDED">>; // jurisdictionId null rows
  jurisdictions: EngineJurisdiction[];
  exemptJurisdictionIds: Set<string>;  // from active customer exemptions on taxDate
  lines: { key: string; kind: InvoiceLineItemKind; amountCents: number; parentKey?: string }[];
};
export type EngineTaxLine = {
  lineKey: string; jurisdictionId: string; rateVersionId: string; category: TaxChargeCategory;
  taxableCents: number; exemptCents: number; exemptReason: string | null; taxCents: number;
};
export type EngineResult =
  | { ok: true; lines: EngineTaxLine[]; totalTaxCents: number }
  | { ok: false; problems: string[] };  // plain English, one per problem; never throws for policy gaps

export function computeTax(input: EngineInput): EngineResult;
export function resolveTaxability(j: EngineJurisdiction, category: TaxChargeCategory, input: Pick<EngineInput, "election" | "defaultRules" | "leaseTermMonths">): { taxability: "TAXABLE" | "EXEMPT" | "UNDECIDED"; reason: string };
```

`resolveTaxability`, in this order:

1. A jurisdiction-specific rule that is not `UNDECIDED` wins.
2. If the jurisdiction is `SELF_COLLECTED`: the answer is its own rule, so `UNDECIDED` when missing. Stop.
3. Category `RENTAL` or `LATE_RETURN` in a state-collected jurisdiction: election `PAY_ON_ACQUISITION` and
   (`leaseTermMonths === null` or `<= 36`) → EXEMPT, reason "Short-term rental — tax paid when the appliance was
   bought (C.R.S. 39-26-713)"; election `PAY_ON_ACQUISITION` and term > 36 → TAXABLE; `COLLECT_ON_RENTALS` → TAXABLE;
   `UNDECIDED` → UNDECIDED.
4. Otherwise the default rule for the category; missing → UNDECIDED.

`computeTax`: for every line with a taxable category and every jurisdiction: problems if the rate is null ("No rate
entered for <name> on <date>") or taxability UNDECIDED ("<category words> in <name>: not decided yet"); exempt by
customer exemption → `exemptCents = amount`, reason "Customer exemption certificate"; exempt by rule → same with the
rule's reason; taxable → `taxCentsForLine(amount, rate)`. Step 5: a negative line (`FOLLOWS_PARENT`) is taxed with its
parent line's category and the same per-jurisdiction treatment (a discount on rent reduces taxable rent). A line
without a `parentKey` that `FOLLOWS_PARENT` uses category `RENTAL`. If any problem exists, return `ok: false` with
**all** problems (never the first only).

### 3.3 Colorado GIS adapter — `colorado-gis.ts`

```ts
export type GisJurisdiction = { code: string; name: string; level: TaxJurisdictionLevel; administration: TaxAdministration | null; rateMilliPercent: number | null };
export type GisLookup =
  | { status: "MATCHED"; normalizedAddress: string; jurisdictions: GisJurisdiction[] }
  | { status: "AMBIGUOUS" | "NOT_FOUND" | "UNAVAILABLE"; message: string };
export interface ColoradoRateSource { lookup(address: { line1: string; line2?: string | null; city: string; zip: string }): Promise<GisLookup> }
export function getColoradoRateSource(): ColoradoRateSource; // real client when COLORADO_GIS_API_KEY is set, else ManualOnlySource (always UNAVAILABLE)
export function __setColoradoRateSourceForTests(source: ColoradoRateSource | null): void;
```

The real client is written in WU-T3 **only from** `docs/runbooks/colorado-gis-api.md` (created in WU-T0 from the
documentation shown inside SUTS — endpoint, parameters, response fields, limits; never the key). Requirements: 8-second
timeout; one retry on network error only; HTTP errors and unexpected JSON shapes map to `UNAVAILABLE` (never throw to
the caller); rates converted to milli-percent with exact string arithmetic (no floats: `"4.11"` → 4110); the
response is validated with zod and the raw response is **not** stored. If the API does not say whether a jurisdiction
is self-collected, `administration` is `null` and a new jurisdiction lands `NEEDS_REVIEW` for a person to set it.

### 3.4 Locating addresses — `locations.ts`

```ts
export async function locateServiceAddress(serviceAddressId: string, opts?: { force?: boolean }): Promise<{ status: TaxAddressStatus }>;
export async function confirmAddressLocation(actorUserId: string, input: { serviceAddressId: string; jurisdictionIds: string[] }): Promise<void>; // OWNER/ADMIN; writes a MANUAL VERIFIED location
export async function importBulkLookupFile(actorUserId: string, csvText: string): Promise<{ matched: number; needsReview: number; errors: string[] }>; // OWNER/ADMIN
export async function getAgreementTaxContext(tx, agreementId, taxDate: Date): Promise<Omit<EngineInput, "lines">>;
export async function assertTaxReadyForAgreement(tx, agreementId): Promise<void>; // D-T7; throws TaxNotReadyError(problems)
```

`locateServiceAddress` runs after the address is committed (never inside the address-save transaction): calls the
source; on `MATCHED`, upserts each jurisdiction by `code` (new ones `NEEDS_REVIEW`), creates a rate version from the
GIS rate when the jurisdiction has none effective today (source `COLORADO_GIS`, effective today, flagged in the
jurisdiction review list), and writes a new current location (previous one `isCurrent = false`) — `VERIFIED` when all
jurisdictions are `REVIEWED`, else `NEEDS_REVIEW` with a note. Any other status → `NEEDS_REVIEW` (or `FAILED` for
`NOT_FOUND`) with the message. Without `force`, an address looked up within 30 days is not looked up again. The bulk
importer accepts the column layout documented in WU-T0's runbook only; unknown layouts are rejected with a message.

### 3.5 Return worksheet — `worksheet.ts` (pure builder + loader)

```ts
export type FilingWorksheet = {
  filingAccountId: string; periodStart: string; periodEnd: string; basis: "ACCRUAL" | "CASH";
  grossSalesCents: number;                                 // all charges at addresses inside this account's jurisdictions, excl. deposits and tax
  exemptByReason: { reason: string; cents: number }[];
  byJurisdiction: { jurisdictionId: string; name: string; code: string; taxableCents: number; taxCents: number }[];
  refundsAndCreditsCents: number;                          // tax-bearing reductions in the period
  correctionsToEarlierPeriods: { periodStart: string; jurisdictionId: string; taxCents: number }[];
  useTax: { jurisdictionId: string; purchaseCents: number; useTaxCents: number }[];
  totalTaxDueCents: number;
};
export function buildWorksheet(input: {...}): FilingWorksheet; // pure
export async function loadWorksheet(filingPeriodId: string): Promise<FilingWorksheet | { blocked: string }>; // OWNER/ADMIN
export async function markPeriodFiled(actorUserId: string, input: { filingPeriodId: string; filedOn: Date; confirmationNumber: string; amountPaidCents: number; serviceFeeRetainedCents?: number }): Promise<void>; // OWNER; freezes worksheet; row-locks the period
```

Accrual basis counts `InvoiceTaxLine` rows by their invoice's issue date (Colorado date). Cash basis allocates each
payment across the invoice's tax lines with `allocateAcrossLines` (3.7) and counts by payment date. Refund tax uses
the same allocator. Labels on screen use the plain words "Gross sales", "Exempt sales", "Taxable sales", "Tax";
the PR must **not** claim these map to specific return line numbers — the owner guide says "your CPA confirms which
box each number goes in".

### 3.6 Use tax — `use-tax.ts`

```ts
export async function recordUseTaxForPurchase(tx, input: { sourceType: "APPLIANCE" | "PURCHASE_ORDER_LINE" | "EXPENSE"; sourceId: string; purchasedOn: Date; amountCents: number; vendorTaxCents: number; isRentalInventory: boolean }): Promise<void>;
```

Uses the current business-location `AddressTaxLocation`. For each jurisdiction: expected = `taxCentsForLine(amount,
rate)`; vendor tax is split across jurisdictions in proportion to their rates (`allocateAcrossLines`); due =
max(0, expected − allocated vendor tax). Status `NOT_DUE` when due is 0, or when `isRentalInventory` and the election
is `COLLECT_ON_RENTALS` (rental inventory bought for re-lease under that election). Called when an appliance's
acquisition cost is saved (new optional field on the add/edit appliance form: "Sales tax the seller charged"), when a
purchase order is marked received (per line with a known cost; vendor tax entered once per order and split across
lines by amount), and by Batch K's expenses. Idempotent per `(sourceType, sourceId, jurisdictionId)`; a cost change
updates the row unless its status is `FILED` (then a correction row is not written — a Today card asks the owner to
handle it on the next return; stop-and-ask point S-T6 explains why).

### 3.7 Allocation helper — `allocate.ts` (pure)

`allocateAcrossLines(totalCents: number, weights: number[]): number[]` — largest-remainder method, integer cents, sum
always equals `totalCents`, negative totals allocate symmetrically, zero weights get 0, ties go to the earlier index.
Batch K reuses it.

### 3.8 Stripe rates — `stripe-rates.ts`

```ts
export async function ensureStripeTaxRate(rateVersionId: string): Promise<string>; // ProviderOperation TAX_RATE_CREATE, key `tax-rate-<rateVersionId>`
export async function stripeTaxRateIdsForAgreement(tx, agreementId: string, taxDate: Date): Promise<string[]>; // RENTAL-category taxable jurisdictions only
```

Each Stripe Tax Rate: `display_name` "Sales tax", `jurisdiction` = jurisdiction name (shows on the customer's Stripe
invoice), `percentage` = milli-percent / 1000 as an exact decimal string, `inclusive: false`, `country: "US"`,
`state: "CO"`, `tax_type: "sales_tax"`, `metadata: { rateVersionId, jurisdictionCode }`. More than **5** taxable
jurisdictions for one line (Stripe's limit per subscription item) → `TaxNotReadyError` "This address has more tax
areas than Stripe allows on one item" (stop-and-ask S-T3; northern Colorado addresses have 1–4).

Fees charged through Stripe Checkout at signing (deposit is never taxed; damage waiver and one-time fees follow their
categories) use the same `ensureStripeTaxRate` ids per line.

---

## 4. Screens (Desk → Money → **Sales tax**; OWNER and ADMIN)

Every screen follows AGENTS.md's "explained in the screen" rule: what the setting does, what each choice means for a
customer, the starting value and why, who can change it, and (where a recommended value exists) a restore button.
Tax policy settings have **no** recommended value — the screen says "Ask your accountant; here is what each answer
means" instead.

1. **Overview** — for each filing account: this period's tax so far, due date, status; cards for anything blocking
   billing (undecided rules, addresses needing review, missing rates).
2. **Your tax decisions** (OWNER edits) — the lease election (both options explained in plain words with the
   consequence: "Customers in Evans would pay X; you would owe use tax on appliances you buy without tax"), retail
   delivery fee answer, business address for use tax.
3. **Tax areas** — jurisdictions with level, state-collected / city-collected, filing account, current and upcoming
   rates (add a rate version with an effective date), review button for new ones.
4. **What is taxed** — the matrix: rows = categories, columns = "All state-collected areas" + each self-collected
   city; each cell Taxable / Exempt / Not decided, reason, "CPA confirmed on". The "Fill in the common Colorado
   starting answers" button (D-T5).
5. **Addresses** — needing review / failed; confirm jurisdictions; re-check; bulk file import.
6. **Exemptions** — per customer; also shown on the customer record (OWNER/ADMIN only).
7. **Returns** — periods per filing account; worksheet; "Mark as filed" (OWNER); frozen worksheet download (CSV).
8. **Use tax** — purchases with use tax due by period; included in the filing worksheet.

Customer-facing: the invoice and statement show "Sales tax" with a breakdown by area name ("State of Colorado —
exempt short-term rental", "City of Greeley 4.11%"). The signing page and agreement document say "Sales tax for your
address, currently X%" (X = the combined taxable rate for RENTAL on the signing date); the old fixed "Sales tax rate:"
line in `src/domains/documents/render.ts` changes to that wording. A rate change later does not need a new signature
(the agreement promises "applicable sales tax", wording to be confirmed by Chris's attorney — IN-38).

---

## 5. Work units (in order; one PR per group; stacked per AGENTS.md)

**PR T-1 (foundation): WU-T0 … WU-T2. PR T-2 (engine in billing): WU-T3 … WU-T5. PR T-3 (returns and use tax):
WU-T6 … WU-T8. PR T-4: WU-T9.**

### WU-T0 — Owner setup and the GIS contract (no code; can run before approval of the rest)
Chris registers on SUTS (if not already), obtains the GIS API key, and adds it as `COLORADO_GIS_API_KEY` in Vercel
(Production and Preview) — the agent gives him the exact steps and never sees the key. The agent then writes
`docs/runbooks/colorado-gis-api.md` from the documentation page Chris copies from SUTS (endpoint, auth header,
parameters, response fields, error shapes, limits, bulk-file columns). If this is not available, WU-T3's real client
is skipped and the batch ships with manual entry + bulk import only; record that in STATUS.

### WU-T1 — Migration, seeds, backup, schema health
Section 2 verbatim. Tests: `tests/tax-migration-integration.test.ts` (partial unique indexes reject a second default
rule and a second current location; seeds present; old `BusinessSettings` row gets `UNDECIDED`).

### WU-T2 — Pure primitives
`categories.ts`, `engine.ts`, `allocate.ts`. Tests (`tests/tax-engine.test.ts`, `tests/tax-allocate.test.ts`):
every row of 3.2's resolution order; exempt rent under PAY_ON_ACQUISITION in a state-collected area with taxable rent
in a self-collected city on the same line; term 37 months taxable; customer exemption scoped to one jurisdiction;
discount follows parent; multiple problems all returned; allocator sums exactly, handles negatives and ties; a 7.01%
two-jurisdiction line rounds per jurisdiction (e.g. $64.99 → state 1.88 + city 2.67 = 4.55).

### WU-T3 — GIS adapter and address locating
`colorado-gis.ts`, `locations.ts`; call `locateServiceAddress` after every service-address create/update (customer
record, rental builder, estimate). Tests: `tests/tax-locations-integration.test.ts` with a fake source (matched →
verified when all reviewed; new jurisdiction → needs review; unavailable → needs review with message; not found →
failed; 30-day reuse; force re-check; business location). `tests/colorado-gis-client.test.ts` against recorded
**synthetic** responses shaped exactly like the runbook (no real addresses, no key).

### WU-T4 — Readiness gate and Stripe rates
`assertTaxReadyForAgreement` wired into send-for-signature, `checkout.ts` billing setup (before any Stripe call;
replaces `getOrCreateTaxRate`), and local invoice creation. `stripe-rates.ts`; `subscription-line.ts` keeps copying
existing item rates (unchanged). Tests: `tests/tax-readiness-integration.test.ts` (each D-T7 condition blocks with
its message; ready agreement passes), `tests/tax-stripe-rates-integration.test.ts` (fake Stripe client via
`__setStripeClientForTests`: one Stripe rate per version, reused on retry, exact percentage string, >5 blocked).

### WU-T5 — Invoices use the engine
Local invoice builders (`pickup-billing-events.ts`, `early-return.ts`, `late-return-waiver.ts`, any other caller of
`sumTax`/`taxCentsForLine` with an agreement rate) call `computeTax` and write `InvoiceTaxLine` rows plus the existing
single `TAX` line item (= total, so existing totals and statements keep working). The webhook mirror writes STRIPE +
ENGINE rows and the mismatch exception (D-T8). `RentalAgreement.taxRateMilliPercent` is still written (combined
taxable RENTAL rate at signing, display only) and no longer read for arithmetic — grep proves it. Remove the
`taxRateConfirmed` control; pricing page wording change. Tests: `tests/tax-invoice-lines-integration.test.ts` (late
return in Greeley under each election; waiver reverses the same jurisdictions; Stripe mirror with a 1-cent
difference raises exactly one exception; exempt rows recorded), update existing tests that asserted the single-rate
behaviour (grep `taxRateMilliPercent` in `tests/`).

### WU-T6 — Exemptions and rate changes
`CustomerTaxExemption` CRUD (OWNER), engine input from active exemptions, Today expiry card. Automation
`tax-rate-changes` (new cron route, `vercel.json` `"5 18 * * *"`, `runAutomation` rule key `tax-rate-changes`) and
the monthly/Jan 1/Jul 1 re-check (`tax-address-recheck`, `"20 13 1 * *"`) plus the Nov 15 / May 15 reminder cards.
Tests: `tests/tax-rate-change-integration.test.ts` (version starting tomorrow updates only affected subscriptions,
once; retry after crash uses the same key; exempt-rent subscriptions untouched), `tests/tax-exemptions-integration.test.ts`.

### WU-T7 — Filing accounts, worksheet, use tax
Section 3.5 and 3.6, appliance form field, purchase-order receipt hook. Periods are created lazily for each active
account (current + previous). Due-date Today cards 7 days and 1 day before. Tests:
`tests/tax-worksheet.test.ts` (pure: accrual vs cash; refund reduces tax; correction to a filed period lands on the
next worksheet), `tests/tax-filing-integration.test.ts` (mark filed freezes; ADMIN refused; second filing refused),
`tests/tax-use-tax-integration.test.ts` (private-seller appliance owes state + Greeley; vendor tax credited
proportionally; COLLECT_ON_RENTALS rental inventory not due).

### WU-T8 — Screens
Section 4 screens, navigation entry under Money, customer invoice breakdown. Browser spec `e2e/sales-tax.spec.ts`
(assign to the lightest group in `e2e/shards.json`): owner sees blocking cards, fills the matrix, confirms an address;
ADMIN cannot change the election; axe clean at 360/1440 light/dark. Unit tests for each form's validation.

### WU-T9 — Docs and PR
`docs/BUSINESS-RULES.md` (new "Sales and use tax" section replacing the single-rate text), `docs/DATABASE.md`,
`docs/ARCHITECTURE.md` (env var, crons), `docs/OWNER-GUIDE.md` ("Sales tax: your monthly routine" in plain words),
`docs/GO-LIVE-CHECKLIST.md` (section 7 lines), `docs/DECISIONS.md` (D-T1 summary), `docs/designs/CHANGES-SINCE-DESIGN.md`
(section 9), STATUS.

---

## 6. Cheap-model guardrails (read before each work unit)

- Never write a tax rate, a taxability answer or an election into code, seeds, tests that run against production, or
  docs as fact. Tests use obviously synthetic rates (e.g. 1.000% and 2.000%) unless a test is specifically about the
  7.01% rounding example.
- Never call the real Colorado GIS from tests or CI. Never log addresses together with the API response.
- Money stays integer cents; rates stay integer milli-percent; use `taxCentsForLine` and `allocateAcrossLines`, never
  floats.
- Every write that changes tax policy writes an `AuditLog` row (`entityType` `TaxPolicy`, old/new values).
- If a test needs a fake transaction client, provide `$queryRaw`, the same `tx` calls the code makes, and a
  `$transaction` that hands the callback that fake `tx` (AGENTS.md).

## 7. Go-live lines to add (verbatim, `docs/GO-LIVE-CHECKLIST.md` → "Money")

- "Sales tax: your CPA has answered IN-33 (lease election), IN-34 (what is taxed), IN-35 (cash or accrual), IN-36
  (rentals over 3 years), IN-37 (retail delivery fee); you have entered the answers in Desk → Money → Sales tax and
  every rule in use shows 'CPA confirmed'."
- "Sales tax: Colorado sales tax license and City of Greeley license numbers entered as filing accounts; filing
  frequency matches what each license letter says."
- "Sales tax: COLORADO_GIS_API_KEY set in Vercel (Production and Preview) — or you accept manual address checking."
- "Sales tax: the rate for every tax area you serve is entered with its effective date and matches the state's
  lookup page for one real address in each area."

## 8. Stop-and-ask points

- **S-T1** The GIS documentation contradicts section 3.3 (for example, it returns a single combined rate with no
  jurisdiction list). Stop: write a stronger-model prompt; manual entry still ships.
- **S-T2** Any test or screen would need a real tax answer to pass. Stop and ask Chris.
- **S-T3** An address in the service area has more than 5 taxable jurisdictions.
- **S-T4** Retail delivery fee answer is `COLLECT`. Collecting it is not designed here; stop and ask for a design
  amendment (Stripe supports it as a flat-amount tax; the app would need a per-delivery line).
- **S-T5** Production has real agreements when WU-T5 starts (backfilling tax lines for past invoices is not designed).
- **S-T6** A correction to use tax or sales tax on an already-filed period needs anything beyond "show it on the next
  worksheet" (amended returns are out of scope).
- **S-T7** Stripe rejects `jurisdiction`/`tax_type` values or the API version in `src/lib/stripe.ts` lacks
  `invoice.total_taxes[].tax_rate_details`; do not guess a different mapping.

## 9. What later batches must assume (copy into `CHANGES-SINCE-DESIGN.md` when T merges)

- Tax amounts come from `computeTax` and live in `InvoiceTaxLine`; the single `TAX` line item is a total for display.
- `RentalAgreement.taxRateMilliPercent` is display-only. `taxRateConfirmed` is unused.
- `allocateAcrossLines` is the one proportional-split helper.
- Batch K posts sales tax payable per **filing account** from `InvoiceTaxLine`, use tax from `PurchaseUseTax`, and
  tax payments from `TaxFilingPeriod.amountPaidCents`.

## 10. Acceptance mapping

| PLAN.md Batch T acceptance item | Evidence |
|---|---|
| Rates come from the address, never ZIP/city | WU-T3 tests |
| Billing blocked until tax decided | WU-T4 readiness tests |
| Lease election and home-rule rules handled separately | WU-T2 engine tests |
| Stripe charges what the app computes; differences surface | WU-T4/T5 tests |
| Rate changes reach live subscriptions before they start | WU-T6 tests |
| Returns worksheet per filing account; filed periods frozen | WU-T7 tests |
| Use tax on untaxed purchases | WU-T7 tests |
| Owner screens explained in plain words; ADMIN limits enforced | WU-T8 browser spec |
