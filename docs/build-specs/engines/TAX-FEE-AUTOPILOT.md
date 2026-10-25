# Build spec — Tax and fee autopilot (TFA-1, TFA-2, TFA-3)

Design: `docs/designs/TAX-FEE-AUTOPILOT.md`. Facts and sources: `docs/research/2026-10-25-tax-fee-rules.md` (the only
place legal numbers come from). Requested by Chris 2026-10-25 (DECISIONS.md: autopilot, and the timing rule).
Depends on DEC-1a (Decisions registry, `DecisionScheduledChange`, `getTaxabilityRulesAsOf`). Read
`docs/AI-PR-READ-FIRST.md` (tax on customer bills, money). No live payments, email or texts are turned on by any of
this; owner email notices go through the existing switch.

Current code (audited 2026-10-25; re-check line numbers): rates `TaxRateVersion` (effective-dated, auto-apply with
undo exists in `official-rate-auto-apply.ts` but the production source is manual-only); RDF amounts
`RetailDeliveryFeeRate` (owner-entered via `addRdfRate`, none seeded); RDF status `retailDeliveryFeeStatus`
(`retail-delivery-fee.ts`), start date `rdfNewBusinessStartsOn` (uses filing periods), crossing recorder
`recordFirstRetailDeliveryFeeThresholdCrossing` (no callers); sales total `recordedRetailSales`
(`rdf-sales-evidence.ts`); shop-sale fee `rdf-shop-sale.ts` (voided on return at `src/domains/sales/index.ts` ~480);
line label `RDF_LINE_DESCRIPTION` (`rdf-charges.ts:9`); use-tax switch `chooseUseTaxFrequency` /
`advanceColoradoUseTaxFrequency` (one-way); official watches `OfficialSourceWatch` (six rows seeded inactive, hash-only)
run by `runOfficialSourceWatch` on Mondays; certificates `CustomerTaxExemption` with expiry warning; plain settings
`vendor1099ThresholdCents`, `useTaxMonthlyThresholdCents`, `rdfThresholdCents`, `recordRetentionYears`.

---

## TFA-1 — The rule book and the timing rule

### 1. Data (additive migration `20261101000000_legal_rules`)
```prisma
model LegalRuleVersion {
  id            String   @id @default(cuid())
  ruleKey       String   @db.VarChar(80)      // registry key, e.g. "co.rdf.amount"
  value         Json                          // shape per rule (registry zod schema)
  effectiveFrom DateTime                      // Denver start of the business date, stored UTC
  origin        LegalRuleOrigin               // RESEARCHED | OFFICIAL_WATCH | OWNER | PROFESSIONAL
  sourceUrl     String?  @db.VarChar(500)
  sourceQuote   String?  @db.VarChar(1000)
  checkedOn     DateTime?
  provisional   Boolean  @default(true)       // true until confirmed (owner or professional) — official-watch values from strict parsers are false
  autoApplied   Boolean  @default(false)
  undoneAt      DateTime?
  createdByUserId String?
  createdAt     DateTime @default(now())
  @@unique([ruleKey, effectiveFrom, origin])
  @@index([ruleKey, effectiveFrom])
}
enum LegalRuleOrigin { RESEARCHED OFFICIAL_WATCH OWNER PROFESSIONAL }
```
Backup: backed up. Owner overrides are versions with `origin OWNER` and a required reason (stored in the audit row).

