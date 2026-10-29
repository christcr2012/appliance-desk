import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StatCard } from "@/components/ui/stat-card";
import { MetricStat } from "@/components/desk/metric-stat";
import { METRICS, type MetricKey } from "@/domains/reports/definitions";

afterEach(cleanup);

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
