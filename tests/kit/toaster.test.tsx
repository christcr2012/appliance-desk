import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Toaster, TOAST_MS, TOAST_UNDO_MS, clearToasts, plainError, toast } from "@/components/kit";

vi.mock("next/navigation", () => import("./kit-test-env"));
beforeEach(() => {
  clearToasts();
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("kit Toaster and toast() (KIT 4.15)", () => {
  it("is one polite live region, placed above the phone bottom bar and bottom-right on desktop", () => {
    render(<Toaster />);
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region.className).toContain("bottom-[calc(5.5rem+env(safe-area-inset-bottom))]");
    expect(region.className).toContain("lg:right-6");
  });

  it("shows a message and removes it after 6 seconds", () => {
    render(<Toaster />);
    act(() => void toast({ message: "Reminder sent to Maria Lopez" }));
    expect(screen.getByText("Reminder sent to Maria Lopez")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(TOAST_MS - 100));
    expect(screen.getByText("Reminder sent to Maria Lopez")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByText("Reminder sent to Maria Lopez")).toBeNull();
  });

  it("keeps an Undo toast for 10 seconds and runs undo once when pressed", async () => {
    const undo = vi.fn(async () => undefined);
    render(<Toaster />);
    act(() => void toast({ message: "Snoozed until Oct 28", undo }));
    act(() => vi.advanceTimersByTime(TOAST_MS + 500));
    const button = screen.getByRole("button", { name: "Undo" });
    await act(async () => fireEvent.click(button));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Snoozed until Oct 28")).toBeNull();
    act(() => void toast({ message: "Snoozed again", undo }));
    act(() => vi.advanceTimersByTime(TOAST_UNDO_MS + 10));
    expect(screen.queryByText("Snoozed again")).toBeNull();
  });

  it("can be dismissed, and colors danger toasts", () => {
    render(<Toaster />);
    act(() => void toast({ message: "Card declined", tone: "danger" }));
    expect(screen.getByText("Card declined").parentElement).toHaveAttribute("data-tone", "danger");
    act(() => fireEvent.click(screen.getByRole("button", { name: "Dismiss" })));
    expect(screen.queryByText("Card declined")).toBeNull();
  });

  it("never shows a raw error", () => {
    expect(plainError(new Error("Pick a date after today."))).toBe("Pick a date after today.");
    expect(plainError(new Error("An error occurred in the Server Components render. digest 123"))).toBe("That didn't work. Try again.");
    expect(plainError(undefined)).toBe("That didn't work. Try again.");
  });
});
