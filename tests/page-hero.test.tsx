import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PageHero } from "@/components/site/page-hero";

afterEach(cleanup);

describe("V-3 page hero", () => {
  it("is the page's one h1 at the display size, with the lede after it", () => {
    render(<PageHero heading="Simple pricing" lede="What it costs." />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("Simple pricing");
    expect(heading.className).toContain("text-display");
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    expect(screen.getByText("What it costs.").className).toContain("text-lede");
  });

  it("is a cut evergreen band, with the dark surface in dark mode", () => {
    const { container } = render(<PageHero heading="Hello" />);
    const band = container.querySelector(".cut-band");
    expect(band).not.toBeNull();
    expect(band?.className).toContain("bg-primary");
    expect(band?.className).toContain("text-on-primary");
    expect(band?.className).toContain("dark:bg-surface");
    expect(band?.className).toContain("dark:text-ink");
  });

  it("shows an eyebrow only when given one, and adds no words of its own", () => {
    const plain = render(<PageHero heading="Only this" />);
    expect(plain.container.textContent).toBe("Only this");
    cleanup();
    const withEyebrow = render(<PageHero eyebrow="Coming soon" heading="Launch" lede="Join us" />);
    expect(withEyebrow.container.textContent).toBe("Coming soonLaunchJoin us");
  });
});
