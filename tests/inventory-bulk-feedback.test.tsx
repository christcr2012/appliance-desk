import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
const m = vi.hoisted(() => ({
  role: vi.fn(),
  bulk: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ requireRole: m.role }));
vi.mock("@/domains/inventory", () => ({ bulkUpdateApplianceStatus: m.bulk }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: m.refresh }),
}));
import { bulkUpdateApplianceStatusAction } from "@/app/desk/inventory/actions";
import { InventoryList } from "@/app/desk/inventory/inventory-list";
const appliances = ["one", "two", "three"].map((id) => ({
  id,
  assetNumber: `A-${id}`,
  status: "AVAILABLE" as const,
  manufacturer: null,
  model: null,
  color: null,
  currentLocation: null,
  applianceType: { name: "Washer" },
}));
beforeEach(() => {
  vi.clearAllMocks();
  m.role.mockResolvedValue({ user: { id: "owner" } });
});
afterEach(cleanup);
it("returns all skipped IDs and their independent reasons through the server action", async () => {
  const result = {
    updated: ["one"],
    skipped: [
      { applianceId: "two", reason: "Retired units cannot change." },
      { applianceId: "three", reason: "This unit changed elsewhere." },
    ],
  };
  m.bulk.mockResolvedValue(result);
  expect(
    await bulkUpdateApplianceStatusAction(["one", "two", "three"], "RENTED"),
  ).toEqual({ status: "success", ...result });
  expect(m.bulk).toHaveBeenCalledWith(
    "owner",
    ["one", "two", "three"],
    "RENTED",
  );
});
it("reports each skipped asset and retains only those selections after partial success", async () => {
  m.bulk.mockResolvedValue({
    updated: ["one"],
    skipped: [
      { applianceId: "two", reason: "Retired units cannot change." },
      { applianceId: "three", reason: "This unit changed elsewhere." },
    ],
  });
  render(<InventoryList appliances={appliances} canManage />);
  fireEvent.click(screen.getByLabelText("Select all on this page"));
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  const status = await screen.findByRole("status");
  expect(status).toHaveTextContent("Updated 1. Skipped 2.");
  expect(within(status).getByRole("link", { name: "A-two" })).toHaveAttribute(
    "href",
    "/desk/inventory/two",
  );
  expect(status).toHaveTextContent("Retired units cannot change.");
  expect(status).toHaveTextContent("A-three: This unit changed elsewhere.");
  expect(screen.getByLabelText("Select A-one")).not.toBeChecked();
  expect(screen.getByLabelText("Select A-two")).toBeChecked();
  expect(screen.getByLabelText("Select A-three")).toBeChecked();
  await waitFor(() => expect(m.refresh).toHaveBeenCalledTimes(1));
});
it("keeps selection and reports an unconfirmed response without claiming success", async () => {
  m.bulk.mockRejectedValue(new Error("lost response"));
  render(<InventoryList appliances={appliances} canManage />);
  fireEvent.click(screen.getByLabelText("Select A-one"));
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  expect(await screen.findByRole("status")).toHaveTextContent("not confirmed");
  expect(screen.getByLabelText("Select A-one")).toBeChecked();
  expect(m.refresh).not.toHaveBeenCalled();
});
it("denies non-manager actions and validates inputs before changing inventory", async () => {
  m.role.mockRejectedValueOnce(new Error("Forbidden"));
  await expect(
    bulkUpdateApplianceStatusAction(["one"], "RENTED"),
  ).rejects.toThrow("Forbidden");
  expect(await bulkUpdateApplianceStatusAction([], "RENTED")).toMatchObject({
    status: "error",
  });
  expect(
    await bulkUpdateApplianceStatusAction(["one"], "invalid"),
  ).toMatchObject({ status: "error" });
  expect(m.bulk).not.toHaveBeenCalled();
  render(<InventoryList appliances={appliances} />);
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
});
