# Rental economics and measurement model

Planning edition • October 7 2026 • Illustrative assumptions not a forecast

## What the source model missed

Purchase cost divided by a monthly return produces months, not days. Revenue exceeding purchase price is not proof of profit. Ongoing repairs, vacancy, transport, labor, payment fees and overhead continue. Refundable deposits and collected tax are liabilities, not rent revenue.

The examples below use invented, visible planning assumptions to test the model. They are not supplier quotes, actual accounts, industry benchmarks or recommended borrowing amounts. Replace them with measured data. Missing cost inputs make a result incomplete, not profitable by default.

## Per set illustration

| Assumption or result | Refurbished standard | Verified new | Local flexible |
|---|---:|---:|---:|
| Initial acquisition, preparation and deployment investment | $400 | $900 | $400 |
| Connection cash received, before any tax | $50 | $50 | $50 |
| Unrecovered initial investment | $350 | $850 | $350 |
| Monthly rent while occupied and collected | $60 | $85 | $85 |
| Payment cost allowance | $2 | $3 | $3 |
| Maintenance reserve allowance | $10 | $12 | $12 |
| Route and return allowance | $5 | $5 | $10 |
| Labor allowance | $8 | $8 | $16 |
| Bad-debt allowance | $3 | $4 | $4 |
| Monthly economic contribution before fixed overhead | $32 | $53 | $40 |
| Estimated investment recovery in occupied months | 10.94 | 16.04 | 8.75 |

Initial investment already includes initial preparation/deployment; monthly allowances cover continuing service and eventual return, so do not charge the same deployment twice. If a cost is counted elsewhere, remove the duplicate allocation. Labor may be paid or imputed owner time: show both cash and economic views. Reserves are planning allowances, not additional accounting expenses to post on top of actual maintenance.

At the flexible illustration's three-month minimum, contribution plus the setup receipt is $170, below the $400 initial investment. This directly disproves a guaranteed 90-day payoff from the example prices. A $5 partner commission lowers the standard illustration's monthly contribution from $32 to $27 and extends occupied-month recovery from 10.94 to 12.96. A $10 commission lowers it to $22 and recovery becomes 15.91 months.

## Small fleet illustration

Assume the standard scenario above, all listed sets occupied and paid, and $200 monthly fixed overhead as an illustrative input. This table excludes taxes on business income and financing and is not an owner's take-home forecast.

| Occupied paying sets | Monthly rent | Contribution before overhead | After $200 fixed overhead | Initial investment before connection receipts |
|---|---:|---:|---:|---:|
| 5 | $300 | $160 | -$40 | $2,000 |
| 10 | $600 | $320 | $120 | $4,000 |
| 25 | $1,500 | $800 | $600 | $10,000 |

Operating break-even is ceil($200 / $32) = 7 occupied paying sets, before recovering startup investment. At 85% occupancy, approximately ceil(7 / 0.85) = 9 rentable sets are needed for that occupancy target, with variation in actual days and collections. Idle equipment still consumes capital and may incur storage/insurance. Use a daily cash forecast for purchase timing, receipts, refunds and taxes; dividing a steady monthly margin cannot prove liquidity.

## Canonical definitions for the system

| Metric | Definition and evidence |
|---|---|
| Paid acquisition cost | Advertising spend / new customers reaching first settled rent in the selected acquisition cohort; zero denominator is N/A |
| Fully loaded acquisition cost | (Ad spend + attributable outreach expenses + tracked hours × chosen hourly cost) / same cohort; label imputed time |
| Signed conversion | Signed first agreements / qualified leads in the same cohort; renewals excluded |
| First-paid conversion | New customers with settled first rent / qualified leads; separate from signed conversion |
| Utilization | Rented appliance-days / rentable fleet-days; disclose treatment of maintenance and retired days |
| Renewal conversion | Eligible ending agreements whose successor actually starts within the defined grace window / eligible ending agreements; exclude not-yet-mature cohorts |
| Customer churn | Customers ending their last active rental without continuation / customers active at the start of the period; a replacement agreement is not churn |
| Asset cash recovery | Date cumulative attributed net cash after actual attributable costs reaches initial cash investment; deposits/tax excluded |
| Economic recovery estimate | Unrecovered investment / expected contribution per occupied month, adjusted for vacancy; N/A when contribution is nonpositive |
| Asset accounting result | Invoiced/recognized income less expenses and depreciation under Batch K; explicitly separate from collected cash |
| Partner commission payable | Earned commission less reversals and confirmed payments, from an append-only ledger |

Use existing receipts, allocations, refunds, rental lines, assignment/custody history and Batch K expenses. Split a set's rental line across assigned appliances using the existing allocation rule, with deterministic penny remainders. Do not allocate all historic rent to today's replacement machine. Preserve separate billed, collected and estimated measures in the shared METRICS registry.

## Monthly review worksheet

Record fleet count and occupied days; rent billed and cash collected; refunds and disputes; deposits held; taxes owed; purchases and preparation; labor hours; parts/service; delivery/removal; insurance/storage/software; marketing spend; commissions earned/paid; cash available after liabilities. Explain missing costs and unusual events. Compare the current month and acquisition cohorts before changing a price or buying more stock.
