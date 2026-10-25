import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { ScreenHeader } from "@/components/kit";
import { openMenu } from "./kit-test-env";

vi.mock("next/navigation", () => import("./kit-test-env"));
afterEach(cleanup);

describe("kit ScreenHeader (KIT 4.1)", () => {
  it("shows the title as the page heading with its count, and a 44 px back chevron on phones", () => {
    render(<ScreenHeader title="Bills" count={12} back={{ href: "/desk/money", label: "Back to Money" }} />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("Bills12");
    expect(heading.querySelector(".tabular-nums")!.textContent).toBe("12");
    const back = screen.getByRole("link", { name: "Back to Money" });
    expect(back).toHaveAttribute("href", "/desk/money");
    expect(back.className).toContain("h-11 w-11");
    expect(back.className).toContain("lg:hidden");
  });

  it("puts a non-list screen's primary action in the header as a button", () => {
    render(<ScreenHeader title="Money" primary={{ kind: "link", label: "Record a payment", href: "/desk/payments/new" }} />);
    const links = screen.getAllByRole("link", { name: "Record a payment" });
    expect(links).toHaveLength(1);
    expect(links[0].className).toContain("bg-primary");
  });

  it("turns a list screen's primary action into the phone Fab and a desktop header button", () => {
    render(<ScreenHeader title="Customers" list primary={{ kind: "link", label: "New customer", href: "/desk/customers/new" }} />);
    const links = screen.getAllByRole("link", { name: "New customer" });
    expect(links).toHaveLength(2);
    expect(links[0].parentElement!.className).toContain("hidden lg:block");
    expect(links[1].className).toContain("rounded-full");
    expect(links[1].className).toContain("lg:hidden");
  });

  it("opens the overflow (⋯) menu with its items", async () => {
    render(
      <ScreenHeader title="Bills" overflow={[{ kind: "link", label: "Download as a spreadsheet", href: "/desk/billing/export" }]} />,
    );
    await openMenu(screen.getByRole("button", { name: "More for Bills" }));
    await act(async () => {});
    expect(screen.getByRole("menuitem", { name: "Download as a spreadsheet" })).toHaveAttribute("href", "/desk/billing/export");
  });

  it("has no description prop (guard 9.1)", () => {
    const source = readFileSync("src/components/kit/screen-header.tsx", "utf8");
    const props = source.slice(source.indexOf("export type ScreenHeaderProps"), source.indexOf("};", source.indexOf("export type ScreenHeaderProps")));
    expect(props).not.toMatch(/description/);
  });
});
