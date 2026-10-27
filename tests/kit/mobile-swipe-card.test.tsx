import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MobileSwipeCard, SWIPE_REVEAL_PX, swipeIntent } from "@/components/kit/mobile-swipe-card";
import type { MenuItem } from "@/components/kit/types";
import { resetNav } from "./kit-test-env";

vi.mock("next/navigation", () => import("./kit-test-env"));
let reduced = false;
beforeEach(() => {
  resetNav("/desk/billing");
  reduced = false;
  window.matchMedia = ((query: string) => ({
    matches: query.includes("prefers-reduced-motion") ? reduced : false,
    media: query,
    addEventListener() {}, removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});
afterEach(cleanup);

const actions = [
  { kind: "link" as const, label: "History", href: "/desk/billing/abc/history" },
  { kind: "link" as const, label: "Open details", href: "/desk/billing/abc" },
  { kind: "link" as const, label: "Third action", href: "/desk/other" },
];

function card(items: MenuItem[] = actions) {
  return render(
    <ul>
      <MobileSwipeCard label="Bill 1" actions={items}>
        <a href="/desk/billing/abc">Bill 1</a>
        <button type="button">More for row 1</button>
      </MobileSwipeCard>
    </ul>,
  );
}
function gesture(element: HTMLElement, x: number, y = 0, type = "touch", cancel = false) {
  fireEvent.pointerDown(element, { pointerType: type, pointerId: 1, clientX: 200, clientY: 30 });
  if (cancel) fireEvent.pointerCancel(element, { pointerType: type, pointerId: 1 });
  fireEvent.pointerUp(element, { pointerType: type, pointerId: 1, clientX: 200 + x, clientY: 30 + y });
}

describe("AR-11 safe phone swipe actions", () => {
  it("uses an exact 64px mostly-horizontal threshold, not a diagonal or a right swipe", () => {
    expect(SWIPE_REVEAL_PX).toBe(64);
    expect(swipeIntent(-63, 0, false)).toBe("none");
    expect(swipeIntent(-64, 0, false)).toBe("open");
    expect(swipeIntent(-120, 110, false)).toBe("none");
    expect(swipeIntent(120, 0, false)).toBe("none");
    expect(swipeIntent(64, 0, true)).toBe("close");
  });

  it("reveals at most two existing actions while preserving the link and the More menu", () => {
    card();
    const li = screen.getByRole("listitem");
    expect(screen.getByRole("link", { name: "Bill 1" })).toHaveAttribute("href", "/desk/billing/abc");
    expect(screen.getByRole("button", { name: "More for row 1" })).toBeInTheDocument();
    expect(li).toHaveAttribute("data-swipe-open", "false");
    gesture(li, -64);
    expect(li).toHaveAttribute("data-swipe-open", "true");
    expect(screen.getByRole("link", { name: "History" })).toHaveAttribute("href", "/desk/billing/abc/history");
    expect(screen.getByRole("link", { name: "Open details" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Third action" })).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "Bill 1" }));
    expect(li).toHaveAttribute("data-swipe-open", "false");
  });

  it("does not reveal for a short, vertical, mouse or cancelled pointer gesture", () => {
    card();
    const li = screen.getByRole("listitem");
    gesture(li, -63);
    gesture(li, -100, 120);
    gesture(li, -200, 0, "mouse");
    gesture(li, -200, 0, "touch", true);
    expect(li).toHaveAttribute("data-swipe-open", "false");
    expect(screen.queryByRole("link", { name: "History" })).toBeNull();
  });

  it("respects reduced motion but keeps the full row and More menu available", () => {
    reduced = true;
    card();
    const li = screen.getByRole("listitem");
    gesture(li, -200);
    expect(li).toHaveAttribute("data-swipe-open", "false");
    expect(screen.getByRole("link", { name: "Bill 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More for row 1" })).toBeInTheDocument();
  });

  it("keeps confirmed money actions behind the existing dialog, not the swipe", async () => {
    const charge = vi.fn(async () => ({ success: "Payment received" }));
    card([{
      kind: "form" as const, label: "Take payment", action: charge,
      confirm: { title: "Take $70.00?", summary: "This can't be undone.", confirmLabel: "Take $70.00" },
    }]);
    const li = screen.getByRole("listitem");
    gesture(li, -90);
    expect(charge).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Take payment" })));
    expect(screen.getByRole("alertdialog", { name: "Take $70.00?" })).toBeInTheDocument();
    expect(charge).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Cancel" })));
    expect(charge).not.toHaveBeenCalled();
    expect(li).toHaveAttribute("data-swipe-open", "true");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Take payment" })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Take $70.00" })));
    expect(charge).toHaveBeenCalledTimes(1);
  });

  it("closes when someone taps outside; a right swipe can also close it", () => {
    render(<><ul><MobileSwipeCard label="Row" actions={actions}><span>Row</span></MobileSwipeCard></ul><button type="button">Outside</button></>);
    const li = screen.getByRole("listitem");
    gesture(li, -100);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }), { pointerType: "touch" });
    expect(li).toHaveAttribute("data-swipe-open", "false");
    gesture(li, -100);
    gesture(li, 100);
    expect(li).toHaveAttribute("data-swipe-open", "false");
  });
});
