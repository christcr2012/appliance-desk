type ProgressInput = {
  id: string;
  status: string;
  depositCents: number;
  paidInFullInAdvance: boolean;
  billingStartedAt: Date | null;
  billingBlockedReason: string | null;
  signature: { signedAt: Date | null } | null;
  /** The system queued this renewal because the customer agreed to auto-renew (no signature exists). */
  createdByAutoRenew?: boolean;
  lines: { assignments: unknown[] }[];
  jobs: { id: string; type: string; status: string }[];
};
export function agreementProgress(a: ProgressInput) {
  const signed = Boolean(a.signature?.signedAt);
  const assignmentCount = a.lines.reduce(
    (sum, l) => sum + l.assignments.length,
    0,
  );
  const delivery = a.jobs.find(
    (j) =>
      (j.type === "DELIVERY" || j.type === "INSTALLATION") &&
      j.status === "COMPLETED",
  );
  const scheduledDelivery = a.jobs.find(
    (j) =>
      (j.type === "DELIVERY" || j.type === "INSTALLATION") &&
      (j.status === "SCHEDULED" || j.status === "IN_PROGRESS"),
  );
  const closed = a.status === "ENDED" || a.status === "CANCELLED";
  const billing = a.billingStartedAt
    ? "Started"
    : a.billingBlockedReason
      ? "Blocked — review billing"
      : a.paidInFullInAdvance
        ? "Prepaid recorded; recurring billing does not apply"
        : "Not started";
  const milestones = [
    {
      label: "Signature",
      state: a.createdByAutoRenew
        ? "Renews automatically (the customer agreed to auto-renew)"
        : signed
        ? "Signed"
        : a.status === "AWAITING_SIGNATURE"
          ? "Awaiting signature"
          : "Not signed",
    },
    {
      label: "Payment requirement",
      state:
        a.depositCents > 0
          ? "Deposit required; amount alone does not prove payment"
          : "No security deposit required",
    },
    {
      label: "Equipment",
      state: `${assignmentCount} current appliance assignment${assignmentCount === 1 ? "" : "s"} across ${a.lines.length} line${a.lines.length === 1 ? "" : "s"}`,
    },
    {
      label: "Delivery",
      state: delivery
        ? "Completed visit recorded"
        : scheduledDelivery
          ? "Visit arranged; not completed"
          : "No completed delivery",
    },
    { label: "Billing", state: billing },
  ];
  const next = closed
    ? {
        label: "This agreement is closed. Historical milestones remain below.",
        href: null,
      }
    : a.status === "SCHEDULED"
      ? {
          label: a.createdByAutoRenew
            ? "Automatic renewal. The customer agreed to auto-renew, so it starts on its start date and continues month to month; until then the equipment stays on the current rental. It is cancelled automatically if they turn auto-renew off. Nothing to do now."
            : "Signed renewal. It starts on its start date; until then the equipment stays on the current rental. Nothing to do now.",
          href: null,
        }
    : !a.lines.length
      ? { label: "Add appliance lines to this draft.", href: null }
      : !signed
        ? {
            label:
              a.status === "AWAITING_SIGNATURE"
                ? "Follow up on the pending signature."
                : "Review this draft and send it for signature.",
            href: null,
          }
        : !assignmentCount && !delivery
          ? { label: "Assign equipment before arranging delivery.", href: null }
          : !delivery
            ? {
                label: scheduledDelivery
                  ? "Open the delivery visit."
                  : "Arrange delivery for the signed agreement.",
                href: scheduledDelivery
                  ? `/desk/jobs/${scheduledDelivery.id}`
                  : `/desk/jobs/new?agreementId=${a.id}`,
              }
            : a.billingBlockedReason
              ? {
                  label:
                    "Review the billing blocker before treating this rental as billed.",
                  href: "/desk/today",
                }
              : {
                  label: "Review rental details and customer billing history.",
                  href: null,
                };
  return { milestones, next };
}
