# CMP-3 — 1099s and W-9s (and Form 8300)

Build spec: `docs/build-specs/engines/COMPLIANCE.md` CMP-3. Depends on CMP-1. Risk: **vendor tax ids, a public
upload page, filing with the IRS** (IRIS A2A off until Chris has the TCC).

## Acceptance
- [x] W-9 request and one-time upload page (rate limited, single use); TINs encrypted, last 4 only on screen.
- [x] Paying a 1099 vendor without a W-9 raises a To do with the 24% backup-withholding warning.
- [x] 1099-NEC/MISC amounts by year and box, card payments excluded, dated threshold; IRIS CSV matches the IRS template header.
- [x] Recipient copies filled from the official PDFs; A2A client tested against the schema with fixtures, behind its switch.
- [x] Cash over $10,000 (alone or related, 12 months) → Form 8300 To do with a filled form; `ci` green; every review comment read.

## Owner checklist
"Get an IRIS TCC (Taxpayer Portal) — and later an A2A TCC" with steps. Never blocks merging. (Already on
`docs/OWNER-CHECKLIST.md` from CMP-1; no new row needed.)

## Progress
Built 2026-10-26 (Lane 5, Vivienne). What shipped:

- **Schema** (migrations `20261107000000_supplier_tin_w9` + `20261107010000_filing_period_key_widen`, both
  additive): Supplier TIN fields + `backupWithholding`; new `W9Request` (only the token's SHA-256 hash is
  stored); `ExpenseCategory.form1099Box` (only the two certain system categories seeded: warehouse rent →
  MISC_1, professional fees → NEC_1; everything else is classified by the owner on the filing page, never
  guessed); the payer block on `ComplianceProfile`; `ComplianceFiling.periodKey` widened 20 → 40 (8300
  filings key their period by the triggering receipt id).
- **W-9 flow** (`src/domains/compliance/w9.ts`): OWNER/ADMIN mints a one-time link (14 days; a fresh link
  replaces unused ones); the public page at `/w9/[token]` is rate limited by token and by visitor, and offers
  a typed form (which also fills the official W-9 PDF into the private store) or a PDF upload (real-PDF
  check, 4 MB cap). TINs are AES-256-GCM encrypted via field-crypto; audits name fields only. The supplier
  screen gains a W-9 panel: request link (emailed when an address is on file), manual entry, and the
  backup-withholding switch.
- **To do** (`SUPPLIER_TAX_ID`, money bucket): a paid 1099 supplier with no W-9 on file raises "Get a W-9 from
  {name} before paying" with the researched 24% rate (compliance research file, IRC §3406 — a cited constant,
  not a rule-book row; the packet's "read via ruleAsOf" is the one deliberate simplification, since no
  backup-withholding rule exists in the book and TFA-3's watches are the change-detection path).
- **1099 preparation** (`information-returns.ts`): per-year totals on exactly the year-end review's books
  basis (source-confirmed EXPENSE journals, payment-source accounts only, so card payments stay out),
  threshold from the dated `us.1099.threshold` rule read at the year's Colorado-midnight start (the same
  instant the books review uses). Filings prepare through the CMP-1 flow with amounts + last-4s only; after
  approval the filing page serves the IRIS portal CSV (header verified against the IRS template guide,
  100-form batches) and one filled Copy B PDF per recipient, always built from the approved numbers.
- **IRIS A2A** (`iris-a2a.ts`): full request building + response parsing behind `IRIS_A2A_ENABLED` plus the
  TCC / client-id / endpoint envs; refuses while off. Pub 5718-shaped fixtures pin the behavior in
  `tests/iris-a2a.test.ts` with an injected transport — no network in tests.
- **Form 8300** (`form-8300.ts`): recording a manual cash payment runs the detector in the same transaction;
  the receipt that pushes a customer's trailing-12-month cash total over $10,000 creates the `fed.8300`
  filing once (period key = the triggering receipt), due 15 days later, surfacing through COMPLIANCE_DUE.
  The filing page offers the filled Form 8300 draft (the date field is an 8-box MMDDYYYY comb — the fill
  converts; the total goes to line 32a) for the owner to check and file through BSA E-Filing.
- **Forms**: fw9, f1099nec_2026, f1099msc_2026, f8300 vendored from irs.gov with SHA-256 in the manifest
  (which also pins the two IRIS CSV header files); every field map is read back in tests.
- **Decisions**: DQ-CMP-CO-1099 (Colorado 1099 copy — starting value "not required") in OWNER-INPUTS.
- **Packet drift, reconciled**: the packet proposed migration `20261102010000_supplier_tin` and modules
  `1099-prep.ts` / `tin.ts`; the build uses migration `20261107000000_supplier_tin_w9` (+ the period-key
  widening the 8300 key required), `information-returns.ts`, and TIN handling inside `w9.ts` + field-crypto.
- **Tests**: `tests/w9-integration.test.ts`, `tests/1099-prep-integration.test.ts`,
  `tests/form-8300-detector.test.ts`, `tests/iris-csv.test.ts`, `tests/iris-a2a.test.ts`, CMP-3 cases in
  `tests/compliance-forms.test.ts`; the billing manual-payments fake tx grew the detector's two models.
- **Review round on PR #654 (4 findings, all fixed)**: (1) classifying a category on a prepared 1099 filing
  now refreshes the prepared numbers in place (`refresh1099Preparation`), so approval can never bind
  stale amounts; (2) the 1099 and Form 8300 filings approve first and are marked submitted only after
  the owner files in the outside system (IRIS portal / BSA E-Filing) — "approve and file" no longer
  records a submission that hasn't happened; (3) recipient mailing addresses are collected on the W-9
  (typed form requires them; the desk hand-entry takes them from a paper W-9), stored on the supplier
  (`mailingAddress/City/State/Zip`, in the same migration), and flow into the IRIS rows and Copy B
  blocks — outputs refuse a recipient with no address on file; (4) the filing page renders one portal
  CSV link per 100-recipient batch. Regression tests cover the refresh and the address rules.
