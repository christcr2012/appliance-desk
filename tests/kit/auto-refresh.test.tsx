import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AutoRefresh, IDLE_LIMIT_MS, RETURN_AFTER_MS, freshnessLabel, refreshPermitted } from "@/components/kit/auto-refresh";
import { nav, resetNav } from "./kit-test-env";

vi.mock("next/navigation", () => import("./kit-test-env"));

let visible = true;
let online = true;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-26T18:00:00.000Z"));
  resetNav();
  visible = true;
  online = true;
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visible ? "visible" : "hidden" });
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
});
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(document, "visibilityState");
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("AR-11 quiet page freshness", () => {
  it("guards the ten-minute idle boundary and handles offline/dialog/hidden state", () => {
    const input = { now: 600_000, lastInteraction: 1, visible: true, online: true, blocked: false };
    expect(refreshPermitted(input)).toBe(true);
    expect(refreshPermitted({ ...input, lastInteraction: 0 })).toBe(false);
    expect(refreshPermitted({ ...input, lastInteraction: IDLE_LIMIT_MS + 1 })).toBe(false);
    expect(refreshPermitted({ ...input, visible: false })).toBe(false);
    expect(refreshPermitted({ ...input, online: false })).toBe(false);
    expect(refreshPermitted({ ...input, blocked: true })).toBe(false);
    expect(RETURN_AFTER_MS).toBe(30_000);
  });

  it("refreshes active visible pages but stops after ten idle minutes", () => {
    render(<AutoRefresh everySeconds={60} />);
    expect(screen.getByLabelText("Page freshness")).toHaveTextContent("Updated just now");
    act(() => vi.advanceTimersByTime(60_000));
    expect(nav.refresh).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(11 * 60_000));
    expect(nav.refresh).toHaveBeenCalledTimes(9);
    expect(screen.getByLabelText("Page freshness")).toHaveTextContent("Updated 3 min ago");
  });

  it("does not refresh while hidden, offline or a form is dirty, and resumes only after 30 hidden seconds", () => {
    const form = document.createElement("form");
    form.dataset.dirty = "true";
    document.body.append(form);
    render(<AutoRefresh everySeconds={60} />);
    act(() => vi.advanceTimersByTime(60_000));
    expect(nav.refresh).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Page freshness")).toHaveTextContent("Updated 1 min ago");
    form.remove();
    visible = false;
    act(() => fireEvent(document, new Event("visibilitychange")));
    act(() => vi.advanceTimersByTime(60_000));
    expect(nav.refresh).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Page freshness")).toHaveTextContent("Updated 2 min ago");
    visible = true;
    act(() => fireEvent(document, new Event("visibilitychange")));
    expect(nav.refresh).toHaveBeenCalledTimes(1);
    online = false;
    act(() => vi.advanceTimersByTime(60_000));
    expect(nav.refresh).toHaveBeenCalledTimes(1);
    online = true;
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    document.body.append(dialog);
    act(() => vi.advanceTimersByTime(60_000));
    expect(nav.refresh).toHaveBeenCalledTimes(1);
    dialog.remove();
    act(() => vi.advanceTimersByTime(60_000));
    expect(nav.refresh).toHaveBeenCalledTimes(2);
  });

  it("does not refresh after short hidden time or when returning after going idle", () => {
    render(<AutoRefresh everySeconds={60} />);
    visible = false;
    act(() => fireEvent(document, new Event("visibilitychange")));
    act(() => vi.advanceTimersByTime(RETURN_AFTER_MS - 1));
    visible = true;
    act(() => fireEvent(document, new Event("visibilitychange")));
    expect(nav.refresh).not.toHaveBeenCalled();
    visible = false;
    act(() => fireEvent(document, new Event("visibilitychange")));
    act(() => vi.advanceTimersByTime(11 * 60_000));
    visible = true;
    act(() => fireEvent(document, new Event("visibilitychange")));
    expect(nav.refresh).not.toHaveBeenCalled();
  });
  it("uses plain freshness wording", () => {
    expect(freshnessLabel(0)).toBe("Updated just now");
    expect(freshnessLabel(60_000)).toBe("Updated 1 min ago");
    expect(freshnessLabel(180_000)).toBe("Updated 3 min ago");
  });
});
