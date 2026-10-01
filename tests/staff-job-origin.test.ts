import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ role: "STAFF", linked: vi.fn(), update: vi.fn(), invalidate: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireRole: async () => ({ user: { id: "actor", role: m.role } }) }));
vi.mock("@/lib/prisma", () => ({ prisma: { jobAppliance: { findFirst: m.linked } } }));
vi.mock("@/domains/inventory", () => ({ updateApplianceStatus: m.update }));
vi.mock("next/cache", () => ({ revalidatePath: m.invalidate }));
import { updateApplianceStatusFromJobAction } from "@/app/desk/jobs/actions";
beforeEach(() => { vi.clearAllMocks(); m.role = "STAFF"; m.update.mockResolvedValue({}); });
it("denies staff calls without an originating job before querying or writing", async () => {
  expect((await updateApplianceStatusFromJobAction("unit", "RENTED")).status).toBe("error");
  expect(m.linked).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled();
});
it("denies an unrelated appliance and permits a linked appliance with actor attribution", async () => {
  m.linked.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "link" });
  expect((await updateApplianceStatusFromJobAction("other", "RENTED", "job")).status).toBe("error");
  expect(m.update).not.toHaveBeenCalled();
  expect(await updateApplianceStatusFromJobAction("unit", "RENTED", "job")).toEqual({ status: "success" });
  expect(m.linked).toHaveBeenLastCalledWith({ where: { jobId: "job", applianceId: "unit" }, select: { id: true } });
  expect(m.update).toHaveBeenCalledWith("actor", "unit", "RENTED");
  expect(m.invalidate).toHaveBeenCalledWith("/desk/jobs/job");
});
it("preserves owner inventory authority without a job-origin lookup", async () => {
  m.role = "OWNER";
  expect((await updateApplianceStatusFromJobAction("unit", "MAINTENANCE")).status).toBe("success");
  expect(m.linked).not.toHaveBeenCalled();
});
it("rejects invalid status and failed membership reads before mutation", async () => {
  expect((await updateApplianceStatusFromJobAction("unit", "bogus", "job")).status).toBe("error");
  expect(m.linked).not.toHaveBeenCalled();
  m.linked.mockRejectedValueOnce(new Error("Database unavailable"));
  expect(await updateApplianceStatusFromJobAction("unit", "RENTED", "job")).toEqual({ status: "error", message: "Database unavailable" });
  expect(m.update).not.toHaveBeenCalled();
});
