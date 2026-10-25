import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { ActionBar } from "@/components/kit";

vi.mock("next/navigation", () => import("./kit-test-env"));
afterEach(cleanup);

describe("kit ActionBar (KIT 4.13)", () => {
  it("is a sticky phone-only bar above the safe area with at most two actions, the primary filled", () => {
    render(
      <ActionBar
        label="Actions for Maria Lopez"
        actions={[
          { kind: "tel", label: "Call", phone: "9705550101" },
          { kind: "link", label: "New rental", href: "/desk/agreements/new", primary: true },
          { kind: "link", label: "Extra", href: "/x" },
        ]}
      />,
    );
    const bar = screen.getByRole("group", { name: "Actions for Maria Lopez" });
    expect(bar.className).toContain("sticky");
    expect(bar.className).toContain("lg:hidden");
    expect(bar.className).toContain("pb-[max(0.75rem,env(safe-area-inset-bottom))]");
    const links = within(bar).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["Call", "New rental"]);
    expect(links[1].className).toContain("bg-primary");
    expect(links[0].className).not.toContain("bg-primary");
    expect(links[1].className).toContain("min-h-12");
  });

  it("makes a lone action the filled one and renders nothing with no actions", () => {
    const { container, rerender } = render(<ActionBar actions={[{ kind: "link", label: "Open", href: "/a" }]} />);
    expect(screen.getByRole("link", { name: "Open" }).className).toContain("bg-primary");
    rerender(<ActionBar actions={[]} />);
    expect(container.innerHTML).toBe("");
  });
});
