import type { ApplianceStatus } from "@prisma/client";

/**
 * AR-6 section 4 (EQUIPMENT.md): the ONE next step shown on the appliance
 * record, chosen by priority. Pure and total — every status has an answer
 * (possibly null), so the page never invents its own ordering.
 *
 * Priority: away for repair → needs inspection → needs cleaning → out
 * with no custody record → purchase tax undecided → retired with no plan
 * → old set waiting to be split.
 */
export type ApplianceNextStep = {
  label: string;
  href: string;
  tone: "attention" | "info";
};

export type NextStepExtras = {
  awayForRepair: boolean;
  /** Status says the unit is out (RENTED / AWAITING_PICKUP) but no open custody episode says who has it. */
  custodyMissing: boolean;
  /** The retired plan has no choice yet ("decide later" or no plan row). */
  retiredPlanMissing: boolean;
  /** A pre-split washer+dryer set record (packages OLD_SET_TYPE_SLUG). */
  isOldSet: boolean;
};

export function applianceNextStep(
  appliance: { id: string; status: ApplianceStatus; acquisitionTaxStatus: string },
  extras: NextStepExtras,
): ApplianceNextStep | null {
  const base = `/desk/inventory/${appliance.id}`;
  if (extras.awayForRepair) {
    return {
      label: "Return or replace it — it is out for repair",
      href: `${base}/out-of-service`,
      tone: "attention",
    };
  }
  if (appliance.status === "AWAITING_INSPECTION") {
    return { label: "Inspect it", href: `${base}?tab=overview#guided-actions`, tone: "attention" };
  }
  if (appliance.status === "CLEANING") {
    return { label: "Finish cleaning it", href: `${base}?tab=overview#cleaning`, tone: "attention" };
  }
  if (extras.custodyMissing) {
    return {
      label: "Record who has it",
      href: `${base}?tab=overview#custody`,
      tone: "attention",
    };
  }
  if (appliance.acquisitionTaxStatus === "UNKNOWN") {
    return {
      label: "Say how the purchase tax was handled",
      href: `${base}?tab=tax`,
      tone: "info",
    };
  }
  if (appliance.status === "RETIRED" && extras.retiredPlanMissing) {
    return {
      label: "Choose what happens to it",
      href: `${base}?tab=retired`,
      tone: "info",
    };
  }
  if (extras.isOldSet) {
    return {
      label: "Split it into separate machines",
      href: `${base}/split`,
      tone: "info",
    };
  }
  return null;
}
