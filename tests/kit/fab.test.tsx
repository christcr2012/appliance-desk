import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Fab } from "@/components/kit";

vi.mock("next/navigation", () => import("./kit-test-env"));
afterEach(cleanup);

describe("kit Fab (KIT 4.14)", () => {
  it("is a round plus button above the phone bottom bar, named by its label, hidden on desktop", () => {
    render(<Fab spec={{ kind: "link", label: "New customer", href: "/desk/customers/new" }} />);
    const fab = screen.getByRole("link", { name: "New customer" });
    expect(fab).toHaveAttribute("href", "/desk/customers/new");
    for (const name of ["fixed", "right-5", "bottom-[calc(5.5rem+env(safe-area-inset-bottom))]", "h-14", "w-14", "rounded-full", "bg-primary", "shadow-raise", "lg:hidden"]) {
      expect(fab.className).toContain(name);
    }
    expect(fab.textContent).toBe("");
    expect(fab.querySelector('svg[data-icon="plus"]')).not.toBeNull();
  });

  it("can run a form action", async () => {
    const action = vi.fn(async () => undefined);
    render(<Fab spec={{ kind: "form", label: "Add a visit", action }} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add a visit" })));
    expect(action).toHaveBeenCalledTimes(1);
  });
});
