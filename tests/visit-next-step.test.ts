import { describe, expect, it } from "vitest";
import { visitNextStep, type NextStepJob } from "@/domains/jobs/next-step";

const NOW = new Date("2026-10-30T16:00:00Z"); // Friday 10:00 AM Denver
const TODAY = new Date("2026-10-30T19:00:00Z"); // Friday 1:00 PM Denver
const TOMORROW = new Date("2026-10-31T19:00:00Z");

const base: NextStepJob = {
  status: "SCHEDULED",
  type: "DELIVERY",
  scheduledAt: TOMORROW,
  assignedToUserId: "staff-1",
};

describe("visitNextStep", () => {
  it("no time yet comes first", () => {
    expect(visitNextStep({ ...base, scheduledAt: null, assignedToUserId: null }, { role: "OWNER" }, NOW)).toEqual({
      label: "This visit has no time yet.",
      cta: "Set a time",
      href: "#schedule",
    });
  });

  it("no person is an owner/admin step only; staff fall through", () => {
    const job = { ...base, assignedToUserId: null };
    expect(visitNextStep(job, { role: "ADMIN" }, NOW)?.cta).toBe("Choose who goes");
    expect(visitNextStep(job, { role: "STAFF" }, NOW)).toBeNull();
  });

  it("a visit today asks to start it; under way asks to finish it", () => {
    expect(visitNextStep({ ...base, scheduledAt: TODAY }, { role: "STAFF" }, NOW)).toEqual({
      label: "This visit is today.",
      cta: "Start the visit",
      href: "#finish",
    });
    expect(
      visitNextStep({ ...base, status: "IN_PROGRESS", scheduledAt: TODAY }, { role: "STAFF" }, NOW)?.cta,
    ).toBe("Finish the visit");
  });

  it("a partial completion points at the follow-up task", () => {
    const step = visitNextStep(
      { ...base, status: "COMPLETED", hasOpenFollowUp: true },
      { role: "STAFF" },
      NOW,
    );
    expect(step).toEqual({
      label: "Some items weren't done — a follow-up task was added.",
      cta: "Open tasks",
      href: "/desk/tasks",
    });
  });

  it("a closed rental with a deposit left is the owner's deposit step, never staff's", () => {
    const job: NextStepJob = {
      status: "COMPLETED",
      type: "REMOVAL",
      scheduledAt: TODAY,
      assignedToUserId: "staff-1",
      rentalClosed: true,
      depositId: "dep-1",
    };
    expect(visitNextStep(job, { role: "OWNER" }, NOW)).toEqual({
      label: "The rental is closed. The deposit still needs settling.",
      cta: "Settle the deposit",
      href: "/desk/billing/deposits/dep-1",
    });
    expect(visitNextStep(job, { role: "STAFF" }, NOW)).toBeNull();
    expect(visitNextStep({ ...job, depositId: null }, { role: "OWNER" }, NOW)).toBeNull();
  });

  it("a settled or future visit has no step", () => {
    expect(visitNextStep(base, { role: "OWNER" }, NOW)).toBeNull();
    expect(visitNextStep({ ...base, status: "CANCELLED" }, { role: "OWNER" }, NOW)).toBeNull();
  });
});
