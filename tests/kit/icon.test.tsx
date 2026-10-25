import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { Icon, ICON_NAMES } from "@/components/kit";

afterEach(cleanup);

describe("kit Icon (KIT 4.21)", () => {
  it("has every icon the kit table names, each drawn with Lucide's stroke style", () => {
    expect(ICON_NAMES).toEqual([
      "today", "home", "repair", "bill", "account", "bell", "customers", "schedule", "equipment", "money", "search",
      "plus", "more", "back", "down", "phone", "email", "map", "filter", "sort", "gear", "check", "close", "info",
      "offline", "collapse", "help", "signout",
    ]);
    for (const name of ICON_NAMES) {
      const { container, unmount } = render(<Icon name={name} />);
      const svg = container.querySelector("svg")!;
      expect(svg.getAttribute("aria-hidden"), name).toBe("true");
      expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
      expect(svg.getAttribute("stroke")).toBe("currentColor");
      expect(svg.getAttribute("stroke-width")).toBe("2");
      expect(svg.getAttribute("stroke-linecap")).toBe("round");
      expect(svg.getAttribute("stroke-linejoin")).toBe("round");
      expect(svg.children.length, `${name} has shapes`).toBeGreaterThan(0);
      unmount();
    }
  });

  it("supports the two sizes and extra classes, and is never announced", () => {
    const { container } = render(
      <button type="button">
        <Icon name="plus" size={24} className="text-primary" />
        New customer
      </button>,
    );
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("24");
    expect(svg.getAttribute("class")).toContain("text-primary");
    expect(container.querySelector("button")!.textContent).toBe("New customer");
  });

  it("keeps Lucide's ISC copyright line at the top of the file", () => {
    const source = readFileSync("src/components/kit/icons.tsx", "utf8");
    expect(source.slice(0, 400)).toMatch(/Lucide[\s\S]*ISC License/);
    expect(source).toContain("Copyright (c) for portions of Lucide are held by Cole Bemis");
  });
});
