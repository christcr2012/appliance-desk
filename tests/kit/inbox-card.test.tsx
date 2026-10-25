import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { InboxCard } from "@/components/kit";
import { openMenu } from "./kit-test-env";

vi.mock("next/navigation", () => import("./kit-test-env"));
afterEach(cleanup);

describe("kit InboxCard (KIT 4.9)", () => {
  it("shows the eyebrow in its tone, the title and detail, the first action filled and the second secondary", () => {
    render(
      <InboxCard
        eyebrow="Money · 5 days late"
        eyebrowTone="attention"
        title="Maria Lopez owes $70.00"
        detail="Bill from Oct 20"
        actions={[
          { kind: "tel", label: "Call", phone: "9705550101" },
          { kind: "link", label: "Open bill", href: "/desk/billing/inv_1" },
          { kind: "link", label: "Never shown", href: "/x" },
        ]}
      />,
    );
    const card = screen.getByRole("article");
    expect(within(card).getByText("Money · 5 days late").className).toContain("text-warning-ink");
    expect(within(card).getByRole("heading", { name: "Maria Lopez owes $70.00" }).className).toContain("text-base font-bold");
    expect(within(card).getByText("Bill from Oct 20").className).toContain("text-ink-soft");
    const call = within(card).getByRole("link", { name: "Call" });
    expect(call.className).toContain("bg-primary");
    expect(call.className).toContain("flex-1");
    expect(within(card).getByRole("link", { name: "Open bill" }).className).toContain("border-line-strong");
    expect(within(card).queryByRole("link", { name: "Never shown" })).toBeNull();
    expect(card.className).not.toContain("border-warning-bg");
  });

  it("gives high-severity items the attention border and puts the rest in ⋯", async () => {
    render(
      <InboxCard
        eyebrow="Taxes"
        eyebrowTone="info"
        title="Sales tax due Nov 20"
        severity="high"
        actions={[{ kind: "link", label: "Open", href: "/t" }]}
        overflow={[{ kind: "link", label: "View source", href: "https://tax.colorado.gov" }]}
      />,
    );
    expect(screen.getByRole("article").className).toContain("border-warning-bg");
    expect(screen.getByText("Taxes").className).toContain("text-info-ink");
    await openMenu(screen.getByRole("button", { name: "More for Sales tax due Nov 20" }));
    expect(screen.getByRole("menuitem", { name: "View source" })).toHaveAttribute("href", "https://tax.colorado.gov");
  });
});
