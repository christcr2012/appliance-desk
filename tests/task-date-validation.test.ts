import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  role: vi.fn(),
  create: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ requireRole: m.role }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
vi.mock("@/domains/tasks", () => ({ createTask: m.create }));
import { createTaskAction } from "@/app/desk/tasks/actions";
beforeEach(() => {
  vi.resetAllMocks();
  m.role.mockResolvedValue({ user: { id: "staff" } });
});
it.each(["2026-02-30", "2026-13-01", "yesterday", "2026-09-30T00:00:00Z"])(
  "rejects invalid date-only value %s without writes",
  async (dueDate) => {
    expect(
      (await createTaskAction({ note: "Call customer", dueDate })).status,
    ).toBe("error");
    expect(m.create).not.toHaveBeenCalled();
  },
);
it("stores the chosen calendar date unchanged and invalidates Today and Tasks", async () => {
  expect(
    (await createTaskAction({ note: "Call customer", dueDate: "2026-09-30" }))
      .status,
  ).toBe("success");
  expect(m.create).toHaveBeenCalledWith(
    expect.objectContaining({ dueDate: "2026-09-30", priority: "NORMAL" }),
  );
  expect(m.revalidate).toHaveBeenCalledWith("/desk/today");
  expect(m.revalidate).toHaveBeenCalledWith("/desk/tasks");
});
