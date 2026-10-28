import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AreaTabs, currentAreaTab } from "@/components/kit";
import { resetNav } from "./kit-test-env";

vi.mock("next/navigation", () => import("./kit-test-env"));
beforeEach(() => resetNav());
afterEach(cleanup);

const money = [
  { href: "/desk/money", label: "Overview" },
  { href: "/desk/billing", label: "Bills", count: 4 },
  { href: "/desk/payments", label: "Payments" },
  { href: "/desk/expenses", label: "Expenses", hidden: true },
];

describe("kit AreaTabs (KIT 4.2)", () => {
  it("is a labelled nav of links; the current one is marked and styled", () => {
    resetNav("/desk/billing");
    render(<AreaTabs label="Money sections" items={money} />);
    const nav = screen.getByRole("navigation", { name: "Money sections" });
    expect(nav).toBeInTheDocument();
    const bills = screen.getByRole("link", { name: "Bills 4" });
    expect(bills).toHaveAttribute("aria-current", "page");
    expect(bills.className).toContain("font-extrabold");
    expect(bills.className).toContain("text-primary");
    expect(bills.className).toContain("border-primary");
    expect(bills.className).toContain("border-b-[3px]");
    expect(screen.getByRole("link", { name: "Overview" })).not.toHaveAttribute("aria-current");
  });

  it("skips hidden items and scrolls sideways on phones without a scrollbar", () => {
    render(<AreaTabs label="Money sections" items={money} />);
    expect(screen.queryByRole("link", { name: "Expenses" })).toBeNull();
    const list = screen.getByRole("list");
    expect(list.className).toContain("overflow-x-auto");
    expect(list.className).toContain("[scrollbar-width:none]");
  });

  it("matches a deeper path by the longest prefix", () => {
    expect(currentAreaTab(money, "/desk/billing/inv_1")).toBe(1);
    expect(currentAreaTab(money, "/desk/money")).toBe(0);
    expect(currentAreaTab(money, "/desk/moneybags")).toBe(-1);
    expect(
      currentAreaTab([{ href: "/desk", label: "Desk" }, { href: "/desk/billing", label: "Bills" }], "/desk/billing/inv_1"),
    ).toBe(1);
  });

  it("matches Payments by query or nested alias rather than Bills", () => {
    const tabs = [
      { href: "/desk/billing", label: "Bills" },
      { href: "/desk/billing?view=deposits", label: "Payments", query: { param: "view", values: ["deposits", "waiting"] }, matches: ["/desk/billing/held-payments"] },
    ];
    expect(currentAreaTab(tabs, "/desk/billing", "")).toBe(0);
    expect(currentAreaTab(tabs, "/desk/billing", "view=deposits")).toBe(1);
    expect(currentAreaTab(tabs, "/desk/billing/held-payments")).toBe(1);
    expect(currentAreaTab(tabs, "/desk/billing/customer/123")).toBe(0);
  });

  it("matches record tabs by their ?tab= value, and defaults to the first tab", () => {
    const tabs = [
      { href: "/desk/customers/c1?tab=activity", label: "Activity" },
      { href: "/desk/customers/c1?tab=rentals", label: "Rentals" },
      { href: "/desk/customers/c1?tab=billing", label: "Bills" },
    ];
    expect(currentAreaTab(tabs, "/desk/customers/c1", "tab=billing&open=x")).toBe(2);
    expect(currentAreaTab(tabs, "/desk/customers/c1", "")).toBe(0);
    resetNav("/desk/customers/c1", "tab=rentals");
    render(<AreaTabs label="Customer sections" items={tabs} />);
    expect(screen.getByRole("link", { name: "Rentals" })).toHaveAttribute("aria-current", "page");
  });
});
