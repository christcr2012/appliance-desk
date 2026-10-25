import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ActionButton, Toaster, clearToasts } from "@/components/kit";

vi.mock("next/navigation", () => import("./kit-test-env"));
beforeEach(() => clearToasts());
afterEach(cleanup);

describe("kit ActionButton (KIT 4.13)", () => {
  it("renders a link, a phone call and an email as the right elements", () => {
    render(
      <>
        <ActionButton spec={{ kind: "link", label: "Open bill", href: "/desk/billing/1", primary: true }} />
        <ActionButton spec={{ kind: "tel", label: "Call", phone: "(970) 555-0101" }} />
        <ActionButton spec={{ kind: "mailto", label: "Email", email: "maria@example.test" }} />
      </>,
    );
    const open = screen.getByRole("link", { name: "Open bill" });
    expect(open).toHaveAttribute("href", "/desk/billing/1");
    expect(open.className).toContain("bg-primary");
    const call = screen.getByRole("link", { name: "Call" });
    expect(call).toHaveAttribute("href", "tel:9705550101");
    expect(call.className).toContain("border-line-strong");
    expect(screen.getByRole("link", { name: "Email" })).toHaveAttribute("href", "mailto:maria@example.test");
  });

  it("submits a form action with its hidden fields, shows the pending label while it runs, then a success toast", async () => {
    let finish: () => void = () => {};
    const action = vi.fn((fd: FormData) => {
      void fd;
      return new Promise<void>((resolve) => (finish = resolve));
    });
    render(
      <>
        <ActionButton
          spec={{ kind: "form", label: "Send reminder", action, fields: { invoiceId: "inv_1" }, pendingLabel: "Sending…", successMessage: "Reminder sent to Maria Lopez" }}
        />
        <Toaster />
      </>,
    );
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Send reminder" })));
    expect(action).toHaveBeenCalledTimes(1);
    expect((action.mock.calls[0][0] as FormData).get("invoiceId")).toBe("inv_1");
    const pending = screen.getByRole("button", { name: "Sending…" });
    expect(pending).toBeDisabled();
    await act(async () => finish());
    await waitFor(() => expect(screen.getByRole("button", { name: "Send reminder" })).not.toBeDisabled());
    expect(screen.getByRole("status").textContent).toContain("Reminder sent to Maria Lopez");
  });

  it("uses 'Saving…' as the default pending label", async () => {
    const action = vi.fn(() => new Promise<void>(() => {}));
    render(<ActionButton spec={{ kind: "form", label: "Mark done", action }} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Mark done" })));
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  });

  it("asks first when the spec has a confirmation, and only submits after the person confirms", async () => {
    const action = vi.fn(async () => undefined);
    render(
      <ActionButton
        spec={{
          kind: "form",
          label: "Take payment",
          action,
          confirm: { title: "Take a $70.00 payment?", summary: "$70.00 from Maria Lopez's Visa ending 4242. This can't be undone.", confirmLabel: "Take $70.00", danger: true },
        }}
      />,
    );
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Take payment" })));
    expect(action).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog", { name: "Take a $70.00 payment?" });
    expect(dialog.textContent).toContain("This can't be undone.");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Take $70.00" })));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  });

  it("returns focus to its own button when the confirmation is cancelled, even if the click did not focus it", async () => {
    render(
      <ActionButton
        spec={{ kind: "form", label: "Refund", action: async () => undefined, confirm: { title: "Refund $45.00?", summary: "This can't be undone.", confirmLabel: "Refund" } }}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Refund" });
    await act(async () => fireEvent.click(trigger));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Cancel" })));
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("shows the server's plain message as a danger toast when the action fails or returns an error", async () => {
    render(
      <>
        <ActionButton spec={{ kind: "form", label: "Snooze", action: async () => { throw new Error("Pick a date after today."); } }} />
        <ActionButton spec={{ kind: "form", label: "Save", action: async () => ({ error: "Enter an amount.", success: "" }) }} />
        <Toaster />
      </>,
    );
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Snooze" })));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Pick a date after today."));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save" })));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Enter an amount."));
    expect(screen.getByRole("status").querySelectorAll('[data-tone="danger"]').length).toBe(2);
  });

  it("offers Undo in the success toast when the spec allows it", async () => {
    const undoAction = vi.fn(async () => undefined);
    render(
      <>
        <ActionButton
          spec={{ kind: "form", label: "Mark done", action: async () => undefined, fields: { key: "todo-1" }, undo: true, undoAction, successMessage: "Marked done" }}
        />
        <Toaster />
      </>,
    );
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Mark done" })));
    const undo = await screen.findByRole("button", { name: "Undo" });
    await act(async () => fireEvent.click(undo));
    expect(undoAction).toHaveBeenCalledTimes(1);
    expect((undoAction.mock.calls[0] as unknown as [FormData])[0].get("key")).toBe("todo-1");
  });

  it("refuses a spec that asks for both a confirmation and Undo", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      render(
        <ActionButton
          spec={{ kind: "form", label: "Refund", action: async () => undefined, undo: true, confirm: { title: "Refund?", summary: "This can't be undone.", confirmLabel: "Refund" } }}
        />,
      ),
    ).toThrow(/cannot also offer Undo/);
  });
});
