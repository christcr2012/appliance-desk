/**
 * Every number on Reports, Revenue, Fleet and Growth is declared once here (docs/archive/designs-completed/BATCH-D.md D3), and the screen
 * prints the definition next to the number: the date basis, how it is worked out, whether it is an actual or an
 * estimate, which records it comes from, and where to see those records. Read-only; no screen invents its own wording.
 * Cost that is not recorded is shown as "unknown", never as profit.
 */

export type MetricKind = "ACTUAL" | "ESTIMATE";

export type MetricDefinition = {
  key: string;
  label: string;
  dateBasis: string;
  calculation: string;
  kind: MetricKind;
  sources: string[];
  drillHref: (params: Record<string, string>) => string;
};

const CO = "Colorado calendar dates";

function define(d: Omit<MetricDefinition, "drillHref"> & { drill: string | ((p: Record<string, string>) => string) }): MetricDefinition {
  const { drill, ...rest } = d;
  return { ...rest, drillHref: typeof drill === "function" ? drill : () => drill };
}

export const METRICS = {
  "budget.ready": define({key:"budget.ready",label:"Ready to assign after real bank protection",dateBasis:"Colorado completed statement and Books source revision",calculation:"Independently eligible bank cash minus classified customer/tax/card obligations and already-positive discretionary envelopes; negative protected/unknown/stale source prevents funding.",kind:"ACTUAL",sources:["BankReconciliation","CashAccount","JournalEntry","BudgetMove","BudgetState"],drill:"/desk/books/budget"}),
  "budget.unpaidPlans": define({key:"budget.unpaidPlans",label:"Planned unpaid obligations",dateBasis:"Colorado future dated estimated/exact cost occurrences",calculation:"Occurrence amount minus unique verified posted Books expense settlement links after preserved inverses; neither budget plan nor draft expense is proof of payment.",kind:"ESTIMATE",sources:["BudgetCostPlan","BudgetCostOccurrence","BudgetCostSettlement","Expense","JournalEntry"],drill:"/desk/books/budget?tab=plan"}),
  "budget.targetNeed": define({key:"budget.targetNeed",label:"Discretionary savings need",dateBasis:"Colorado current month and target due cycles",calculation:"Maximum of target need and upcoming unpaid obligations minus positive saved envelope balance, not target plus bill sum. Suggestions never borrow verified protected cash.",kind:"ESTIMATE",sources:["BudgetTarget","BudgetMove","BudgetCostOccurrence"],drill:"/desk/books/budget?tab=plan"}),
  "books.forecastCashNoNewCollections": define({key:"books.forecastCashNoNewCollections",label:"Confirmed bank cash after planned outflows, no new collections",dateBasis:"Colorado current completed bank statement and forthcoming dated obligations",calculation:"Reconciled business bank eligible cash minus only unpaid cost occurrences, outstanding recurring drafts and source-backed open tax worksheet estimates, each source counted once. Unknown banking or cost evidence yields incomplete status. Targets are virtual allocations, not outflows.",kind:"ESTIMATE",sources:["CashAccount","BankReconciliation","BudgetCostOccurrence","BudgetCostSettlement","RecurringExpense","TaxFilingPeriod"],drill:"/desk/books/closing"}),
  "books.forecastCashEstimatedCollections": define({key:"books.forecastCashEstimatedCollections",label:"Cash scenario if future rental invoices are collected (estimate)",dateBasis:"Colorado future billing schedule and current confirmed bank statement",calculation:"No-new-collection scenario plus future invoice schedule estimate, without treating outstanding invoices, pending payouts or drafts as bank cash; not a probability-weighted receipt forecast.",kind:"ESTIMATE",sources:["RentalAgreement","RentalLine","CashAccount","BudgetCostOccurrence"],drill:"/desk/books/closing"}),
  "books.forecastInflow": define({key:"books.forecastInflow",label:"Expected subscription invoicing",dateBasis:"Colorado source and accounting calendar dates",calculation:"Future dated active billed subscription lines with tax computed from verified current jurisdiction engine and rental acquisition evidence; if unreviewed, show incomplete base-only estimate.",kind:"ESTIMATE",sources:["RentalAgreement","RentalLine","BusinessSettings"],drill:"/desk/books/closing"}),
  "books.forecastOutflow": define({key:"books.forecastOutflow",label:"Expected expenses, planned unpaid bills and tax",dateBasis:"Colorado source and accounting calendar dates",calculation:"Unpaid budget cost occurrences with posted-source settlement amounts subtracted, distinct recurring template dates that are not already drafted or linked, plus open tax worksheet estimate remittances; incomplete source evidence labelled for review.",kind:"ESTIMATE",sources:["RecurringExpense","Expense","BudgetCostPlan","BudgetCostOccurrence","BudgetCostSettlement","TaxFilingPeriod"],drill:"/desk/books/closing"}),
  "books.forecastNet": define({key:"books.forecastNet",label:"Expected net movements",dateBasis:"Colorado source and accounting calendar dates",calculation:"Estimated customer invoicing less expected expenses and unfiled tax worksheets, without collection guarantees.",kind:"ESTIMATE",sources:["RentalAgreement","RecurringExpense","TaxFilingPeriod"],drill:"/desk/books/closing"}),
  "books.healthActive": define({key:"books.healthActive",label:"Active rental agreements",dateBasis:"Colorado source and accounting calendar dates",calculation:"Count of agreements in ACTIVE status at read time; no signed-but-not-started agreements.",kind:"ACTUAL",sources:["RentalAgreement"],drill:"/desk/books/closing"}),
  "books.healthEnding": define({key:"books.healthEnding",label:"Rentals ending in next 90 days",dateBasis:"Colorado source and accounting calendar dates",calculation:"Active agreements with supported end date within the next 90 Colorado calendar days; actual end is not yet guaranteed.",kind:"ACTUAL",sources:["RentalAgreement"],drill:"/desk/books/closing"}),
  "books.healthNetCollected": define({key:"books.healthNetCollected",label:"Customer receipt-linked collections after refunds",dateBasis:"Colorado source and accounting calendar dates",calculation:"Successful invoice-linked payment amounts attached to real receipt IDs less recorded refunds; excludes unallocated receipts, deposits and transfers.",kind:"ACTUAL",sources:["Payment","Receipt","Refund","Invoice"],drill:"/desk/books/closing"}),
  "books.healthRentalLength": define({key:"books.healthRentalLength",label:"Average completed rental months",dateBasis:"Colorado source and accounting calendar dates",calculation:"Mean calendar length only for ended agreements with evidenced billing start and actual close or end, divided by 30.4375 days; missing dates excluded.",kind:"ACTUAL",sources:["RentalAgreement"],drill:"/desk/books/closing"}),
  "books.yearEndPackage": define({key:"books.yearEndPackage",label:"Annual books source package",dateBasis:"Colorado source and accounting calendar dates",calculation:"Five read-only source CSVs: K-7 monthly P&L cash/accrual, assets and book depreciation, filed tax records, posted expense journal categories, and source-backed supplier review at the owner-selected threshold. No CPA filing.",kind:"ACTUAL",sources:["JournalEntry","BookAsset","BookTaxEvidence","Expense","Supplier","TaxFilingPeriod"],drill:"/desk/books/closing"}),

  "books.accrualIncome": define({key:"books.accrualIncome",label:"Posted business income",dateBasis:"Colorado actual posted/evidence dates",calculation:"Income account credits less debits in source-backed journals, excluding taxes and customer deposits.",kind:"ACTUAL",sources:["JournalEntry","JournalLine","LedgerAccount"],drill:"/desk/books/reports"}),
  "books.accrualReductions": define({key:"books.accrualReductions",label:"Posted credits, discounts and refunds",dateBasis:"Colorado actual posted/evidence dates",calculation:"Contra-income account debits less credits; reversals keep their source book date.",kind:"ACTUAL",sources:["JournalEntry","JournalLine","LedgerAccount"],drill:"/desk/books/reports"}),
  "books.accrualExpense": define({key:"books.accrualExpense",label:"Posted operating and book depreciation expense",dateBasis:"Colorado actual posted/evidence dates",calculation:"Expense debits less credits, including book depreciation, not equipment purchase capital.",kind:"ACTUAL",sources:["JournalEntry","JournalLine","LedgerAccount"],drill:"/desk/books/reports"}),
  "books.accrualNetProfit": define({key:"books.accrualNetProfit",label:"Accrual book result",dateBasis:"Colorado actual posted/evidence dates",calculation:"Income less credits, discounts, refunds and ordinary/book depreciation expense at journal date.",kind:"ACTUAL",sources:["JournalEntry","JournalLine","LedgerAccount"],drill:"/desk/books/reports"}),
  "books.cashNetProfit": define({key:"books.cashNetProfit",label:"Applied cash basis result",dateBasis:"Colorado actual posted/evidence dates",calculation:"Only posted receipt-linked applied invoice funds apportioned to source revenue, discounts and tax, minus paid expense, fees and refunds; missing allocation is excluded and flagged.",kind:"ACTUAL",sources:["Payment","Receipt","Invoice","JournalEntry","JournalLine"],drill:"/desk/books/reports"}),
  "books.totalAssets": define({key:"books.totalAssets",label:"Business book assets",dateBasis:"Colorado actual posted/evidence dates",calculation:"Signed debit/credit balances from ASSET and CONTRA_ASSET ledger accounts, including retired pending disposition once.",kind:"ACTUAL",sources:["LedgerAccount","JournalLine","BookAsset"],drill:"/desk/books/reports"}),
  "books.totalLiabilities": define({key:"books.totalLiabilities",label:"Business liabilities",dateBasis:"Colorado actual posted/evidence dates",calculation:"Signed credit/debit balances in liability accounts, including customer deposits/credits and tax payable.",kind:"ACTUAL",sources:["LedgerAccount","JournalLine"],drill:"/desk/books/reports"}),
  "books.totalEquity": define({key:"books.totalEquity",label:"Owner book equity",dateBasis:"Colorado actual posted/evidence dates",calculation:"Signed credit/debit equity entries; owner investments are not rental income.",kind:"ACTUAL",sources:["LedgerAccount","JournalLine"],drill:"/desk/books/reports"}),
  "books.retainedEarnings": define({key:"books.retainedEarnings",label:"Accumulated book result",dateBasis:"Colorado actual posted/evidence dates",calculation:"Income minus contra-income and expenses through the balance as-of date.",kind:"ACTUAL",sources:["LedgerAccount","JournalLine"],drill:"/desk/books/reports"}),
  "books.applianceRent": define({key:"books.applianceRent",label:"Rental invoice income per appliance",dateBasis:"Colorado actual posted/evidence dates",calculation:"Posted rental/late-return invoice line cents split only among verified appliances assigned at the invoice period start.",kind:"ACTUAL",sources:["InvoiceLineItem","JournalEntry","ApplianceAssignment"],drill:"/desk/books/reports"}),
  "books.applianceRepair": define({key:"books.applianceRepair",label:"Known recorded appliance repairs",dateBasis:"Colorado actual posted/evidence dates",calculation:"Completed maintenance itemized parts cost or manual job parts, labor and separate verified posted nonduplicate expenses.",kind:"ACTUAL",sources:["JobAppliance","Job","PartStockMovement","Expense"],drill:"/desk/books/reports"}),
  "books.applianceNet": define({key:"books.applianceNet",label:"Invoiced appliance contribution after cost",dateBasis:"Colorado actual posted/evidence dates",calculation:"Posted invoiced rental and late-return share less recorded repair and original acquisition cost; missing costs remain unknown.",kind:"ACTUAL",sources:["InvoiceLineItem","ApplianceAssignment","BookAsset","Job","Expense"],drill:"/desk/books/reports"}),
  "books.applianceBookValue": define({key:"books.applianceBookValue",label:"Appliance management book carrying value",dateBasis:"Colorado actual posted/evidence dates",calculation:"Original source-backed book cost less posted book depreciation, or separately retained retirement carrying value.",kind:"ACTUAL",sources:["BookAsset","JournalEntry","JournalLine"],drill:"/desk/books/reports"}),
  "books.paybackMonths": define({key:"books.paybackMonths",label:"Estimated months until appliance pays for itself",dateBasis:"Colorado actual posted/evidence dates",calculation:"Unrecovered original cost and repairs divided by last six months of sourced invoice rent, with no forecast cash guarantee.",kind:"ESTIMATE",sources:["InvoiceLineItem","ApplianceAssignment","BookAsset","Expense"],drill:"/desk/books/reports"}),
  "telecom.reportedSpend": define({ key:"telecom.reportedSpend", label:"Provider-reported telecom spend", dateBasis:"Exact GMT provider billing period", calculation:"Exact total or non-overlapping complete daily totals; not invoice paid", kind:"ACTUAL", sources:["TelecomUsageSnapshot (provider reported, not invoice reconciled)"], drill:"/desk/settings/telecom" }),
  "telecom.estimatedSpend": define({ key:"telecom.estimatedSpend", label:"Estimated telecom resource costs", dateBasis:"Dates of resource activity", calculation:"Known signed resource estimates, excluding unknown fees/taxes", kind:"ESTIMATE", sources:["CommunicationCostFact", "TelecomRateVersion"], drill:"/desk/reports" }),
  "telecom.reconciledSpend": define({ key:"telecom.reconciledSpend", label:"Verified provider statement", dateBasis:"Provider statement GMT billing period", calculation:"Private verified statement total; not a payment or posted Expense", kind:"ACTUAL", sources:["TelecomStatement"], drill:"/desk/settings/telecom" }),
  "telecom.budgetRemaining": define({ key:"telecom.budgetRemaining", label:"Budget warning preview remaining", dateBasis:"Complete fresh provider GMT period", calculation:"Suggested threshold minus provider-reported spend; no alerts enabled", kind:"ESTIMATE", sources:["BusinessSettings communicationsPolicy", "TelecomUsageSnapshot"], drill:"/desk/settings/telecom" }),
  "telecom.costPerActiveCustomer": define({ key:"telecom.costPerActiveCustomer", label:"Provider-reported telecom spend per active customer", dateBasis:"Whole GMT days, same as the provider's billing days", calculation:"Provider-reported spend divided by the average number of customers with an ACTIVE rental per day; unavailable when history is incomplete or there were no active customers", kind:"ACTUAL", sources:["TelecomUsageSnapshot (provider reported, not invoice reconciled)", "RentalAgreement (status, start date, closed time)"], drill:"/desk/reports" }),
  "telecom.projectedSpend": define({ key:"telecom.projectedSpend", label:"What-if monthly telecom spend at a customer count", dateBasis:"Last complete provider period, scaled to 30 days", calculation:"Observed variable spend per active-customer-day times the what-if customer count times 30, plus known fixed recurring charges once; what-if counts (200, 250, 500, 1,000) are editable examples, not budget facts", kind:"ESTIMATE", sources:["TelecomUsageSnapshot (provider reported, not invoice reconciled)", "RentalAgreement"], drill:"/desk/reports" }),
  "communications.deliveryFailureRate": define({ key:"communications.deliveryFailureRate", label:"Text delivery failure rate", dateBasis:"Whole GMT days the text was requested", calculation:"Failed (including bounced) divided by texts with a final result; accepted, pending and unknown are shown separately; retries are attempts, not new messages; unavailable under 10 final results", kind:"ACTUAL", sources:["MessageDelivery"], drill:"/desk/reports" }),
  "communications.optOutRate": define({ key:"communications.optOutRate", label:"Text opt-out (STOP) rate", dateBasis:"Whole GMT days the opt-out was recorded", calculation:"Distinct people who opted out in the period and were texted in it, divided by distinct people texted; unavailable under 10 people texted", kind:"ACTUAL", sources:["MarketingSuppression", "MessageDelivery"], drill:"/desk/reports" }),
  "communications.medianResponseMinutes": define({ key:"communications.medianResponseMinutes", label:"Median minutes to a person's first reply", dateBasis:"Whole GMT days the customer's message arrived", calculation:"From a customer's inbound text to the first reply written by a signed-in person (automatic replies are not people); ordinary elapsed minutes, not business hours; shows how many conversations it is based on; no per-employee breakdown", kind:"ACTUAL", sources:["CommunicationMessage"], drill:"/desk/reports" }),
  "telecom.usageSyncAge": define({ key:"telecom.usageSyncAge", label:"Provider usage sync age", dateBasis:"Time since successful sync", calculation:"Now minus last successful usage sync; unknown if never run", kind:"ACTUAL", sources:["TelecomSyncCursor"], drill:"/desk/settings/telecom" }),
  "reports.estimatedEarnings": define({
    key: "reports.estimatedEarnings",
    label: "Estimated earnings (all billing agreements)",
    dateBasis: "From each agreement's billing start to today.",
    calculation: "Each agreement's agreed monthly price times the months it has actually been billing.",
    kind: "ESTIMATE",
    sources: ["Rental agreements (agreed prices)", "Billing start and end dates"],
    drill: "/desk/reports",
  }),
  "reports.collected": define({
    key: "reports.collected",
    label: "Collected, net of refunds",
    dateBasis: "The date each payment or refund was recorded.",
    calculation: "Money received plus account credit applied to an agreement's invoices, minus refunds recorded on them. Deposits are not included.",
    kind: "ACTUAL",
    sources: ["Payments", "Credit applications", "Refunds"],
    drill: "/desk/revenue",
  }),
  "reports.gap": define({
    key: "reports.gap",
    label: "Gap (estimated minus collected)",
    dateBasis: "Same as the two numbers it subtracts.",
    calculation: "Estimated earnings minus collected. A positive gap means collections are behind the agreed prices; small timing differences are normal.",
    kind: "ESTIMATE",
    sources: ["Estimated earnings", "Collected, net of refunds"],
    drill: "/desk/reports",
  }),
  "revenue.mrr": define({
    key: "revenue.mrr",
    label: "Estimated monthly rate (MRR)",
    dateBasis: `Rentals billing right now (${CO}).`,
    calculation: "The agreed monthly line prices of rentals that are currently billing. It is the rate you have agreed, not money received.",
    kind: "ESTIMATE",
    sources: ["Active rental agreements and their line prices"],
    drill: "/desk/agreements",
  }),
  "revenue.arr": define({
    key: "revenue.arr",
    label: "Estimated annual rate (ARR)",
    dateBasis: "Same as the monthly rate.",
    calculation: "The estimated monthly rate times 12. Not a forecast of cash.",
    kind: "ESTIMATE",
    sources: ["Estimated monthly rate"],
    drill: "/desk/agreements",
  }),
  "revenue.cashMonth": define({
    key: "revenue.cashMonth",
    label: "Gross cash received this month",
    dateBasis: `The date each receipt was actually received; "this month" is the ${CO} month.`,
    calculation: "All money received in the month before refunds. Deposits are shown separately and are not rent.",
    kind: "ACTUAL",
    sources: ["Receipts"],
    drill: () => "/desk/revenue?source=payments&scope=month",
  }),
  "revenue.cashAllTime": define({
    key: "revenue.cashAllTime",
    label: "Gross cash received all-time",
    dateBasis: "Every receipt on file.",
    calculation: "All money received before refunds.",
    kind: "ACTUAL",
    sources: ["Receipts"],
    drill: () => "/desk/revenue?source=payments&scope=all",
  }),
  "revenue.activeRentals": define({
    key: "revenue.activeRentals",
    label: "Rentals currently billing",
    dateBasis: "Right now.",
    calculation: "A count of rental agreements that are active (a signed renewal that has not started yet is not counted).",
    kind: "ACTUAL",
    sources: ["Rental agreements"],
    drill: "/desk/agreements",
  }),
  "revenue.activeCustomers": define({
    key: "revenue.activeCustomers",
    label: "Customers currently billing",
    dateBasis: "Right now.",
    calculation: "A count of different customers who have at least one active rental.",
    kind: "ACTUAL",
    sources: ["Rental agreements"],
    drill: "/desk/customers",
  }),
  "revenue.newRentals": define({
    key: "revenue.newRentals",
    label: "Rental starts dated this month",
    dateBasis: `The agreement's start date, in the ${CO} month.`,
    calculation: "A count of agreements whose start date falls this month.",
    kind: "ACTUAL",
    sources: ["Rental agreements"],
    drill: "/desk/agreements",
  }),
  "revenue.closedRentals": define({
    key: "revenue.closedRentals",
    label: "Closed rentals updated this month",
    dateBasis: `The last time a closed agreement was changed, in the ${CO} month.`,
    calculation: "A count of ended or cancelled agreements that were last updated this month. It is a rough guide to how many closed, not an exact count.",
    kind: "ESTIMATE",
    sources: ["Rental agreements"],
    drill: "/desk/agreements",
  }),
  "revenue.pastDueAmount": define({
    key: "revenue.pastDueAmount",
    label: "Past-due amount",
    dateBasis: "Right now.",
    calculation: "What is still owed on invoices that are past due: the amount due minus what has been paid.",
    kind: "ACTUAL",
    sources: ["Invoices", "Payments"],
    drill: () => "/desk/billing?filter=delinquent",
  }),
  "revenue.pastDueCount": define({
    key: "revenue.pastDueCount",
    label: "Past-due invoices",
    dateBasis: "Right now.",
    calculation: "A count of invoices that are past due.",
    kind: "ACTUAL",
    sources: ["Invoices"],
    drill: () => "/desk/billing?filter=delinquent",
  }),
  "revenue.failedPayments": define({
    key: "revenue.failedPayments",
    label: "Failed payments this month",
    dateBasis: `The date the payment failed, in the ${CO} month.`,
    calculation: "A count of payment attempts that failed.",
    kind: "ACTUAL",
    sources: ["Payments"],
    drill: "/desk/billing",
  }),
  "fleet.applianceCount": define({
    key: "fleet.applianceCount",
    label: "Total appliances",
    dateBasis: "Right now.",
    calculation: "A count of appliances on file that are not archived, including retired units still listed.",
    kind: "ACTUAL",
    sources: ["Appliance records"],
    drill: "/desk/inventory",
  }),
  "fleet.utilization": define({
    key: "fleet.utilization",
    label: "Physical custody utilization",
    dateBasis: "Current custody and the rolling 30 days through today.",
    calculation: "Current utilization is the share of units physically recorded with customers now. Rolling utilization is occupied custody days divided by observable unit-days in the last 30 days. Assignment rows do not change this metric.",
    kind: "ESTIMATE",
    sources: ["Appliance custody episodes", "Appliance records"],
    drill: "/desk/fleet",
  }),
  "fleet.rented": define({
    key: "fleet.rented",
    label: "Currently rented",
    dateBasis: "Right now.",
    calculation: "A count of appliances whose status is rented.",
    kind: "ACTUAL",
    sources: ["Appliance status"],
    drill: "/desk/inventory?status=RENTED",
  }),
  "fleet.available": define({
    key: "fleet.available",
    label: "Currently available",
    dateBasis: "Right now.",
    calculation: "A count of appliances whose status is available.",
    kind: "ACTUAL",
    sources: ["Appliance status"],
    drill: "/desk/inventory?status=AVAILABLE",
  }),
  "fleet.maintenance": define({
    key: "fleet.maintenance",
    label: "In maintenance",
    dateBasis: "Right now.",
    calculation: "A count of appliances whose status is maintenance.",
    kind: "ACTUAL",
    sources: ["Appliance status"],
    drill: "/desk/inventory?status=MAINTENANCE",
  }),
  "fleet.acquisitionCost": define({
    key: "fleet.acquisitionCost",
    label: "Recorded acquisition costs",
    dateBasis: "All time.",
    calculation: "The purchase prices you entered. A unit with no price entered adds nothing and is counted as incomplete.",
    kind: "ACTUAL",
    sources: ["Appliance purchase costs"],
    drill: "/desk/fleet?costs=missing",
  }),
  "fleet.rentalValue": define({
    key: "fleet.rentalValue",
    label: "Estimated lifetime rental value",
    dateBasis: "Assignment dates, from first rental to today.",
    calculation: "Agreed monthly prices, prorated by 30-day months over each assignment; a rental line is split across its distinct units. It is not invoiced or collected revenue.",
    kind: "ESTIMATE",
    sources: ["Rental assignments", "Agreed line prices"],
    drill: "/desk/fleet",
  }),
  "fleet.repairCost": define({
    key: "fleet.repairCost",
    label: "Recorded repair costs",
    dateBasis: "Completed maintenance visits, all time.",
    calculation: "Parts plus labor entered on completed repair visits (itemized parts replace a hand-typed parts cost). A shared visit's full cost appears on each linked unit.",
    kind: "ACTUAL",
    sources: ["Repair jobs", "Part usage"],
    drill: "/desk/reports",
  }),
  "fleet.contribution": define({
    key: "fleet.contribution",
    label: "Estimated contribution from recorded costs",
    dateBasis: "All time.",
    calculation: "Estimated rental value minus recorded acquisition and repair costs. Costs that were never entered are unknown, not zero, so this is not profit.",
    kind: "ESTIMATE",
    sources: ["Estimated lifetime rental value", "Recorded costs"],
    drill: "/desk/fleet",
  }),
  "fleet.costRecovery": define({
    key: "fleet.costRecovery",
    label: "Estimated cost recovery with complete records",
    dateBasis: "All time.",
    calculation: "How many units have complete cost records and an estimated rental value at least as large as their recorded costs.",
    kind: "ESTIMATE",
    sources: ["Estimated lifetime rental value", "Recorded costs"],
    drill: "/desk/fleet",
  }),
  "fleet.incompleteCosts": define({
    key: "fleet.incompleteCosts",
    label: "Units with incomplete costs",
    dateBasis: "Right now.",
    calculation: "A count of units missing a purchase price or with a repair that has no cost. These units are left out of any total that claims a result.",
    kind: "ACTUAL",
    sources: ["Appliance purchase costs", "Repair jobs"],
    drill: () => "/desk/fleet?costs=missing",
  }),
  "growth.churnRisk": define({
    key: "growth.churnRisk",
    label: "Customers worth a proactive call",
    dateBasis: "Right now.",
    calculation: "Active rentals showing at least one signal: a past-due invoice, a recent failed payment, a term ending soon with no renewal, or repeat repair requests.",
    kind: "ESTIMATE",
    sources: ["Invoices", "Payments", "Rental agreements", "Repair requests"],
    drill: "/desk/growth",
  }),
  "growth.winBack": define({
    key: "growth.winBack",
    label: "Leads worth a follow-up",
    dateBasis: "Days since the last recorded real contact, or since a lead was marked lost.",
    calculation: "NEW or CONTACTED leads use the canonical last-real-contact timestamp from inbound contact, manual notes/calls and accepted/delivered messages. LOST leads also respect when they were marked lost. Generic row edits do not reset the clock.",
    kind: "ESTIMATE",
    sources: ["Leads", "Lead contact evidence", "Message delivery evidence"],
    drill: "/desk/leads",
  }),
  "growth.priceReview": define({
    key: "growth.priceReview",
    label: "Agreements due for a price review",
    dateBasis: "Months since signing.",
    calculation: "Active agreements a year or more old at the same agreed price. A reminder only.",
    kind: "ACTUAL",
    sources: ["Rental agreements"],
    drill: "/desk/agreements",
  }),
  "growth.fleetFlags": define({
    key: "growth.fleetFlags",
    label: "Fleet flags",
    dateBasis: "Current physical custody plus rolling 30-day custody evidence.",
    calculation: "Flags a type only when current and rolling custody tell the same story and there is enough recent observation. This avoids calling old demand a current shortage or brand-new inventory immediately underused.",
    kind: "ESTIMATE",
    sources: ["Appliance custody episodes", "Appliance records"],
    drill: "/desk/fleet",
  }),
} as const;

export type MetricKey = keyof typeof METRICS;

export function metricDefinition(key: MetricKey): MetricDefinition {
  return METRICS[key];
}

export function costOrUnknown(cents: number | null | undefined, formatter: (cents: number) => string): string {
  return cents === null || cents === undefined ? "unknown" : formatter(cents);
}