### 2. Registry (`src/domains/rules/registry.ts`, pure) and reads
```ts
type RuleDef = { key: string; title: string; explain: string; area: "SALES_TAX" | "USE_TAX" | "RDF" | "FEDERAL" | "RECORDS" | "LEASES";
  schema: z.ZodType; describe(v): string; change: "FIXED_JUL_1" | "FIXED_JAN_1" | "ANY_DATE";
  watch?: WatchKey; decisionId?: string };
export async function ruleAsOf<T>(key: string, at: Date, db = prisma): Promise<{ value: T; version: LegalRuleVersion }>
export async function nextRuleChange(key: string, after: Date): Promise<LegalRuleVersion | null>
```
`ruleAsOf` = newest version with `effectiveFrom <= at` and `undoneAt = null`; among equal dates PROFESSIONAL > OWNER >
OFFICIAL_WATCH > RESEARCHED. No version → throw `RuleMissingError` (a test asserts every registry key is seeded).
Seeded rules (values exactly from the research file; `origin RESEARCHED`, `sourceUrl`, `checkedOn 2026-10-25`):
| key | value(s) seeded | change |
|---|---|---|
| `co.rdf.amount` | cents per sale: 28 from 2023-07-01, 29 from 2024-07-01, 28 from 2025-07-01, 31 from 2026-07-01 | FIXED_JUL_1 |
| `co.rdf.qualified_threshold` | 50,000,000 cents from 2023-05-04 | ANY_DATE |
| `co.sales.frequency_thresholds` | `{ annualMaxMonthlyCents: 5000, quarterlyMaxMonthlyCents: 110000 }` | FIXED_JAN_1 |
| `co.sales.state_service_fee` | 0 milli-percent from 2026-01-01 | FIXED_JAN_1 |
| `co.use.monthly_threshold` | 30,000 cents | FIXED_JAN_1 |
| `co.penalty` | `{ minCents: 1500, firstPercent: 10, perMonthPercent: 0.5, maxPercent: 18 }` | ANY_DATE |
| `co.interest` | `{ regular: 11, discounted: 8 }` from 2026-01-01 | FIXED_JAN_1 |
| `co.lease.short_term_months` | 36 | ANY_DATE |
| `co.license.expiry` | `{ rule: "DEC_31_ODD_YEARS" }` | ANY_DATE |
| `us.1099.threshold` | 200,000 cents from 2026-01-01 | FIXED_JAN_1 |
| `us.1099.deadlines` | `{ necBoth: "01-31", miscPayee: "01-31", miscIrsPaper: "02-28", miscIrsElectronic: "03-31" }` | FIXED_JAN_1 |
| `us.section179` | `{ limitCents: 256000000000, phaseoutCents: 409000000000 }` from 2026-01-01 | FIXED_JAN_1 |
| `us.bonus_depreciation` | `{ percent: 100, acquiredAfter: "2025-01-19" }` | ANY_DATE |
| `records.keep_years` | 7 (counted from disposal) | ANY_DATE |
Readers switch to `ruleAsOf` (and the old settings fields stay but are no longer read; listed in AR-8's
`NOT_A_SETTING` as "Now a dated rule"): `rdfRateForSale` reads `co.rdf.amount` (and `RetailDeliveryFeeRate` rows are
copied into versions by the migration, then `addRdfRate` writes an OWNER version); `rdfThresholdCents`,
`useTaxMonthlyThresholdCents`, `vendor1099ThresholdCents` (`books/closing.ts`), `recordRetentionYears`
(`tax/retention.ts`). The **state** jurisdiction's `serviceFeeMilliPercent` is ignored in favour of
`co.sales.state_service_fee` for periods from 2026-01-01; the setup screen disables that box for the state line with
"Colorado allows no service fee on state sales tax from Jan 1, 2026" (local lines keep their box).

