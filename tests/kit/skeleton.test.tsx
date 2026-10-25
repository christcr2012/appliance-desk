import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { InboxSkeleton, ListSkeleton, RecordSkeleton, Skeleton } from "@/components/kit";

afterEach(cleanup);

describe("kit Skeleton (KIT 4.16)", () => {
  it("pulses unless the person asks for less motion, and is hidden from screen readers", () => {
    const { container } = render(<Skeleton className="h-4 w-40" />);
    const bar = container.querySelector("[data-skeleton]")!;
    expect(bar.className).toContain("animate-pulse");
    expect(bar.className).toContain("motion-reduce:animate-none");
    expect(bar.className).toContain("h-4 w-40");
    expect(bar).toHaveAttribute("aria-hidden", "true");
  });

  it("ListSkeleton has 6 cards on phones and 8 rows on desktop, announced once as loading", () => {
    render(<ListSkeleton />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status.textContent).toBe("Loading…");
    expect(screen.getByTestId("list-skeleton-phone").children).toHaveLength(6);
    expect(screen.getByTestId("list-skeleton-phone").className).toContain("lg:hidden");
    expect(screen.getByTestId("list-skeleton-desktop").children).toHaveLength(8);
    expect(screen.getByTestId("list-skeleton-desktop").className).toContain("lg:block");
  });

  it("RecordSkeleton and InboxSkeleton are ready-made loading states", () => {
    render(
      <>
        <RecordSkeleton label="Loading customer…" />
        <InboxSkeleton />
      </>,
    );
    expect(screen.getAllByRole("status").map((status) => status.textContent)).toEqual(["Loading customer…", "Loading…"]);
  });
});
