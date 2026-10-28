// AR-4a (RENTALS spec section 5): which "End this rental" options a rental
// qualifies for. Pure; the page computes the two facts that need the
// database (month-to-month end quote, return pickup) and passes them in.
// Every option hands off to an existing page or action — this module only
// decides what is shown.
export type EndOption = {
  key: "term-ending" | "month-to-month" | "early-return" | "cancel-before-delivery" | "end-today";
  title: string;
  line: string;
  href?: string;
  /** "end-today" renders the danger confirmation in place instead of a link. */
  confirm?: { title: string; summary: string; confirmLabel: string };
};

export type EndOptionsInput = {
  agreement: {
    id: string;
    status: string;
    termMonths: number | null;
    endDate: Date | null;
    terminationRequestedAt: Date | null;
    firstDeliveredOn: Date | null;
    customerName: string;
  };
  /** getMonthToMonthEndQuote returned a quote for this rental. */
  monthToMonthEndAvailable: boolean;
  /** loadReturnPickup found a pickup for an early return. */
  returnPickupFound: boolean;
};

export function endOptions(input: EndOptionsInput): EndOption[] {
  const a = input.agreement;
  if (a.status === "ENDED" || a.status === "CANCELLED") return [];
  const options: EndOption[] = [];
  if (
    a.status === "ACTIVE" &&
    a.termMonths != null &&
    a.endDate != null &&
    a.terminationRequestedAt == null
  ) {
    options.push({
      key: "term-ending",
      title: "The term is ending",
      line: "Renew, switch to month to month, or pick up the appliances.",
      href: `/desk/agreements/${a.id}/ending-decision`,
    });
  }
  if (a.status === "ACTIVE" && a.termMonths == null && input.monthToMonthEndAvailable) {
    options.push({
      key: "month-to-month",
      title: "The customer wants to stop",
      line: "End a month-to-month rental with the notice your terms require.",
    });
  }
  if (a.status === "ACTIVE" && a.firstDeliveredOn != null && input.returnPickupFound) {
    options.push({
      key: "early-return",
      title: "Everything came back early",
      line: "Decide billing, refunds and fees for an early return.",
      href: `/desk/agreements/${a.id}/early-return`,
    });
  }
  if (
    a.firstDeliveredOn == null &&
    (a.status === "DRAFT" ||
      a.status === "AWAITING_SIGNATURE" ||
      a.status === "SCHEDULED" ||
      a.status === "ACTIVE")
  ) {
    options.push({
      key: "cancel-before-delivery",
      title: "Cancel before delivery",
      line: "Review the signing money and refund before cancelling.",
      href: `/desk/agreements/${a.id}/cancel`,
    });
  }
  if (a.status === "ACTIVE") {
    options.push({
      key: "end-today",
      title: "End it today",
      line: "Stops monthly billing now and adds a pickup visit if appliances are still there.",
      confirm: {
        title: `End ${a.customerName}'s rental today?`,
        summary:
          "Monthly billing stops and a pickup visit is added to your To do list if appliances are still at the customer's. This can't be undone.",
        confirmLabel: "End the rental",
      },
    });
  }
  return options;
}
