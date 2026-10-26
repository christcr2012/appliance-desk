import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Timeline } from "@/components/kit";

afterEach(cleanup);

describe("kit Timeline (KIT 4.10)", () => {
  const now = new Date("2026-10-25T12:00:00-06:00");
  it("lists items newest first with a tone dot, bold title and '{short date} · {actor}'", () => {
    render(
      <Timeline
        now={now}
        emptyLabel="Nothing has happened yet"
        items={[
          { id: "a", at: new Date("2026-10-01T09:00:00-06:00"), title: "Rental signed", tone: "good", actor: "Maria Lopez" },
          { id: "b", at: new Date("2026-10-20T09:00:00-06:00"), title: "Bill sent", detail: "$70.00", tone: "info", actor: "automatic" },
          { id: "c", at: new Date("2025-12-31T23:30:00-07:00"), title: "Customer added", tone: "neutral", actor: "Chris" },
        ]}
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(items.map((item) => item.querySelector("p.font-bold")!.textContent)).toEqual(["Bill sent", "Rental signed", "Customer added"]);
    expect(items[0].textContent).toContain("Oct 20 · automatic");
    expect(items[0].textContent).toContain("$70.00");
    expect(items[2].textContent).toContain("Dec 31, 2025 · Chris");
    expect(items[0].querySelector('[data-tone="info"]')!.className).toContain("bg-info-ink");
    expect(items[1].querySelector('[data-tone="good"]')!.className).toContain("h-2 w-2");
  });

  it("links an item's title when it has an href (AR-0b)", () => {
    render(
      <Timeline
        now={now}
        emptyLabel="Nothing"
        items={[{ id: "a", at: now, title: "Visit scheduled", tone: "info", actor: "Chris", href: "/desk/jobs/j1" }]}
      />,
    );
    expect(screen.getByRole("link", { name: "Visit scheduled" })).toHaveAttribute("href", "/desk/jobs/j1");
  });

  it("shows the empty label when there is nothing", () => {
    render(<Timeline items={[]} emptyLabel="Nothing has happened yet" />);
    expect(screen.getByText("Nothing has happened yet")).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
  });
});
