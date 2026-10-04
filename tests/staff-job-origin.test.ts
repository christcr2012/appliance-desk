import { beforeEach, expect, it, vi } from "vitest";

// The action hands staff changes to the guarded domain function WITH the originating job id. Whether that job
// and appliance are allowed is decided inside the domain transaction and tested against Postgres
// (job-scope-integration.test.ts, "scope-appliance-status").
const m = vi.hoisted(() => ({
  role: "STAFF",
  update: vi.fn(),
  guardedUpdate: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireRole: async () => ({ user: { id: "actor", role: m.role } }),
}));
vi.mock("@/domains/inventory", () => ({ updateApplianceStatus: m.update }));
vi.mock("@/domains/inventory/guarded-status", () => ({
  updateApplianceStatusAsTeamActor: m.guardedUpdate,
}));
vi.mock("next/cache", () => ({ revalidatePath: m.invalidate }));

import { updateApplianceStatusFromJobAction } from "@/app/desk/jobs/actions";

beforeEach(() => {
  vi.clearAllMocks();
  m.role = "STAFF";
  m.update.mockResolvedValue({});
  m.guardedUpdate.mockResolvedValue({});
});

it("passes the originating job to the guarded staff path and never to the owner path", async () => {
  expect(await updateApplianceStatusFromJobAction("unit", "RENTED", "job")).toEqual({ status: "success" });
  expect(m.guardedUpdate).toHaveBeenCalledWith("actor", "unit", "RENTED", "job");
  expect(m.update).not.toHaveBeenCalled();
  expect(m.invalidate).toHaveBeenCalledWith("/desk/jobs/job");
});

it("shows the domain's refusal to the person and changes nothing", async () => {
  m.guardedUpdate.mockRejectedValueOnce(new Error("This appliance is not linked to the originating job."));
  expect(await updateApplianceStatusFromJobAction("other", "RENTED", "job")).toEqual({
    status: "error",
    message: "This appliance is not linked to the originating job.",
  });
  expect(m.update).not.toHaveBeenCalled();
});

it("preserves owner inventory authority", async () => {
  m.role = "OWNER";

  expect((await updateApplianceStatusFromJobAction("unit", "MAINTENANCE")).status).toBe("success");
  expect(m.guardedUpdate).not.toHaveBeenCalled();
  expect(m.update).toHaveBeenCalledWith("actor", "unit", "MAINTENANCE");
});

it("rejects an invalid status before any change", async () => {
  expect((await updateApplianceStatusFromJobAction("unit", "bogus", "job")).status).toBe("error");
  expect(m.guardedUpdate).not.toHaveBeenCalled();
  expect(m.update).not.toHaveBeenCalled();
});
