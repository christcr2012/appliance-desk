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
