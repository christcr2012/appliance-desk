import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SidePanel } from "@/components/kit";
import { nav, resetNav } from "./kit-test-env";

vi.mock("next/navigation", () => import("./kit-test-env"));
beforeEach(() => resetNav("/desk/billing", "open=inv_1"));
afterEach(cleanup);

function panel() {
  return (
    <SidePanel title="Bill for Maria Lopez" closeHref="/desk/billing?status=open" fullHref="/desk/billing/inv_1">
      <button type="button">Send reminder</button>
    </SidePanel>
  );
}

describe("kit SidePanel (KIT 4.6)", () => {
  it("is a 420 px desktop-only aside named by its title, with Close and Open full page links", () => {
    render(panel());
    const aside = screen.getByRole("complementary", { name: "Bill for Maria Lopez" });
    expect(aside.className).toContain("hidden");
    expect(aside.className).toContain("lg:flex");
    expect(aside.className).toContain("lg:w-[420px]");
    expect(aside.className).toContain("lg:border-l");
    expect(screen.getByRole("link", { name: "Close" })).toHaveAttribute("href", "/desk/billing?status=open");
    expect(screen.getByRole("link", { name: "Open full page →" })).toHaveAttribute("href", "/desk/billing/inv_1");
  });

  it("Escape inside the panel closes it; Escape elsewhere does not", () => {
    render(
      <>
        <button type="button">Elsewhere</button>
        {panel()}
      </>,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "Elsewhere" }), { key: "Escape" });
    expect(nav.push).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("button", { name: "Send reminder" }), { key: "Escape" });
    expect(nav.push).toHaveBeenCalledWith("/desk/billing?status=open", { scroll: false });
  });
});
