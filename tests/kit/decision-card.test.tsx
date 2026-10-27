import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { DecisionCard } from "@/components/kit";

vi.mock("next/navigation", () => import("./kit-test-env"));
afterEach(cleanup);

describe("kit DecisionCard (KIT 4.22)", () => {
  it("shows the question, what the app does now with its pill, the folded why with sources and the affects links", () => {
    render(
      <DecisionCard
        title="Delivery charges"
        question="Should delivery charges have sales tax?"
        doingNow="Sales tax is charged"
        pills={[{ label: "Starting value — not confirmed", tone: "attention" }]}
        why={{ text: "Colorado taxes delivery that is part of the sale.", sources: [{ title: "DR 0100", url: "https://tax.colorado.gov/x", checkedOn: "2026-10-25" }] }}
        affects={[{ label: "Bills", href: "/desk/billing" }, { label: "Tax setup", href: "/desk/sales-tax" }]}
        notes={["Starts Nov 1: No sales tax is charged"]}
        actions={<button type="button">Keep this</button>}
      />,
    );
    const card = screen.getByRole("article", { name: "Delivery charges" });
    expect(within(card).getByRole("heading", { name: "Delivery charges" })).toBeTruthy();
    expect(within(card).getByText("Sales tax is charged")).toBeTruthy();
    expect(within(card).getByText("Starting value — not confirmed").getAttribute("data-tone")).toBe("attention");
    expect(within(card).getByText("Why this starting value")).toBeTruthy();
    expect(within(card).getByRole("link", { name: "DR 0100" }).getAttribute("rel")).toContain("noopener");
    expect(within(card).getByRole("link", { name: "Bills" }).getAttribute("href")).toBe("/desk/billing");
    expect(within(card).getByText("Starts Nov 1: No sales tax is charged")).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Keep this" })).toBeTruthy();
  });

  it("read-only: no actions row when none are given", () => {
    render(<DecisionCard title="T" question="Q" doingNow="D" pills={[]} affects={[]} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
