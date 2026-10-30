import { describe, expect, it } from "vitest";
import { handoffToast, type JobHandoff } from "@/domains/jobs/handoff";

const base: JobHandoff = {
  type: "DELIVERY",
  outcome: "COMPLETE",
  replayed: false,
  startedBilling: false,
  rentalClosed: false,
  depositId: null,
  agreementId: "agr-1",
  maintenanceRequestId: null,
};

describe("handoffToast", () => {
  it("a replayed completion just says it was already saved", () => {
    expect(handoffToast({ ...base, replayed: true, startedBilling: true }, "OWNER")).toEqual({
      message: "Already saved.",
    });
  });

  it("a partial completion points at the follow-up task, for every role", () => {
    const toast = handoffToast({ ...base, outcome: "PARTIAL" }, "STAFF");
    expect(toast.message).toBe("Saved. Some items weren't done — a follow-up task was added.");
    expect(toast.action).toEqual({ label: "Open tasks", href: "/desk/tasks" });
  });

  it("a delivery that starts billing says so to owner/admin, with the rental one tap away", () => {
    const toast = handoffToast({ ...base, startedBilling: true }, "OWNER");
    expect(toast.message).toBe("Delivered. Monthly billing starts automatically.");
    expect(toast.action).toEqual({ label: "Open rental", href: "/desk/agreements/agr-1" });
  });

  it("staff never hear about money: the billing line collapses to 'Delivered.'", () => {
    const toast = handoffToast({ ...base, startedBilling: true }, "STAFF");
    expect(toast.message).toBe("Delivered.");
  });

  it("a delivery without billing just says delivered", () => {
    expect(handoffToast(base, "ADMIN").message).toBe("Delivered.");
    expect(handoffToast({ ...base, type: "INSTALLATION" }, "OWNER").message).toBe("Delivered.");
  });

  it("a pickup that closes the rental with a deposit left sends the owner to settle it", () => {
    const toast = handoffToast(
      { ...base, type: "REMOVAL", rentalClosed: true, depositId: "dep-1" },
      "OWNER",
    );
    expect(toast.message).toBe("Picked up. The rental is closed — settle the deposit next.");
    expect(toast.action).toEqual({ label: "Settle deposit", href: "/desk/billing/deposits/dep-1" });
  });

  it("staff get the closed-rental line without the deposit step", () => {
    const toast = handoffToast(
      { ...base, type: "REMOVAL", rentalClosed: true, depositId: "dep-1" },
      "STAFF",
    );
    expect(toast).toEqual({ message: "Picked up. The rental is closed." });
  });

  it("a closed rental with no deposit left just says so", () => {
    expect(
      handoffToast({ ...base, type: "REMOVAL", rentalClosed: true }, "OWNER"),
    ).toEqual({ message: "Picked up. The rental is closed." });
  });

  it("a pickup with appliances still out says that, with the rental one tap away", () => {
    const toast = handoffToast({ ...base, type: "REMOVAL", rentalClosed: false }, "OWNER");
    expect(toast.message).toBe("Picked up. Other appliances are still at the customer's.");
    expect(toast.action).toEqual({ label: "Open rental", href: "/desk/agreements/agr-1" });
  });

  it("a finished repair visit links back to the repair request when there is one", () => {
    const toast = handoffToast(
      { ...base, type: "MAINTENANCE_VISIT", agreementId: null, maintenanceRequestId: "req-1" },
      "STAFF",
    );
    expect(toast.message).toBe("Repair visit finished.");
    expect(toast.action).toEqual({ label: "Open repair request", href: "/desk/maintenance/req-1" });
    expect(
      handoffToast({ ...base, type: "MAINTENANCE_VISIT", agreementId: null }, "OWNER").action,
    ).toBeUndefined();
  });
});
