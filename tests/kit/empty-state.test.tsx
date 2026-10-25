import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { EmptyState } from "@/components/kit";

vi.mock("next/navigation", () => import("./kit-test-env"));
afterEach(cleanup);

describe("kit EmptyState (KIT 4.11)", () => {
  it("is one centered line with no paragraph of explanation", () => {
    const { container } = render(<EmptyState title="You're all caught up" />);
    expect(screen.getByText("You're all caught up")).toBeInTheDocument();
    expect(container.querySelectorAll("p")).toHaveLength(1);
    expect(container.firstElementChild!.className).toContain("text-center");
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("can offer one action as a filled button", () => {
    render(<EmptyState title="No customers yet" action={{ kind: "link", label: "Add a customer", href: "/desk/customers/new" }} />);
    const link = screen.getByRole("link", { name: "Add a customer" });
    expect(link).toHaveAttribute("href", "/desk/customers/new");
    expect(link.className).toContain("bg-primary");
  });
});
