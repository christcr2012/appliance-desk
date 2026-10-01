import { beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
const m = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: m.refresh }),
}));
vi.mock("@/app/account/maintenance/actions", () => ({
  createMaintenanceRequestAction: m.save,
}));
vi.mock("@/components/photo-upload-field", () => ({
  PhotoUploadField: () => null,
}));
import { NewRequestForm } from "@/app/account/maintenance/new-request-form";
beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("preserves pickup text after failure and confirms only a successful existing request action", async () => {
  m.save
    .mockRejectedValueOnce(new Error("network"))
    .mockResolvedValueOnce({ status: "success" });
  render(
    <NewRequestForm
      customerId="c1"
      appliances={[]}
      initialProblem="Pickup request: "
      requestTitle="Request pickup"
    />,
  );
  const text = "Pickup request: collect my washer at my home next week";
  fireEvent.change(screen.getByLabelText("What's going on?"), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole("button", { name: "Submit request" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("not confirmed"),
  );
  expect(
    (screen.getByLabelText("What's going on?") as HTMLTextAreaElement).value,
  ).toBe(text);
  expect(m.refresh).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByRole("button", { name: "Submit request" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Submit request" }));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain("next steps"),
  );
  expect(m.save).toHaveBeenLastCalledWith({
    problem: text,
    applianceId: "",
    priority: "NORMAL",
    photoUrls: [],
  });
});
