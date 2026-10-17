import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AttentionList, severityWord, type AttentionGroup } from "@/components/ui/attention-list";
import { StatCard } from "@/components/ui/stat-card";
import { MetricStat } from "@/components/desk/metric-stat";
import { GlobalSearchBox } from "@/components/global-search-box";
import { METRICS, type MetricKey } from "@/domains/reports/definitions";

afterEach(cleanup);

const item = (severity: "high" | "medium", title: string) => ({
  category: "NEW_LEAD_CONTACT" as const,
  severity,
  title,
  detail: "Detail",
  href: "/desk/leads",
  since: new Date("2026-10-17T12:00:00Z"),
});

describe("V-4 attention severity", () => {
  it("shows a word as well as a stripe, from the existing severity", () => {
    const groups: AttentionGroup[] = [{ category: "g", title: "Group", total: 2, items: [item("high", "Pay this"), item("medium", "Call back")] }];
    const { container } = render(<AttentionList groups={groups} />);
    const rows = container.querySelectorAll("li");
    expect(rows[0].textContent).toContain("Urgent");
    expect(rows[0].className).toContain("border-danger");
    expect(rows[1].textContent).toContain("Soon");
    expect(rows[1].className).toContain("border-warning-ink");
    expect(severityWord("high")).toBe("Urgent");
    expect(severityWord("medium")).toBe("Soon");
  });
});

describe("V-4 stat card", () => {
  it("gives only the headline card the cut corner", () => {
    const { container } = render(
      <>
        <StatCard label="Visits" value="3" tone="headline" />
        <StatCard label="Other" value="1" />
      </>,
    );
    const [headline, plain] = Array.from(container.children) as HTMLElement[];
    expect(headline.className).toContain("cut-corner-md");
    // Its text is light (nav ink), so it must carry the dark nav background or it reads as an empty box.
    expect(headline.className).toContain("bg-nav-bg");
    expect(plain.className).not.toContain("cut-corner-md");
    expect(plain.className).toContain("rounded-card");
  });
});

describe("V-4 Actual and Estimate tags", () => {
  const keys = Object.keys(METRICS) as MetricKey[];
  const actual = keys.find((k) => METRICS[k].kind === "ACTUAL") as MetricKey;
  const estimate = keys.find((k) => METRICS[k].kind === "ESTIMATE") as MetricKey;

  it("tags each money number from the metric's own kind", () => {
    render(<MetricStat metric={actual} value="$1.00" />);
    expect(screen.getByText("Actual")).toBeTruthy();
    expect(screen.queryByText("Estimate")).toBeNull();
    cleanup();
    render(<MetricStat metric={estimate} value="$1.00" />);
    expect(screen.getByText("Estimate")).toBeTruthy();
    expect(screen.queryByText("Actual")).toBeNull();
  });
});

describe("V-4 search shortcut", () => {
  it("shows the key, keeps the one existing search form, and focuses it on Ctrl K", () => {
    const { container } = render(<GlobalSearchBox />);
    const form = container.querySelector("form") as HTMLFormElement;
    expect(form.getAttribute("action")).toBe("/desk/search");
    expect(container.querySelectorAll("input[name='q']")).toHaveLength(1);
    expect(container.querySelector("kbd")?.textContent).toMatch(/K/);
    const input = screen.getByRole("searchbox");
    expect(input.getAttribute("placeholder")).toBe("Search or jump to…");
    // jsdom has no layout, so give the box the layout the shortcut checks for.
    Object.defineProperty(input, "offsetParent", { configurable: true, get: () => document.body });
    expect(document.activeElement).not.toBe(input);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(document.activeElement).toBe(input);
  });

  it("ignores K without Ctrl or Cmd", () => {
    render(<GlobalSearchBox />);
    const input = screen.getByRole("searchbox");
    Object.defineProperty(input, "offsetParent", { configurable: true, get: () => document.body });
    fireEvent.keyDown(window, { key: "k" });
    expect(document.activeElement).not.toBe(input);
  });
});
