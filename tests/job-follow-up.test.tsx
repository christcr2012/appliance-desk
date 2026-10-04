import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const m = vi.hoisted(() => ({ status: vi.fn(), appliance: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: m.push, refresh: m.refresh }) }));
vi.mock("@/components/photo-upload-field", () => ({ PhotoUploadField: () => null }));
vi.mock("@/app/desk/jobs/actions", () => ({ updateJobStatusAction: m.status, updateApplianceStatusFromJobAction: m.appliance, addJobPhotoAction: vi.fn(), setJobRepairCostsAction: vi.fn(), updateJobChecklistAction: vi.fn() }));
import { JobDetailPanel } from "@/app/desk/jobs/[id]/job-detail-panel";
import { DriverJobCard } from "@/app/desk/driver/driver-job-card";
const job = { id: "swap", type: "SWAP" as const, status: "COMPLETED" as const, completionNotes: null, checklist: [], photos: [], swapReplacementIds: ["incoming"], appliances: [
  { appliance: { id: "broken", assetNumber: "BROKEN", status: "MAINTENANCE" as const, applianceType: { name: "Washer" } } },
  { appliance: { id: "incoming", assetNumber: "INCOMING", status: "RESERVED" as const, applianceType: { name: "Washer" } } },
] };
beforeEach(() => { vi.clearAllMocks(); m.status.mockResolvedValue({ status: "success" }); m.appliance.mockResolvedValue({ status: "success" }); });
afterEach(cleanup);
it("offers only the frozen incoming swap unit and includes the originating job on save", async () => {
  render(<JobDetailPanel job={job} version={1} />);
  expect(screen.queryByRole("button", { name: /Mark BROKEN/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Mark INCOMING as Rented" }));
  await waitFor(() => expect(m.appliance).toHaveBeenCalledWith("incoming", "RENTED", "swap"));
  await waitFor(() => expect(screen.queryByRole("button", { name: /Mark INCOMING/ })).toBeNull());
  expect(m.refresh).toHaveBeenCalled();
});
it("retains the suggestion and reports a failed status save", async () => {
  m.appliance.mockResolvedValue({ status: "error", message: "Unit changed; reload" });
  render(<JobDetailPanel job={job} version={1} />);
  fireEvent.click(screen.getByRole("button", { name: "Mark INCOMING as Rented" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Unit changed; reload");
  await waitFor(() => expect(screen.getByRole("button", { name: /Mark INCOMING/ })).toBeEnabled());
  expect(m.refresh).not.toHaveBeenCalled();
});
it("requests owner confirmation for legacy swaps without recorded replacement intent", () => {
  render(<JobDetailPanel job={{ ...job, swapReplacementIds: [] }} version={1} />);
  expect(screen.getByText(/no recorded replacement appliance/)).toBeVisible();
  expect(screen.queryByRole("button", { name: /Mark .* as Rented/ })).toBeNull();
});
it.each(["SWAP", "MAINTENANCE_VISIT", "DELIVERY", "INSTALLATION", "REMOVAL"] as const)("sends completed %s visits to the job page, where each item gets a result", async type => {
  render(<DriverJobCard job={{ id: "job", type, status: "IN_PROGRESS", scheduledAt: null, notes: null, customerName: null, customerPhone: null, address: null, appliances: [] }} />);
  fireEvent.click(screen.getByRole("button", { name: "Mark complete" }));
  await waitFor(() => expect(m.push).toHaveBeenCalledWith("/desk/jobs/job"));
  // The driver screen never completes a job by itself.
  expect(m.status).not.toHaveBeenCalled();
});
it("shows a failed start and does not navigate away", async () => {
  m.status.mockResolvedValue({ status: "error", message: "Job changed" });
  render(<DriverJobCard job={{ id: "job", type: "SWAP", status: "SCHEDULED", scheduledAt: null, notes: null, customerName: null, customerPhone: null, address: null, appliances: [] }} />);
  fireEvent.click(screen.getByRole("button", { name: "Start" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Job changed");
  expect(m.push).not.toHaveBeenCalled(); expect(m.refresh).not.toHaveBeenCalled();
});
