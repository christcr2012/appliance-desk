import { beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

const m = vi.hoisted(() => ({ save: vi.fn() }));

vi.mock("@/app/desk/settings/actions", () => ({
  updateAppliancePriceAction: m.save,
  setApplianceVisibilityAction: vi.fn(),
  createApplianceTypeAction: vi.fn(),
  setApplianceTypeActiveAction: vi.fn(),
  setAppliancePhotoUrlAction: vi.fn(),
}));
vi.mock("@/components/photo-upload-field", () => ({
  PhotoUploadField: () => null,
}));

import { AppliancePricingTable } from "@/app/desk/settings/appliance-pricing-table";

const rows = [
  {
    id: "washer",
    name: "Washer",
    monthlyPriceCents: 4000,
    showOnWebsite: true,
    isActive: true,
    photoUrl: null,
  },
];

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function activePricingTable() {
  return within(
    screen.getByRole("table", { name: "Active appliance types" }),
  );
}

it.each(["", "-5"])(
  "shows returned validation error for %s, retains the edit and never claims success",
  async (value) => {
    m.save.mockResolvedValue({
      status: "error",
      message: "Enter a valid price.",
    });
    render(<AppliancePricingTable rows={rows} />);
    const table = activePricingTable();
    const input = table.getByLabelText("Monthly price for Washer");
    fireEvent.change(input, { target: { value } });
    fireEvent.click(table.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(table.getByRole("alert")).toHaveTextContent(
        "Enter a valid price.",
      ),
    );
    expect((input as HTMLInputElement).value).toBe(value);
    expect(table.queryByRole("status")).toBeNull();
    expect(m.save).toHaveBeenCalledWith(
      "washer",
      value === "" ? NaN : -5,
    );
  },
);

it("retains the typed amount on thrown failure and confirms success only after a successful retry", async () => {
  m.save
    .mockRejectedValueOnce(new Error("private network details"))
    .mockResolvedValueOnce({ status: "success" });
  render(<AppliancePricingTable rows={rows} />);
  const table = activePricingTable();
  const input = table.getByLabelText("Monthly price for Washer");
  fireEvent.change(input, { target: { value: "45.25" } });
  fireEvent.click(table.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(table.getByRole("alert")).toHaveTextContent("not confirmed"),
  );
  expect((input as HTMLInputElement).value).toBe("45.25");
  expect(screen.queryByText(/private network/)).toBeNull();
  fireEvent.click(table.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(table.getByRole("status")).toHaveTextContent("Saved"),
  );
  expect(table.queryByRole("alert")).toBeNull();
  expect(m.save).toHaveBeenLastCalledWith("washer", 45.25);
  fireEvent.change(input, { target: { value: "46" } });
  expect(table.queryByRole("status")).toBeNull();
});

it("freezes editing while saving and accepts a confirmed zero price", async () => {
  let resolve!: (value: { status: "success" }) => void;
  m.save.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  render(<AppliancePricingTable rows={rows} />);
  const table = activePricingTable();
  const input = table.getByLabelText("Monthly price for Washer");
  fireEvent.change(input, { target: { value: "0" } });
  fireEvent.click(table.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(input).toBeDisabled());
  expect(table.getByRole("button", { name: "Saving…" })).toBeDisabled();
  await act(async () => resolve({ status: "success" }));
  await waitFor(() =>
    expect(table.getByRole("status")).toHaveTextContent("Saved"),
  );
  expect(input).toBeEnabled();
  expect(m.save).toHaveBeenCalledWith("washer", 0);
});

it("does not interpret an unconfirmed action result as success", async () => {
  m.save.mockResolvedValue({ status: "idle" });
  render(<AppliancePricingTable rows={rows} />);
  const table = activePricingTable();
  fireEvent.click(table.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(table.getByRole("alert")).toHaveTextContent("not confirmed"),
  );
  expect(table.queryByRole("status")).toBeNull();
});
