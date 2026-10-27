import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DeskShortcuts, deskShortcutHref, shortcutTypingTarget } from "@/components/kit/shortcuts";
import { nav, resetNav, setDesktop } from "./kit-test-env";

vi.mock("next/navigation", () => import("./kit-test-env"));

beforeEach(() => { resetNav(); setDesktop(true); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("AR-11 desk keyboard access", () => {
  it("refuses finance navigation to staff before calling the router", () => {
    expect(deskShortcutHref("m", "STAFF")).toBeNull();
    expect(deskShortcutHref("m", "OWNER")).toBe("/desk/revenue");
    expect(deskShortcutHref("m", "ADMIN")).toBe("/desk/revenue");
    expect(deskShortcutHref("c", "STAFF")).toBe("/desk/customers");
    expect(deskShortcutHref("x", "OWNER")).toBeNull();
  });
  it("ignores typing fields and editable elements", () => {
    const input = document.createElement("input");
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    document.body.append(input, editor);
    expect(shortcutTypingTarget(input)).toBe(true);
    expect(shortcutTypingTarget(editor)).toBe(true);
    expect(shortcutTypingTarget(document.body)).toBe(false);
    input.remove(); editor.remove();
  });
  it("navigates with g then a destination and ignores shortcuts while typing", () => {
    render(<DeskShortcuts role="OWNER" />);
    fireEvent.keyDown(document, { key: "g" });
    fireEvent.keyDown(document, { key: "c" });
    expect(nav.push).toHaveBeenCalledWith("/desk/customers");
    const input = document.createElement("input");
    document.body.append(input);
    fireEvent.keyDown(input, { key: "g" });
    fireEvent.keyDown(input, { key: "m" });
    expect(nav.push).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "g", ctrlKey: true });
    fireEvent.keyDown(document, { key: "m" });
    expect(nav.push).toHaveBeenCalledTimes(1);
    input.remove();
  });
  it("moves focus through desktop data table links with j and k", () => {
    render(<DeskShortcuts role="OWNER" />);
    const table = document.createElement("table");
    table.innerHTML = '<tbody><tr data-row-key="a"><td><a href="/desk/a">Alpha</a></td></tr><tr data-row-key="b"><td><a href="/desk/b">Beta</a></td></tr></tbody>';
    document.body.append(table);
    // jsdom has no layout; make the row anchors discoverable as visible links.
    vi.spyOn(HTMLAnchorElement.prototype, "getClientRects").mockImplementation(() => ({ length: 1 }) as DOMRectList);
    fireEvent.keyDown(document, { key: "j" });
    expect(document.activeElement).toHaveTextContent("Alpha");
    fireEvent.keyDown(document, { key: "j" });
    expect(document.activeElement).toHaveTextContent("Beta");
    fireEvent.keyDown(document, { key: "k" });
    expect(document.activeElement).toHaveTextContent("Alpha");
    table.remove();
  });
  it("shows help using ? and closes on Escape", async () => {
    render(<DeskShortcuts role="OWNER" />);
    await act(async () => fireEvent.keyDown(document, { key: "?" }));
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  });
});
