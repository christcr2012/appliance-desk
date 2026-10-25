# Federal and Colorado (non-sales-tax) obligations — researched 2026-10-25

Source for the compliance registry (CMP units, `docs/build-specs/engines/COMPLIANCE.md`). All pages accessed
2026-10-25. **V** = official page read; **U** = unverified (careful choice in the app + a Decisions question).

## Federal
| Obligation | Applies | Dates | Channel usable by the app | Form/PDF |
|---|---|---|---|---|
| Income tax — single-member LLC (disregarded): Schedule C + SE on Form 1040 (V, irs.gov Single Member LLCs) | yes (starting value; entity type is a Decisions question) | Apr 15 | none for own software (MeF needs ETIN + testing) → accountant packet / commercial software | irs.gov PDFs |
| Multi-member LLC 1065 + K-1, or S-corp 1120-S (U) | only if entity differs | Mar 15 | none | yes |
| Estimated tax 1040-ES (V, f1040es 2026): Apr 15, Jun 15, Sep 15, Jan 15; safe harbor 90% of this year or 100% of last year (110% if last year's AGI > $150,000) | yes | fixed dates | payment links only (Direct Pay / EFTPS / Online Account) | voucher PDF |
| Form 4562 (depreciation, §179) and 4797 (sale of business property, §1245) | yes, when assets placed in service / sold | with return | none → worksheets | yes |
| 1099-NEC/MISC: $2,000 for 2026 payments, may be inflation-adjusted from 2027 (V); NEC Jan 31 to IRS and payee; MISC payee Jan 31, IRS Feb 28 paper / Mar 31 electronic (V) | when paying a vendor ≥ $2,000 | fixed | **IRIS Taxpayer Portal CSV upload (≤100 per batch, free, needs IRIS TCC)**; **IRIS A2A** (A2A TCC + API client id + ATS testing, schema 5.0.7, Pub 5718); FIRE ends Nov 19, 2026 (V) | red paper copies only for paper |
| 10+ information returns (incl. W-2) must be e-filed (V) | — | — | — | — |
| W-9 before paying; backup withholding 24% (V); TIN Matching only after filing certain 1099s in prior 2 years (V) — new business not eligible yet | yes | before payment | — | W-9 PDF |
| 1099-K received from Stripe: over $20,000 **and** over 200 transactions (V, IR-2025-107) | if volume | ~Jan 31 (U) | Stripe data | — |
| Form 8300: cash over $10,000, within 15 days, BSA E-Filing (V, archival page) | rare (cards/ACH aren't cash) | 15 days | BSA E-Filing web | f8300.pdf |
| Payroll (941/940/W-2, EFTPS deposits, SSA BSO EFW2 upload) (V) | only once hiring | 941 quarterly; 940 & W-2 Jan 31 | EFTPS (web), SSA BSO upload | yes |
| BOI (FinCEN): "U.S. companies are exempt" (V, final rule Aug 2026) | **no** | — | — | — |
| Form 2290: only ≥ 55,000 lb (V) | almost certainly no | — | — | — |
| USDOT: Colorado requires one intrastate at GVWR/GCWR ≥ 16,001 lb (V, CSP) | depends on truck GVWR (owner fact) | biennial update | FMCSA web | — |

## Colorado (non-sales-tax)
| Obligation | Applies | Dates | Channel | Form |
|---|---|---|---|---|
| Owner's DR 0104 + estimated DR 0104EP Apr 15, Jun 15, Sep 15, Jan 15 (V dates; trigger/safe harbor U) | yes (SMLLC) | fixed | Revenue Online payment (no API) | DR0104EP_2026.pdf |
| DR 0106 (partnership/S-corp) (U) | only if entity differs | U | Revenue Online | yes |
| Business personal property declaration (Weld DS 056/060): owner of taxable property on Jan 1 files **on or before Apr 15**; extension by Apr 15 ($20/10 days, $40/20 days); none needed if total actual value per county ≤ **$56,000**; first-time filers list items over $350; late penalty lesser of $50 or 15% of tax (V). "Property rented 30 days at a time or less, returned by the renter at his option" is exempt inventory (V; whether the month-to-month fleet qualifies is a Decisions question) | yes from the Jan 1, 2027 assessment | Apr 15 | Weld Assessor Declaration System (web + spreadsheet), no API | weld.gov PDFs |
| Secretary of State periodic report: file from 2 months before to 2 months after the report month, $25, online only; late → delinquent, $50 penalty, $100 cure (V) | yes, yearly | window | SOS web only | — |
| Trade name renewal $5 (fee V; renewal rule U) | likely | U | SOS web | — |
| Greeley business license: "All companies conducting business in the City of Greeley are required to have a business license" (V); fee/renewal U | yes | U | salestax.greeleygov.com portal | city PDFs |
| Greeley sales/use tax: follows the state's filing frequency; file at least yearly even with no tax (V) | yes | U (likely 20th) | Greeley portal, no API | — |
| New hire report within 20 days (V); withholding (quarterly < $7,000/yr, monthly, weekly), UI (quarterly, wage base 2026 $30,600), FAMLI (2026 0.88%, employers with ≤ 9 employees remit only the employee 0.44%; **API and CSV/XML upload**), minimum wage $15.16 (2026), workers' comp required with any employee, paid sick leave 1 h per 30 h up to 48 (all V) | only once hiring | various | Revenue Online upload; MyUI bulk; FAMLI API | — |
| Rent-to-own licensing (C.R.S. 5-10-301): only agreements that let the renter become owner (V) | **no** (no ownership option — keep it explicit in the agreement) | — | — | — |
| Truck registration + specific ownership tax (annual) | yes | annual | county office | — |

## Owner facts needed (not decisions — the app asks once in Compliance setup)
Entity type and tax treatment (starting value: single-member LLC, Schedule C — Decisions question for the CPA), EIN
(only if he has one; needed for employees), the LLC's SOS report month, truck GVWR, number of employees (0).
