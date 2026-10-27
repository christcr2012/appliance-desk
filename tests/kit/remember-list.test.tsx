import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { RememberList, clearRememberedLists, followRememberedClick, readListPosition, rememberedListHref, saveListPosition } from "@/components/kit/remember-list";
import { nav, resetNav } from "./kit-test-env";

vi.mock("next/navigation", () => import("./kit-test-env"));
beforeEach(() => { resetNav("/desk/billing"); sessionStorage.clear(); vi.restoreAllMocks(); });
afterEach(() => { cleanup(); sessionStorage.clear(); vi.restoreAllMocks(); Reflect.deleteProperty(document.documentElement, "scrollHeight"); Reflect.deleteProperty(window, "innerHeight"); });

describe("AR-11 tab-local list memory", () => {
  it("remembers filter and scroll but never rewrites direct filtered, hash, external or record URLs", () => {
    saveListPosition("/desk/billing", "?status=past-due&sort=owed-desc", 430);
    expect(readListPosition("/desk/billing")).toEqual({ search: "?status=past-due&sort=owed-desc", scrollY: 430 });
    expect(rememberedListHref("/desk/billing")).toBe("/desk/billing?status=past-due&sort=owed-desc");
    expect(rememberedListHref("/desk/billing?status=paid")).toBe("/desk/billing?status=paid");
    expect(rememberedListHref("/desk/billing#saved")).toBe("/desk/billing#saved");
    expect(rememberedListHref("https://example.com")).toBe("https://example.com");
    expect(rememberedListHref("/desk/billing/customer/id")).toBe("/desk/billing/customer/id");
  });
  it("does not steal modified clicks, and navigates on an ordinary click only", () => {
    saveListPosition("/desk/today", "?group=snoozed", 0);
    const navigate = vi.fn();
    const event = { button: 0, defaultPrevented: false, metaKey: false, ctrlKey: false,
      altKey: false, shiftKey: false, preventDefault: vi.fn() };
    expect(followRememberedClick(event, "/desk/today", navigate)).toBe(true);
    expect(navigate).toHaveBeenCalledWith("/desk/today?group=snoozed");
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(followRememberedClick({ ...event, ctrlKey: true }, "/desk/today", navigate)).toBe(false);
    expect(followRememberedClick(event, "/desk/today?group=all", navigate)).toBe(false);
    expect(navigate).toHaveBeenCalledTimes(1);
  });
  it("fails open when storage throws or entries are malformed", () => {
    sessionStorage.setItem("list:/desk/billing", '{"search":"javascript:bad","scrollY":10}');
    expect(rememberedListHref("/desk/billing")).toBe("/desk/billing");
    const storage = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(rememberedListHref("/desk/billing")).toBe("/desk/billing");
    storage.mockRestore();
  });
  it("does not recreate cleared list state when a signed-out page unmounts", () => {
    resetNav("/desk/billing", "status=past-due");
    const view = render(<RememberList />);
    clearRememberedLists();
    view.unmount();
    expect(readListPosition("/desk/billing")).toBeNull();
  });
  it("waits for streamed rows before restoring a long list", async () => {
    saveListPosition("/desk/billing", "?status=past-due", 315);
    resetNav("/desk/billing", "status=past-due");
    let height = 600;
    Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, get: () => height });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    const main = document.createElement("main");
    main.id = "main-content";
    document.body.append(main);
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const view = render(<RememberList />);
    expect(scrollTo).not.toHaveBeenCalled();
    height = 1600;
    await act(async () => { main.append(document.createElement("div")); await Promise.resolve(); });
    expect(scrollTo).toHaveBeenCalledWith({ top: 315, behavior: "auto" });
    view.unmount();
    main.remove();
  });
  it("restores saved scroll after a matching list renders, and clears it at sign out", async () => {
    saveListPosition("/desk/billing", "?status=past-due", 315);
    resetNav("/desk/billing", "status=past-due");
    Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: 2000 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((fn) => { fn(0); return 1; });
    render(<RememberList />);
    expect(scrollTo).toHaveBeenCalledWith({ top: 315, behavior: "auto" });
    raf.mockRestore();
    clearRememberedLists();
    expect(readListPosition("/desk/billing")).toBeNull();
  });
});
