import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
const create = vi.hoisted(() => vi.fn());
vi.mock("@/app/desk/settings/actions", () => ({ createStaffAccountAction: create }));
import { StaffAccountsSection } from "@/app/desk/settings/staff-accounts-section";
afterEach(cleanup);
it.each([true, false])("reports setup acceptance %s without duplicating the saved account", async (activationEmailSent) => {
  create.mockResolvedValue({ status: "success", activationEmailSent });
  render(<StaffAccountsSection accounts={[]} />);
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Jamie" } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "jamie@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Add staff account" }));
  const message = await screen.findByRole(activationEmailSent ? "status" : "alert");
  expect(message).toHaveTextContent(activationEmailSent ? "We emailed" : "setup email was not sent");
  if (!activationEmailSent) expect(message).toHaveTextContent("do not create another account");
  expect(screen.getByLabelText("Email")).toHaveValue("");
});
