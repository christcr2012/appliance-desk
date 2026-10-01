import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ guard: vi.fn(), create: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireRole: m.guard }));
vi.mock("@/domains/staff", () => ({ createStaffAccount: m.create }));
vi.mock("@/domains/settings", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: m.refresh }));
import { createStaffAccountAction } from "@/app/desk/settings/actions";
beforeEach(() => { vi.clearAllMocks(); m.guard.mockResolvedValue({ user: { id: "owner" } }); });
it.each([true, false])("preserves provider acceptance %s on successful saved accounts", async (activationEmailSent) => {
  m.create.mockResolvedValue({ account: { id: "staff" }, activationEmailSent });
  expect(await createStaffAccountAction({ name: "Jamie", email: "jamie@example.com" })).toEqual({ status: "success", activationEmailSent });
  expect(m.refresh).toHaveBeenCalledWith("/desk/settings");
});
it("denies staff before account creation", async () => {
  m.guard.mockRejectedValue(new Error("denied"));
  await expect(createStaffAccountAction({ name: "Jamie", email: "jamie@example.com" })).rejects.toThrow("denied");
  expect(m.create).not.toHaveBeenCalled();
});
