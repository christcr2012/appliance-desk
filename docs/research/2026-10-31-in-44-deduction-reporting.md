# IN-44 — How non-taxed amounts are reported on the Colorado sales tax return

Researched 2026-10-31 on Chris's instruction (owner decision, recorded in
docs/DECISIONS.md): determine the most likely outcome of the CPA's review of
IN-44, apply it as the configurable default in `TaxFilingAccount.deductionLabels`,
and keep IN-44 open for the CPA to confirm. Method: house Deep Research
pattern — primary sources first, the 2026-10-25 draft treated as a claim to
verify, counterevidence actively sought, skeptic pass at the end. Full run
record: workspace research notes `in44-colorado-suts-deduction-reporting-20261031-1304`.

**These are researched defaults, not a CPA answer. IN-44 stays open.**

## The return's shape (verified on the current forms)

The current DR 0100 (07/03/25, effective July 1, 2025, and 09/19/25,
effective January 1, 2026 — the two editions have an identical Schedule A)
works like this: line 1 is "Gross sales of goods and services for this
site/location only", and its instruction says to **include all sales of
goods and services, whether taxable or not**. Schedule A deductions come off
on line 2; line 3 is line 1 minus line 2. So on this return, a non-taxed
amount is normally **included in gross and then deducted** — that resolves
the placement question IN-44 asked: every bucket below is a DEDUCTION
(`reportAs: "DEDUCTION"`), and none of the packet's buckets maps to
LEAVE_OUT_OF_GROSS.

Current Schedule A lines used here:

| Code | Line name (exact, current form) |
|---|---|
| A1-1 | Wholesale sales, including wholesale sales of ingredients and component parts |
| A2-1 | Sales made to nonresidents or sourced to locations outside of Colorado |
| A3-1 | Sales of nontaxable services |
| A4-1 | Sales to exempt entities and organizations |
| A8-1 | Bad debts charged-off, returned goods, trade discounts and allowances where tax was paid (cash discounts are not allowed) |
| A13-1 | Other exempt sales (identify type(s) of exemption(s) claimed) |

**Renumbering trap:** the July 2025 form inserted a new line 11 "Direct Pay
Permit", which pushed "Other exempt sales" from A12-1 to **A13-1**. Every
pre-July-2025 source — including the DOR's own Supplemental Instructions
(Rev. Feb 2023) and the State Auditor's evaluations — cites it as line 12.
Those citations are stale for current filings. Lines 1–10 did not change.

## Per-bucket conclusions (the defaults applied)

### EXEMPT_SHORT_TERM_RENTAL → A13-1, DEDUCTION — confidence MEDIUM
Rent exempt because the lessor paid sales/use tax when buying the appliance
(C.R.S. 39-26-713(1)(a)). **Premise correction:** the statute covers leases
of **three years or less**, not 30 days (30 days is the separate rooms
exemption, §39-26-704(3)). The Office of the State Auditor's tax expenditure
evaluation 2020-TE14 says lessors report the lease payments on line 1 and
the exempted amount on Schedule A line 3 (nontaxable services) **or** line
12 "Other exempt sales" — line 12 then, A13-1 now. The DOR Supplemental
Instructions contain **no** entry assigning a lessor's own receipts to any
line (their only 713(1)(a) entry is the opposite transaction: sales of
property *to* lessors who collect tax on lease payments, reported on
Schedule A line 1 as wholesale). Default: A13-1 with the exemption
identified on the line ("short-term lease, tax paid on acquisition,
C.R.S. 39-26-713(1)(a)"), because the receipts are exempt sales rather than
services. This is the one bucket where the CPA's confirmation matters most.

### NOT_TAXED_CATEGORY → A3-1, DEDUCTION — confidence HIGH
(A3-1) "Sales of nontaxable services." Supplemental Instructions: "Services
that are not taxable — Schedule A, line 3 — §39-26-104(1), C.R.S." Caveat:
only services not taxed by §39-26-104 belong here; a service charge bundled
into a taxable sale without separate statement can be fully taxable (Sales
Tax Guide, May 2026), which is a taxability-matrix question, not a reporting
one.

### EXEMPT_CUSTOMER_OTHER → A4-1, DEDUCTION — confidence HIGH
(A4-1) "Sales to exempt entities and organizations." Supplemental
Instructions assign to line 4: the U.S. government and Colorado governments
(§39-26-704(1)), charitable organizations (§§39-26-718(1)(a), -102(2.5)),
schools, affordable-housing projects, and materials for exempt construction
projects. The retailer carries the burden of proving the exemption
(certificate on file — Rule 39-26-105-3). **Correction to the 2025 draft's
framing:** a buyer with a *resale* certificate is not A4 — that sale is
wholesale, A1-1 (below). Direct Pay Permit holders are also no longer A4;
they have their own new line, A11-1.

### OUTSIDE_AREA → A2-1, DEDUCTION — confidence HIGH for the line, MEDIUM overall
(A2-1) "Sales made to nonresidents or sourced to locations outside of
Colorado." Supplemental Instructions put on line 2: sales sourced to the
retailer's Colorado location but delivered outside Colorado
(§§39-26-104(3)(c)(I)-(II)), vehicles to nonresidents, and trucks/trailers
for exclusive out-of-state use. Split treatment, recorded so the packet is
never "fixed" wrongly later: (1) sourced here, delivered out of state →
in gross, deducted on A2-1; (2) delivered and sourced to a **different
Colorado location** → excluded from this site's line 1 entirely, no
deduction — it belongs on that location's return (a packet-construction
rule, not a label); (3) purely destination-sourced out-of-state sales →
DOR publications conflict and none reconciles them; never exclude **and**
deduct the same amount.

