import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StatusTabs, statusTabHref } from "@/components/kit";
import { resetNav } from "./kit-test-env";

vi.mock("next/navigation", () => import("./kit-test-env"));
beforeEach(() => resetNav("/desk/billing", "status=open&q=lopez&cursor=abc"));
afterEach(cleanup);

const items = [
  { value: "open", label: "Open", count: 12 },
  { value: "past-due", label: "Past due", count: 3 },
  { value: "paid", label: "Paid" },
  { value: "failed", label: "Failed", count: 0, hideWhenZero: true },
];

describe("kit StatusTabs (KIT 4.3)", () => {
  it("links set the status, drop the cursor and keep other params", () => {
    render(<StatusTabs label="Bill status" current="open" items={items} />);
    expect(screen.getByRole("navigation", { name: "Bill status" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Past due 3" })).toHaveAttribute("href", "/desk/billing?status=past-due&q=lopez");
    expect(statusTabHref("/desk/today", "q=x", "group", "money")).toBe("/desk/today?q=x&group=money");
  });

  it("labels are '{label} {count}' with tabular numbers, and the current tab is marked", () => {
    render(<StatusTabs label="Bill status" current="open" items={items} />);
    const open = screen.getByRole("link", { name: "Open 12" });
    expect(open).toHaveAttribute("aria-current", "page");
    expect(open.querySelector(".tabular-nums")!.textContent).toBe("12");
    expect(open.className).toContain("bg-primary text-on-primary");
    expect(open.className).toContain("lg:bg-surface");
    expect(screen.getByRole("link", { name: "Paid" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Paid" }).className).toContain("border");
  });

  it("hides a zero tab marked hideWhenZero, unless it is the current one", () => {
    const { rerender } = render(<StatusTabs label="Bill status" current="open" items={items} />);
    expect(screen.queryByRole("link", { name: /Failed/ })).toBeNull();
    rerender(<StatusTabs label="Bill status" current="failed" items={items} />);
    expect(screen.getByRole("link", { name: "Failed 0" })).toHaveAttribute("aria-current", "page");
  });

  it("uses a custom param", () => {
    resetNav("/desk/today", "");
    render(<StatusTabs label="To do groups" param="group" current="all" items={[{ value: "all", label: "All", count: 5 }, { value: "money", label: "Money", count: 2 }]} />);
    expect(screen.getByRole("link", { name: "Money 2" })).toHaveAttribute("href", "/desk/today?group=money");
  });
});
