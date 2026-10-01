import { beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
const m = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("@/app/desk/settings/actions", () => ({
  updateSettingsSectionAction: m.save,
  updateSettingsAction: m.save,
}));
import { SettingsForm } from "@/app/desk/settings/settings-form";
const defaults = {
  publicBusinessName: "Original",
  publicPhone: "9705550100",
  publicEmail: "owner@example.test",
  publicAddress: "Colorado",
} as Parameters<typeof SettingsForm>[0]["defaultValues"];
beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("retains typed edits on rejected save and lets the owner retry", async () => {
  m.save
    .mockRejectedValueOnce(new Error("network"))
    .mockResolvedValueOnce({ status: "success" });
  render(<SettingsForm section="profile" defaultValues={defaults} />);
  fireEvent.change(screen.getByLabelText("Business name"), {
    target: { value: "Edited" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save this section" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain(
      "still in the form",
    ),
  );
  expect(
    (screen.getByLabelText("Business name") as HTMLInputElement).value,
  ).toBe("Edited");
  expect(screen.queryByLabelText("Delivery fee")).toBeNull();
  await waitFor(() => expect(screen.getByRole("button", { name: "Save this section" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Save this section" }));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe("Settings saved."),
  );
  expect(m.save).toHaveBeenLastCalledWith(
    "profile",
    expect.objectContaining({ publicBusinessName: "Edited" }),
  );
});
