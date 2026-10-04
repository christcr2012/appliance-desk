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
it("a completed swap offers no manual status buttons, because completing it already moved both units", () => {
  render(<JobDetailPanel job={job} version={1} />);
  expect(screen.queryByRole("button", { name: /Mark .* as Rented/ })).toBeNull();
  expect(screen.queryByText(/no recorded replacement appliance/)).toBeNull();
  expect(m.appliance).not.toHaveBeenCalled();
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
