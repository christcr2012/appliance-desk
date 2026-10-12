import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const mock = vi.hoisted(() => ({ sign: vi.fn() }));
vi.mock("@/app/sign/[id]/actions", () => ({ signAgreementAction: (...args: unknown[]) => mock.sign(...args) }));
import { SignForm } from "@/app/sign/[id]/sign-form";

afterEach(cleanup);
beforeEach(() => mock.sign.mockReset());
function signForm() {
  render(<SignForm signatureRecordId="sig-1" />);
  fireEvent.change(screen.getByLabelText("Your full legal name"), { target: {value: "Customer Name"} });
  fireEvent.change(screen.getByLabelText("Your email"), { target: {value: "customer@example.test"} });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", {name:"Sign agreement"}));
}
describe("W-22 after-sign display is not a payment receipt", () => {
  it("shows the exact due amount as unpaid and explains first-invoice treatment", async () => {
    mock.sign.mockResolvedValue({status:"success", agreementId:"agr-1", checkoutUrl:null, pendingSigningAmountCents:7500});
    signForm();
    await waitFor(() => expect(screen.getByText("Signing amount still to pay: $75.00")).toBeTruthy());
    expect(screen.getByText(/Signing does not confirm that payment was received/)).toBeTruthy();
    expect(screen.getByText(/down payments/)).toBeTruthy();
  });
  it("does not misstate a waived zero-fee agreement as paid", async () => {
    mock.sign.mockResolvedValue({status:"success", agreementId:"agr-1", checkoutUrl:null, pendingSigningAmountCents:0});
    signForm();
    await waitFor(() => expect(screen.getByText("No signing charge is due for this agreement.")).toBeTruthy());
    expect(screen.getByText(/Signing does not confirm that payment was received/)).toBeTruthy();
  });
  it("uses explicit human review rather than claiming payment when evidence conflicts", async () => {
    mock.sign.mockResolvedValue({status:"success", agreementId:"agr-1", checkoutUrl:null, paymentNeedsReview:true});
    signForm();
    await waitFor(() => expect(screen.getByText(/We need to review your payment details/)).toBeTruthy());
    expect(screen.getByText(/No payment was confirmed here/)).toBeTruthy();
  });
});
