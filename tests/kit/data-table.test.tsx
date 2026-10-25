import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { CAP_REACHED_LABEL, DataTable, EmptyState, type Column } from "@/components/kit";
import { nav, openMenu, resetNav } from "./kit-test-env";

vi.mock("next/navigation", () => import("./kit-test-env"));
beforeEach(() => resetNav("/desk/billing", "status=open&cursor=abc"));
afterEach(cleanup);

type Bill = { id: string; customer: string; amount: string };
const rows: Bill[] = [
  { id: "inv_1", customer: "Maria Lopez", amount: "$70.00" },
  { id: "inv_2", customer: "Sam Chen", amount: "$45.00" },
];
const columns: Column<Bill>[] = [
  { key: "customer", header: "Customer", cell: (row) => row.customer, sortValue: "customer" },
  { key: "amount", header: "Amount", cell: (row) => row.amount, align: "right" },
  { key: "note", header: "Note", cell: () => "—", desktopOnly: true },
];

function table(extra: Partial<Parameters<typeof DataTable<Bill>>[0]> = {}) {
  return (
    <DataTable<Bill>
      caption="Open bills"
      rows={rows}
      rowKey={(row) => row.id}
      columns={columns}
      mobileCard={(row) => (
        <span>
          {row.customer} owes {row.amount}
        </span>
      )}
      rowHref={(row) => `/desk/billing/${row.id}`}
      empty={<EmptyState title="No open bills" />}
      {...extra}
    />
  );
}

describe("kit DataTable (KIT 4.5)", () => {
  it("phones get a list of cards that link to the full record", () => {
    render(table());
    const list = screen.getByRole("list", { name: "Open bills" });
    expect(list.className).toContain("lg:hidden");
    const card = within(list).getByRole("link", { name: "Maria Lopez owes $70.00" });
    expect(card).toHaveAttribute("href", "/desk/billing/inv_1");
  });

  it("cards with their own buttons are not wrapped in a link", () => {
    render(table({ mobileCardLink: false }));
    expect(within(screen.getByRole("list", { name: "Open bills" })).queryAllByRole("link")).toHaveLength(0);
  });

  it("desktop gets a captioned table with a sticky header, tabular numbers and right-aligned money", () => {
    render(table());
    const grid = screen.getByRole("table", { name: "Open bills" });
    expect(grid.className).toContain("tabular-nums");
    expect(grid.parentElement!.className).toContain("hidden");
    expect(grid.parentElement!.className).toContain("lg:block");
    expect(grid.querySelector("caption")!.className).toContain("sr-only");
    expect(grid.querySelector("thead")!.className).toContain("sticky");
    expect(screen.getByRole("columnheader", { name: "Amount" }).className).toContain("text-right");
    expect(screen.getByRole("columnheader", { name: "Note" }).className).toContain("hidden xl:table-cell");
  });

  it("a sortable header links to ?sort= without the cursor", () => {
    render(table());
    expect(screen.getByRole("link", { name: "Sort by Customer" })).toHaveAttribute("href", "/desk/billing?status=open&sort=customer");
  });

  it("clicking a row (or its first-cell link) opens the side panel with ?open=<key> and keeps the scroll", () => {
    render(table({ selectedKey: "inv_2" }));
    const cell = screen.getByRole("cell", { name: "$70.00" });
    fireEvent.click(cell);
    expect(nav.push).toHaveBeenCalledWith("/desk/billing?status=open&cursor=abc&open=inv_1", { scroll: false });
    const firstCellLink = within(screen.getByRole("table")).getByRole("link", { name: "Sam Chen" });
    expect(firstCellLink).toHaveAttribute("href", "/desk/billing?status=open&cursor=abc&open=inv_2");
    const selected = firstCellLink.closest("tr")!;
    expect(selected.className).toContain("bg-success-soft");
    expect(selected).toHaveAttribute("aria-selected", "true");
    expect(cell.closest("tr")!.className).toContain("hover:bg-tint");
  });

  it("a custom panel param is used", () => {
    render(table({ panelParam: "preview" }));
    expect(within(screen.getByRole("table")).getByRole("link", { name: "Maria Lopez" })).toHaveAttribute(
      "href",
      "/desk/billing?status=open&cursor=abc&preview=inv_1",
    );
  });

  it("shows the EmptyState when there are no rows", () => {
    render(table({ rows: [] }));
    expect(screen.getByText("No open bills")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows Load more when there is a next page, and the narrow-your-filters line at the cap", () => {
    const { rerender } = render(table({ nextHref: "/desk/billing?status=open&cursor=xyz" }));
    expect(screen.getByRole("link", { name: "Load more" })).toHaveAttribute("href", "/desk/billing?status=open&cursor=xyz");
    rerender(table({ nextHref: null }));
    expect(screen.queryByRole("link", { name: "Load more" })).toBeNull();
    rerender(table({ nextHref: "/x", capReached: true }));
    expect(screen.queryByRole("link", { name: "Load more" })).toBeNull();
    expect(screen.getByText(CAP_REACHED_LABEL)).toBeInTheDocument();
  });

  it("has a ⋯ menu per row", async () => {
    render(table({ rowActions: (row) => [{ kind: "link", label: `Open ${row.customer}`, href: `/desk/billing/${row.id}` }] }));
    const triggers = within(screen.getByRole("table")).getAllByRole("button", { name: "More for row 1" });
    await openMenu(triggers[0]);
    expect(screen.getByRole("menuitem", { name: "Open Maria Lopez" })).toHaveAttribute("href", "/desk/billing/inv_1");
  });

  it("bulk actions: select rows, see '{n} selected', and the action receives every selected id", async () => {
    const action = vi.fn(async () => undefined);
    render(table({ bulkActions: [{ label: "Send reminders", action }] }));
    const grid = screen.getByRole("table");
    expect(screen.queryByRole("region", { name: "Selected rows" })).toBeNull();
    fireEvent.click(within(grid).getByRole("checkbox", { name: "Select all rows" }));
    const bar = screen.getByRole("region", { name: "Selected rows" });
    expect(bar.textContent).toContain("2 selected");
    expect(nav.push).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(within(bar).getByRole("button", { name: "Send reminders" })));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect((action.mock.calls[0] as unknown as [FormData])[0].getAll("id")).toEqual(["inv_1", "inv_2"]);
    await waitFor(() => expect(screen.queryByRole("region", { name: "Selected rows" })).toBeNull());
  });

  it("a bulk action with a confirmation asks first", async () => {
    const action = vi.fn(async () => undefined);
    render(table({ bulkActions: [{ label: "Give up on these", action, confirm: { title: "Give up on 1 bill?", summary: "This can't be undone.", confirmLabel: "Give up", danger: true } }] }));
    fireEvent.click(within(screen.getByRole("table")).getAllByRole("checkbox", { name: "Select row 1" })[0]);
    const bar = screen.getByRole("region", { name: "Selected rows" });
    expect(bar.textContent).toContain("1 selected");
    await act(async () => fireEvent.click(within(bar).getByRole("button", { name: "Give up on these" })));
    expect(action).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Give up" })));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  });
});
