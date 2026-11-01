# Colorado sales tax — how we report amounts that are not taxed

**Robinson Appliance Rentals · Greeley, Colorado**
**A reference for our CPA — owner question IN-44 · October 31, 2026**

Robinson Appliance Rentals is a family-owned washer and dryer rental
business in Greeley, Colorado. Customers rent appliances month to month;
we pay sales tax when we buy each appliance. Our bookkeeping software
prepares the numbers for the Colorado sales tax return (Form DR 0100,
filed through SUTS, the Sales & Use Tax System).

The question we originally asked (IN-44) was:

> On the SUTS return, how should non-taxed amounts be reported: rent that
> is exempt under the short-term lease rule, sales to exempt customers,
> and charges you decided are not taxable — included in gross sales and
> then deducted (under which deduction name), or left out of gross sales?

On the owner's instruction, we researched the most likely treatment from
the Department of Revenue's own forms and instructions and applied it in
the software as starting defaults, so filing work is not blocked while
the question waits. **These are researched defaults, not a CPA answer.**
Every line that uses one is labelled in the software
"Researched default — CPA confirmation still pending", and IN-44 stays
open until you confirm or correct each treatment below. Your confirmed
wording replaces the default as a plain setting — no software change is
needed — and you can also make the change yourself in the app with the
Accountant sign-in, which records the bucket as set by the accountant
and clears the pending label. Placement does not change the tax due; it
changes where the amounts sit on the return.

## The rule behind all four buckets

On the current DR 0100, line 1 is "Gross sales of goods and services for
this site/location only", and its instruction says to **include all sales
of goods and services, whether taxable or not**. Deductions come off on
Schedule A (line 2), and line 3 is line 1 minus line 2. So for every
bucket below, the treatment is the same shape: **counted in gross sales,
then deducted on Schedule A** — nothing is left out of gross.

| Bucket (plain words) | Schedule A line | Confidence |
|---|---|---|
| Rent that is exempt under the short-term lease rule | A13-1 | MEDIUM |
| Charges that are not taxable (services and fees) | A3-1 | HIGH |
| Sales to exempt customers (government, charities, schools) | A4-1 | HIGH |
| Sales delivered outside Colorado | A2-1 | MEDIUM (see §4) |

## 1. Rent that is exempt under the short-term lease rule — line A13-1 — MEDIUM

**What belongs in this bucket.** Rent we collect on appliances where we
paid sales tax when we bought the appliance — the lease exemption in
C.R.S. §39-26-713(1)(a). One correction the research surfaced: the statute
covers leases of **three years or less**, not 30 days (the 30-day figure
is the separate rooms/lodging exemption, §39-26-704(3)). Our customer
rentals run month to month, always well inside three years.

**The label the app shows.**

> "A13-1 Other exempt sales — short-term lease, tax paid on acquisition
> (C.R.S. 39-26-713(1)(a))" — with "Researched default — CPA confirmation
> still pending"

**Why the confidence is MEDIUM.** The Office of the State Auditor's tax
expenditure evaluation of this exemption (2020-TE14) says lessors report
the lease payments in gross sales and deduct the exempted amount on
Schedule A either as nontaxable services or as "Other exempt sales". No
Department of Revenue publication assigns a lessor's own receipts to one
line. We chose A13-1, "Other exempt sales", because these are exempt
sales rather than services, and the line asks the filer to identify the
exemption claimed, which our label does. (On forms before July 2025 this
line was numbered A12-1; the current form renumbered it to A13-1 when a
new line 11 was inserted — older references to "line 12" mean this line.)

**The question we are asking you to confirm.**

1. Do our rental receipts qualify for the §39-26-713(1)(a) exemption — we
   pay sales tax when we buy each appliance, and our rentals run month to
   month, always under three years?
2. Does the exempt rent belong on Schedule A line A13-1 "Other exempt
   sales", with the exemption named on the line, rather than on line
   A3-1?

If you would report it on A3-1, or treat any part of the rent
differently, tell us and we will change the default. Of the four items
in this document, this is the one where your confirmation matters most.

## 2. Charges that are not taxable (services and fees) — line A3-1 — HIGH

**What belongs in this bucket.** Amounts for services and fees that
Colorado does not tax. The return's Supplemental Instructions assign
them directly: "Services that are not taxable — Schedule A, line 3 —
§39-26-104(1), C.R.S."

