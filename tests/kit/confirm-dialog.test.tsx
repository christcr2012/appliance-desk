import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { ConfirmDialog, type ConfirmSpec } from "@/components/kit";

vi.mock("next/navigation", () => import("./kit-test-env"));
afterEach(cleanup);

function Harness({ spec, onConfirm }: { spec: ConfirmSpec; onConfirm: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Give up on this bill
      </button>
      <ConfirmDialog open={open} onOpenChange={setOpen} spec={spec} onConfirm={onConfirm} />
    </>
  );
}

const spec: ConfirmSpec = {
  title: "Give up on this $45.00 bill?",
  summary: "Maria Lopez won't be asked to pay it. This can't be undone.",
  confirmLabel: "Give up on it",
  danger: true,
};

describe("kit ConfirmDialog (KIT 4.12)", () => {
  it("shows the title and plain summary, starts focus on Cancel and colors a danger confirm", async () => {
    render(<Harness spec={spec} onConfirm={() => {}} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Give up on this bill" })));
    const dialog = screen.getByRole("alertdialog", { name: spec.title });
    expect(dialog).toHaveAccessibleDescription(spec.summary);
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Give up on it" }).className).toContain("bg-danger");
  });

  it("Cancel closes without confirming and returns focus to the opener", async () => {
    const onConfirm = vi.fn();
    render(<Harness spec={spec} onConfirm={onConfirm} />);
    const opener = screen.getByRole("button", { name: "Give up on this bill" });
    opener.focus(); // browsers focus a clicked button; jsdom's click does not
    await act(async () => fireEvent.click(opener));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Cancel" })));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("the confirm button confirms once and closes; a non-danger confirm uses the primary color", async () => {
    const onConfirm = vi.fn();
    render(<Harness spec={{ ...spec, danger: false, confirmLabel: "Send it" }} onConfirm={onConfirm} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Give up on this bill" })));
    const confirm = screen.getByRole("button", { name: "Send it" });
    expect(confirm.className).toContain("bg-primary");
    await act(async () => fireEvent.click(confirm));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("Escape closes it", async () => {
    render(<Harness spec={spec} onConfirm={() => {}} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Give up on this bill" })));
    await act(async () => fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
