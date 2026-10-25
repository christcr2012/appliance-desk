# Build spec — Compliance center: every federal and Colorado obligation, prepared and filed (CMP-1…CMP-5)

Requested by Chris 2026-10-25: "the existing designs [don't] address any federal laws, statutes, rules, compliance,
filings, reporting, updates … I would like the system to be able to directly handle as many things as possible,
whether it is filing directly into respective systems when possible, filling out the forms for me to submit manually
or mail in when required". Facts: `docs/research/2026-10-25-federal-colorado-compliance.md`; sales/use tax and RDF
are TFA (`TAX-FEE-AUTOPILOT.md`), which this reuses (rule book `ruleAsOf`, timing rule `whenToAct`, "Chris approves
everything" rule). Depends on TFA-1 and DEC-1a. Read `docs/AI-PR-READ-FIRST.md` (money, personal data).

**Principles.** (1) The app keeps a list of every obligation, decides from real data whether it applies, and puts it
on To do at the timing rule's date. (2) For each, it does as much as the official channel allows, in this order:
**file directly** (an official interface the business's own software may use) → **upload file** (a file in the
official format for Chris to upload in the official portal) → **filled form** (the official fillable PDF, completed,
for Chris to submit online or print and mail) → **guided web steps** (the exact values to type, in order, for portals
with no upload) → **accountant packet** (worksheets for the CPA or tax software where the government channel is
closed to small-business software, e.g. income tax returns). (3) **Nothing is submitted without Chris approving it**
(same rule as TFA, 2026-10-25): "Review and file" shows the exact data; Chris taps Approve; only then does the app file
or produce the final file. (4) Never invent numbers: an unknown value stops that one obligation with a plain "what's
missing" list.

## CMP-1 — The obligation list, owner facts and the Compliance screen

### 1. Data (additive migration `20261102000000_compliance`)
```prisma
model ComplianceProfile {          // singleton
  id               String  @id @default("singleton")
  entityType       String  @default("SINGLE_MEMBER_LLC")     // SINGLE_MEMBER_LLC | MULTI_MEMBER_LLC | S_CORP — Decisions question CMP-ENTITY (CPA), starting value single-member
  einLast4         String? @db.Char(4)
  einEncrypted     String?                                   // section 3
  sosReportMonth   Int?                                      // 1–12, from the SOS summary page
  truckGvwrLbs     Int?
  employees        Int     @default(0)
  hasHomeOffice    Boolean @default(false)
  updatedAt        DateTime @updatedAt
}
model ComplianceFiling {
  id            String  @id @default(cuid())
  obligationKey String  @db.VarChar(60)                   // registry key
  periodKey     String  @db.VarChar(20)                   // "2026", "2026-Q4", "2027-04"
  state         String  @db.VarChar(20)                   // NOT_APPLICABLE | UPCOMING | READY_FOR_REVIEW | APPROVED | SUBMITTED | ACCEPTED | REJECTED | DONE_ELSEWHERE
  dueOn         DateTime
  actOn         DateTime                                  // from whenToAct
  preparedData  Json?                                     // the numbers shown for review (no full TINs)
  preparedHash  String? @db.Char(64)                      // approval binds to this
  outputFileUrl String?                                   // private blob (compliance/)
  approvedByUserId String?
  approvedAt    DateTime?
  submittedAt   DateTime?
  confirmation  String? @db.VarChar(200)                  // receipt id / "mailed on"
  note          String? @db.VarChar(1000)
  version       Int     @default(1)
  @@unique([obligationKey, periodKey])
  @@index([state, actOn])
}
```
Backup: both backed up (`einEncrypted` stays encrypted in backups; restore needs the same key).

### 2. Registry (`src/domains/compliance/registry.ts`, pure)
`Obligation = { key, title, agency, explain, sourceUrl, applies(ctx): { applies: boolean; why: string }, periods(year):
{ periodKey, opens, dueOn, effect: "FIXED"|"COSTS"|"BENEFITS" }[], prepare?(ctx, period): Prepared, channel:
"DIRECT"|"UPLOAD_FILE"|"FILLED_FORM"|"GUIDED_WEB"|"ACCOUNTANT_PACKET", unit: "CMP-2"|… }`. Seed exactly the
research table: `fed.income.schedule_c`, `fed.estimated_tax` (4 periods), `fed.4562`, `fed.4797`, `fed.1099_nec`,
`fed.1099_misc`, `fed.1099k_reconcile`, `fed.8300`, `fed.payroll.*` (dormant: `applies` = employees > 0),
`fed.usdot` (applies = GVWR ≥ 16,001), `co.income.dr0104ep` (4 periods), `co.bpp.weld_declaration`,
`co.sos.periodic_report` (window: report month ± 2 months, COSTS → acted at 90%), `co.sos.trade_name`,
`greeley.business_license`, `co.vehicle_registration`, plus `co.payroll.*` dormant. Not obligations (shown in "Checked
and not needed" with the reason and source): BOI ("U.S. companies are exempt"), Form 2290 (< 55,000 lb), rent-to-own
license (no ownership option). Tests: every key has a source, periods are right for 2026–2028, `applies` covers the
owner-fact branches.

### 3. Owner facts (Compliance › Business facts, OWNER)
Entity type (select, with the Decisions link), EIN (optional; stored AES-256-GCM in `einEncrypted` with key env
`COMPLIANCE_ENCRYPTION_KEY` — 32 bytes base64; missing key → field disabled with "Ask your developer to set the
encryption key" and an owner checklist row; shown only as last 4), SOS report month, truck GVWR, employees count,
home office. `src/lib/field-crypto.ts`: `encryptField(plain)` / `decryptField(stored)` with a version prefix `v1:`;
decrypt only inside filing preparation; never logged; unit tests with a test key.

### 4. Screen — Compliance (`/desk/compliance`, OWNER/ADMIN read; OWNER approves)
Tabs: **Coming up** (next 120 days by `actOn`), **Needs you** (READY_FOR_REVIEW, REJECTED, missing facts), **Done**,
**Not needed** (with why). Row: title, agency, period, "Do on {actOn} · due {dueOn}", how it will be handled ("The app
files it" / "Upload this file at {portal}" / "Print and mail" / "Type these values at {portal}" / "For your
accountant"), state pill. Filing page `/desk/compliance/{id}`: prepared numbers with where each came from (links to
books/records), the output preview, **Approve and file** / **Approve and download** (binds `preparedHash`; if data
changed since → "Numbers changed — review again"), then "Mark submitted" (confirmation text or "mailed on") and, where
the channel returns an answer, ACCEPTED/REJECTED automatically. To do category `COMPLIANCE_DUE` (one per filing at
`actOn`; high when within the safety margin of `dueOn`). Calendar export reuses `tax/calendar-file.ts`.

### 5. Filled forms engine (`src/domains/compliance/pdf-forms.ts`)
Official fillable PDFs are vendored under `src/domains/compliance/forms/<agency>/<form>_<year>.pdf` (downloaded by the
developer from the official URL in the registry; the file's SHA-256 recorded in `forms/manifest.json`; a test
verifies). `fillOfficialForm(formKey, values)` uses `pdf-lib` (existing; same approach as `tax/dr0252-form.ts`) with a
field map per form (`forms/<form>.fields.ts`: our value key → the PDF field name; test fails if a mapped field is
missing in the PDF). Each new year: the yearly To do "New {year} forms" (TFA-3's watch on the form URL) → the
developer vendors the new PDF in a PR; until then the app produces the prior-year form only if the agency allows it,
otherwise says "The {year} form isn't loaded yet".

## CMP-2 — Income tax helpers (federal + Colorado)
- **Schedule C mapping:** each books account (`system-chart.json`) gets a `scheduleCLine` (e.g. rent income → line 1,
  advertising → 8, car and truck → 9, depreciation → 13, insurance → 15, repairs → 21, supplies → 22, taxes and
  licenses → 23, utilities → 25, other → 27a with description). Unknown accounts → "Other expenses" listed by name.
  Test: every income/expense account maps.
- **Accountant packet** (`fed.income.schedule_c`, channel ACCOUNTANT_PACKET, due Apr 15): year totals by Schedule C
  line from posted books, gross receipts reconciled to Stripe's 1099-K (below), the 4562 and 4797 worksheets, home
  office note if set, and a CSV + PDF. Also a **TXF** export (Tax Exchange Format 042, accepted by desktop tax software)
  for the Schedule C lines — build it only after confirming the format spec from an official/vendor source in the PR;
  otherwise omit TXF (the CSV stays).
- **4562 worksheet** from `BookAsset` (placed in service date, cost, `section179Cents`, `bonusDepreciationCents`,
  method/life) using `ruleAsOf("us.section179", …)` / `us.bonus_depreciation`; **4797 worksheet** from retired-sale
  dispositions (existing §1245 estimate). Both marked "Estimate — your CPA confirms" (DEC-2 IN-39/IN-56).
- **Estimated tax** (`fed.estimated_tax`, `co.income.dr0104ep`; FIXED dates; COSTS → act at the timing point before
  each date): `estimateQuarterlyTax(year, quarter)` = the safe-harbor method by default — Chris (or the CPA) enters
  last year's total federal tax and AGI once (Compliance facts, per year); required annual payment = 100% (110% if AGI
  > $150,000) of last year's tax ÷ 4; for a first year with no prior return → "Enter an estimate from your CPA" (no
  invented number). Colorado: the DR 0104EP worksheet's method once its 2026 trigger and safe harbor are confirmed
  (U → Decisions question; starting value: same ratio method on last year's Colorado tax). Output: filled 1040-ES
  voucher and DR 0104EP voucher PDFs + links to IRS Direct Pay and Colorado Revenue Online payment (the app never pays).
- **1099-K reconciliation:** from Stripe balance transactions (existing `books/stripe-balance.ts`) by month: gross
  charges vs the 1099-K amounts Chris types from Stripe's form (or Stripe's tax-form API if the account exposes it — check
  `stripe.tax.forms` availability in test mode during the build; else manual entry), with fees, refunds and disputes
  shown so the Schedule C gross receipts tie out.

## CMP-3 — Information returns (1099s) and W-9s
- **W-9 collection:** Supplier gets `tinType (SSN|EIN)`, `tinEncrypted`, `tinLast4`, `legalName`, `w9ReceivedOn`,
  `w9FileUrl` (private blob `compliance/w9/`), `backupWithholding Boolean`. "Ask for a W-9" on the supplier record sends
  the existing email path (owner mailbox, switch respected) with a link to a one-time upload page
  `/w9/{token}` (public form, rate limited, token single-use 14 days, accepts the IRS W-9 PDF or a typed form that
  produces a filled W-9 PDF). Paying a 1099-marked supplier without a W-9 → To do "Get a W-9 from {name} before paying
  — otherwise 24% backup withholding applies" (rate from `ruleAsOf`).
- **Preparation** (`fed.1099_nec`, `fed.1099_misc`): per supplier and payment year, source-confirmed paid amounts from
  books (existing 1099 review query in `books/closing.ts`) split NEC (services) vs MISC rents/other by the expense
  account's `form1099Box` mapping; threshold `ruleAsOf("us.1099.threshold", year)`. Card payments are excluded (reported
  by the card company on 1099-K) — the query excludes payments whose method is card.
- **Outputs:** (a) **IRIS Taxpayer Portal CSV** in the IRS template's exact columns (vendor the IRS CSV template in
  `compliance/forms/irs/iris_csv_<year>`, test against its header), ≤ 100 rows per file; (b) recipient copies (Copy B)
  as filled PDFs from the official 1099-NEC/MISC PDFs for mailing/email; (c) **IRIS A2A direct filing** — built
  behind `IRIS_A2A_ENABLED` and an owner checklist row ("Apply for an IRIS A2A TCC and API client id; pass ATS
  testing with the IRS test schema 5.0.7"); until the TCC exists the A2A path is off and (a) is used. The A2A client
  follows Pub 5718 (build after downloading the schema package; tests against the schema with fixtures; no network
  in CI).
- **Colorado copy:** if Colorado requires 1099s with no Colorado withholding (U → Decisions question, starting value
  "not required"), Revenue Online upload file.
- **Form 8300 detector:** recording a cash payment (method CASH) that, alone or with related cash payments from the same
  customer in 12 months, exceeds $10,000 → To do high "File Form 8300 within 15 days (by {date})" with a filled
  f8300.pdf and BSA E-Filing steps.

## CMP-4 — Colorado and local business filings
- **Weld business personal property** (`co.bpp.weld_declaration`, due Apr 15, COSTS → act at 90% of Jan 2 → Apr 15
  with margin): snapshot of `BookAsset` and the fleet as of Jan 1 (cost, year acquired, category: rental appliances,
  vehicles are excluded — they're registered separately, tools, office equipment); items over $350 listed for a
  first-time filer; the rental-fleet exemption ("rented 30 days at a time or less, returned at the renter's option")
  applied only per the Decisions answer `CMP-BPP-RENTAL-EXEMPT` (starting value: **not exempt** — careful choice — with
  the question to the Weld Assessor/CPA); total vs `ruleAsOf("co.bpp.exemption_threshold")` (seed $56,000 for 2026);
  under it → "No declaration needed" (state NOT_APPLICABLE with the numbers kept); over → filled DS 056/060 PDFs +
  the Weld Declaration System spreadsheet and steps; extension option shown when the date is near (fee from the rule
  book).
- **SOS periodic report** (window ± 2 months, $25): GUIDED_WEB — the values to type (legal name, principal address,
  registered agent from settings) and the SOS link; "Mark filed" with confirmation number. Trade name renewal the same
  way once its rule is confirmed.
- **Greeley business license**: GUIDED_WEB with the portal link; dates once confirmed (U → Decisions question; starting
  value "renew every 2 years on the license date" — careful reminder 60 days ahead).
- **Vehicle registration** reminder from the truck's registration month (owner fact); **USDOT** only if GVWR ≥ 16,001.

## CMP-5 — Hiring readiness (dormant until employees > 0)
When Chris sets employees > 0 (or adds a STAFF user marked "employee"), the payroll obligations become active and the
Compliance screen shows a **Hiring checklist** (EIN, W-4, I-9, new hire report within 20 days, Colorado withholding
account, UI account, FAMLI registration, workers' comp policy, posters, paid sick leave tracking) with links and the
dates. **Running payroll** (pay calculation, withholding tables, 941/940/W-2, EFTPS deposits, FAMLI API filing) is a
Decisions question `CMP-PAYROLL-HOW` (owner): "Run payroll inside Appliance Desk, or use a payroll service and track it
here?" — starting value **payroll service** (the careful choice: tax tables change often and payroll errors carry
penalties), with the in-app payroll engine designed when Chris chooses it. Either way the app records payroll totals
as books entries (import from the provider's CSV) so Schedule C and the 941 numbers tie out.

## Tests (all units)
Registry/applies/periods; timing per obligation; approval binds the prepared hash; encryption round trip and no TIN in
logs/exports except the filing file; form field maps against vendored PDFs; IRIS CSV header; 1099 split and card
exclusion; 8300 detector; BPP snapshot and threshold; estimated tax safe harbor (100/110%) and "no prior year" refusal;
Compliance screen browser spec with axe.
