import { beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const m = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("@/app/desk/settings/actions", () => ({ updateTermsPolicyAction: m.save }));

import { TermsPolicyForm } from "@/app/desk/settings/terms-policy-form";
import { termsPolicyDefaults } from "@/domains/settings/terms-policy";

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("shows every setting with a plain label, blank when nothing has been decided", () => {
  render(<TermsPolicyForm defaultValues={termsPolicyDefaults({})} />);
  for (const label of [
    "Flat fee",
    "Percent of the rent still owed",
    "Highest fee you will ever charge (optional)",
    "Days of notice the customer must give",
    "If a customer prepaid, what happens to the months they did not use?",
    "Wording customers will see about ending early",
    "Days before the term ends that the customer is told it will renew",
    "Wording customers will see when they agree to renew",
  ]) {
    expect(screen.getByLabelText(label)).toBeTruthy();
  }
  expect((screen.getByLabelText("Flat fee") as HTMLInputElement).value).toBe("");
  expect(
    (screen.getByLabelText(/what happens to the months they did not use/) as HTMLSelectElement).value,
  ).toBe("");
});

it("sends exactly what the owner typed and confirms the save", async () => {
  m.save.mockResolvedValueOnce({ status: "success" });
  render(<TermsPolicyForm defaultValues={termsPolicyDefaults({})} />);
  fireEvent.change(screen.getByLabelText("Flat fee"), { target: { value: "75" } });
  fireEvent.change(screen.getByLabelText("Percent of the rent still owed"), { target: { value: "25" } });
  fireEvent.change(screen.getByLabelText("Days of notice the customer must give"), { target: { value: "30" } });
  fireEvent.change(screen.getByLabelText(/what happens to the months they did not use/), {
    target: { value: "CREDIT" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save this section" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Settings saved."));
  expect(m.save).toHaveBeenCalledWith(
    expect.objectContaining({ feeDollars: "75", feePercent: "25", noticeDays: "30", unusedTerm: "CREDIT" }),
  );
});

it("shows the problem in plain words and keeps what was typed", async () => {
  m.save.mockResolvedValueOnce({ status: "error", message: "The highest fee can't be less than the flat fee." });
  render(<TermsPolicyForm defaultValues={termsPolicyDefaults({})} />);
  fireEvent.change(screen.getByLabelText("Flat fee"), { target: { value: "200" } });
  fireEvent.click(screen.getByRole("button", { name: "Save this section" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("can't be less"));
  expect((screen.getByLabelText("Flat fee") as HTMLInputElement).value).toBe("200");
});

it("keeps typed edits when the save request itself fails, and lets the owner retry", async () => {
  m.save.mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce({ status: "success" });
  render(<TermsPolicyForm defaultValues={termsPolicyDefaults({})} />);
  fireEvent.change(screen.getByLabelText("Days of notice the customer must give"), { target: { value: "14" } });
  fireEvent.click(screen.getByRole("button", { name: "Save this section" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("still in the form"));
  expect((screen.getByLabelText("Days of notice the customer must give") as HTMLInputElement).value).toBe("14");
  await waitFor(() => expect(screen.getByRole("button", { name: "Save this section" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Save this section" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Settings saved."));
});

it("starts from the saved values", () => {
  render(
    <TermsPolicyForm
      defaultValues={termsPolicyDefaults({
        earlyTerminationFeeCents: 4999,
        earlyTerminationNoticeDays: 30,
        unusedTermTreatment: "REFUND",
        renewalTermsText: "We renew monthly.",
      })}
    />,
  );
  expect((screen.getByLabelText("Flat fee") as HTMLInputElement).value).toBe("49.99");
  expect((screen.getByLabelText("Days of notice the customer must give") as HTMLInputElement).value).toBe("30");
  expect(
    (screen.getByLabelText(/what happens to the months they did not use/) as HTMLSelectElement).value,
  ).toBe("REFUND");
  expect((screen.getByLabelText(/Wording customers will see when they agree to renew/) as HTMLTextAreaElement).value).toBe(
    "We renew monthly.",
  );
});

it("tells the owner that changes only reach agreements sent for signing afterwards", () => {
  render(<TermsPolicyForm defaultValues={termsPolicyDefaults({})} />);
  expect(screen.getByText(/apply only to rental agreements that are sent for signing/)).toBeTruthy();
  expect(screen.getByText(/keeps the terms it was sent with/)).toBeTruthy();
});
