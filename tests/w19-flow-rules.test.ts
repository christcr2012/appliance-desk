import { describe, expect, it } from "vitest";
import { agreementProgress } from "../src/domains/agreements/progress";
import { unreviewedMaintenanceRequestException, UNREVIEWED_MAINTENANCE_REQUEST_DAYS } from "../src/domains/exceptions/rules";

const base = {
  id: "a1", status: "AWAITING_SIGNATURE", depositCents: 15000, paidInFullInAdvance: false, billingStartedAt: null,
  billingBlockedReason: null, signature: { signedAt: null }, lines: [{ assignments: [] }], jobs: [],
};

describe("W-19 rules", () => {
  it("a repair request is on To do at once, named for the customer", () => {
    expect(UNREVIEWED_MAINTENANCE_REQUEST_DAYS).toBe(0);
    expect(unreviewedMaintenanceRequestException({ id: "r1", openedAt: new Date(), customerName: "Pat Renter", problem: "Leaks" }))
      .toMatchObject({ title: "Review Pat Renter's repair request", href: "/desk/maintenance/r1" });
  });
  it("every unfinished step of the progress card has a button to a page that exists", () => {
    const { actions } = agreementProgress(base);
    expect(Object.keys(actions).sort()).toEqual(["Billing", "Delivery", "Equipment", "Payment requirement", "Signature"]);
    expect(actions["Signature"].href).toBe("/desk/communications");
    expect(actions["Delivery"].href).toBe("/desk/jobs/new?agreementId=a1");
    for (const action of Object.values(actions)) expect(action.href.startsWith("/desk/")).toBe(true);
  });
  it("a finished step has no button and a closed agreement has none at all", () => {
    const done = agreementProgress({ ...base, status: "ACTIVE", signature: { signedAt: new Date() }, depositCents: 0, billingStartedAt: new Date(),
      lines: [{ assignments: [{}] }], jobs: [{ id: "j1", type: "DELIVERY", status: "COMPLETED" }] });
    expect(done.actions).toEqual({});
    expect(agreementProgress({ ...base, status: "ENDED" }).actions).toEqual({});
  });
  it("a draft's signature button resumes the builder", () => {
    expect(agreementProgress({ ...base, status: "DRAFT" }).actions["Signature"].href).toBe("/desk/agreements/new?draftId=a1");
  });
});
