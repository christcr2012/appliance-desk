import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { Sheet } from "@/components/kit";
import { setDesktop } from "./kit-test-env";

vi.mock("next/navigation", () => import("./kit-test-env"));
afterEach(() => {
  cleanup();
  setDesktop(false);
});

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Snooze…
      </button>
      <Sheet open={open} onOpenChange={setOpen} title="Snooze this item" footer={<button type="submit">Snooze</button>}>
        <label>
          Until
          <input type="date" />
        </label>
      </Sheet>
    </>
  );
}

describe("kit Sheet (KIT 4.19)", () => {
  it("on desktop is a 480 px centered dialog named by its title; Escape closes it and focus returns to the opener", async () => {
    setDesktop(true);
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Snooze…" });
    opener.focus();
    await act(async () => fireEvent.click(opener));
    const dialog = screen.getByRole("dialog", { name: "Snooze this item" });
    expect(dialog).toHaveAttribute("data-sheet", "dialog");
    expect(dialog.className).toContain("w-[480px]");
    expect(screen.getByLabelText("Until")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Snooze" })).toBeInTheDocument();
    await act(async () => fireEvent.keyDown(dialog, { key: "Escape" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("on desktop the Close button closes it", async () => {
    setDesktop(true);
    render(<Harness />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Snooze…" })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Close" })));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("on phones is a bottom sheet with a grab handle, capped at 90% of the screen height", async () => {
    setDesktop(false);
    render(<Harness />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Snooze…" })));
    const sheet = await screen.findByRole("dialog", { name: "Snooze this item" });
    expect(sheet).toHaveAttribute("data-sheet", "drawer");
    expect(sheet.className).toContain("bottom-0");
    expect(sheet.className).toContain("max-h-[90dvh]");
    expect(sheet.querySelector("[data-vaul-handle]")).not.toBeNull();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Close" })));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
