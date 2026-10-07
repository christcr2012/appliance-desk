# Design — Batch T: Colorado sales and use tax

Status: **APPROVED DESIGN — implement from this document** (Chris, 2026-10-06: "I love all of this! Update the repo!"). Run the drift check in section 0 before starting.
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
   write their own rules. Greeley is home-rule, self-collected and taxes leases/rentals of tangible personal property.
   **Corrected 2026-10-07 (Amendment A):** Greeley *is* a SUTS participating city (code 030057, live 2023-08-01, as are
   Evans 030041 and Windsor 030142), so its return is filed in SUTS next to the state return even though Greeley keeps
   its own taxability rules. The 2026-10-06 text said the opposite. Public sources give Greeley 4.11% city + 2.9% state =
   7.01% combined, not 7.375%. **Chris's CPA must confirm** (IN-17 stays open for this).
3. **Rentals have a special state rule.** C.R.S. 39-26-713(2)(f): a lease of 3 years or less is **exempt** from state
   (and state-administered local) sales tax **if the lessor paid Colorado sales or use tax when acquiring the
   item**. Alternatively, with the Department's permission, the lessor may buy tax-free and collect tax on every
   lease payment. This is an *election* that changes what the app charges. Home-rule cities do not have to follow
   it (Greeley taxes lease payments). The Department published a draft rewrite of its lease rule ("Special Rule 47")
   in February 2026 — the CPA should say whether it changes anything.
4. **Use tax.** Under the "paid on acquisition" election, every appliance bought without Colorado tax (private
   sellers, out-of-state online stores) owes **use tax** to the state and to Greeley, reported on separate returns.
5. **Retail Delivery Fee** (31¢ per delivery from July 2026, only when the delivery includes an item subject to state
   sales tax). Rentals under the "pay tax on acquisition" election are not subject to it; businesses with $500,000 or
   less of Colorado retail sales in the prior year are exempt. The app works out which case applies and handles
   collecting, counting and filing — **Amendment B, section 12**. CPA confirms (IN-37).

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
3. Filing is a short monthly SUTS session either way (Greeley participates in SUTS — Amendment A); Stripe's filing
   partners cost extra and cannot see the lease election.
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
  *state-collected* jurisdiction, for leases of 36 months or less, **for each appliance whose purchase tax was paid or
  is being paid as use tax** (Amendment D, 15.3 — the exemption is per appliance); use tax is due on appliances bought
  untaxed (section 3.6).
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
"send for signature" and billing setup in `checkout.ts` (before any Stripe call). **Local invoices never block
operations** (review fix 2026-10-06): a late-return, early-return or pickup invoice is created inside job completion,
so a tax problem there must not fail the job. When `computeTax` returns problems for a local invoice, the invoice is
saved as `DRAFT` with no tax lines, and a HIGH exception card "Bill #N needs a tax decision before it can be sent"
lists the problems; once fixed, a "Recalculate tax" button on the bill re-runs the engine and opens it. The
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
lookup for every current address and raises a card for any difference. **Extended by Amendment C (section 13):** rate
changes found in Colorado's official lookup are applied automatically within guardrails, upcoming January 1 / July 1
rates are looked up in advance when the lookup supports a date, and official pages are watched for law changes.

### D-T10 — Exemptions are per customer, with a certificate on file

`CustomerTaxExemption` (resale, government, charitable, other) with certificate number, a photo of the certificate
(existing private upload system), validity dates and scope (all jurisdictions, or a chosen list). An expired or
revoked exemption stops applying on its end date; a Today card warns 30 days before expiry. Only the owner adds,
verifies or revokes one.

### D-T11 — Filing is tracked; money still moves outside the app

`TaxFilingAccount` = a place Chris files ("Colorado — SUTS", "City of Greeley"), with frequency, due day, account
number and the jurisdictions it covers. `TaxFilingPeriod` = one return. The app produces the worksheet (section 3.5),
reminds before the due date, and records "filed on / confirmation number / amount paid". When a period is marked
filed its worksheet is frozen. **Corrected 2026-10-07 (review of Amendment A):** a later change that alters a filed
period's numbers is reported on an **amended return for that same period** (Colorado requires an amended return with
the full corrected amounts; it is not netted into a later return) — section 11.12. A filed number is never silently
changed. Each account's reporting basis
(`ACCRUAL` by invoice date, or `CASH` by payment date) is a setting starting at `UNDECIDED` (IN-35); an `UNDECIDED`
basis shows the worksheet with a warning instead of totals.
**Extended by Amendment A (section 11):** the worksheet becomes a SUTS *entry packet* laid out in SUTS's order, the app
keeps a filing calendar for every account (including quarterly/annual and license renewals), and it prompts the owner
on Today and by email until each return is marked filed.

### D-T12 — Permissions

OWNER: everything. ADMIN: view all tax screens, confirm addresses, review new jurisdictions' *names and levels*,
enter rate versions; cannot change the election, taxability rules, exemptions, filing accounts or mark a return
filed. STAFF and CUSTOMER: nothing (customers see only their own invoice breakdown). Enforce in the domain functions
with `requireRole` / `assertActiveTeamActor`, never only by hiding links.

### D-T13 — The Colorado GIS key is optional at runtime

