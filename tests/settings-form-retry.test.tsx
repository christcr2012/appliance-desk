import { beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
const m = vi.hoisted(() => ({ save: vi.fn(), preview: vi.fn() }));
vi.mock("@/app/desk/settings/actions", () => ({
  updateSettingsSectionAction: m.save,
  previewSettingsSectionAction: m.preview,
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
  render(<SettingsForm section="profile" defaultValues={defaults} revision="rev-1" />);
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
    "rev-1",
  );
});

it("shows the reload message when someone else saved first, and keeps what was typed", async () => {
  m.save.mockResolvedValueOnce({ status: "error", message: "Someone else changed these settings. Reload the page." });
  render(<SettingsForm section="profile" defaultValues={defaults} revision="rev-1" />);
  fireEvent.change(screen.getByLabelText("Business name"), { target: { value: "Mine" } });
  fireEvent.click(screen.getByRole("button", { name: "Save this section" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Reload the page"));
  expect((screen.getByLabelText("Business name") as HTMLInputElement).value).toBe("Mine");
});

it("uses the fresh fingerprint for a second save from the same open page", async () => {
  m.save.mockResolvedValue({ status: "success", revision: "rev-2" });
  render(<SettingsForm section="profile" defaultValues={defaults} revision="rev-1" />);
  fireEvent.click(screen.getByRole("button", { name: "Save this section" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Settings saved."));
  await waitFor(() => expect(screen.getByRole("button", { name: "Save this section" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Save this section" }));
  await waitFor(() => expect(m.save).toHaveBeenCalledTimes(2));
  expect(m.save).toHaveBeenNthCalledWith(1, "profile", expect.anything(), "rev-1");
  expect(m.save).toHaveBeenNthCalledWith(2, "profile", expect.anything(), "rev-2");
});

it("previews the changes without saving anything", async () => {
  m.preview.mockResolvedValue({
    status: "preview",
    nothingToSave: false,
    lines: [{ key: "publicBusinessName", label: "Public business name", from: "Original", to: "Edited", effect: "Shown on the public website." }],
  });
  render(<SettingsForm section="profile" defaultValues={defaults} revision="rev-1" />);
  fireEvent.click(screen.getByRole("button", { name: "Preview changes" }));
  const panel = await screen.findByLabelText("What saving would change");
  expect(panel.textContent).toContain("Original → Edited");
  expect(panel.textContent).toContain("nothing is saved yet");
  expect(m.save).not.toHaveBeenCalled();
});
