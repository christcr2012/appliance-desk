import { beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ upload: vi.fn(), submit: vi.fn(), refresh: vi.fn() }));
vi.mock("@vercel/blob/client", () => ({ upload: mocks.upload }));
vi.mock("@/app/account/maintenance/actions", () => ({ createMaintenanceRequestAction: mocks.submit }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
import { NewRequestForm } from "@/app/account/maintenance/new-request-form";

beforeEach(() => {
  cleanup();
  vi.resetAllMocks();
  mocks.upload.mockResolvedValue({ url: "https://example.test/photo.jpg" });
  mocks.submit.mockResolvedValue({ status: "success" });
});

it("uploads into the server-supplied customer folder and submits the uploaded photo", async () => {
  render(<NewRequestForm customerId="customer-1" appliances={[]} />);
  const file = new File(["photo"], "Washer 1.jpg", { type: "image/jpeg" });
  fireEvent.change(screen.getByLabelText("Add a photo"), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Remove this photo" })).toBeVisible());
  expect(mocks.upload).toHaveBeenCalledWith("maintenance-requests/customer-1/Washer 1.jpg", file, {
    access: "public", handleUploadUrl: "/api/uploads/photo",
  });
  fireEvent.change(screen.getByLabelText("What's going on?"), { target: { value: "Washer leaks" } });
  fireEvent.submit(screen.getByRole("button", { name: /submit/i }).closest("form")!);
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({
    problem: "Washer leaks", photoUrls: ["https://example.test/photo.jpg"],
  })));
});

it("a failed upload shows an error and never adds a photo to the request", async () => {
  mocks.upload.mockRejectedValue(new Error("Photo uploads are disabled in previews."));
  render(<NewRequestForm customerId="customer-1" appliances={[]} />);
  fireEvent.change(screen.getByLabelText("Add a photo"), { target: { files: [new File(["photo"], "photo.jpg")] } });
  await expect(screen.findByRole("alert")).resolves.toHaveTextContent("Photo uploads are disabled in previews.");
  expect(screen.queryByRole("button", { name: "Remove this photo" })).not.toBeInTheDocument();
  expect(mocks.submit).not.toHaveBeenCalled();
});
