import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const m = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), use: vi.fn(), settings: vi.fn(), create: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => m }));
vi.mock("@/app/desk/purchasing-actions", () => ({ recordPartUsageAction: m.use, updatePartStockSettingsAction: m.settings, createPurchaseOrderAction: m.create }));
import { PartStockPanel } from "@/app/desk/parts/part-stock-panel";
import { NewPurchaseOrderForm } from "@/app/desk/purchase-orders/new/new-purchase-order-form";
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); });
it("opens stock editing with refreshed values after using parts, preserving failed edits", async () => {
  m.use.mockResolvedValue({ status: "success" });
  m.settings.mockResolvedValue({ status: "error", message: "Try again" });
  const props = { partRecordId: "p1", quantityOnHand: 10, reorderThreshold: 2, lowStock: false };
  const view = render(<PartStockPanel {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Used some" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(m.refresh).toHaveBeenCalled());
  view.rerender(<PartStockPanel {...props} quantityOnHand={9} reorderThreshold={3} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit stock" }));
  expect(screen.getByLabelText("On hand")).toHaveValue(9);
  expect(screen.getByLabelText("Flag below")).toHaveValue(3);
  fireEvent.change(screen.getByLabelText("On hand"), { target: { value: "8" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("alert");
  expect(screen.getByLabelText("On hand")).toHaveValue(8);
  expect(m.settings).toHaveBeenCalledWith("p1", 8, 3);
});
it("all order-line controls have associated names after adding/removing a line", () => {
  render(<NewPurchaseOrderForm suppliers={[{ id: "s1", name: "Supplier" }]} partRecords={[]} />);
  fireEvent.click(screen.getByRole("button", { name: "+ Add another line" }));
  for (const label of ["Part on file (optional)", "Description", "Quantity", "Unit cost ($)"]) {
    const controls = screen.getAllByLabelText(label);
    expect(controls).toHaveLength(2);
    expect(controls[0].id).not.toBe(controls[1].id);
  }
  fireEvent.click(screen.getAllByRole("button", { name: "Remove line" })[0]);
  for (const label of ["Part on file (optional)", "Description", "Quantity", "Unit cost ($)"]) expect(screen.getByLabelText(label)).toBeVisible();
});
