import { expect, it } from "vitest";
import { agreementProgress } from "@/domains/agreements/progress";
const base = {
  id: "a1",
  status: "ACTIVE",
  depositCents: 15000,
  paidInFullInAdvance: false,
  billingStartedAt: null,
  billingBlockedReason: null,
  signature: { signedAt: new Date() },
  lines: [{ assignments: [{}] }],
  jobs: [],
};
it("signed does not imply delivered, billed or deposit paid", () => {
  const p = agreementProgress(base);
  expect(p.milestones).toContainEqual({ label: "Signature", state: "Signed" });
  expect(p.milestones).toContainEqual({
    label: "Delivery",
    state: "No completed delivery",
  });
  expect(p.milestones).toContainEqual({
    label: "Billing",
    state: "Not started",
  });
  expect(
    p.milestones.find((m) => m.label === "Payment requirement")?.state,
  ).toContain("does not prove payment");
  expect(p.next.href).toBe("/desk/jobs/new?agreementId=a1");
});
it("completed delivery does not imply billing started", () => {
  const p = agreementProgress({
    ...base,
    jobs: [{ id: "j1", type: "DELIVERY", status: "COMPLETED" }],
    billingBlockedReason: "No saved payment method",
  });
  expect(p.milestones).toContainEqual({
    label: "Delivery",
    state: "Completed visit recorded",
  });
  expect(p.milestones).toContainEqual({
    label: "Billing",
    state: "Blocked — review billing",
  });
  expect(p.next.href).toBe("/desk/today");
});
it("cancelled delivery and scheduled maintenance do not satisfy delivery", () => {
  const p = agreementProgress({
    ...base,
    jobs: [
      { id: "j1", type: "DELIVERY", status: "CANCELLED" },
      { id: "j2", type: "MAINTENANCE_VISIT", status: "SCHEDULED" },
    ],
  });
  expect(p.milestones).toContainEqual({
    label: "Delivery",
    state: "No completed delivery",
  });
});
it("prepaid is a recorded fact, not a successful subscription", () => {
  const p = agreementProgress({ ...base, paidInFullInAdvance: true });
  expect(p.milestones.find((m) => m.label === "Billing")?.state).toMatch(
    /Prepaid recorded/,
  );
});
it("closed agreements never suggest scheduling a new delivery", () => {
  expect(agreementProgress({ ...base, status: "ENDED" }).next.href).toBeNull();
  expect(agreementProgress({ ...base, status: "SCHEDULED", lines: [{ assignments: [] }], jobs: [] }).next.label).toMatch(
    /equipment stays on the current rental/,
  );
});
it("signed but unassigned equipment does not suggest a delivery before assignment", () => {
  expect(
    agreementProgress({ ...base, lines: [{ assignments: [] }] }).next.label,
  ).toContain("Assign equipment");
});
