import { beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
const m = vi.hoisted(() => ({ create: vi.fn(), add: vi.fn(), send: vi.fn(), customer: vi.fn() }));
vi.mock("@/app/desk/agreements/actions", () => ({
  createDraftAgreementAction: m.create,
  addRentalLineAction: m.add,
  sendForSignatureAction: m.send,
}));
vi.mock("@/app/desk/customers/actions", () => ({
  createCustomerAction: m.customer,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
import { RentalWizard } from "@/app/desk/agreements/new/rental-wizard";
const customers = [
  {
    id: "c1",
    name: "Customer",
    serviceAddresses: [{ id: "a1", label: "Home" }],
  },
];
const draft = {
  id: "saved",
  customerId: "c1",
  customerName: "Customer",
  serviceAddressId: "a1",
  termMonths: 6,
  depositCents: 0,
  damageWaiverCents: 0,
  lateFeeGraceDays: 5,
  lateFeeCents: 0,
  lateFeePercent: 0,
  paidInFullInAdvance: false,
  lines: [
    {
      id: "line1",
      label: "Washer",
      monthlyPriceCents: 3250,
      applianceNames: "Washer (A1)",
    },
  ],
};
beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/desk/agreements/new");
});
it("resumes persisted lines and actual discounted cents without recreating a draft", () => {
  render(
    <RentalWizard
      customers={customers}
      availableAppliances={[]}
      initialCustomerId="c1"
      initialServiceAddressId="a1"
      initialDraft={draft}
    />,
  );
  expect(screen.getByText("Washer — $32.50/mo")).toBeVisible();
  expect(screen.getByText("Total: $32.50/mo")).toBeVisible();
  expect(m.create).not.toHaveBeenCalled();
  expect(
    screen
      .getByRole("link", { name: "Resume saved builder" })
      .getAttribute("href"),
  ).toBe("/desk/agreements/new?draftId=saved");
});
it("stores the request key in the URL before an ambiguous save and keeps term edits", async () => {
  m.create.mockRejectedValue(new Error("lost response"));
  render(
    <RentalWizard
      customers={customers}
      availableAppliances={[]}
      initialCustomerId="c1"
      initialServiceAddressId="a1"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Next: term & fees" }));
  fireEvent.change(screen.getByLabelText("Term (months, optional)"), {
    target: { value: "6" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Next: appliances" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("not confirmed"),
  );
  expect(new URLSearchParams(window.location.search).get("requestKey")).toBe(
    m.create.mock.calls[0][0].requestKey,
  );
  expect(
    (screen.getByLabelText("Term (months, optional)") as HTMLInputElement)
      .value,
  ).toBe("6");
});

it("preserves appliance inputs and selection when the line response is lost", async () => {
  m.add.mockRejectedValue(new Error("lost response"));
  render(
    <RentalWizard
      customers={customers}
      availableAppliances={[
        { id: "unit1", assetNumber: "A1", typeName: "Washer" },
      ]}
      initialCustomerId="c1"
      initialServiceAddressId="a1"
      initialDraft={{ ...draft, lines: [] }}
    />,
  );
  fireEvent.change(screen.getByLabelText("Label"), {
    target: { value: "New washer" },
  });
  fireEvent.change(
    screen.getByLabelText("Monthly price before any discount ($)"),
    { target: { value: "35" } },
  );
  fireEvent.click(screen.getByRole("checkbox", { name: "Washer (A1)" }));
  fireEvent.click(screen.getByRole("button", { name: "Add to agreement" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("not confirmed"),
  );
  expect(screen.getByLabelText("Label")).toHaveValue("New washer");
  expect(
    screen.getByLabelText("Monthly price before any discount ($)"),
  ).toHaveValue(35);
  expect(screen.getByRole("checkbox", { name: "Washer (A1)" })).toBeChecked();
  expect(screen.queryByText("New washer — $35.00/mo")).not.toBeInTheDocument();
});
it("keeps the saved review and avoids a success claim after an ambiguous signature send", async () => {
  m.send.mockRejectedValue(new Error("lost response"));
  render(
    <RentalWizard
      customers={customers}
      availableAppliances={[]}
      initialCustomerId="c1"
      initialServiceAddressId="a1"
      initialDraft={draft}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Send for signature" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain(
      "Sending was not confirmed",
    ),
  );
  expect(screen.getByText("Total: $32.50/mo")).toBeVisible();
  expect(screen.queryByText("Sent for signature.")).not.toBeInTheDocument();
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Send for signature" }),
    ).toBeEnabled(),
  );
});

it("keeps an unsent activation warning with a recovery link after saving a new customer", async () => {
  m.customer.mockResolvedValue({ status: "success", customerId: "new-customer", isNewAccount: true, activationEmailSent: false, serviceAddresses: [{ id: "new-address", line1: "123 Main", city: "Greeley", state: "CO", zip: "80631" }] });
  render(<RentalWizard customers={[]} availableAppliances={[]} />);
  fireEvent.submit(screen.getByRole("button", { name: "Next: term & fees" }).closest("form")!);
  const warning = await screen.findByRole("alert");
  expect(warning).toHaveTextContent("setup email was not sent");
  expect(screen.getByRole("link", { name: "customer record" })).toHaveAttribute("href", "/desk/customers/new-customer");
  expect(screen.getByLabelText("Term (months, optional)")).toBeInTheDocument();
  expect(m.customer).toHaveBeenCalledTimes(1);
});

it("names every address control and persists the entered service address", async () => {
  m.customer.mockResolvedValue({ status: "success", customerId: "new-customer", isNewAccount: false, activationEmailSent: false, serviceAddresses: [{ id: "new-address", line1: "123 Main", city: "Greeley", state: "CO", zip: "80631" }] });
  render(<RentalWizard customers={[]} availableAppliances={[]} />);
  const fields = ["Street address", "Apartment / unit (optional)", "City", "State", "ZIP"];
  expect(new Set(fields.map(label => screen.getByLabelText(label).id)).size).toBe(5);
  for (const [label, value] of [["Street address", "123 Main"], ["Apartment / unit (optional)", "B"], ["City", "Greeley"], ["State", "CO"], ["ZIP", "80631"]]) fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.submit(screen.getByRole("button", { name: "Next: term & fees" }).closest("form")!);
  await waitFor(() => expect(m.customer).toHaveBeenCalledTimes(1));
  expect(m.customer).toHaveBeenCalledWith(expect.objectContaining({ addresses: [{ line1: "123 Main", line2: "B", city: "Greeley", state: "CO", zip: "80631" }] }));
  expect(await screen.findByLabelText("Term (months, optional)")).toBeInTheDocument();
});
it("labels the optional waiver as a one-time signing charge", () => {
  render(<RentalWizard customers={customers} availableAppliances={[]} initialCustomerId="c1" initialServiceAddressId="a1" />);
  fireEvent.click(screen.getByRole("button", { name: "Next: term & fees" }));
  expect(screen.getByLabelText("Damage waiver ($, one time at signing, optional)")).toBeVisible();
  expect(screen.queryByLabelText("Damage waiver ($/mo, optional)")).toBeNull();
});
