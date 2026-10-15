import { beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const calls=vi.hoisted(()=>({approve:vi.fn(),changes:vi.fn()}));
vi.mock("@/app/estimate/[id]/actions",()=>({
  approveEstimateAction:calls.approve,requestEstimateChangesAction:calls.changes,
}));
import { EstimateResponseForm } from "@/app/estimate/[id]/estimate-response-form";
beforeEach(()=>{cleanup();vi.clearAllMocks();});
it("submits the rendered viewed revision and retains a stale-offer denial",async()=>{
  const viewed="a".repeat(64);
  calls.approve.mockResolvedValue({status:"error",message:"The reviewed all-in offer changed. Refresh."});
  render(<EstimateResponseForm estimateId="estimate" allowApproval expectedQuoteFingerprint={viewed}/>);
  fireEvent.click(screen.getByRole("button",{name:"Approve estimate"}));
  fireEvent.change(screen.getByLabelText("Your full name"),{target:{value:"Quote viewer"}});
  fireEvent.change(screen.getByLabelText("Your email"),{target:{value:"viewer@example.test"}});
  fireEvent.click(screen.getByRole("button",{name:"Approve estimate"}));
  await waitFor(()=>expect(calls.approve).toHaveBeenCalledWith("estimate",{
    approverName:"Quote viewer",approverEmail:"viewer@example.test",expectedQuoteFingerprint:viewed,
  }));
  await waitFor(()=>expect(screen.getByRole("alert").textContent).toMatch(/offer changed/));
  expect(screen.queryByText(/you approved/i)).toBeNull();
});
