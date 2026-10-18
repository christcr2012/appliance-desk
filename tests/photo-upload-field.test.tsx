// F2-D: an old review finding (#58) - the hidden file input must show where the keyboard focus is, and a failed upload must be
// reported to the caller (which shows it as an alert) while leaving the picker usable again.
import { beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock("@vercel/blob/client", () => ({ upload: mocks.upload }));
import { PhotoUploadField } from "@/components/photo-upload-field";

beforeEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it("draws a focus ring around the visible control when the hidden file input has keyboard focus", () => {
  const { container } = render(<PhotoUploadField pathPrefix="appliance-types" onUploaded={vi.fn()} label="Add photo" />);
  const wrapper = container.firstElementChild as HTMLElement;
  expect(wrapper.className).toContain("has-[:focus-visible]:outline");
  expect(wrapper.className).toContain("has-[:focus-visible]:outline-ring");
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  expect(wrapper.contains(input)).toBe(true);
  expect(wrapper.contains(screen.getByText("Add photo"))).toBe(true);
  expect(input.id).toBe(screen.getByText("Add photo").getAttribute("for"));
});

it("reports a failed upload to the caller with a readable message and lets the person try again", async () => {
  mocks.upload.mockRejectedValueOnce(new Error("Photo upload failed. Please try again."));
  const onError = vi.fn();
  const onUploaded = vi.fn();
  const { container } = render(<PhotoUploadField pathPrefix="appliance-types" onUploaded={onUploaded} onError={onError} label="Add photo" />);
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["x"], "a.png", { type: "image/png" })] } });
  await waitFor(() => expect(onError).toHaveBeenCalledWith("Photo upload failed. Please try again."));
  expect(onUploaded).not.toHaveBeenCalled();
  await waitFor(() => expect(input.disabled).toBe(false));
});