### 3. Timing rule (`src/domains/rules/timing.ts`, pure)
```ts
type Effect = "FIXED" | "COSTS" | "BENEFITS";
export function whenToAct(input: { opens: Date; closes: Date; effect: Effect; fixedOn?: Date; now: Date;
  percent: number /* 85–95 */; marginBusinessDays: number }): { actOn: Date; reason: string }
```
FIXED → `fixedOn` exactly. BENEFITS → `max(opens, now)`. COSTS (also used for "doesn't help") →
`opens + round((closes − opens) × percent/100)` business-date, then `min(that, addBusinessDays(closes, −margin))`,
then `max(that, opens, now)`; never after `closes`. Owner settings (catalog rows in AR-8, section Taxes):
`costlyChangeTimingPercent Int @default(90)` (85–95; "For things that cost you money or don't help you to do early —
paying a return, filing 1099s, renewing a license — the app suggests a day this far through the time allowed.
Starting value 90%, your choice on Oct 25, 2026.") and `timingSafetyMarginBusinessDays Int @default(3)` (1–10; "Always
at least this many business days before the deadline, so a slow bank day can't make it late. Starting value 3.").
Tests: Oct 31 → Nov 20 window at 90% with margin 3; a margin larger than the window; now past the point; DST.
**Uses:** every filing period shows "File and pay on {date}" (COSTS: opens = period end + 1 day, closes = due date)
next to the due date (existing return screens and the To do item's due label); 1099s (COSTS: Jan 1 → deadline);
license renewal (COSTS: Nov 1 → Dec 31 of the expiry year); certificate renewal request (COSTS: 30 business days
before expiry → expiry); asking DOR to file less often (BENEFITS, section 6). The app never pays or files by itself.

### 4. Screen — Taxes › Rules (`/desk/sales-tax/rules`, OWNER/ADMIN read; OWNER changes)
One row per registry rule: title, "Now: {describe(value)} since {date}", "Next: {describe} from {date}" (if a future
version), source link + "checked {date}", state pill ("Researched — not confirmed" / "From the official page" /
"Set by you" / "Confirmed by {name}"), InfoTip `explain`. ⋯: "History" (all versions, undone ones struck through),
"Change…" (OWNER: value + effective date ≥ today + reason → OWNER version; ConfirmDialog), "Undo this automatic
change" (auto-applied future versions only). Words pass the plain-words check.

### 5. Tests (TFA-1)
`tests/rules-registry.test.ts` (every key seeded, schemas valid, sources present), `tests/rules-as-of-integration.test.ts`
(dates, priority, undo, DST), `tests/rules-timing.test.ts`, readers switched (RDF amount on a Jun 30 vs Jul 1 sale;
1099 list uses the threshold for the payment year), `e2e/tax-rules.spec.ts`.

---

## TFA-2 — Exemptions and switches that turn themselves on and off

### 6. Retail delivery fees
1. **Crossing date recorded automatically.** The nightly `billing-reconcile:retail-delivery-fees` run calls
   `recordFirstRetailDeliveryFeeThresholdCrossing` after computing the running total for the current year: when the
   year's `recordedRetailSales` first exceeds `co.rdf.qualified_threshold`, it stores the business date of the invoice
   that crossed it (`rdfThresholdCrossedOn`, plus audit with the total). Idempotent; never moves an existing date.
2. **Statute start date.** Replace `rdfNewBusinessStartsOn` with `rdfQualifiedEndsOn(crossedOn)` = first day of the
   month after `crossedOn + 90 days` (Denver dates; June 15 → Oct 1). Applies only when the prior year had no Colorado
   retail sales; otherwise the year's status is fixed on Jan 1 by the prior year's total (exempt all year if ≤ the
   threshold, owed all year if over). Status is recomputed on Jan 1 each year (nightly run on the first business day).
3. **Warning, approval and switch.** Every automatic switch in TFA-2 (fee starts or stops, use tax monthly/yearly,
   filing frequency, certificate expiry) first appears on To do for Chris to **Approve** (Chris, 2026-10-25). When a
   start date is known: To do `RDF_STARTS` 30 days before ("Retail delivery fees start on {date} for your delivered
   sales. Approve so the app adds them from that day.") and an owner email (existing switch). Approved → status becomes
   APPLIES on the date. Not approved by the date → the item turns high severity and says what the law requires; the
   app records the fee as owed from the legal date (so the return is right) but changes no customer bill until Chris
   approves. A new year's test back to exempt: To do "Retail delivery fees stop on Jan 1 — your {year} sales were under
   $500,000. Approve." Both are FIXED dates (no timing choice).
4. **What counts** (`recordedRetailSales`): keep counting rent (careful choice; Decisions question `RDF-RENT-COUNTS`,
   audience CPA, starting value "Count rent"); subtract refunds of sales cancelled before delivery; leave voided
   bills out (as today).
5. **Returns vs cancellations (fixes a legal error).** `returnShopSale` after delivery must **not** void the fee:
   the fee record stays owed and the customer refund excludes the fee line ("Retail delivery fees can't be refunded on
   a return"); a sale cancelled **before** delivery with everything refunded voids the fee and records a credit for the
   next DR 1786 (existing `reserveRdfCreditsInTx` path). Free exchange/replacement → no new fee (a replacement sale
   created from a return carries `replacementOfInvoiceId` and skips the fee). Tests for each.
6. **Line wording**: `RDF_LINE_DESCRIPTION = "Retail delivery fees"` (statute wording); existing issued lines keep
   their text.
7. **Pay-instead choice locks at the first qualifying sale**: once any RDF record has status APPLIES, `rdfHandling`
   can't be changed (setting row shows "Locked since {date} — Colorado requires the same choice for every sale"). DEC-2's
   starting value stays PAY_MYSELF.
8. Rentals under pay-on-acquisition stay NOT_APPLICABLE (already correct); add a test pinning it with the lease source.

### 7. Use tax resets each year
`chooseUseTaxFrequency` becomes year-aware: each account starts every calendar year as ANNUAL (due Jan 20 next year);
the first month end whose running total for **that** year exceeds `co.use.monthly_threshold` switches it to MONTHLY
from the next month (as today); on Jan 1 it returns to ANNUAL (an audited change, To do "Use tax is back to one
yearly return for {year}"). Tests across a year boundary.

### 8. Sales tax filing frequency
Monthly job (`tax-filing-calendar`) computes the trailing-12-month average state + state-collected local tax per month
and compares with `co.sales.frequency_thresholds`: lower than the current frequency allows → BENEFITS: To do "You may
file {quarterly|yearly}. Ask Colorado in Revenue Online" (once per year, with steps); higher → FIXED: in December, To
do "Colorado may move you to {monthly|quarterly} on Jan 1 — check Revenue Online and update here". The app never
changes the account's frequency itself (only Colorado assigns it); Chris confirms with one tap that sets the account's
frequency from the next period.

### 9. Exemption certificates
- At each bill for a customer whose certificate expired since their last bill: the bill is taxed (already by date) and
  a To do "{customer}'s exemption certificate expired on {date}. Ask for a new one (DR 0715 or DR 5002)." with a
  drafted message (email/SMS only through the existing switches).
- Form names: replace any mention of DR 0563 with DR 0715 / DR 5002 / MTC certificate (grep the repo).
- A new certificate entered with `validFrom` in the past applies to bills from now on only (history unchanged).

### 10. License renewal
`TaxFilingAccount.licenseExpiresOn` for the state license defaults from `co.license.expiry` (12/31/2027); after Chris
marks it renewed, the next odd year is set. Reminder at the timing point (section 3).

### 11. Tests (TFA-2)
`tests/rdf-autopilot-integration.test.ts` (crossing recorded once; statute start; Jan 1 re-test both ways; return keeps
fee; pre-delivery cancel credits; exchange no fee; lock), `tests/use-tax-year-reset.test.ts`,
`tests/filing-frequency-advice.test.ts`, `tests/exemption-expiry-flow-integration.test.ts`, `tests/license-renewal.test.ts`.

---

## TFA-3 — Watching official sources and updating itself

### 12. Turn the watches on
Migration sets the six seeded `OfficialSourceWatch` rows `active = true` (starting value; owner switch "Watch the
official tax pages" on Taxes › Rules, explained) and adds: `https://tax.colorado.gov/retail-delivery-fee-rates`
(parser `RDF_RATES`), the Greeley sales-tax page (parser `GREELEY_RATE`), `https://www.irs.gov/instructions/i1099mec`
(parser `IRS_1099_THRESHOLD`), `https://tax.colorado.gov/index.php/tax-topics-penalties-and-interest` (parser
`CO_INTEREST`). Cadence: weekly (existing Monday run); **daily** for a watch during its known change window (RDF: Apr
15–Jul 1; IRS 1099 and Colorado interest: Nov 1–Jan 31; Greeley: Nov 4–Dec 31 2026 for the ballot, then weekly).

### 13. Parsers (`src/domains/rules/parsers/*.ts`, pure, each with saved-page fixtures)
Each returns `{ ok: true, values: { ruleKey, value, effectiveFrom }[], evidence: string } | { ok: false, why }` and
must be **strict**: it finds the exact table/heading it expects, every number parses, dates are explicit; otherwise
`ok: false` (never guess).
- `RDF_RATES`: the rates table → one version per July 1 row; the six parts must add up to the total.
- `GREELEY_RATE`: the sentence/table stating the city sales tax rate → `greeley.sales_rate` (registry key added in
  TFA-1 with 4.11% seeded, linked to the Greeley `TaxRateVersion` writer), effective date only if the page states one.
- `IRS_1099_THRESHOLD`: "$X or more" for NEC and rents + the tax year → `us.1099.threshold`.
- `CO_INTEREST`: the year's regular/discounted rates → `co.interest`.

### 14. What happens with a reading — always Chris's approval (Chris, 2026-10-25)
**Nothing found on an official page is ever applied without Chris approving it** ("it should always put it on the
todo list for me to review and approve"). Every parse result is stored as an observation (new `LegalRuleObservation
{ ruleKey, value, effectiveFrom, watchId, observedAt, evidence }`, same pattern as `TaxRateObservation`). When a
reading differs from the current or scheduled rule, a To do `RULE_CHANGE_REVIEW` appears: "{title}: the official page
now says {value} from {date}" with the page excerpt and link, how sure the app is ("Read the same way on 2 days" /
"Read once — check the page"; "Within the usual range" / "Unusually large change — check carefully"), what it will
change ("New delivered sales from {date} get {value}"), and **Approve** (OWNER; creates a version with origin
OFFICIAL_WATCH, `provisional = false`, `createdByUserId` = Chris, scheduled for the stated date — never earlier) /
**Not right** (dismiss with a note; the same reading won't ask again). If the start date passes without approval, the
item turns high severity ("Colorado's new amount started on {date} — approve it so your records are right") and
nothing changes on its own. Greeley tax-rate readings go through the existing `TaxRateVersion` review path
(`officialRateReviewException` with APPLY_OFFICIAL_RATE), never its auto-apply.
**The existing rate auto-apply is turned off:** the setting `autoApplyOfficialRateChanges` gets starting value
**false** (migration sets it false; Chris's answer, recorded in DECISIONS) and the setting row explains "Off: every new
rate waits for your approval on To do". Leave the code path but it only runs if Chris turns it on himself.
Hash-only watches (DR 1002, SUTS jurisdictions) keep today's "page changed" To do, plus the existing Jan 1/Jul 1
reminders.

### 15. After the Nov 3, 2026 Greeley vote
Dated check: from Nov 4 the Greeley watch runs daily; the decision subject `GREELEY-RATE-2F` (DEC-2) shows "Waiting for
the result" until the parser or Chris enters the new rate and its start date; the rate is a FIXED change on the date
the city sets.

### 16. Tests (TFA-3)
Parser fixtures (good page, changed layout → `ok: false`, partial table), observation agreement rule, plausibility
bounds, future-only, undo, switch off → review only, cadence windows, no network in CI (fetch is injected).

## 17. Owner checklist and decisions
No new checklist rows (the IN-61 key row already covers the address lookup). New Decisions questions (CPA): 
`RDF-RENT-COUNTS`, and from the research file's "still unverified" list: free-delivery RDF, Greeley filing/license
rules, certificate life. Each with the careful starting value.