**The label the app shows.**

> "A3-1 Sales of nontaxable services" — with "Researched default — CPA
> confirmation still pending"

**Why the confidence is HIGH.** The Department's own instructions name
this line for exactly these amounts.

**The question we are asking you to confirm.** Do these charges belong
on Schedule A line A3-1 "Sales of nontaxable services"? One boundary we
need your word on: the Sales Tax Guide says a service charge bundled
into a taxable sale without being separately stated can be fully
taxable. We state service charges separately on the customer's bill — is
that enough to keep them in this bucket?

## 3. Sales to exempt customers — line A4-1 — HIGH

**What belongs in this bucket.** Sales to buyers who are exempt by law —
the U.S. government and Colorado governments, charitable organizations,
schools, and affordable-housing projects — with the buyer's exemption
certificate kept on file. The retailer carries the burden of proving the
exemption, so the certificate is part of the record for every sale in
this bucket.

**The label the app shows.**

> "A4-1 Sales to exempt entities and organizations" — with "Researched
> default — CPA confirmation still pending"

**Why the confidence is HIGH.** The Supplemental Instructions assign
exactly these buyers to Schedule A line 4.

**The question we are asking you to confirm.** Do sales to exempt
entities and organizations belong on Schedule A line A4-1? Two
boundaries we are applying, which we also ask you to confirm: a buyer
purchasing for resale is a **wholesale** sale (line A1-1), not A4-1; and
Direct Pay Permit holders are no longer reported on A4-1 — the current
form gives them their own line, A11-1.

## 4. Sales delivered outside Colorado — line A2-1 — MEDIUM overall

**What belongs in this bucket.** Sales counted on a Colorado return but
delivered outside Colorado. The Supplemental Instructions put on line 2
sales sourced to the retailer's Colorado location but delivered outside
Colorado.

**The label the app shows.**

> "A2-1 Sales made to nonresidents or sourced to locations outside of
> Colorado" — with "Researched default — CPA confirmation still pending"

**Why the confidence is MEDIUM overall.** The line itself is named
directly in the instructions (that part is HIGH). The overall rating is
MEDIUM because the treatment splits three ways, and the second case is a
rule about which return the sale belongs on, not a label:

1. Sourced here, delivered out of state → counted in gross, deducted on
   A2-1.
2. Delivered to a **different Colorado location** → reported on that
   location's return instead; it never enters this return's gross sales
   at all.
3. The same amount is never both excluded and deducted. Department
   publications conflict on purely destination-sourced out-of-state
   sales and none reconciles them, so the software never applies both
   treatments to one amount.

**The question we are asking you to confirm.**

1. Do sales delivered outside Colorado belong on Schedule A line A2-1,
   as in case 1 above?
2. Is case 2 right — a rental delivered to a different Colorado location
   is reported on that location's return and kept out of this return's
   gross sales entirely?
3. Is the never-both-ways rule in case 3 the right guard?

## What happens with your answers

The wording in the app is a setting, not fixed code. When you confirm or
correct a bucket — on this document, or directly in the app with the
Accountant sign-in — the confirmed wording replaces the researched
default, the "CPA confirmation still pending" label clears for that
bucket, and the change is logged with who made it and when. When all
four are confirmed, owner question IN-44 closes. Until then the pending
label stays, so no researched default is ever mistaken for your answer.

For completeness, two more treatments were verified in the same
research but are not used by the software today, because it does not
produce those buckets: resale/wholesale sales → line A1-1 (HIGH), and
bad debts charged off where tax was paid → line A8-1 (HIGH).

Sources: Form DR 0100, current editions (07/03/25 and 09/19/25);
Supplemental Instructions for Form DR 0100 (Rev. Feb 2023); C.R.S.
§39-26-713(1)(a); Office of the State Auditor, Tax Expenditure
Evaluation 2020-TE14; Colorado Sales Tax Guide (May 2026). The full
research note, with source-by-source reasoning, is
`docs/research/2026-10-31-in-44-deduction-reporting.md` in the same
repository as this document.

*Prepared by Robinson Appliance Rentals from Department of Revenue
sources, October 31, 2026. This document records researched reporting
defaults and asks for the CPA's confirmation; it is not itself tax
advice.*
