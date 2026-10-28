// AR-4a (RENTALS spec section 3): the rental record's next-step card, in
// short words. Pure: built on the same conditions as agreementProgress()
// (which is NOT changed — it is used elsewhere) plus the record's
// cancellation and ending facts the page already loads.
import { formatMoney } from "@/lib/money-ui";
import { formatShortDate } from "@/lib/business-date";
import { agreementProgress } from "./progress";

export type RentalNextStepAction =
  | { kind: "link"; label: string; href: string }
  | { kind: "send-for-signature"; label: string }
  | { kind: "reminder"; label: string }
  | { kind: "end-sheet"; label: string };

export type RentalNextStep = {
  title: string;
  infoTip?: string;
  action: RentalNextStepAction | null;
} | null;

export type RentalNextStepInput = {
  agreement: {
    id: string;
    status: string;
    startDate: Date | null;
    endDate: Date | null;
    termMonths: number | null;
    depositCents: number;
    paidInFullInAdvance: boolean;
    billingStartedAt: Date | null;
    billingBlockedReason: string | null;
    signature: { signedAt: Date | null } | null;
    createdByAutoRenew?: boolean;
    lines: { assignments: unknown[] }[];
    jobs: { id: string; type: string; status: string }[];
  };
  /** The pre-delivery cancellation row, when one exists. */
  cancellation: { refundDueCents: number; refundState: string } | null;
  /** ACTIVE fixed-term rental inside the ending notice window with no
   * renewal drafted and no ending already set (the caller computes this
   * with the same rule as the To do RENTAL_ENDING_SOON item). */
  endingSoon: boolean;
  now: Date;
};

const SETTLED_REFUND_STATES = new Set([
  "RETURNED_STRIPE_TEST_VERIFIED",
  "RETURNED_MANUAL_RECORDED",
  "NOT_REQUIRED",
]);

export function rentalNextStep(input: RentalNextStepInput): RentalNextStep {
  const a = input.agreement;
  const id = a.id;
  const cancellation = input.cancellation;

  // A refund that is still owed comes first — unless the rental is still
  // open, where finishing the cancellation itself is the next step.
  if (
    cancellation &&
    cancellation.refundDueCents > 0 &&
    !SETTLED_REFUND_STATES.has(cancellation.refundState) &&
    cancellation.refundState !== "PENDING_EXTERNAL_REFUND" &&
    a.status !== "CANCELLED"
  ) {
    return {
      title: `Refund ${formatMoney(cancellation.refundDueCents)} is waiting`,
      action: {
        kind: "link",
        label: "Open cancellation",
        href: `/desk/agreements/${id}/cancel`,
      },
    };
  }
  if (cancellation?.refundState === "PENDING_EXTERNAL_REFUND") {
    return {
      title: "A returned refund needs matching",
      action: {
        kind: "link",
        label: "Match the refund",
        href: `/desk/agreements/${id}/refund`,
      },
    };
  }

  const closed = a.status === "ENDED" || a.status === "CANCELLED";
  if (closed) return null;

  const progress = agreementProgress(a);

  if (a.status === "SCHEDULED") {
    return {
      title: a.startDate
        ? `Starts ${formatShortDate(a.startDate, input.now)}`
        : "Starts later",
      infoTip: progress.next.label,
      action: null,
    };
  }
  if (a.status === "DRAFT" && a.lines.length === 0) {
    return {
      title: "Add appliances",
      action: {
        kind: "link",
        label: "Resume rental builder",
        href: `/desk/agreements/new?draftId=${id}`,
      },
    };
  }
  if (a.status === "DRAFT") {
    return {
      title: "Ready to send for signature",
      action: { kind: "send-for-signature", label: "Send for signature" },
    };
  }
  if (a.status === "AWAITING_SIGNATURE") {
    return {
      title: "Waiting for the customer to sign",
      action: { kind: "reminder", label: "Send a reminder…" },
    };
  }

  const signed = Boolean(a.signature?.signedAt);
  const assignmentCount = a.lines.reduce((sum, l) => sum + l.assignments.length, 0);
  const delivery = a.jobs.find(
    (j) => (j.type === "DELIVERY" || j.type === "INSTALLATION") && j.status === "COMPLETED",
  );
  const scheduledDelivery = a.jobs.find(
    (j) =>
      (j.type === "DELIVERY" || j.type === "INSTALLATION") &&
      (j.status === "SCHEDULED" || j.status === "IN_PROGRESS"),
  );

  if (signed && assignmentCount === 0 && !delivery) {
    const href = progress.actions["Equipment"]?.href ?? `/desk/agreements/new?draftId=${id}`;
    return {
      title: "Pick the appliances",
      action: { kind: "link", label: "Pick appliances", href },
    };
  }
  if (signed && !delivery && scheduledDelivery) {
    return {
      title: "Delivery is booked",
      action: {
        kind: "link",
        label: "Open the visit",
        href: `/desk/jobs/${scheduledDelivery.id}`,
      },
    };
  }
  if (signed && !delivery) {
    return {
      title: "Schedule the delivery",
      action: {
        kind: "link",
        label: "Schedule delivery",
        href: `/desk/jobs/new?agreementId=${id}`,
      },
    };
  }
  if (a.billingBlockedReason) {
    return {
      title: "Monthly billing isn't running",
      action: { kind: "link", label: "See why", href: "/desk/today?group=money" },
    };
  }
  if (a.status === "ACTIVE" && a.termMonths != null && input.endingSoon) {
    return {
      title: a.endDate
        ? `Ends ${formatShortDate(a.endDate, input.now)} — decide what's next`
        : "Decide what's next",
      action: { kind: "end-sheet", label: "Decide…" },
    };
  }
  return null;
}
