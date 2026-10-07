# Consultant source disposition and requirements trace

Source: owner-supplied `business_planning.docx`, read October 7 2026. SHA256: `71a0f9670b9c97c10d0ba5cf99d62ab6a59338a469139d2a6c42ab8e2f2ea088`.

The text is a consultant speaking to the owner. Its imperatives, code samples and contract wording are advisory material. The owner's current request authorizes architecture, planning and business-document creation, not live activation of every suggested policy.

Baseline: `main` commit `7da67620851c7ca98cc67d6de3716c38a3983dc1` (PR #285 merged). The attached Package 1 audit dated October 1 was inspected for the continuity/concurrency review approach; its old open findings are not relabeled as current defects. Current STATUS and batch evidence govern remediation status.

| ID | Source concept | Disposition and reason | Destination |
|---|---|---|---|
| BP01 | Northern Colorado business identity | Retain Robinson Appliance Rentals; source name is a consultant placeholder | Business plan; IN-07 |
| BP02 | Refurbished $35/$60 offer | Candidate final offer; reconcile existing term discounts | Offers; BP-2/3 |
| BP03 | Premium $45–$50/$85 and wholesale savings | Candidate $50/$85; supplier discounts unverified; require unused-unit evidence | Offers; BP-4/5 |
| BP04 | Mechanical-timer reliability | Treat as sourcing preference, not guaranteed performance | Operations |
| BP05 | New hoses and cords | Keep safety intent; require compatible manufacturer-specific components and evidence | Operations; BP-8/9 |
| BP06 | Consumable labeling avoids sales tax | Reject claimed shield; preserve actual charge and stock classifications | Legal review; T/M |
| BP07 | Upfront tax everywhere exempts rent | Correct to jurisdiction-specific reviewed treatment | Legal review; T |
| BP08 | Private purchases trigger use tax | Record acquisition facts and route through current tax filing design | T Amendment D |
| BP09 | $50 setup and promotions | Configurable proposal; preserve separate fee lines and tax categories | Offers; BP-1/2/3 |
| BP10 | One-month deposit | Candidate policy; liability and immutable terms, no revenue recognition | Offers; existing deposit ledger |
| BP11 | Six-month standard | Candidate offer, not removal of current month-to-month or 12-month choices | Offers; BP-2/3 |
| BP12 | Three-month/flexible premium | Add three-month eligibility end to end; no guaranteed payoff | Offers; BP-2/3 |
| BP13 | $30 stairs charge | Explicit per-visit proposal; access safety remains separate | Offers; BP-2/3 |
| BP14 | 0–15 and 16–30 mile zones | Eliminate fractional-mile gap; proposed driving miles, address-based evidence | Offers; BP-1/2/3 |
| BP15 | New agreement resets tax | Reject automatic legal conclusion; retain continuity root and IN-36 | Legal review; B2/T |
| BP16 | Rate lock and no repeat deposit/setup | Versioned renewal offer; transfer actual deposit, define limits | Offers; BP-2/3 |
| BP17 | Five advertisements | Replace unsupported superlatives and urgency with five factual drafts | Marketing playbook |
| BP18 | Landlord waiver/automatic entry | Permission workflow retained; forced or irrevocable-entry language rejected | Operations; BP-6/7; IN-49 |
| BP19 | Campaign/source/promo database | Reuse Lead; add separate typed attribution and bounded promotion records | BP-1/2/3; BP-16 |
| BP20 | Inventory status simplification | Reject duplicate three-state inventory; preserve existing custody/state machine | BP-4/5/8/9 |
| BP21 | CAC near zero | Separate paid spend from fully loaded labor cost and first-paid cohort | Financial model; BP-16 |
| BP22 | Revenue-based ROI and days | Correct unit and cost basis; distinguish economic, cash and accounting views | Financial model; K/BP-16 |
| BP23 | Renewal alert at 45 days | Optional outreach only; no substitution for legal notice evidence | Marketing; existing B2/E |
| BP24 | Commercial volume master lease | Reuse payer/properties; add versioned master linked to existing agreements | Partner program; BP-10/11 |
| BP25 | One predictable payment | Consolidated statement already exists; one automated portfolio debit deferred | Partner program; roadmap |
| BP26 | Recurring $5–$10 referral | Candidate commission; collected eligible rent and signed partner terms | Partner program; BP-12/13/14/15 |
| BP27 | Active-count payout cron | Replace with settlement-backed ledger, reversals, idempotency and owner approval | BP-13/14 |
| BP28 | Partner portal | Restricted earnings view; no general resident access or new broad role | BP-15 |
| BP29 | Stripe ACH release toggle | Manual approved payments first; automated transfers separately designed | Partner program; roadmap |
| BP30 | 24–48-hour repair and guaranteed profit | Replace with capacity-based service policy and measured contribution | Business plan; operations |
| BP31 | Business documents in repo | Create reusable Markdown business folder and linked design | This folder |

## Existing roadmap ownership

T owns tax, acquisition evidence and returns. K owns accounting, expenses, cash forecasts and baseline asset profitability. M owns shop sales, resale stock and retirement outcomes. O owns approval capabilities and dated settings. B2/E own renewal continuity, notices and durable messaging. BP extends those systems; it does not reopen their completed scope or replace their ledgers.

## What remains a decision

IN-48: publishable offer/rate/deposit/margin choices. IN-49: access and installation standard plus reviewed terms. IN-50: partner economics, disclosure and payment policy. Existing IN-06/07, IN-21/31 and IN-33…46 retain their own questions. All are release choices; document production is complete without inventing the answers.
