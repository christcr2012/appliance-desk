import { describe, expect, it } from "vitest";
import {
  rentalNextStep,
  type RentalNextStepInput,
} from "@/domains/agreements/next-step";

// AR-4a / RENTALS spec section 3: every row of the next-step table.
const now = new Date("2026-10-28T12:00:00Z");

function input(
  patch: Partial<RentalNextStepInput["agreement"]> = {},
  extras: Partial<RentalNextStepInput> = {},
): RentalNextStepInput {
  return {
    agreement: {
      id: "agr-1",
      status: "ACTIVE",
      startDate: new Date("2026-10-01T00:00:00Z"),
      endDate: null,
      termMonths: null,
      depositCents: 0,
      paidInFullInAdvance: false,
      billingStartedAt: new Date("2026-10-02T00:00:00Z"),
      billingBlockedReason: null,
      signature: { signedAt: new Date("2026-09-30T00:00:00Z") },
      lines: [{ assignments: [{}] }],
      jobs: [{ id: "job-1", type: "DELIVERY", status: "COMPLETED" }],
      ...patch,
    },
    cancellation: null,
    endingSoon: false,
    now,
    ...extras,
  };
}

describe("rentalNextStep", () => {
  it("refund waiting on an open rental opens the cancellation", () => {
    const step = rentalNextStep(
      input({}, {
        cancellation: { refundDueCents: 4500, refundState: "APPROVED" },
      }),
    );
    expect(step?.title).toBe("Refund $45.00 is waiting");
    expect(step?.action).toEqual({
      kind: "link",
      label: "Open cancellation",
      href: "/desk/agreements/agr-1/cancel",
    });
  });

  it("a pending external refund needs matching, even on a cancelled rental", () => {
    const step = rentalNextStep(
      input(
        { status: "CANCELLED" },
        { cancellation: { refundDueCents: 4500, refundState: "PENDING_EXTERNAL_REFUND" } },
      ),
    );
    expect(step?.title).toBe("A returned refund needs matching");
    expect(step?.action).toEqual({
      kind: "link",
      label: "Match the refund",
      href: "/desk/agreements/agr-1/refund",
    });
  });

  it("a settled refund shows no card on a closed rental", () => {
    expect(
      rentalNextStep(
        input(
          { status: "ENDED" },
          { cancellation: { refundDueCents: 4500, refundState: "RETURNED_MANUAL_RECORDED" } },
        ),
      ),
    ).toBeNull();
  });

  it("closed rentals have no next step", () => {
    expect(rentalNextStep(input({ status: "ENDED" }))).toBeNull();
    expect(rentalNextStep(input({ status: "CANCELLED" }))).toBeNull();
  });

  it("a scheduled rental just says when it starts", () => {
    const step = rentalNextStep(
      input({ status: "SCHEDULED", startDate: new Date("2026-11-04T12:00:00Z") }),
    );
    expect(step?.title).toBe("Starts Nov 4");
    expect(step?.action).toBeNull();
  });

  it("a draft with no lines goes back to the builder", () => {
    const step = rentalNextStep(input({ status: "DRAFT", lines: [], signature: null }));
    expect(step?.title).toBe("Add appliances");
    expect(step?.action).toEqual({
      kind: "link",
      label: "Resume rental builder",
      href: "/desk/agreements/new?draftId=agr-1",
    });
  });

  it("a draft with lines is ready to send for signature", () => {
    const step = rentalNextStep(input({ status: "DRAFT", signature: null }));
    expect(step?.title).toBe("Ready to send for signature");
    expect(step?.action).toEqual({ kind: "send-for-signature", label: "Send for signature" });
  });

  it("awaiting signature offers the reminder", () => {
    const step = rentalNextStep(
      input({ status: "AWAITING_SIGNATURE", signature: { signedAt: null } }),
    );
    expect(step?.title).toBe("Waiting for the customer to sign");
    expect(step?.action).toEqual({ kind: "reminder", label: "Send a reminder…" });
  });

  it("signed with no appliances picked says pick them", () => {
    const step = rentalNextStep(input({ lines: [{ assignments: [] }], jobs: [] }));
    expect(step?.title).toBe("Pick the appliances");
    expect(step?.action?.kind).toBe("link");
  });

  it("signed, not delivered, visit booked opens the visit", () => {
    const step = rentalNextStep(
      input({ jobs: [{ id: "job-9", type: "DELIVERY", status: "SCHEDULED" }] }),
    );
    expect(step?.title).toBe("Delivery is booked");
    expect(step?.action).toEqual({
      kind: "link",
      label: "Open the visit",
      href: "/desk/jobs/job-9",
    });
  });

  it("signed, not delivered, no visit schedules the delivery", () => {
    const step = rentalNextStep(input({ jobs: [] }));
    expect(step?.title).toBe("Schedule the delivery");
    expect(step?.action).toEqual({
      kind: "link",
      label: "Schedule delivery",
      href: "/desk/jobs/new?agreementId=agr-1",
    });
  });

  it("blocked billing points at Today money", () => {
    const step = rentalNextStep(
      input({ billingBlockedReason: "card failed", billingStartedAt: null }),
    );
    expect(step?.title).toBe("Monthly billing isn't running");
    expect(step?.action).toEqual({
      kind: "link",
      label: "See why",
      href: "/desk/today?group=money",
    });
  });

  it("an active fixed-term rental ending soon asks for a decision", () => {
    const step = rentalNextStep(
      input(
        { termMonths: 12, endDate: new Date("2026-11-20T12:00:00Z") },
        { endingSoon: true },
      ),
    );
    expect(step?.title).toBe("Ends Nov 20 — decide what's next");
    expect(step?.action).toEqual({ kind: "end-sheet", label: "Decide…" });
  });

  it("a healthy active rental has no card", () => {
    expect(rentalNextStep(input())).toBeNull();
  });
});
