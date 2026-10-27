import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PullToRefresh, PULL_REFRESH_THRESHOLD, canPullRefresh, pullDistance } from "@/components/kit/pull-to-refresh";
import { nav, resetNav } from "./kit-test-env";

vi.mock("next/navigation", () => import("./kit-test-env"));
let reduced = false;
let coarse = true;
beforeEach(() => {
  resetNav();
  coarse = true; reduced = false;
  window.matchMedia = ((q: string) => ({ matches: q.includes("pointer: coarse") ? coarse :
    q.includes("prefers-reduced-motion") ? reduced : false, media: q, addEventListener() {}, removeEventListener() {} })) as typeof window.matchMedia;
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  document.body.dataset.offline = "false";
  Object.defineProperty(document, "scrollingElement", { configurable: true, value: document.documentElement });
  Object.defineProperty(document.documentElement, "scrollTop", { configurable: true, writable: true, value: 0 });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); delete document.body.dataset.offline; Reflect.deleteProperty(document, "scrollingElement"); });

function swipe(element: HTMLElement, distance: number, drift = 0) {
  fireEvent.pointerDown(element, { pointerType: "touch", pointerId: 1, clientX: 0, clientY: 10 });
  fireEvent.pointerMove(element, { pointerType: "touch", pointerId: 1, clientX: drift, clientY: 10 + distance });
  fireEvent.pointerUp(element, { pointerType: "touch", pointerId: 1, clientX: drift, clientY: 10 + distance });
}

describe("AR-11 touch refresh", () => {
  it("requires a vertical 72px pull, recent consent to motion and top of the page", () => {
    expect(PULL_REFRESH_THRESHOLD).toBe(72);
    expect(pullDistance(10, 81, 0)).toBe(71);
    expect(pullDistance(10, 82, 0)).toBe(72);
    expect(pullDistance(10, 100, 49)).toBe(0);
    const ready = { touch: true, coarse: true, atTop: true, reducedMotion: false, online: true, blocked: false };
    expect(canPullRefresh(ready)).toBe(true);
    for (const change of [{ touch: false }, { coarse: false }, { atTop: false }, { reducedMotion: true }, { online: false }, { blocked: true }]) {
      expect(canPullRefresh({ ...ready, ...change })).toBe(false);
    }
  });
  it("pulls once only on release after the threshold and announces the action", () => {
    render(<PullToRefresh><p>Rows</p></PullToRefresh>);
    const surface = screen.getByText("Rows").parentElement!;
    fireEvent.pointerDown(surface, { pointerType: "touch", pointerId: 1, clientX: 0, clientY: 10 });
    fireEvent.pointerMove(surface, { pointerType: "touch", pointerId: 1, clientX: 0, clientY: 82 });
    expect(screen.getByRole("status")).toHaveTextContent("Release to refresh");
    expect(nav.refresh).not.toHaveBeenCalled();
    fireEvent.pointerUp(surface, { pointerType: "touch", pointerId: 1, clientX: 0, clientY: 82 });
    expect(nav.refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("Updated just now");
  });
  it("does not refresh on short, sideways, mouse or cancelled pulls", () => {
    render(<PullToRefresh><p>Rows</p></PullToRefresh>);
    const surface = screen.getByText("Rows").parentElement!;
    swipe(surface, 71);
    swipe(surface, 100, 60);
    fireEvent.pointerDown(surface, { pointerType: "mouse", pointerId: 1, clientY: 0 });
    fireEvent.pointerMove(surface, { pointerType: "mouse", pointerId: 1, clientY: 200 });
    fireEvent.pointerUp(surface, { pointerType: "mouse", pointerId: 1, clientY: 200 });
    fireEvent.pointerDown(surface, { pointerType: "touch", pointerId: 1, clientY: 0 });
    fireEvent.pointerMove(surface, { pointerType: "touch", pointerId: 1, clientY: 100 });
    fireEvent.pointerCancel(surface, { pointerType: "touch", pointerId: 1, clientY: 100 });
    expect(nav.refresh).not.toHaveBeenCalled();
  });
  it("refuses refresh for reduced motion, offline, dirty form and a scrolled page", () => {
    render(<PullToRefresh><p>Rows</p></PullToRefresh>);
    const surface = screen.getByText("Rows").parentElement!;
    reduced = true; swipe(surface, 100);
    reduced = false; document.body.dataset.offline = "true"; swipe(surface, 100);
    document.body.dataset.offline = "false";
    const form = document.createElement("form"); form.dataset.dirty = "true"; document.body.append(form);
    swipe(surface, 100); form.remove();
    document.documentElement.scrollTop = 10; swipe(surface, 100);
    expect(nav.refresh).not.toHaveBeenCalled();
  });
});