With `COLORADO_GIS_API_KEY` unset, the lookup source is "manual": address saves create `NEEDS_REVIEW` locations, and
the owner/admin picks jurisdictions from a list (or imports the state's bulk-lookup result file). Nothing else
changes. The key is never logged, never sent to the browser and never stored in the database.

### D-T14 — Prepaid rent is invoiced so its tax is recorded (review fix, 2026-10-07)

Today a `paidInFullInAdvance` agreement creates no subscription and no rent invoice (Chris collects the lump sum outside
the app), so its rent and sales tax would never reach `InvoiceTaxLine`, the returns or the retail delivery fee. From
WU-T5 on: when a prepaid agreement is signed, the app creates **one local invoice for the full prepaid rent** (the
agreed prepaid amount after the prepaid discount, with `computeTax` lines for the address on the signing date), issued
on the signing date and due on receipt. It is **manual-payment-only** (review fix: today's customer portal can only pay
Stripe invoices, so a local invoice cannot be paid by card there): Chris records the payment with the **existing
manual-payment action** (cash, check, bank transfer, or a card taken outside the app), and the portal shows the invoice
as "Pay as arranged with Robinson Appliance Rentals". Reporting follows D-T11: the accrual basis counts it on its issue
date, the cash basis on the recorded payment date. For the delivery fee (12.4) its `saleOn` is the **recorded payment
date** (the first rent payment); while it is unpaid the fee record waits as `PENDING_RATE` ("prepaid rent not yet
paid"). Card payment of local invoices is a roadmap item. Idempotent per agreement (`prepaid-rent-<agreementId>`). Stop-and-ask S-T13 if
the signing/checkout flow already collects prepaid rent some other way that WU-T5's drift check finds.

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
  invoiceTaxLines  InvoiceTaxLine[]
  useTaxRows       PurchaseUseTax[]
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
  invoiceTaxLines  InvoiceTaxLine[]
  useTaxRows       PurchaseUseTax[]
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
  jurisdiction      TaxJurisdiction   @relation(fields: [jurisdictionId], references: [id])
  rateVersionId     String
  rateVersion       TaxRateVersion    @relation(fields: [rateVersionId], references: [id])
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
  useTaxRows              PurchaseUseTax[]
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
  jurisdiction       TaxJurisdiction  @relation(fields: [jurisdictionId], references: [id])
  rateVersionId      String
  rateVersion        TaxRateVersion   @relation(fields: [rateVersionId], references: [id])
  useTaxDueCents     Int
  status             UseTaxStatus
  filingPeriodId     String?
  filingPeriod       TaxFilingPeriod? @relation(fields: [filingPeriodId], references: [id])
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

Prisma note: `TaxabilityRule`'s `@@unique([jurisdictionId, category])` cannot be used in an `upsert` for the default
rows (null `jurisdictionId`); read with `findFirst` and create/update inside the same transaction instead.

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
| ADJUSTMENT (negative), PREPAY_DISCOUNT | follows the line it reduces (see 3.2 step 5) | — |
| ADJUSTMENT (positive) | OTHER_CHARGE | UNDECIDED — ask the CPA |
| CREDIT | not taxable — it is account credit applied to the bill **after** tax (Stripe applies a customer balance after tax; local `CreditApplication` works the same way). Review fix 2026-10-06: treating it as a discount would make the engine expect less tax than Stripe charged on every bill that used a credit. Whether a late-delivery credit *should* lower taxable rent is part of IN-34; if the CPA says yes, those credits must be issued as negative rent lines instead of balance credits (design amendment, stop-and-ask) | — |
| DEPOSIT | not taxable, never in the matrix | — |
| TAX | not a taxable line | — |

For **self-collected** jurisdictions the "Fill in" button writes nothing — the owner sets each one (Greeley's screen
links to Greeley's tax page). `export function categoryForLineKind(kind, amountCents): TaxChargeCategory | "NOT_TAXABLE" | "FOLLOWS_PARENT"`.

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
GIS rate when the jurisdiction has none effective today (source `COLORADO_GIS`, effective today) **and sets that
jurisdiction back to `NEEDS_REVIEW`** so a person confirms the first rate before any bill uses it (review fix
2026-10-06: otherwise the seeded, already-reviewed State of Colorado row would start billing at a rate nobody checked),
and writes a new current location (previous one `isCurrent = false`) — `VERIFIED` when all
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
acquisition cost is saved (the add/edit appliance form's "Sales tax when you bought it" section — **Amendment D,
section 15**), when a
purchase order is marked received (per line with a known cost; vendor tax entered once per order and split across
lines by amount), and by Batch K's expenses. Idempotent per `(sourceType, sourceId, jurisdictionId)`; a cost change
updates the row; if its status is `FILED` the change makes that period need an amended return (11.12).

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

## 4. Screens (Desk → Money → **Sales tax**; OWNER and ADMIN) — organized by section 14 (screen map)

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

> PR boundaries below are superseded by `docs/MASTER-ROADMAP.md` section 7 (smaller PRs, same work units and order).

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
discount follows parent; a CREDIT line is never taxed and never lowers the taxable amount; multiple problems all returned; allocator sums exactly, handles negatives and ties; a 7.01%
two-jurisdiction line rounds per jurisdiction (e.g. $64.99 → state 1.88 + city 2.67 = 4.55).

### WU-T3 — GIS adapter and address locating
`colorado-gis.ts`, `locations.ts`; call `locateServiceAddress` after every service-address create/update (customer
record, rental builder, estimate). Tests: `tests/tax-locations-integration.test.ts` with a fake source (matched →
verified when all reviewed; new jurisdiction → needs review; unavailable → needs review with message; not found →
failed; 30-day reuse; force re-check; business location). `tests/colorado-gis-client.test.ts` against recorded
**synthetic** responses shaped exactly like the runbook (no real addresses, no key).

### WU-T4 — Readiness gate and Stripe rates
`assertTaxReadyForAgreement` wired into send-for-signature, `checkout.ts` billing setup (before any Stripe call;
replaces `getOrCreateTaxRate`) — **not** into local invoice creation (D-T7). `stripe-rates.ts`; `subscription-line.ts` keeps copying
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
difference raises exactly one exception; exempt rows recorded; a Stripe bill that used account credit raises **no**
exception; completing a pickup while a needed rule is UNDECIDED still completes the job and leaves a DRAFT bill plus
one HIGH card, and "Recalculate tax" opens it once fixed), update existing tests that asserted the single-rate
behaviour (grep `taxRateMilliPercent` in `tests/`).

### WU-T6 — Exemptions and rate changes
`CustomerTaxExemption` CRUD (OWNER), engine input from active exemptions, Today expiry card. Automation
`tax-rate-changes` (new cron route, `vercel.json` `"5 18 * * *"`, `runAutomation` rule key `tax-rate-changes`) and
the re-check (`tax-address-recheck`, **daily** `"20 13 * * *"` — review fix for Amendment C: the route runs every day
and each rule inside decides whether today is its day: the monthly/Jan 1/Jul 1 address re-check, the daily December/June
look-ahead, the weekly page watch) plus the Nov 15 / May 15 reminder cards.
Tests: `tests/tax-rate-change-integration.test.ts` (version starting tomorrow updates only affected subscriptions,
once; retry after crash uses the same key; exempt-rent subscriptions untouched), `tests/tax-exemptions-integration.test.ts`.

### WU-T7 — Filing accounts, worksheet, use tax (+ Amendment A WU-TA1 … WU-TA3)
Section 3.5 and 3.6, appliance form field, purchase-order receipt hook. **Read section 11 first**: it adds the filing
calendar, reminders, owner emails, calendar file and the entry packet, and splits this work into PRs T-6a and T-6b. Periods are created lazily for each active
account (current + previous). Due-date Today cards 7 days and 1 day before. Tests:
`tests/tax-worksheet.test.ts` (pure: accrual vs cash; refund reduces tax; a change to a filed period produces an
amended packet for that period and leaves the next period untouched — 11.12), `tests/tax-filing-integration.test.ts` (mark filed freezes; ADMIN refused; second filing refused),
`tests/tax-use-tax-integration.test.ts` (private-seller appliance owes state + Greeley; vendor tax credited
proportionally; COLLECT_ON_RENTALS rental inventory not due).

### WU-T8 — Screens
Section 4 screens (with Amendment A's "Filing calendar" and "Return — SUTS entry packet" pages), navigation entry under
Money, customer invoice breakdown. Browser spec `e2e/sales-tax.spec.ts`
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
- "Sales tax: Colorado sales tax license (and a separate City of Greeley account only if Greeley issued one — Greeley
  files through SUTS, Amendment A) entered as filing accounts; filing
  frequency matches what each license letter says."
- "Sales tax: COLORADO_GIS_API_KEY set in Vercel (Production and Preview) — or you accept manual address checking."
- "Sales tax: the rate for every tax area you serve is entered with its effective date and matches the state's
  lookup page for one real address in each area."

## 8. Stop-and-ask points

- **S-T1** The GIS documentation contradicts section 3.3 (for example, it returns a single combined rate with no
  jurisdiction list). Stop: write a stronger-model prompt; manual entry still ships.
- **S-T2** Any test or screen would need a real tax answer to pass. Stop and ask Chris.
- **S-T3** An address in the service area has more than 5 taxable jurisdictions.
- **S-T4** Replaced by Amendment B (section 12.9).
- **S-T5** Production has real agreements when WU-T5 starts (backfilling tax lines for past invoices is not designed).
- **S-T6** Amending a filed period needs anything beyond 11.12 (for example SUTS requires a form or field the
  amended packet does not produce, or a refund claim must go through a separate process the CPA describes).
- **S-T13** Prepaid rent turns out to be collected through a flow D-T14 does not describe (for example a Stripe
  Checkout line added after this design), or the prepaid amount cannot be read from the agreement.
- **S-T7** Stripe rejects `jurisdiction`/`tax_type` values or the API version in `src/lib/stripe.ts` lacks
  `invoice.total_taxes[].tax_rate_details`; do not guess a different mapping.

## 9. What later batches must assume (copy into `CHANGES-SINCE-DESIGN.md` when T merges)

- Tax amounts come from `computeTax` and live in `InvoiceTaxLine`; the single `TAX` line item is a total for display.
- `RentalAgreement.taxRateMilliPercent` is display-only. `taxRateConfirmed` is unused.
- `allocateAcrossLines` is the one proportional-split helper.
- Batch K posts sales tax payable per **filing account** from `InvoiceTaxLine`, use tax from `PurchaseUseTax`, and
  tax payments from `TaxFilingPeriod.amountPaidCents` plus filed `TaxFilingAmendment.amountPaidCents` (11.12).

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

---

## 11. Amendment A (2026-10-07) — Filing workspace: SUTS entry packet and filing calendar

Status: **APPROVED** (Chris, 2026-10-07: "make sure my system can handle as much of this as possible. If it can't do
anything for me directly, then it at least needs to provide me exactly what I need in a way that I am just doing data
entry in the SUTS portal. System should still handle scheduling so that I always am prompted to do the filings on
time"). Replaces nothing above except where it says so; implement it inside WU-T7/WU-T8 as the PRs in 11.8.

### 11.1 Facts this amendment relies on (researched 2026-10-07; verify in WU-TA0)

| # | Fact | Source / confidence | If wrong |
|---|---|---|---|
| A-F1 | Greeley (030057), Evans (030041) and Windsor (030142) are SUTS **participating** home-rule cities, so one SUTS session files the state, state-collected locals and those cities. They keep their own taxability rules (the D-T5 matrix is unchanged). | Colorado's SUTS participating-jurisdictions page (state staging copy, found by search; tax.colorado.gov itself was unreachable from the sandbox). Medium-high. | Add a second SALES_RETURN account for the city; nothing else changes. |
| A-F2 | The **state** vendor (service) fee is gone from 2026-01-01 (HB25B-1005). Some state-collected local jurisdictions still allow a service fee (listed in the state's DR 1002); home-rule cities set their own. | Colorado General Assembly bill page; tax-software notices. High. | The per-area fee setting below simply stays 0. |
| A-F3 | Returns are due the **20th of the month after the period**; a deadline on a weekend or Colorado legal holiday moves to the next business day. Frequency (monthly / quarterly / annual, calendar periods) is assigned on the license; a return is filed **even when nothing was sold**. | DR 0100 instructions; Department due-date guide. High; CPA confirms (IN-35). | Due day and frequency are per-account settings already. |
| A-F4 | Use tax the business owes on its own untaxed purchases is a **separate** return (Consumer Use Tax, DR 0252, on Revenue Online for state + special districts): annual (due January 20) while the yearly total stays under $300, otherwise monthly by the 20th. Whether Greeley's use tax goes through SUTS must be checked in Chris's account. | Department consumer-use-tax pages. Medium-high. | Use-tax accounts are ordinary filing accounts of kind USE_TAX_RETURN. |
| A-F5 | SUTS offers "File Taxes Here via Excel Upload": it generates a **custom template for the account**, you fill it and upload it. Column layout is only visible inside SUTS; spreadsheet filing has historically needed Department pre-approval for multi-location filers. SUTS also has **Bulk XML** filing for "bulk filers", which the portal defines to include anyone who wants the bulk XML option; whether a single business can use it and what upload steps it needs is unknown. | Department "Filing Using Excel" material via search; SUTS portal (per review). Medium. | Not built now; WU-TA0 checks eligibility for both (11.7). |
| A-F6 | The Colorado sales tax license is renewed every two years (expires December 31 of odd-numbered years). | Department licensing pages via search. Medium — the owner enters the real expiry from the license. | Expiry is an owner-entered date, not computed. |

Chris's YouTube links (Colorado Department of Revenue SUTS walk-throughs: sign up, manage locations, file and pay,
filing with Excel) could not be opened from the sandbox (YouTube blocked); the facts above come from the Department's
written pages instead. WU-TA0 is where those screens get checked against the packet.

### 11.2 What the system does and does not do

- **Does:** work out every number each return needs, per tax area, in the order SUTS asks for it; show a numbered
  "In SUTS, do this" checklist with a copy button next to every number; keep a calendar of every return and license
  renewal; prompt the owner on Today and by email from the day a period closes until it is marked filed; record the
  confirmation number, date and amount paid; freeze the filed numbers; export a calendar file for the phone.
- **Does not:** log in to SUTS, submit returns, or move money. SUTS has no public submission API (its Excel and Bulk
  XML options are files the filer uploads; eligibility is checked in WU-TA0) and payment needs the owner's bank
  authorisation. No SUTS password, bank number or
  payment card is ever stored or requested by the app.

### 11.3 Schema (additive) — migration `<timestamp>_batch_t_filing_workspace`

```prisma
enum TaxFilingAccountKind { SALES_RETURN USE_TAX_RETURN }

model TaxFilingAccount {
  // existing fields unchanged, plus:
  kind               TaxFilingAccountKind @default(SALES_RETURN)
  firstPeriodStart   DateTime?            // license start; no periods (or reminders) before it
  licenseExpiresOn   DateTime?            // owner enters from the license; reminders 60/30/7 days before
  reminderDaysBefore Int[]                @default([7, 2])
  emailReminders     Boolean              @default(true)
  deductionLabels    Json                 @default("{}") // see 11.4 "Deductions"
  useTaxJurisdictions TaxJurisdiction[]   @relation("UseTaxFilingAccount")
}

model TaxJurisdiction {
  // existing fields unchanged (rename the existing relation to @relation("SalesTaxFilingAccount") in the schema
  // file only — relation names are not stored in the database), plus:
  filingCode             String?   // the code SUTS shows, e.g. "030057"; owner-entered
  filingOrder            Int       @default(0) // row order on the packet = order on the SUTS screen
  serviceFeeMilliPercent Int       @default(0) // service fee the area lets the retailer keep (A-F2); 0 = none
  useTaxFilingAccountId  String?
  useTaxFilingAccount    TaxFilingAccount? @relation("UseTaxFilingAccount", fields: [useTaxFilingAccountId], references: [id])
}

model TaxFilingPeriod {
  // existing fields unchanged (dueOn = the 20th-style due date before any weekend/holiday move), plus:
  legalDueOn          DateTime?  // after the next-business-day rule; display only
  dueOnEditedByUserId String?    // set when the owner overrides dueOn (audit row too)
  zeroReturn          Boolean    @default(false) // true when filed with no sales and no tax
  paidOn              DateTime?  // date the payment was made in SUTS (service-fee eligibility)
  confirmationPhotoId String?    // optional screenshot of the SUTS confirmation (existing private photo store)
  entryProgress       Json       @default("{}") // "Entered" ticks on the guided page (11.11); convenience only
}
```

Add the new columns to backup coverage and `src/lib/schema-health.ts`; the populated-upgrade drill shows existing
accounts become `SALES_RETURN` with reminders `[7, 2]` and email on.

### 11.4 Shared primitives (`src/domains/tax/`)

**`filing-calendar.ts` (pure, no Prisma):**

```ts
export function periodsFor(account: { frequency; firstPeriodStart: Date | null }, through: Date): { start: Date; end: Date }[];
// calendar months / calendar quarters / calendar years in America/Denver; never before firstPeriodStart
export function dueOnFor(periodEnd: Date, dueDayOfFollowingMonth: number): Date;   // the plain due date
export function legalDueOn(dueOn: Date): Date;          // moves past Saturdays, Sundays and Colorado legal holidays
export function coloradoLegalHolidays(year: number): Date[]; // C.R.S. 24-11-101 list, computed (New Year's, MLK,
// Washington-Lincoln, Memorial, Juneteenth, Independence, Labor, Frances Xavier Cabrini (1st Mon Oct), Veterans,
// Thanksgiving, Christmas) with weekend observance — re-check the list against the current C.R.S. 24-11-101 text
// when implementing (Juneteenth in particular); a wrong entry only changes the displayed legalDueOn, never a reminder
export function reminderStages(period, account, today): ReminderStage[];
// "READY" (day after period end), "DUE_IN_<n>" for each reminderDaysBefore, "DUE_TODAY" (on dueOn),
// "DUE_BY_LEGAL" (each day after dueOn up to and including legalDueOn, only when they differ), "OVERDUE" (every day
// after legalDueOn)
```

Advance reminders count from `dueOn` (the plain 20th) so a holiday never makes a reminder late; **overdue starts only
after `legalDueOn`** (review fix: a return filed on the moved deadline is on time, so the app must not claim penalties
the day before). Between the two the task reads "Due date moved to Monday Oct 21 because the 20th is a Sunday — file
today if you can".

**`filing-packet.ts`** (replaces `worksheet.ts`'s output shape; the 3.5 rules on accrual/cash and refunds stay
exactly as written; corrections to filed periods follow 11.12):

```ts
export type FilingPacket = {
  account: { id: string; name: string; kind: "SALES_RETURN" | "USE_TAX_RETURN"; accountNumber: string | null; portalUrl: string | null };
  periodStart: string; periodEnd: string; dueOn: string; legalDueOn: string;
  basis: "ACCRUAL" | "CASH";
  zeroReturn: boolean;                                   // nothing sold and no tax: "File a zero return"
  rows: {                                                // one per tax area (and per rate version if a rate changed mid-period)
    jurisdictionId: string; name: string; filingCode: string | null; administration: "STATE_COLLECTED" | "SELF_COLLECTED";
    grossSalesCents: number;
    deductions: { key: string; label: string; cents: number }[];   // label = the SUTS wording from deductionLabels
    netTaxableCents: number; rateMilliPercent: number; taxCents: number;
    serviceFeeCents: number; remitCents: number;
  }[];
  useTax: { jurisdictionId: string; name: string; filingCode: string | null; purchaseCents: number; useTaxCents: number }[];
  totals: { taxCents: number; serviceFeeCents: number; remitIfOnTimeCents: number; remitIfLateCents: number; remitCents: number };
  steps: string[];                                       // plain-language "In SUTS, do this" checklist (11.5)
  warnings: string[];                                    // e.g. basis or deduction mapping not decided, rate changed mid-period
};
export function buildFilingPacket(input: {...}): FilingPacket;                        // pure
export async function loadFilingPacket(periodId: string): Promise<FilingPacket | { blocked: string }>; // OWNER/ADMIN
```

- **Gross sales** per row = charges sourced to addresses inside that area (the state row = all Colorado charges),
  excluding deposits and tax. **Tax** per row = the sum of `InvoiceTaxLine.taxCents` for that area — never re-derived
  from rate × taxable (that would drift from what customers were charged by rounding).
- **Deductions:** the packet groups non-taxed amounts into buckets with stable keys: `EXEMPT_SHORT_TERM_RENTAL` (state
  and state-collected rent under PAY_ON_ACQUISITION), `EXEMPT_CUSTOMER_<reason>` (D-T10 reasons), `NOT_TAXED_CATEGORY`
  (a category the matrix marks Exempt), `OUTSIDE_AREA` (only on city rows). `TaxFilingAccount.deductionLabels` maps each
  key to `{ label: string; reportAs: "DEDUCTION" | "LEAVE_OUT_OF_GROSS" }`, entered by the owner from the CPA's answer
  (IN-44). An unmapped key is shown as "Not decided — ask your CPA" and adds a warning; totals still show (the tax due
  does not depend on it).
- **Service fee** = `taxCentsForLine(taxCents, serviceFeeMilliPercent)` per row, zero by default, and **only when the
  return is filed and paid by `legalDueOn`** (Colorado allows no service fee on a delinquent remittance, nor on additional
  tax reported on an amended return). The packet therefore carries both `remitIfOnTimeCents` (tax − fee) and
  `remitIfLateCents` (all tax); the guided page shows the one that applies today and, once late, says "SUTS will add
  penalty and interest — pay the total SUTS shows". `totals.remitCents` = the amount for the day the packet is viewed.
- **Rounding check:** if a row's tax (sum of per-bill tax lines, D-T6) differs from its net taxable × rate rounded once,
  the packet shows both and explains that the few-cent difference comes from rounding each bill. The amount to report
  is the tax actually collected (the row's tax) unless the CPA says otherwise — never silently adjust either number.
- `markPeriodFiled` (3.5) additionally requires `amountPaidCents` and **`paidOn`** (review fix: the service fee depends
  on when the tax was remitted, not only when the return was filed; new column `TaxFilingPeriod.paidOn DateTime?`, and
  the same on `TaxFilingAmendment`). The guided form asks "Date you paid" (defaults to today). The expected amount is
  `remitIfOnTimeCents` when both `filedOn` and `paidOn` are ≤ `legalDueOn`, otherwise `remitIfLateCents` (penalty and interest may make the paid amount higher); if the
  paid amount differs from the expected one the owner must type a reason (stored in `notes`). It sets `zeroReturn`, freezes the packet JSON into `worksheet`, writes an audit row,
  and accepts an optional `confirmationPhotoId` (screenshot) through the existing private photo upload.

**`filing-reminders.ts`** — daily automation rule `tax-filing-calendar` (run inside the `tax-rate-changes` cron route
as a second `runAutomation` call — no new cron entry; add it to `src/domains/automation/health.ts`):

1. Create missing `TaxFilingPeriod` rows for every active account up to the period containing today (Denver), with
   `dueOn` and `legalDueOn` (idempotent on `@@unique([filingAccountId, periodStart])`).
2. For each OPEN period, compute `reminderStages` for today and, per stage not yet sent:
   - the **Today task** is *not* written here — it is computed live (11.11), so it exists from the day after the period
     ends until the period is FILED, whatever the automation did;
   - an **owner email** (11.6) when `emailReminders` is on, idempotency key `tax-reminder:<periodId>:<stage>` (OVERDUE
     sends on the first overdue day and then every 3rd day, key includes the date).
3. License renewal: emails 60, 30 and 7 days before `licenseExpiresOn`, then every 3rd day once past it (the Today task
   for it is computed live, 11.11).
4. Amendment detection (11.12): for each FILED period, find tax lines, refunds, payments (cash basis) or use-tax rows
   created or changed after `filedOn` that fall inside the period; rebuild its packet and, if any row differs from the
   frozen one, create or refresh the period's OPEN `TaxFilingAmendment`. Emails use key `tax-amendment:<amendmentId>`
   (once, then weekly while OPEN).

**`calendar-file.ts` (pure):** `buildIcs(periods, licenses): string` — one all-day event per due date ("File sales tax:
Colorado — SUTS, September") with alarms 7 days and 1 day before, plus license renewals; downloaded from the calendar
page for the next 12 months. No subscription URL (it would need a secret in a link); the page says "download again
after you change a filing setting".

### 11.5 The "In SUTS, do this" checklist (generated text, editable wording lives in the template, not settings)

1. "Sign in to SUTS (link) and open your Colorado sales tax account <accountNumber>."
2. "Choose File a return → period <Month YYYY>." (`zeroReturn`: "Choose File a zero return.")
3. One step per row in `filingOrder`: "<Area name> (<filingCode>): Gross sales <$>, deductions <label: $> …, taxable
   <$>, tax <$>." each number with a copy button.
4. "Check that SUTS shows a total of <$totals.remitCents>. If SUTS shows a different amount, do not change the app —
   note SUTS's figure when you mark the return filed."
5. "Pay in SUTS. Write down the confirmation number."
6. "Come back here and press I filed it."

WU-TA0 replaces step 2–3 wording with the real SUTS button and field names once Chris has an account (screenshots or
his description). Until then the packet says "SUTS may label these slightly differently".

### 11.6 Owner emails (new, owner-only)

`src/domains/messaging/owner-alerts.ts`: `sendOwnerAlert({ key, subject, text, href })` sends through the existing
delivery ledger (`MessageDelivery`, `recipientType: "TeamMember"`, purpose TRANSACTIONAL, template `owner-alert`) to
every active OWNER user's login email. It obeys the existing non-production guard (previews never send) and the
existing transport configuration; if email is not configured the delivery records NOT_SENT and the Today card is still
shown. Owner emails are **not** customer email: the hard limit on live customer email/SMS does not apply, and no
customer data appears in them (period, account name, amount due and a link only). The switch is per filing account
(`emailReminders`, starting ON because Chris asked to always be prompted), explained on the account screen.

### 11.7 Not built now (record in `docs/ROADMAP.md`)

- **SUTS Excel upload file.** With Greeley, Weld County and the state the return has only a handful of rows, so typing
  from the packet takes a few minutes, while an upload generator needs SUTS's account-specific template, a spreadsheet
  library and possibly Department approval. Revisit when the packet regularly has more than about 8 rows; it then
  becomes "owner uploads one blank template, maps each column once, the app fills a copy each period".
- **Bulk XML file.** If WU-TA0 finds that a single business may use SUTS's Bulk XML option, generating that file
  from the packet is the preferred replacement for typing (still uploaded by Chris; it would need the XML schema from
  SUTS and its own design amendment). SMS reminders — after live SMS is approved.

### 11.8 Work units and PRs (replace T-6 in `docs/MASTER-ROADMAP.md` section 7)

- **WU-TA0 (Chris + any model, docs only):** after SUTS registration, record in `docs/runbooks/suts-filing.md` which
  areas his return lists (with codes), the filing frequency and license expiry from the license letter, whether Greeley
  use tax is in SUTS, and the button/field names on the return screens (IN-43). No code waits on it; the packet's
  wording is updated when it lands.
- **T-6a — WU-TA1 calendar and prompts:** 11.3 migration, `filing-calendar.ts`, `filing-reminders.ts`,
  `owner-alerts.ts`, `calendar-file.ts`, filing-account settings fields (server side). Tests (★ real Postgres):
  `tests/tax-filing-calendar.test.ts` (monthly/quarterly/annual periods; first period start; due date and legal due
  date across weekends and every Colorado holiday 2026–2030; DST month edges), ★ `tests/tax-filing-reminders-integration.test.ts`
  (each stage once; no OVERDUE before `legalDueOn` when the 20th is a weekend or holiday; overdue repeat cadence; emails
  off; previews never send; license renewal; amendment detected after a refund on a filed period; ADMIN sees the task
  but cannot file), `tests/tax-calendar-file.test.ts` (valid ICS, alarms, all-day dates in Denver).
- **T-6b — WU-TA2 packet and use tax:** 3.5 rules through `filing-packet.ts`, 3.6 use tax, deduction mapping, service
  fee, mark filed with amount check and screenshot, amended returns (11.12). Tests: `tests/tax-filing-packet.test.ts` (pure:
  accrual vs cash; deduction buckets; unmapped label warning; zero return; service fee only when on time; late packet
  remits all tax; rate change mid-period splits rows; tax equals stored lines; amended packet shows previously reported,
  corrected and difference per row and gives no service fee on additional tax), ★ `tests/tax-filing-integration.test.ts` (as in WU-T7, plus amount-differs reason
  required), ★ `tests/tax-use-tax-integration.test.ts` (as in WU-T7; use tax lands on the USE_TAX_RETURN account).
- **T-7 — WU-TA3 screens** (with WU-T8): Desk → Money → Sales tax → **Filing calendar** (next 12 months, status chips
  Upcoming / Ready / Due soon / Overdue / Filed, "Add to my calendar") and **Return** (the packet: total to pay first,
  the checklist with copy buttons, rows in SUTS order, warnings, "I filed it" form; print-friendly and usable on a
  phone beside the SUTS tab) and the guided **File this return** page (11.11). Filing-account form: frequency, due day, first period, license expiry, reminder days,
  email switch, deduction labels, and per-area SUTS code, order and service fee — each explained on screen per
  AGENTS.md. Browser spec additions in `e2e/sales-tax.spec.ts`: owner opens a ready return, copies a number, marks it
  filed; axe clean at 360/1440 light/dark.

### 11.9 Stop-and-ask points (add to section 8)

- **S-T8** SUTS's return screens ask for a number the packet does not produce (WU-TA0 finds it). Stop; write a design
  note — do not invent a calculation.
- **S-T9** The CPA's answer to IN-44 needs a deduction bucket that cannot be computed from `InvoiceTaxLine` and the
  matrix.
- **S-T10** Production email delivery refuses team-member recipients or needs a new provider setting.

### 11.10 Acceptance additions (PLAN.md Batch T)

- Every active filing account has its periods, due dates and license renewal on a calendar; the owner is prompted on
  Today and by email from the day a period closes until it is marked filed (WU-TA1 tests).
- Each return shows, per tax area in SUTS order, exactly the numbers to type, with a zero-return path and a total that
  matches the tax customers were charged (WU-TA2 tests).

### 11.11 The Today task and the guided "File this return" page (Chris, 2026-10-07)

Chris: the return "should also populate in Today tasks and remain there until it is handled … click it and handle it
inside the system … so I just have to transfer data from Appliance Desk to the SUTS remittance portal — as hands off as
possible."

**Today task (computed, cannot be dismissed).** New exception categories in `src/domains/exceptions/rules.ts` (pure,
like every other Today item — computed from current rows on each load, never stored, so it cannot be cleared, snoozed
or completed by anything except the underlying fact changing):

- `TAX_RETURN_DUE` — one item per `TaxFilingPeriod` with `status = OPEN` and `periodEnd` before today (Denver).
  Title "File your <Month> sales tax return — <account name>"; detail "Due <dueOn> · <$ total to pay or 'zero return'>
  · about 5 minutes in SUTS". Severity `medium`, becoming `high` from `min(reminderDaysBefore)` days before `dueOn` and
  when overdue ("Overdue since Oct 20 — Colorado adds penalties and interest; file now"). `href` = the guided page below.
  It disappears only when the period is marked FILED. Sort: overdue first, then nearest due date.
- `TAX_FILING_NOT_READY` — the packet for an open (or about-to-close, last 5 days of the period) period is `blocked` or has
  warnings that change the total (addresses needing review, missing rate, undecided basis). Severity `high` when the
  due date is within 7 days. `href` = the screen that fixes the first problem. This surfaces problems *before* filing day
  so the filing itself stays a few minutes of typing.
- `TAX_LICENSE_RENEWAL` — from 60 days before `licenseExpiresOn` until the owner enters a new expiry date.
- `TAX_AMENDMENT_DUE` — one per OPEN `TaxFilingAmendment` (11.12): "Amend your <Month> return — <$ more to pay / $
  overpaid>"; severity `high` when more tax is owed; disappears only when the amendment is marked filed (or, for an
  overpayment, marked "Handled with my CPA"). `href` = the guided page in amendment mode.

Visible to OWNER and ADMIN (ADMIN sees "Ask the owner to file" instead of the button). STAFF and CUSTOMER never.
Unit tests in `tests/exceptions-tax.test.ts` (pure: appears the day after period end; severity switches; disappears
when FILED; zero return wording; not-ready ordering).

**Guided page** `/desk/sales-tax/returns/<periodId>/file` (OWNER; ADMIN read-only). One screen, top to bottom,
built for a phone or a half-width window next to the SUTS tab:

1. **Check** — green "Ready to file" or the list of problems with a fix link each (same as `TAX_FILING_NOT_READY`).
   Filing is still allowed with warnings that do not change the total (for example IN-44 labels not decided).
2. **Open SUTS** — button opening `portalUrl` in a new tab, the account number with a copy button, and the period
   to choose. Zero return: "Choose 'File a zero return' and skip to step 4."
3. **Type these in** — one card per row in `filingOrder`, each value with a copy button and a tick box "Entered".
   Ticks are saved on the period (`entryProgress Json @default("{}")`, additive column on `TaxFilingPeriod`, keyed by
   row and field) so Chris can stop and come back; ticks are convenience only and never block anything.
4. **Pay** — "SUTS should now show <$total>. Pay it in SUTS." with a copy button. If SUTS shows a different total:
   "Use SUTS's total and note it below; do not change anything here."
5. **Done** — "I filed it": confirmation number (required), date filed and date paid (both default to today, Denver), amount paid
   (pre-filled with the packet total; a different amount needs a one-line reason), optional screenshot. Saving runs
   `markPeriodFiled`; the Today task disappears; the page shows "Filed — next return due <date>".

Hands-off measures (all automatic, no setting): the packet is prepared the morning after the period ends; problems
surface early through `TAX_FILING_NOT_READY`; zero returns get the shortest path; the email reminder links straight to
this page; the confirmation form is pre-filled. Browser spec additions (`e2e/sales-tax.spec.ts`): the Today item opens
the page, ticks persist after reload, filing removes the Today item; axe clean at 360/1440 light/dark.

Roadmap idea (not built): forward SUTS's confirmation email to a dedicated inbound address so the app records the
confirmation number itself (needs inbound email parsing and a confirmed SUTS email format).

### 11.12 Amended returns (review fix, 2026-10-07)

Codex's review of Amendment A pointed out that Colorado requires an **amended return for the original period** with
the full corrected amounts when a filed return turns out wrong (DR 0100 instructions); netting the difference into a
later return, as D-T11 first said, would leave the original return wrong and distort the later one.

```prisma
enum TaxAmendmentStatus { OPEN FILED HANDLED_OUTSIDE }

model TaxFilingAmendment {
  id                 String             @id @default(cuid())
  periodId           String
  period             TaxFilingPeriod    @relation(fields: [periodId], references: [id])
  sequence           Int                // 1 = first amendment of that period
  status             TaxAmendmentStatus @default(OPEN)
  packet             Json               // FilingPacket of the corrected period + previouslyReported per row; frozen when FILED
  additionalTaxCents Int                // corrected tax − previously reported tax (negative = overpaid)
  detectedAt         DateTime           @default(now())
  filedOn            DateTime?
  confirmationNumber String?
  amountPaidCents    Int?
  paidOn             DateTime?
  filedByUserId      String?
  notes              String?
  createdAt          DateTime           @default(now())
  updatedAt          DateTime           @updatedAt
  @@unique([periodId, sequence])
}
```

(Add `amendments TaxFilingAmendment[]` to `TaxFilingPeriod`; same migration as 11.3; backup and schema-health coverage.)

- **Previously reported** = the latest FILED packet for the period (the original, or the last filed amendment).
  At most one OPEN amendment per period; detection refreshes its packet while it is OPEN.
- **Amended packet** = the period's packet rebuilt from current data, with per row: previously reported, corrected,
  difference. The guided page in amendment mode says "In SUTS choose Amend for <Month> and enter the corrected
  totals below (not the difference)", lists the corrected numbers with copy buttons, then: more tax owed → "Pay
  <$additional>; SUTS adds any interest" (no service fee on the additional tax); overpaid → "Colorado returns overpaid
  tax through a refund claim — ask your CPA how to file it" and a "Handled with my CPA" button (OWNER, reason
  required) instead of "I filed it".
- `markAmendmentFiled(actorUserId, { amendmentId, filedOn, paidOn, confirmationNumber, amountPaidCents })` — OWNER; row-locks
  the amendment; freezes its packet; audit row. The original period's frozen worksheet is never edited.
- The **next** period's packet never contains earlier-period corrections (the old `correctionsToEarlierPeriods` field
  is removed from the shape).
- Batch K (section 9): tax payments are `TaxFilingPeriod.amountPaidCents` **plus** filed amendments' `amountPaidCents`.

Tests: in `tests/tax-filing-packet.test.ts` and the integration tests listed in 11.8 (detection, one OPEN amendment per
period, mark filed freezes, overpayment path requires a reason, ADMIN refused).


### 11.13 SUTS setup is entered and updated in the app (Chris, 2026-10-07: IN-43)

Chris: "is there a way you can build this into the system as a way I can update the system when I have it or if it
changes?" IN-43 is therefore **entered by the owner in the app**, not sent to a developer, and can be changed at any
time.

**Screen:** Desk → Sales tax → Setup → **Filing accounts → <account>** (SUTS setup) (OWNER edits, ADMIN views). Each
field is explained on screen per AGENTS.md (what it does, example, who can change it):

| Field | Stored in | Used by |
|---|---|---|
| License / account number, portal link, frequency, first period, license expiry | existing + 11.3 columns | calendar, reminders, checklist step 1 |
| Areas on my SUTS return: pick each tax area, type the code SUTS shows, drag into SUTS's order | `TaxJurisdiction.filingAccountId`, `filingCode`, `filingOrder` | packet rows and order |
| Names SUTS uses on its screens: "Gross sales", "Taxable sales", "Tax", "File a zero return", "Amend" … (blank = the app's default wording) | `TaxFilingAccount.screenLabels Json @default("{}")` | checklist and packet labels |
| Deduction names and "include in gross sales?" (IN-44 answer) | `deductionLabels` (11.4) | packet deductions |
| Service fee each area allows | `serviceFeeMilliPercent` | packet |
| My filing-day notes (free text, e.g. "use the Greeley tab second") | `TaxFilingAccount.filingNotes String?` | top of the guided page |
| SUTS offers me: Excel upload / Bulk XML (yes / no / don't know) | `excelUploadAvailable Boolean?`, `bulkXmlAvailable Boolean?` | information only; drives the 11.7 roadmap decision |
| Which account takes Greeley (and each city's) use tax | `TaxJurisdiction.useTaxFilingAccountId` | use-tax packet |
| "I checked this matches SUTS on" (button sets today) | `setupCheckedOn DateTime?` | yearly check task |

All new columns join the 11.3 migration. Every save writes an `AuditLog` row (`entityType` `TaxFilingAccount`, old/new),
and a change to labels or order applies to OPEN periods' packets immediately (FILED packets stay frozen).

**Keeping it current (Today tasks, computed like 11.11):**
- `TAX_SETUP_INCOMPLETE` — an active account without frequency, first period or license number, or a tax area used on an
  invoice that is on no filing account ("New tax area: Town of Milliken — add it to your SUTS setup"). `high` once a
  period that needs it has closed.
- `TAX_SETUP_CHECK` — each January (and 12 months after `setupCheckedOn`): "Check your SUTS setup still matches SUTS".
  Clears when the owner presses "I checked this".

Tests: `tests/tax-filing-setup.test.ts` (labels fall back to defaults; order drives rows; audit row on save; ADMIN
refused) and the exception rules in `tests/exceptions-tax.test.ts`. IN-43 in `OWNER-INPUTS.md` now reads "enter it in the
app"; WU-TA0's runbook becomes optional notes, not a dependency.

---

## 12. Amendment B (2026-10-07) — Colorado Retail Delivery Fee, handled automatically

Status: **APPROVED** (Chris, 2026-10-07: "make sure the colorado required delivery tax is handled properly as well").
Replaces stop-and-ask S-T4 ("collecting it is not designed here") and the "likely not applicable" wording in the
introduction. Built in PRs T-6c and T-7 (12.8).

### 12.1 Rules (researched 2026-10-07; CPA confirms under IN-37)

| # | Rule | Source / confidence |
|---|---|---|
| B-F1 | A fee per **retail delivery**: a retail sale delivered by motor vehicle to a Colorado location that includes at least one item of tangible personal property **subject to state sales tax**. One fee per delivery (not per item). | Department "Retail Delivery Fee Retailers" page; Colorado regulation on retail delivery fees. High. |
| B-F2 | **Leases:** if the lessor bought the property tax-free with the Department's permission and collects sales tax on lease payments (our `COLLECT_ON_RENTALS`), the short-term lease is a retail sale and the fee applies to its delivery. If the lessor did not get that permission (our `PAY_ON_ACQUISITION`), the short-term lease is **not** subject to the fee whether or not it is delivered. | Department guidance quoted in search results. High — this is why the lease election (IN-33) decides most of this. |
| B-F3 | **Small-business exemption:** a retailer with $500,000 or less of Colorado retail sales in the **previous calendar year** is exempt; a new business is exempt until its current-year retail sales pass $500,000. | Department press release on the small/new business exemption. High. |
| B-F4 | A retailer may **pay the fee itself** instead of collecting it from the customer. If collected, it must be shown separately on the receipt/invoice as "Retail delivery fees"; it is not subject to sales tax. | Department retailer page and regulation. High. |
| B-F5 | Amount changes each **July 1** (2026-07-01 to 2027-06-30: $0.31). | Department announcements via search. Medium — the owner enters each year's amount; never hard-coded. |
| B-F6 | Reported on the Retail Delivery Fee return (DR 1786), **same frequency and due date as the sales tax return**, and filed **even with no deliveries** while the retailer is required to collect. | DR 1786 instructions via search. High. |

### 12.2 What the app decides by itself

`retailDeliveryFeeStatus(today)` (pure, `src/domains/tax/retail-delivery-fee.ts`) returns one of:

1. `NOT_APPLICABLE_LEASE_ELECTION` — election is `PAY_ON_ACQUISITION` (B-F2). Nothing is charged, counted or filed.
2. `EXEMPT_SMALL_BUSINESS` — previous calendar year's Colorado retail sales ≤ threshold; or, for a business with no
   prior-year Colorado retail sales, until the **first filing period that begins at least 90 days after** current-year
   sales first exceed the threshold (Department guidance on new businesses — review fix; the date the threshold was
   crossed is stored as `rdfThresholdCrossedOn` the first time it happens, and the start period is derived from the
   Colorado sales tax account's frequency) (B-F3). Retail sales = charges on invoices to Colorado addresses, excluding tax, deposits and the fee
   itself, from `InvoiceTaxLine`/invoice lines (the same totals the packet uses).
3. `APPLIES` — otherwise.
4. `UNDECIDED` — election still `UNDECIDED`, or the status would be `APPLIES` but `rdfHandling` or the CPA confirmation
   (below) is missing.

Owner settings on Desk → Sales tax → Setup → **Your tax decisions** (OWNER; explained on screen with the rules above):
- `rdfThresholdCents` (starting value 50,000,000 = $500,000, "the amount in Colorado law as of 2026; change it only if
  the law changes"; restore button).
- `rdfHandling`: `UNDECIDED` | `COLLECT_FROM_CUSTOMER` | `PAY_MYSELF` — only asked when the status is or may become
  `APPLIES`; explained with the customer consequence ("customers see a separate 31¢ line" vs "you pay it; customers see
  nothing").
- `rdfCpaConfirmedOn` (date) — the CPA has confirmed the status the app shows (IN-37).
- **Replacements are never charged (review fix, not a setting):** Colorado's retail-delivery-fee regulation says a
  later delivery that exchanges or replaces an item free of charge is not a new retail sale, so repair/broken-unit
  swaps never create a record. Only a new sale counts: an agreement's first delivery and an appliance added to an
  existing agreement.

**Readiness (extends D-T7; review fix):** while the status is `UNDECIDED` because the fee would apply but `rdfHandling`
or `rdfCpaConfirmedOn` is missing, send-for-signature and billing setup show "Decide how to handle Colorado's retail
delivery fee" — the same blocking list, same wording style. (`UNDECIDED` because the lease election is undecided is
already blocked by D-T7.) `NOT_APPLICABLE_LEASE_ELECTION`, `EXEMPT_SMALL_BUSINESS` and a fully decided `APPLIES` never
block. Deliveries completed while undecided (for example on agreements signed earlier) are still recorded as
`PENDING_DECISION` (12.4), so nothing owed is lost.

### 12.3 Schema (additive; same migration as 11.3)

```prisma
enum RdfHandling { UNDECIDED COLLECT_FROM_CUSTOMER PAY_MYSELF }

// BusinessSettings additions
//   rdfThresholdCents Int @default(50000000)
//   rdfHandling RdfHandling @default(UNDECIDED)
//   rdfCpaConfirmedOn DateTime?
//   rdfThresholdCrossedOn DateTime?   // first day current-year sales passed the threshold with no prior-year sales

enum RdfRecordStatus { PENDING_DECISION PENDING_RATE READY NOT_DUE }

model RetailDeliveryFeeRate {
  id              String   @id @default(cuid())
  effectiveOn     DateTime @unique   // a July 1 in practice; owner-entered
  amountCents     Int                // e.g. 31
  enteredByUserId String
  createdAt       DateTime @default(now())
}

model RetailDeliveryFeeRecord {
  id                  String   @id @default(cuid())
  saleKey             String   @unique   // one fee per retail SALE (review fix): "agreement:<id>",
                                         // or "addition:<amendmentId>" (free replacements never count)
  firstJobId          String             // the delivery job that first fulfilled the sale (later partial trips dedupe)
  agreementId         String
  deliveredOn         DateTime           // first delivery of the sale
  saleOn              DateTime?          // date of the sale's FIRST RENT CHARGE (review fix): the first invoice —
                                         // Stripe or local — that charges rent for this sale (for a normal rental the
                                         // first invoice anchored to firstDeliveredOn; for a prepaid one the signing
                                         // payment date); null until that charge exists. Selects amount and period.
  customerRefundedAt  DateTime?          // collected fees: set when the customer was refunded in full (credit gate)
  customerRefundRef   String?
  creditAppliedPeriodId String?          // set when an over-reported fee is claimed as a credit on a later RDF return;
                                         // frozen when that return is filed, so the credit can never be claimed twice
  status              RdfRecordStatus
  rateId              String?            // null while PENDING_DECISION / PENDING_RATE (review fix)
  rate                RetailDeliveryFeeRate? @relation(fields: [rateId], references: [id])
  amountCents         Int?
  collectedFromCustomer Boolean?
  invoiceLineId       String?            // the customer line when collected
  filingPeriodId      String?
  filingPeriod        TaxFilingPeriod? @relation(fields: [filingPeriodId], references: [id])
  createdAt           DateTime @default(now())
}
```

`TaxFilingAccountKind` gains `RETAIL_DELIVERY_FEE_RETURN`. Backup and schema-health coverage for both tables.

### 12.4 Counting and charging

- **When:** a delivery job is marked completed (existing completion command, inside its transaction) for an agreement
  whose delivery address is in Colorado. If the status on the delivery date is `APPLIES` and the delivery contains at
  least one appliance whose RENTAL charge is taxable for the **state** jurisdiction at that address and date (the engine,
  D-T5), write one `RetailDeliveryFeeRecord` keyed by the **sale**, not the trip (review fix: Colorado counts one
  retail sale as one delivery however many trips it takes): the agreement's first delivery uses `agreement:<id>`, an
  appliance added to an existing agreement uses `addition:<amendmentId>`, and later partial-delivery trips for the
  same sale find the existing key and add nothing. Swap/replacement jobs never create a record. If the overall status
  is `UNDECIDED` at delivery time, the record is written as `PENDING_DECISION`; once decided it becomes `NOT_DUE`
  (status turned out not to apply) or, if the fee applies, `READY` when a rate exists for `saleOn` and `PENDING_RATE`
  otherwise (review fix: never `READY` without an amount), with an audit row.
- **Amount:** the `RetailDeliveryFeeRate` in effect on **`saleOn`** — the date of the sale's **first rent charge**
  (Colorado charges a lease's fee once, at the first payment, at the amount in effect when the sale takes place). It is
  *not* the agreement's `startDate`, which is the signing date: recurring billing starts from `firstDeliveredOn`, so a
  rental signed in June and first charged in July uses July's amount, while a `paidInFullInAdvance` rental uses the
  recorded payment date of its prepaid rent invoice (D-T14). `saleOn` is filled when that first rent invoice is recorded (local invoice creation or
  the Stripe invoice mirror); until then the record stays `PENDING_RATE` with the reason "first rent charge not yet
  made". If no rate exists for `saleOn` → the completion still succeeds,
  the record is `PENDING_RATE` (rate and amount empty) and is completed in place when the rate is entered; a `high`
  Today task says "Enter the retail delivery fee amount for July 2026 –
  June 2027". A June Today task (from June 1) reminds the owner to enter the next July's amount.
- **Charging the customer** (`COLLECT_FROM_CUSTOMER`): one invoice line category `RETAIL_DELIVERY_FEE`, label "Colorado
  retail delivery fee", never taxed (the engine skips it; add it to the 3.1 category map as non-taxable by law, not by
  matrix), on the next invoice for that agreement. **When the agreement will have no next invoice** — a
  `paidInFullInAdvance` agreement (no subscription is created for it) or one already ended — the fee is added to the
  agreement's prepaid rent invoice if that is still unpaid, otherwise the app issues a **standalone local invoice** for
  the fee alone, due on receipt, **manual-payment-only** like D-T14, idempotent per record (review fix: otherwise the fee would be reported but never collected). Stripe-billed agreements: a one-time invoice item on the next
  subscription invoice through the existing provider-operation pattern (`ProviderOperation` kind
  `RDF_INVOICE_ITEM`, key `rdf-<recordId>`); local invoices: a line on the next local invoice. Shown separately on the
  invoice, statement and customer portal (B-F4).
- **Paying it yourself** (`PAY_MYSELF`): no customer line; the record still counts for the return; Batch K posts it as
  an expense ("Retail delivery fees").
- Agreements and estimates mention the fee only when the status is `APPLIES` and handling is `COLLECT_FROM_CUSTOMER`
  ("Colorado charges a retail delivery fee of $0.31 per delivery"), wording confirmed with IN-38.

### 12.5 Filing

When the status first becomes `APPLIES`, a `TAX_SETUP_INCOMPLETE` task asks the owner to create the "Colorado — Retail
delivery fee" filing account (prefilled: kind `RETAIL_DELIVERY_FEE_RETURN`, frequency and due day copied from the
Colorado sales tax account, B-F6). It then uses the same calendar, Today task, email reminders, guided page and amended
return flow as sales tax (11.4–11.12) with a simpler packet: number of retail deliveries, fee per delivery (one row per
rate if the period crosses July 1), total fee; zero return when there were none. Records attach to the period by
**`deliveredOn`** (review fix: the return reports retail deliveries made during the period; `saleOn` only chooses the
fee amount — a prepaid rental invoiced June 30 and delivered July 2 is on the July return at June's amount). **Corrections (review fix):** fees *added* to an already-filed period open an amendment (11.12); fees
*over-reported* on a filed period (a record later found `NOT_DUE`, or a cancelled sale) are claimed as a **credit on the
current open RDF return** (DR 1786 tells filers to claim prior-period overpayments that way instead of amending): the
RDF packet has a `priorPeriodCreditCents` line with the source period named, and no amendment is opened. A credit is
offered only by records whose `creditAppliedPeriodId` is empty or equals the open period; it is set to the open period
when the packet is built and frozen when that return is marked filed, so a later return can never claim it again
(review fix; DR 1786 forbids reusing a credit already taken on another return). **Refund first (review fix):** a
record whose fee was collected from the customer becomes credit-eligible only after that customer has been refunded the
full fee (Colorado allows the credit for an erroneously collected fee only then; otherwise collected fees are remitted).
New column `customerRefundedAt DateTime?` plus `customerRefundRef String?` (the local credit/refund record id) on
`RetailDeliveryFeeRecord`; until set, a Today task under Sales tax says "Refund the 31¢ delivery fee to <customer> (or it
must still be paid to Colorado)" linking to the customer's billing page, and the fee stays in the return's total.
`PAY_MYSELF` records need no refund.

### 12.6 Watching the exemption

- `RDF_EXEMPTION_ENDING` Today task (computed): when current-year Colorado retail sales pass 80% of the threshold (only
  while status is `EXEMPT_SMALL_BUSINESS`): "You may lose the small-business delivery-fee exemption next year (or this
  year if this is your first year) — talk to your CPA and decide how to handle the fee". `high` when passed.
- On January 1 the status is recomputed from the year just ended; if it becomes `APPLIES`, readiness (12.2) and the
  filing-account task (12.5) appear.

### 12.7 Tests

`tests/retail-delivery-fee.test.ts` (pure: each status; threshold boundary at exactly $500,000; first-year rule; July 1
rate switch; one fee per sale with several appliances and with a partial delivery finished on a later trip; new-business
grace until the first period starting 90+ days after crossing; state-exempt delivery charges nothing; undecided status
blocks readiness),
★ `tests/retail-delivery-fee-integration.test.ts` (completion writes one record under retry; collected line is untaxed
and on the next invoice; a prepaid agreement gets a standalone fee invoice; a prepaid rental invoiced June 30 and delivered
July 2 is on the July return at June's amount; a collected fee is not credited before the customer refund is recorded; a rental signed in June and first charged in
July uses July's amount; a prepaid invoice issued June 30 and paid July 2 uses July's fee amount and lands in July on a
cash-basis return; a credit claimed on one filed return is not offered on the next; PAY_MYSELF adds no line; rate missing leaves a PENDING_RATE record completed later; undecided
leaves PENDING_DECISION resolved later — to PENDING_RATE when no amount exists yet; a free repair swap creates no
record; a sale paid before July 1 and delivered after uses the earlier amount; added fee after filing opens an amendment; over-reported fee
becomes a credit on the current return), packet tests for the RDF return in `tests/tax-filing-packet.test.ts`, readiness test in the
existing readiness suite.

### 12.8 PRs

- **T-6c — WU-TB1:** 12.2–12.6 domain logic, schema (rides the 11.3 migration if T-6a has not merged; otherwise its own
  additive migration), completion hook, Stripe/local invoice line, packet kind. Risk area: money.
- **T-7** adds the settings fields, rate entry and the RDF return page variant.

### 12.9 Stop-and-ask (replaces S-T4)

- **S-T4** The CPA says the fee applies to something the app does not model as a completed delivery job (for example
  pickups or installation-only visits), or the Department requires per-delivery detail the record does not hold.

---

## 13. Amendment C (2026-10-07) — Watching official sources and applying rate changes automatically

Status: **APPROVED** (Chris, 2026-10-07: "Is there a way to cause the app to monitor the correct official places and
update tax changes automatically?"). Extends D-T9 and WU-T6; built in PR T-5b (13.7).

### 13.1 What can and cannot be automatic

| Kind of change | Official source | What the app does |
|---|---|---|
| A tax area's **rate** changes (state-collected changes only start January 1 or July 1; home-rule cities can change any time) | Colorado's GIS address lookup (D-T3, 3.3) — the same source SUTS uses | **Applies automatically** within the guardrails in 13.2, tells the owner, allows undo before it starts |
| An address is now in a **different set of tax areas** (annexation, new special district) | GIS lookup | Review task — the new area needs a taxability column (D-T5) and a filing account (11.13) |
| **Laws and rules** (what is taxable, lease rule, vendor fee, filing rules, the yearly retail delivery fee amount) | Department pages, DR 1002 "Sales/Use Tax Rates", Sales Tax Rate Changes page, city pages | **Watches the pages and alerts** with what changed; never auto-applies — these need the owner's or CPA's judgement |

### 13.2 Automatic rate updates

New automation `tax-rate-watch` (inside the `tax-address-recheck` cron route as a second `runAutomation` call):

1. **Look-ahead:** **every day** from **December 1** and **June 1** (so the two-days rule can be met well before the
   change), look up every jurisdiction in use (one representative
   reviewed address per jurisdiction combination, not every customer) **as of the coming January 1 / July 1**, if the GIS
   contract supports an effective date (runbook gate; the public bulk-lookup format already accepts a `Date` column). If
   it does not, the look-ahead is skipped and the existing November 15 / May 15 reminder plus the page watch (13.3)
   cover it.
2. **Current check:** daily at 00:20 Denver on January 1 and July 1, and on the 1st of every month, the same lookups for
   today (replaces D-T9's monthly re-check wording; per-address differences still raise the existing review task).
3. For each difference in a jurisdiction that is already `REVIEWED`:
   - **Guardrails (all must hold to apply automatically):** same jurisdiction code and level; the new rate was returned
     by **two lookups on different days**; the change is within `autoRateChangeMaxMilliPercent` (owner setting,
     starting value 1000 = one percentage point — "a bigger jump is more likely a lookup problem than a real change");
     the effective date is today or later (never backdated).
   - **Applied:** create `TaxRateVersion` (`source = COLORADO_GIS`, `effectiveOn`, `autoApplied = true`), which D-T9's
     existing automation then pushes to Stripe subscriptions the day before it starts. **Same-day discovery (review
     fix):** a version whose `effectiveOn` is today or earlier (found by the current check because the look-ahead was
     unavailable, or approved later from a guardrail task) is pushed **immediately** through the same
     `SUBSCRIPTION_TAX_UPDATE` operations and idempotency keys D-T9 uses (D-T9's automation is extended to process
     "starting tomorrow **or already started and not yet pushed**"); invoices Stripe created before the push are caught
     by D-T8's difference check and listed on Today. Today task (informational,
     clears when acknowledged): "Weld County rate changes January 1: 1.000% → 1.200% — applied automatically from
     Colorado's official lookup. Stripe will be updated December 31." with **Undo** (OWNER; allowed until the day before
     it starts; audit row).
   - **Not applied (a guardrail failed):** a `high` review task with both rates, the dates and a one-click "Apply this
     rate" (OWNER).
4. Owner switch `autoApplyOfficialRateChanges` (starting **ON**, because Chris asked for it; off = every change becomes a
   review task). Explained on the "Your tax decisions" screen with the guardrails in plain words.

Schema (additive, migration in T-5b): `TaxRateVersion.autoApplied Boolean @default(false)`, `autoAppliedUndoneAt
DateTime?`; `BusinessSettings.autoApplyOfficialRateChanges Boolean @default(true)`,
`autoRateChangeMaxMilliPercent Int @default(1000)`; `TaxRateObservation(id, jurisdictionId, asOf DateTime,
rateMilliPercent Int, observedAt DateTime @default(now()))` with `@@index([jurisdictionId, asOf])` to prove the
two-days rule (rows older than a year are deleted by the same automation).

### 13.3 Official page watch (alerts only)

New automation `tax-source-watch` (weekly on Mondays, inside the daily `tax-address-recheck` route). Model:

```prisma
model OfficialSourceWatch {
  id            String    @id @default(cuid())
  label         String    // "Colorado — Sales tax rate changes"
  url           String    @unique
  active        Boolean   @default(true)
  lastHash      String?   // sha256 of the normalised page text
  lastText      String?   // the normalised page text from the last check (capped at 200 KB) — needed to show what changed
  lastExcerpt   String?   // up to ~600 characters of the paragraphs added or removed since the previous check
  lastCheckedAt DateTime?
  lastChangedAt DateTime?
  lastError     String?
  consecutiveFailures Int @default(0)   // +1 on each failed fetch, back to 0 on any successful fetch (review fix)
  reviewedAt    DateTime?
  createdAt     DateTime  @default(now())
}
```

- **Starting list** (seeded inactive until the T-5b PR verifies each URL still exists; the PR records the verified
  list): Colorado "Sales Tax Rate Changes" (DR 1002 updates) page; DR 1002 publication page; Retail Delivery Fee
  retailers page; SUTS participating jurisdictions page; Colorado sales-tax news/announcements page; City of Greeley
  sales tax page. The owner can add, pause or remove entries (Desk → Sales tax → Setup → **Official sources**).
- **Fetch safety** (server-side fetch of owner-entered URLs): `https` only; host must end in `.gov` or `.co.us` or be in
  a short reviewed allowlist in code; no IP literals, no redirects to another host, 10-second timeout, 2 MB cap, no
  cookies or credentials; text extracted by stripping tags/scripts and collapsing whitespace before hashing (so page
  chrome changes rarely trigger). The page text is split into paragraphs; on a hash change the paragraphs added or
  removed versus `lastText` (a simple paragraph-level diff) form `lastExcerpt` ("Added: …" / "Removed: …"), and then
  `lastText` is replaced (review fix: an excerpt of the new page's first lines would usually show navigation, not the
  change).
- **Change found:** Today task `TAX_SOURCE_CHANGED` "Colorado updated *Sales tax rate changes* — here is what's new"
  (excerpt + link), cleared by "I looked at it" (sets `reviewedAt`). An owner email goes out with the same text (11.6).
  When `consecutiveFailures` reaches 3 → task "We couldn't check <label> — the page may have moved" (stays until a
  successful fetch resets the counter or the owner pauses the entry).
- **Yearly CPA check:** each December a Today task "Ask your CPA whether anything in Colorado sales tax changes on
  January 1 for you" (laws are not machine-readable; this is the safety net).

### 13.4 Retail delivery fee amount

The June reminder (12.4) also shows the latest excerpt from the Retail Delivery Fee page if it changed since the last
July. The amount is still entered (or confirmed) by the owner — the page is not a structured source.

### 13.5 Tests

`tests/tax-rate-watch.test.ts` (pure guardrails: two-day rule, size limit, never backdated, reviewed jurisdictions
only), ★ `tests/tax-rate-watch-integration.test.ts` (auto-applied version created once; undo before start removes it
and D-T9 does not push it; guardrail failure creates a review task; switch off → review only),
`tests/official-source-watch.test.ts` (URL validation rejects http, IP literals, other-host redirects; normalisation
ignores whitespace; the excerpt shows the added/removed paragraph, not the page header; change produces one task;
fetch failures counted), all with fake fetch and fake GIS — never real
network in CI.

### 13.6 Stop-and-ask

- **S-T11** The GIS contract has no effective-date parameter and no way to learn upcoming rates: ship the current-day
  check and page watch only; record it in the runbook.
- **S-T12** A watched official page blocks automated requests (robots or terms of use): deactivate it and say so in the
  PR.

### 13.7 PR

- **T-5b — WU-TC1:** 13.2–13.5 (after T-5, which builds D-T9's `tax-rate-changes` and `tax-address-recheck`). Risk area:
  automation/provider (read-only). Screens for the switch, limit, undo and official-sources list ride T-7.

---

## 14. Screen map — how all of Batch T is organized in the desk (Chris, 2026-10-07: "make sure this is all properly organized in the UI")

**This section is the single source for where every tax screen lives.** It supersedes the screen lists in section 4,
11.8 (T-7), 11.11, 11.13, 12.2, 13.2 and 13.3 wherever they disagree; those sections still define *what* each screen
does. Build it with the components the desk already uses: `PageHeader` + `FilterBar` link tabs (as on Billing),
`AttentionList` for Today, `DataList`, `Card`, `StatusPill`, form controls from `src/components/ui`, Evergreen tokens.

### 14.1 Navigation

- One new entry in `src/lib/desk-navigation.ts`, group **Money**, after Billing: `["sales-tax", "Sales tax",
  "finance"]` (OWNER and ADMIN; STAFF never sees it, enforced server-side as for every finance link).
- Routes follow the existing flat pattern: **`/desk/sales-tax/...`** (replace every `/desk/sales-tax/...` path in
  this document).
- Phone bottom tabs are unchanged; on a phone the way in is **Today** (14.3) or the menu.
- Old entry points redirect: the single tax-rate field on Settings is removed in T-4/T-7 and replaced by a card "Sales
  tax now has its own section → Sales tax → Setup".

### 14.2 The Sales tax section — six tabs

`PageHeader` title "Sales tax", one-line description "Colorado sales tax: what to charge, what to file, and when".
`FilterBar` tabs (same order everywhere; horizontally scrollable on phones):

| Tab | Route | What is on it | Edits |
|---|---|---|---|
| **Overview** | `/desk/sales-tax` | (1) the **setup checklist** until complete (14.4); (2) **Next return** card: account, period, due date, total to pay or "zero return", big button **File this return**; (3) "Needs you" list — the same tax items Today shows (14.3); (4) "Recently changed by itself" — automatic rate updates with Undo (13.2); (5) next three due dates with link to Returns | — |
| **Returns** | `/desk/sales-tax/returns` | Filing calendar for the next 12 months and filed history, filterable by account (Sales tax, Delivery fee, Use tax) and status (Upcoming · Ready · Due soon · Overdue · Filed · Amend); **Add to my calendar**; filter **Use tax purchases** shows the purchase list (3.6) that feeds the use-tax return | OWNER files |
| **Areas & addresses** | `/desk/sales-tax/areas` | Tax areas (rates now and upcoming, history with "changed automatically" badges and Undo, review queue for new areas and failed guardrails); filter **Addresses to check** (needing review / failed, bulk file import, re-check) | OWNER/ADMIN confirm addresses and enter rates; OWNER undoes and approves |
| **What's taxed** | `/desk/sales-tax/taxability` | The matrix (D-T5) with "CPA confirmed on" per cell and the "Fill in common Colorado starting answers" button | OWNER |
| **Exemptions** | `/desk/sales-tax/exemptions` | Exempt customers, certificates, expiry | OWNER |
| **Setup** | `/desk/sales-tax/setup` | One page with an in-page contents list (anchors), in this order: **Your tax decisions** (lease election, reporting basis, automatic rate updates switch and limit — 13.2); **Delivery fee** (status the app computed with the reason, handling, CPA confirmation, threshold, yearly amounts — 12.2/12.4); **Filing accounts** (list; each opens `/desk/sales-tax/setup/accounts/[id]` with the SUTS setup of 11.13, reminder days and email switch); **Official sources** (watch list — 13.3); **Business location for use tax** | OWNER (ADMIN read-only) |

Return pages (no tab of their own; reached from Today, Overview or Returns; breadcrumb "Sales tax › Returns ›
September 2026"):
- `/desk/sales-tax/returns/[periodId]` — **one** page that is both the return and the guided filing flow of 11.11
  (check → open SUTS → type these in → pay → done). Filed periods show the frozen numbers, confirmation, dates paid and
  filed, and the CSV download; the five steps collapse into a "Filed" summary.
- `/desk/sales-tax/returns/[periodId]/amend` — the amended-return mode of 11.12 (same layout: previously reported /
  corrected / difference).
- The Delivery fee and Use tax returns use the same page with their simpler rows (12.5, 3.6).

### 14.3 Today — every tax item, one place, one click

All tax Today items appear in one **"Sales tax"** group: Today's `AttentionList` groups by `ExceptionCategory`, so every
tax item uses the single category **`SALES_TAX`**, and the names used in 11.11, 11.13, 12 and 13 (`TAX_RETURN_DUE`,
`TAX_SOURCE_CHANGED`, …) become an item `kind` inside it. Items are ordered: overdue returns → amendments owing tax
→ due soon → not ready → setup → information. Each item opens the exact screen that resolves it:

| Today item | Opens | Clears when |
|---|---|---|
| File your <Month> return (`TAX_RETURN_DUE`) | return page | marked filed |
| Amend your <Month> return (`TAX_AMENDMENT_DUE`) | amend page | amendment filed / handled with CPA |
| Return not ready (`TAX_FILING_NOT_READY`) | the first fixing screen (Addresses to check, a rate, What's taxed, or Setup) | nothing blocks the return |
| Finish tax setup (`TAX_SETUP_INCOMPLETE`) | Overview → setup checklist, scrolled to the open step | step complete |
| Check your SUTS setup (`TAX_SETUP_CHECK`) | Setup → the filing account | "I checked this" |
| License renews soon (`TAX_LICENSE_RENEWAL`) | Setup → the filing account | new expiry entered |
| Colorado changed a page (`TAX_SOURCE_CHANGED`) | Setup → Official sources, that entry expanded with the excerpt | "I looked at it" |
| Rate changed by itself (13.2 notice) | Areas & addresses → that area's history (Undo there) | acknowledged |
| Rate change needs you (13.2 guardrail) | the same history row with "Apply this rate" | applied or dismissed with reason |
| Delivery fee decision / amount / exemption ending (12.2, 12.4, 12.6) | Setup → Delivery fee | decided / amount entered / acknowledged |
| Exemption certificate expiring (D-T10) | Exemptions → that customer | renewed or ended |

STAFF never sees tax items; ADMIN sees them with "Ask the owner" where only the OWNER can act.

### 14.4 Setup checklist (Overview, until finished)

Ordered steps with a done tick, a one-line "why", and a **Start** button to the exact place:
1. Your tax decisions (lease election, reporting basis) — needs CPA answers IN-33/IN-35.
2. What's taxed — every cell decided (IN-34).
3. Filing accounts — Colorado sales tax account with license number, frequency, first period; SUTS setup (IN-43).
4. Tax areas reviewed — every area in use reviewed and on a filing account.
5. Delivery fee — status confirmed by the CPA (IN-37); amount entered if it applies.
6. Reminders — one test reminder email received; calendar file downloaded.
7. Official sources — every watched page checked successfully once.

When all are done the checklist collapses to "Setup complete ✓ — review" and the Overview leads with the next return.
Only steps 1 and 2 (and step 5 *when the delivery fee would apply* — 12.2) are billing-readiness blockers (D-T7);
those steps use exactly the same words as the blocking list. Steps 3, 4, 6 and 7 are filing setup: they never block
signing or billing (IN-43/IN-44 never block — `PLAN.md`), they only make returns and reminders complete (review fix).

### 14.5 Tax elsewhere in the desk and portal (small, linked, never duplicated)

- **Customer record:** a "Tax" panel (OWNER/ADMIN) — the service address's tax areas and combined rate, exemption
  status with link to Exemptions. No editing here.
- **Agreement and rental builder:** the address's tax areas and rate in the price summary; a blocking notice links to
  the exact fix (14.3 targets).
- **Appliance form / purchase order receiving:** the "Sales tax when you bought it" section (Amendment D, 15.2) and an
  appliance-detail "Tax at purchase" panel, linking to Returns → Use tax purchases.
- **Invoices, statements, customer portal:** tax lines by area name and the separate "Colorado retail delivery fee"
  line (12.4); customers never see filing information.
- **Automations page:** the new rules (`tax-rate-changes`, `tax-address-recheck`, `tax-filing-calendar`,
  `tax-rate-watch`, `tax-source-watch`) appear in the existing health list with plain explanations.

### 14.6 Words used on screen (one glossary)

| Say on screen | Never on screen |
|---|---|
| return, amended return, zero return | worksheet, packet, period ID |
| tax area | jurisdiction |
| filing account | — |
| Colorado's official address lookup | GIS, API |
| Colorado retail delivery fee (short: delivery fee) | RDF |
| What's taxed | taxability matrix |
| Due date (and "Colorado accepts it until Monday …" when moved) | legalDueOn |

Money is always shown as dollars with cents; dates in Colorado time ("Oct 20, 2026").

### 14.7 Layout rules for these screens

- Every tab works at 360 px: tables become `DataList` cards; the return page keeps one column with the copy buttons
  at thumb reach; the total to pay is always visible at the top of the return page.
- Copy buttons have labels like "Copy Greeley tax, $123.45" and announce "Copied" in a live region.
- One primary button per screen (File this return / Save); destructive or legal actions (mark filed, undo a rate,
  handled with CPA) ask for confirmation with the consequence in plain words.
- Empty states say what will appear and when ("Your first return appears the day after October ends").

### 14.8 Tests (add to T-7)

`e2e/sales-tax.spec.ts`: the nav shows Sales tax to OWNER and ADMIN only; each of the six tabs loads; a Today tax item
opens its target; the setup checklist step links land on the right anchor; return page at 360 px with copy buttons;
axe clean on every tab at 360/1440, light and dark. Unit: `tests/desk-navigation.test.ts` gains the Sales tax entry and
the STAFF exclusion; the 14.3 targets are a table test in `tests/exceptions-tax.test.ts`.

---

## 15. Amendment D (2026-10-07) — Appliance intake records purchase tax; each appliance decides its own rental tax; use tax is filed

Status: **APPROVED** (Chris, 2026-10-07: the appliance entry form should record whether sales tax was paid when the
appliance was bought and how much; if it was not (for example a private-party purchase), the use tax owed should be
logged there, the form to pay it should be prepared — printed ready to sign, or a process for filing it electronically —
and rental tax should follow from all of this). Supersedes the single "Sales tax the seller charged" field in 3.6 and
refines D-T4 and 3.2 rule 3.

### 15.1 Rules this relies on (researched 2026-10-07; CPA confirms under IN-33)

| # | Rule | Source |
|---|---|---|
| D-F1 | The short-term lease exemption (36 months or less) applies **only if the lessor paid Colorado sales or use tax on the acquisition of that leased property** — it is decided **per appliance**, not once for the business. | C.R.S. 39-26-713; Department "Sales & Use Tax Topics: Leases" |
| D-F2 | The alternative — buying tax-free and collecting tax on every lease payment — needs the Department's permission, requested on **DR 0440 (Lessor Registration for Sales Tax Collection)**. | Department leases guidance |
| D-F3 | Use tax on business purchases made without Colorado tax is reported on the **Consumer Use Tax Return (DR 0252)** for the **state and state-administered special districts** (RTD, Cultural District, RTAs), filed on **Revenue Online** (which also covers RTA use tax) or on paper. Due January 20 for the year while the year's use tax stays at $300 or less; once the year's cumulative use tax passes $300 at the end of a month, a return is due by the 20th of the next month. | DR 0252 instructions |
| D-F4 | The Department does **not** administer city or county use taxes: Greeley's city use tax (and any county use tax) is filed with that jurisdiction (or through SUTS if it participates for use tax — IN-43). | DR 0252 instructions |
| D-F5 | If the seller charged some Colorado sales tax but less than the combined rate where the appliance is used, use tax is owed on the difference. | Department consumer use tax guidance (already in 3.6) |

### 15.2 The intake form (Inventory → Add appliance, and the edit form)

New section **"Sales tax when you bought it"** (required for new appliances; explained on screen in plain words):

1. **"The seller charged Colorado sales tax"** → *Tax paid ($)* (total for the quantity entered; split across units with
   `allocateAcrossLines`), optional *Where you bought it* (city), optional receipt photo (existing private photo upload).
   The app compares it with the tax due at the business location (3.6): if it is less, it shows "You still owe $Y use tax
   on the difference" and records that.
2. **"No sales tax was charged"** (private seller, out-of-state or online store) → the app shows "You owe Colorado use
   tax of $X on this appliance: state $a, RTD $b, Greeley $c … It will go on your next use tax return (due Jan 20, 2027)"
   and records it. Optional *Seller* (free text) and receipt photo.
3. **"Bought tax-free under my lessor permission (DR 0440)"** — offered only when the election is `COLLECT_ON_RENTALS`;
   no use tax; rent on this appliance is taxed (D-T4).
4. **"I'll fill this in later"** — allowed so intake is never blocked, but the appliance cannot go on a rental until it
   is answered (15.4), and a Today task lists such appliances.

Schema (additive, migration in T-6d): `enum AcquisitionTaxStatus { UNKNOWN SALES_TAX_PAID USE_TAX_DUE USE_TAX_PAID
BOUGHT_TAX_FREE_FOR_LEASE }`; `Appliance.acquisitionTaxStatus AcquisitionTaxStatus @default(UNKNOWN)`,
`acquisitionTaxPaidCents Int?`, `acquisitionSellerNote String?`, `acquisitionReceiptPhotoId String?`. Existing
appliances start `UNKNOWN` (populated-upgrade drill). `SALES_TAX_PAID` with a remaining difference also has
`USE_TAX_DUE`-style rows in `PurchaseUseTax` (3.6) — the status shown is "Sales tax paid + $Y use tax due" until those
rows are filed, then "Tax fully paid". When every `PurchaseUseTax` row of an appliance is `FILED` its status becomes
`USE_TAX_PAID` automatically (audit row). Purchase-order receiving (3.6) asks the same question once per order and
applies it to every appliance created from it.

### 15.3 Rental tax follows the appliance (refines D-T4 and 3.2 rule 3)

`EngineLine` gains `acquisitionTaxStatus` for rent lines (the appliance assigned to the line at the start of the billed
period; a swap mid-period uses the outgoing appliance until the next period, and a card notes it). Rule 3 becomes, for
`RENTAL`/`LATE_RETURN` in a state-collected jurisdiction with a lease of 36 months or less:

| Election | Appliance status | Rent is |
|---|---|---|
| `PAY_ON_ACQUISITION` | `SALES_TAX_PAID`, `USE_TAX_PAID`, or `USE_TAX_DUE` (the use tax is on a return being prepared) | **EXEMPT** — reason "Tax paid when this appliance was bought (C.R.S. 39-26-713)" |
| `PAY_ON_ACQUISITION` | `UNKNOWN` | **UNDECIDED** → blocks billing for that rental with "Tell us whether you paid tax on appliance A-104" |
| `PAY_ON_ACQUISITION` | `BOUGHT_TAX_FREE_FOR_LEASE` | impossible (option hidden); treated as TAXABLE with a card |
| `COLLECT_ON_RENTALS` | any | **TAXABLE** (IN-33 follow-up asks whether a unit you did pay tax on is exempt under this option) |

Self-collected cities (Greeley) still use only their own rule (Greeley taxes rent either way). If a use-tax return that
contains an appliance's use tax becomes **overdue** (11.4 `OVERDUE`), the rentals stay exempt but a `high` Sales tax Today
task says "Pay the use tax on A-104 — its rentals are tax-free only because that tax is paid".

### 15.4 Readiness

`UNKNOWN` appliances are a blocker only when they are on an agreement being sent for signature or billed (D-T7 list
item "Tell us whether you paid sales tax on: A-104, A-117"). Intake, inventory and repairs are never blocked.

### 15.5 Filing the use tax (DR 0252 and city use tax)

- Filing accounts (11.3, kind `USE_TAX_RETURN`): **"Colorado — Consumer use tax (DR 0252, Revenue Online)"** covers the
  state and state-administered special districts; each self-collected city with use tax (Greeley) gets its own account
  or the SUTS account, per the SUTS setup (11.13, IN-43). The setup checklist (14.4 step 3) offers to create them.
- **Frequency is automatic for the state account** (D-F3): annual (due January 20) while the calendar year's use tax is
  $300 or less; when the cumulative total passes $300 at the end of a month, the account switches to monthly from the
  next return and a Sales tax notice explains why. The $300 threshold is an owner setting (starting value 30000 cents,
  "the amount in Colorado's instructions as of 2026", restore button).
- **The return page (11.11 / 14.2)** for a use-tax account shows, per jurisdiction: purchases subject to use tax, rate,
  use tax due, and the list of appliances and purchases included (asset number, date, price, tax paid to seller).
  Checklist for Revenue Online: "Sign in to Revenue Online → File a return → Consumer Use Tax → period …", each number
  with a copy button; "I filed it" records confirmation, dates and amount (11.4), which flips those appliances to
  `USE_TAX_PAID`.
- **Paper option — printable DR 0252, filled in:** the page offers "Print the completed form" which fills the
  Department's official fillable DR 0252 PDF for that year with the business name, account number, period and amounts,
  ready to sign and mail. Implementation gate (S-T14): the PR adds the official PDF for the current year (from
  tax.colorado.gov — a public form) to `src/domains/tax/forms/` with its field-name map, using `pdf-lib` (the one new
  library this amendment allows); each new form year is a small PR. Until a year's official PDF is added, the button
  prints a **use-tax worksheet** laid out like the form's boxes to copy onto the paper form. Revenue Online stays the
  recommended path (immediate confirmation, covers RTA); the screen says so.
- The app never submits to Revenue Online (no filing interface exists for small businesses) and never stores Revenue
  Online credentials.

### 15.6 Existing appliances

A Sales tax Today task "Tell us about sales tax on 23 appliances you already own" opens an Inventory list filtered to
`UNKNOWN` with a quick per-row picker (the four 15.2 choices and the amount). For appliances bought before the business
registered, the screen links to the CPA note (IN-33 follow-up) instead of guessing.

### 15.7 Screens (adds to section 14)

- **Inventory → Add/Edit appliance:** the 15.2 section, placed after "Cost each" and "Purchase date".
- **Appliance detail:** a "Tax at purchase" panel (status, amounts, which return it is on, receipt photo).
- **Inventory list:** filter "Tax at purchase not recorded".
- **Sales tax → Returns:** the use-tax accounts appear in the calendar like the others; "Use tax purchases" filter
  (14.2) lists these appliances.

### 15.8 Tests and PR

New PR **T-6d — WU-TD1** (after T-6b, which owns the use-tax rows of 3.6): schema, intake form section, per-unit engine
rule, readiness item, automatic annual/monthly switch, DR 0252 fill (if the official PDF is added) or worksheet.
Tests: `tests/tax-engine.test.ts` additions (each row of the 15.3 table), ★ `tests/appliance-intake-tax-integration.test.ts`
(private-party purchase records use tax and makes rent exempt; seller charged less than the local rate records the
difference; "fill in later" blocks only the agreement that uses it; filing the use-tax return flips status to
`USE_TAX_PAID`; quantity 3 splits the tax paid), `tests/use-tax-frequency.test.ts` (annual → monthly at $300.01 at month
end; owner threshold), `tests/dr0252-fill.test.ts` (field map fills every amount; worksheet fallback), browser: intake
form section at 360 px, axe clean.

### 15.9 Stop-and-ask

- **S-T14** The official fillable DR 0252 cannot be obtained or has no form fields → ship the worksheet only.
- **S-T15** The CPA says the exemption needs the use tax actually *paid* before the first rent (not just recorded as due)
  → make `USE_TAX_DUE` block billing instead of exempting, and ask Chris.
