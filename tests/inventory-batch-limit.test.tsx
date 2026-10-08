import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/app/desk/inventory/actions", () => ({ createApplianceUnitsAction: vi.fn() }));
import { NewApplianceForm } from "@/app/desk/inventory/new-appliance-form";
afterEach(cleanup);
// The asset-number allocator creates at most 50 units at once; the form must not offer more.
it("the add-inventory quantity box stops at the allocator's 50-unit limit", () => {
  render(<NewApplianceForm canRecordTax={true} applianceTypes={[{ id: "t1", name: "Washer" }]} />);
  expect(screen.getByLabelText("How many")).toHaveAttribute("max", "50");
});