### Buckets the packet does not produce today (verified for completeness)
- **Resale / wholesale → A1-1, DEDUCTION — HIGH.** (A1-1) "Wholesale sales,
  including wholesale sales of ingredients and component parts";
  §39-26-102(19)(a). If a future packet bucket needs it, the default is
  ready; adding the bucket itself would be S-T9 design work, not a label.
- **Bad debts → A8-1, DEDUCTION — HIGH.** Deducted on the charge-off
  period's return, only where tax was paid (§39-26-102(5)); a later
  collection of a deducted bad debt re-enters line 1 of the collection
  period, per the line 1 instruction itself.

## SUTS and the XML question (for W-12)

SUTS data entry mirrors the DR 0100 structure at the category level: the
DOR's SUTS FAQ describes entering gross sales and the "State Schedule A
Deductions" for state-collected locations. But **no DOR-published SUTS XML
schema or field dictionary naming the Schedule A fields was found** — the
field-level shape of a bulk XML return could not be verified from public
sources. (One source caveat: the SUTS FAQ was read on a DOR CDS demo mirror
domain rather than tax.colorado.gov itself; its content matches the DR 0100's
own description of SUTS as a filing channel.) This confirms W-12's design
gate: the XML serializer is built only after IN-62's answer and the schema
are in writing (the IN-62 row already plans for Chris to download the schema
files from the bulk-filer portal).

## What could not be verified

- No DOR publication assigns a lessor's exempt lease receipts to a Schedule
  A line (bucket A rests on the State Auditor's evaluation, an either/or).
- The current Supplemental Instructions could not be re-read at the DOR's
  own link (it now points at a Google Sheet that would not open); the
  February 2023 PDF — the latest published edition found — was used, and
  its line numbers were re-based onto the current form before use.
- SUTS template field codes sit behind the SUTS sign-in and were not read.

## Skeptic pass

The draft's five line assignments were checked against the current form
rather than the draft's own citations: four verified exactly (A3-1, A4-1,
A1-1, A8-1), and A13-1 is the correct *current* number for the line the
Auditor calls line 12 — the draft's number survives only because of the
July 2025 renumbering, which the draft did not mention. The draft's
placement ("included in gross then deducted") is confirmed by the line 1
instruction for every bucket. The weakest claim is bucket A's line choice
(either/or authority, no DOR assignment) — labelled MEDIUM and flagged
above as the CPA's most valuable confirmation. Nothing in the sources found
supports LEAVE_OUT_OF_GROSS for any current packet bucket.

## Sources (primary first)

- DR 0100 (07/03/25): https://tax.colorado.gov/sites/default/files/documents/DR0100_2025.pdf
- DR 0100 (09/19/25, 2026): https://tax.colorado.gov/sites/default/files/documents/DR0100SS_2026.pdf
- DR 0100 (09/30/24, prior form, for the renumbering): https://tax.colorado.gov/sites/default/files/documents/DR0100_2024_0.pdf
- Supplemental Instructions for Form DR 0100 (Rev. Feb 2023): https://www.taxformfinder.org/forms/2024/2024-colorado-form-dr-0100-instructions.pdf
- C.R.S. 39-26-713(1)(a): https://codes.findlaw.com/co/title-39-taxation/co-rev-st-sect-39-26-713/
- DOR Sales & Use Tax Topics: Leases: https://tax.colorado.gov/sites/tax/files/SUTT_Leases_1.pdf
- Colorado Sales Tax Guide (May 2026): https://tax.colorado.gov/sites/default/files/documents/Sales_Tax_Guide_May_2026.pdf
- State Auditor, Tax Expenditure Evaluation 2020-TE14 (short-term lease): https://content.leg.colorado.gov/sites/default/files/images/2020-te14_short-term_lease.pdf
- DOR SUTS FAQ (SUTS 2.0): https://taxcds.demo.colorado.gov/SUTS-FAQ (DOR CDS mirror — see caveat above)
- Rule 39-26-105-3 (documenting exempt sales): https://www.law.cornell.edu/regulations/colorado/39-26-105-3
