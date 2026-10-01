import { beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
const m = vi.hoisted(() => ({ create: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: m.refresh, replace: vi.fn() }),
}));
vi.mock("@/app/desk/tasks/actions", () => ({ createTaskAction: m.create }));
vi.mock("@/app/desk/customers/actions", () => ({
  addCustomerNoteAction: vi.fn(),
}));
vi.mock("@/app/desk/leads/actions", () => ({ addLeadNoteAction: vi.fn() }));
import { AddNoteForm } from "@/app/desk/customers/[id]/add-note-form";
import { AddLeadNoteForm } from "@/app/desk/leads/[id]/add-lead-note-form";
beforeEach(() => {
  cleanup();
  vi.resetAllMocks();
});
for (const kind of ["customer", "lead"] as const) {
  it(`${kind} note shortcut links the task to the same record`, async () => {
    m.create.mockResolvedValue({ status: "success" });
    render(
      kind === "customer" ? (
        <AddNoteForm customerId="record" />
      ) : (
        <AddLeadNoteForm leadId="record" />
      ),
    );
    fireEvent.change(screen.getByLabelText("Add a note"), {
      target: { value: "Call back Thursday" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Make this a task" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "linked to this record",
    );
    expect(m.create).toHaveBeenCalledWith({
      note: "Call back Thursday",
      [kind === "customer" ? "customerId" : "leadId"]: "record",
    });
    expect(screen.getByLabelText("Add a note")).toHaveValue(
      "Call back Thursday",
    );
  });
  it(`${kind} shortcut preserves the note after a failed write`, async () => {
    m.create.mockResolvedValue({
      status: "error",
      message: "That linked record is unavailable.",
    });
    render(
      kind === "customer" ? (
        <AddNoteForm customerId="record" />
      ) : (
        <AddLeadNoteForm leadId="record" />
      ),
    );
    fireEvent.change(screen.getByLabelText("Add a note"), {
      target: { value: "Preserve this" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Make this a task" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("unavailable");
    expect(screen.getByLabelText("Add a note")).toHaveValue("Preserve this");
    expect(m.refresh).not.toHaveBeenCalled();
  });
}
