import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ save: vi.fn(), session: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireSession: m.session }));
vi.mock("@/domains/portal", () => ({ createMaintenanceRequestForUser: m.save }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
import { createMaintenanceRequestAction } from "@/app/account/maintenance/actions";
beforeEach(() => {
  vi.resetAllMocks();
  m.session.mockResolvedValue({ user: { id: "session-user" } });
  m.save.mockResolvedValue({ id: "saved-request" });
});
it.each(["", "  ", "Pickup request:", " Pickup request: \n ", "PICKUP REQUEST: "])(
  "rejects a detail-free request %j before saving or refreshing", async (problem) => {
    expect(await createMaintenanceRequestAction({ problem })).toMatchObject({ status: "error" });
    expect(m.save).not.toHaveBeenCalled();
    expect(m.revalidate).not.toHaveBeenCalled();
  },
);
it.each(["Pickup request: Washer at 123 Test Street next week", "Washer leaking"])(
  "saves a described request using session identity: %s", async (problem) => {
    expect(await createMaintenanceRequestAction({ problem, customerId: "other-customer" })).toEqual({ status: "success" });
    expect(m.save).toHaveBeenCalledWith("session-user", expect.objectContaining({ problem }));
    expect(m.revalidate).toHaveBeenCalledWith("/account/maintenance");
  },
);
