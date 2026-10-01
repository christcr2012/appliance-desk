import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const m = vi.hoisted(() => ({ save: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => m }));
vi.mock("@/app/desk/customers/actions", () => ({ addCustomerNoteAction: m.save }));
import { AddNoteForm } from "@/app/desk/customers/[id]/add-note-form";
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); });
it("returns a saved note to newest unfiltered activity and refreshes its data", async () => {
  m.save.mockResolvedValue({ status: "success" });
  render(<AddNoteForm customerId="c1" />);
  fireEvent.change(screen.getByLabelText("Add a note"), { target: { value: "Spoke to customer" } });
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  await waitFor(() => expect(m.replace).toHaveBeenCalledWith("/desk/customers/c1?tab=activity"));
  expect(m.save).toHaveBeenCalledWith("c1", "Spoke to customer");
  expect(m.refresh).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText("Add a note")).toHaveValue("");
});
it("retains the note and current view after a rejected save", async () => {
  m.save.mockResolvedValue({ status: "error", message: "Try again" });
  render(<AddNoteForm customerId="c1" />);
  fireEvent.change(screen.getByLabelText("Add a note"), { target: { value: "Keep me" } });
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  await screen.findByRole("alert");
  expect(screen.getByLabelText("Add a note")).toHaveValue("Keep me");
  expect(m.replace).not.toHaveBeenCalled();
  expect(m.refresh).not.toHaveBeenCalled();
});
