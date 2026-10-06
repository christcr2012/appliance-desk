import { beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const m = vi.hoisted(() => ({ resolve: vi.fn(), refresh: vi.fn() }));
vi.mock("@/app/desk/billing/held-payments/actions", () => ({ resolveHeldPaymentAction: m.resolve }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh }) }));

import { HeldPaymentCard } from "@/app/desk/billing/held-payments/held-payment-card";

const props = {
  paymentId: "p1",
  customerName: "Pat Customer",
  invoiceNumber: "#12",
  invoiceStatusLabel: "Written off",
  amountLabel: "$100.00",
  receivedLabel: "Oct 3, 2026",
  writtenOffReason: "Tenant vacated",
  recommendation: { option: "MARK_PAID" as const, reason: "They did owe it." },
  options: ["MARK_PAID", "CREDIT", "REFUND"] as ("MARK_PAID" | "CREDIT" | "REFUND")[],
};

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

it("explains each choice in plain words and marks the recommended one", () => {
  render(<ul><HeldPaymentCard {...props} /></ul>);
  expect(screen.getByText("Recommended")).toBeTruthy();
  expect(screen.getAllByText(/Mark the invoice paid/).length).toBeGreaterThan(0);
  expect(screen.getByText(/Take the write-off back/)).toBeTruthy();
  expect(screen.getByText(/Choose this only if the customer asks for it/)).toBeTruthy();
  expect(screen.getByText(/Send the money back to the card/)).toBeTruthy();
});

it("asks to confirm, then sends exactly the chosen option", async () => {
  m.resolve.mockResolvedValueOnce({ status: "success" });
  render(<ul><HeldPaymentCard {...props} /></ul>);
  fireEvent.click(screen.getByRole("button", { name: "Keep as credit" }));
  expect(window.confirm).toHaveBeenCalled();
  await waitFor(() => expect(m.resolve).toHaveBeenCalledWith({ paymentId: "p1", option: "CREDIT" }));
  await waitFor(() => expect(m.refresh).toHaveBeenCalled());
});

it("does nothing if the owner cancels the confirmation", () => {
  vi.spyOn(window, "confirm").mockReturnValue(false);
  render(<ul><HeldPaymentCard {...props} /></ul>);
  fireEvent.click(screen.getByRole("button", { name: "Refund to card" }));
  expect(m.resolve).not.toHaveBeenCalled();
});

it("shows the error and changes nothing on screen when the decision fails", async () => {
  m.resolve.mockResolvedValueOnce({ status: "error", message: "This payment has already been dealt with." });
  render(<ul><HeldPaymentCard {...props} /></ul>);
  fireEvent.click(screen.getByRole("button", { name: "Mark invoice paid" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/already been dealt with/);
  expect(m.refresh).not.toHaveBeenCalled();
});
