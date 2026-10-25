import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextStepCard } from "@/components/kit";

vi.mock("next/navigation", () => import("./kit-test-env"));
afterEach(cleanup);

describe("kit NextStepCard (KIT 4.8)", () => {
  it("always says 'Next step', shows the title and up to two actions, the first filled", () => {
    render(
      <NextStepCard
        title="Maria's $70.00 bill is 5 days late"
        tone="attention"
        actions={[
          { kind: "tel", label: "Call Maria", phone: "9705550101" },
          { kind: "link", label: "Send reminder", href: "/r" },
          { kind: "link", label: "Third", href: "/3" },
        ]}
      />,
    );
    const card = screen.getByRole("region", { name: "Next step" });
    expect(card.textContent).toContain("Next step");
    expect(card.textContent).toContain("Maria's $70.00 bill is 5 days late");
    expect(card.className).toContain("bg-warning-bg/40");
    expect(card.className).toContain("border-warning-bg");
    expect(screen.getByRole("link", { name: "Call Maria" }).className).toContain("bg-primary");
    expect(screen.getByRole("link", { name: "Send reminder" }).className).not.toContain("bg-primary");
    expect(screen.queryByRole("link", { name: "Third" })).toBeNull();
  });

  it("uses the info look for info", () => {
    render(<NextStepCard title="Delivery is tomorrow" tone="info" actions={[{ kind: "link", label: "Open visit", href: "/v" }]} />);
    expect(screen.getByRole("region", { name: "Next step" })).toHaveAttribute("data-tone", "info");
  });

  it("renders nothing when there is no next step", () => {
    const { container, rerender } = render(<NextStepCard title="Something" actions={[]} />);
    expect(container.innerHTML).toBe("");
    rerender(<NextStepCard title="" actions={[{ kind: "link", label: "Open", href: "/o" }]} />);
    expect(container.innerHTML).toBe("");
  });
});
