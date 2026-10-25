import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { RecordHeader, StatStrip, mapHref, recordBarActions } from "@/components/kit";
import { GLOSSARY } from "@/lib/glossary";
import { openMenu } from "./kit-test-env";

vi.mock("next/navigation", () => import("./kit-test-env"));
afterEach(cleanup);

const back = { href: "/desk/customers", label: "Customers" };

describe("kit RecordHeader (KIT 4.7)", () => {
  it("shows the title as the page heading with its pills, subtitle and the desktop breadcrumb", () => {
    render(
      <RecordHeader
        title="Maria Lopez"
        pills={[{ label: "Active", tone: "good" }, { label: "5 days late", tone: "attention" }]}
        subtitle="Customer since March 2026 · Greeley"
        back={back}
      />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Maria Lopez" })).toBeInTheDocument();
    expect(screen.getByText("Active").className).toContain("bg-success-soft");
    expect(screen.getByText("5 days late").className).toContain("bg-warning-bg");
    expect(screen.getByText("Customer since March 2026 · Greeley")).toBeInTheDocument();
    const crumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(crumb.className).toContain("lg:block");
    expect(within(crumb).getByRole("link", { name: "Customers" })).toHaveAttribute("href", "/desk/customers");
    expect(screen.getAllByRole("link", { name: "Customers" })).toHaveLength(2); // phone chevron + breadcrumb
  });

  it("builds the phone Call / Email / Map buttons from contact, each only if present", () => {
    const { rerender } = render(
      <RecordHeader title="Maria Lopez" back={back} contact={{ phone: "(970) 555-0101", email: "maria@example.test", address: "1 Main St, Greeley, CO" }} />,
    );
    expect(screen.getByRole("link", { name: "Call" })).toHaveAttribute("href", "tel:9705550101");
    expect(screen.getByRole("link", { name: "Email" })).toHaveAttribute("href", "mailto:maria@example.test");
    expect(screen.getByRole("link", { name: "Map" })).toHaveAttribute("href", mapHref("1 Main St, Greeley, CO"));
    expect(mapHref("1 Main St")).toBe("https://maps.google.com/?q=1%20Main%20St");
    expect(screen.getByText("(970) 555-0101 · maria@example.test · 1 Main St, Greeley, CO").className).toContain("lg:block");
    rerender(<RecordHeader title="Maria Lopez" back={back} contact={{ email: "maria@example.test" }} />);
    expect(screen.queryByRole("link", { name: "Call" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Map" })).toBeNull();
    expect(screen.getByRole("link", { name: "Email" })).toBeInTheDocument();
  });

  it("puts primary and actions on the right on desktop, and extra phone actions in the phone ⋯ menu", async () => {
    const primary = { kind: "link" as const, label: "New rental", href: "/desk/agreements/new" };
    const actions = [
      { kind: "link" as const, label: "Take payment", href: "/desk/payments/new" },
      { kind: "link" as const, label: "Add a note", href: "#note" },
    ];
    render(<RecordHeader title="Maria Lopez" back={back} primary={primary} actions={actions} overflow={[{ kind: "link", label: "Merge", href: "/m" }]} />);
    expect(screen.getByRole("link", { name: "New rental" }).className).toContain("bg-primary");
    expect(screen.getByRole("link", { name: "Take payment" }).className).toContain("border-line-strong");
    const [phoneMenu] = screen.getAllByRole("button", { name: "More for Maria Lopez" });
    await openMenu(phoneMenu);
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Add a note", "Merge"]);
    expect(recordBarActions(primary, actions).map((spec) => spec.label)).toEqual(["New rental", "Take payment"]);
    expect(recordBarActions(primary, actions)[0].primary).toBe(true);
  });
});

describe("kit StatStrip (KIT 4.7)", () => {
  it("is two columns in one card on phones and up to five cards on desktop; attention colors the value", () => {
    const { container } = render(
      <StatStrip
        items={[
          { label: "Owes", value: "$70.00", tone: "attention" },
          { label: "Monthly rent", value: "$45.00" },
          { label: "On time", value: "11 of 12" },
          { label: "Appliances", value: "2" },
          { label: "Since", value: "Mar 2026" },
          { label: "Sixth", value: "never shown" },
        ]}
      />,
    );
    const strip = container.querySelector("dl")!;
    expect(strip.className).toContain("grid-cols-2");
    expect(strip.className).toContain("rounded-card");
    expect(strip.className).toContain("lg:auto-cols-fr");
    expect(screen.queryByText("never shown")).toBeNull();
    expect(screen.getByText("$70.00").className).toContain("text-warning-ink");
    expect(screen.getByText("$45.00").className).toContain("text-ink");
    expect(screen.getByText("$45.00").className).toContain("tabular-nums");
  });

  it("a stat with info opens its glossary entry", async () => {
    render(<StatStrip items={[{ label: "Set price", value: "$80.00", info: "set-price" }]} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "What does Set price mean?" })));
    expect(screen.getByRole("note").textContent).toContain(GLOSSARY["set-price"].description);
  });
});
