import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { SEARCH_DEBOUNCE_MS, Toolbar, applyFilters, type FilterDef } from "@/components/kit";
import { nav, openMenu, resetNav, setDesktop } from "./kit-test-env";

vi.mock("next/navigation", () => import("./kit-test-env"));
beforeEach(() => resetNav("/desk/billing", "status=open&cursor=abc"));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setDesktop(false);
});

const filters: FilterDef[] = [
  { kind: "select", param: "card", label: "Card on file", options: [{ value: "yes", label: "Has a card" }, { value: "no", label: "No card" }] },
  { kind: "multi", param: "kind", label: "Kind", options: [{ value: "rent", label: "Rent" }, { value: "fee", label: "Fee" }, { value: "sale", label: "Sale" }] },
  { kind: "date", param: "due", label: "Due" },
  { kind: "toggle", param: "autopay", label: "Pays automatically" },
];

describe("kit Toolbar (KIT 4.4)", () => {
  it("search has a screen-reader label and updates ?q 250 ms after typing stops, without a submit button", () => {
    vi.useFakeTimers();
    render(<Toolbar search={{ placeholder: "Search bills", label: "Search bills by customer" }} />);
    const box = screen.getByRole("searchbox", { name: "Search bills by customer" });
    expect(screen.queryByRole("button", { name: /search/i })).toBeNull();
    act(() => {
      fireEvent.change(box, { target: { value: "lo" } });
      vi.advanceTimersByTime(100);
      fireEvent.change(box, { target: { value: "lopez" } });
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
    });
    expect(nav.replace).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(nav.replace).toHaveBeenCalledTimes(1);
    expect(nav.replace).toHaveBeenCalledWith("/desk/billing?status=open&q=lopez", { scroll: false });
  });

  it("applyFilters writes values, removes empty ones and the cursor, and keeps custom dates only for 'Pick dates'", () => {
    expect(
      applyFilters("/desk/billing", "status=open&cursor=abc&card=no", filters, { card: "", kind: "rent,fee", due: "custom", from: "2026-10-01", to: "2026-10-31", autopay: "1" }),
    ).toBe("/desk/billing?status=open&kind=rent%2Cfee&due=custom&from=2026-10-01&to=2026-10-31&autopay=1");
    expect(applyFilters("/desk/billing", "due=custom&from=2026-10-01", filters, { due: "last-30", from: "2026-10-01" })).toBe(
      "/desk/billing?due=last-30",
    );
  });

  it("search and filters reset numbered pagination as well as cursors", () => {
    expect(applyFilters("/desk/customers", "page=6&cursor=abc&q=older", [
      { kind: "select", param: "kind", label: "Customer type", options: [{ value: "pm", label: "Property manager" }] },
    ], { kind: "pm" })).toBe("/desk/customers?q=older&kind=pm");
    resetNav("/desk/customers", "page=6&cursor=abc");
    vi.useFakeTimers();
    render(<Toolbar search={{ placeholder: "Find customers", label: "Find customers" }} />);
    act(() => { fireEvent.change(screen.getByRole("searchbox", { name: "Find customers" }), { target: { value: "Maria" } });
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS); });
    expect(nav.replace).toHaveBeenCalledWith("/desk/customers?q=Maria", { scroll: false });
  });
  it("phone: Filter opens a bottom sheet; Show results writes the params; the button counts active filters", async () => {
    resetNav("/desk/billing", "status=open&cursor=abc&card=yes");
    render(<Toolbar filters={filters} />);
    const button = screen.getByRole("button", { name: "Filter · 1" });
    await act(async () => fireEvent.click(button));
    const sheet = await screen.findByRole("dialog", { name: "Filter" });
    expect(sheet).toHaveAttribute("data-sheet", "drawer");
    expect(within(sheet).getByLabelText("Card on file")).toHaveValue("yes");
    await act(async () => {
      fireEvent.click(within(sheet).getByLabelText("Fee"));
      fireEvent.click(within(sheet).getByLabelText("Pays automatically"));
    });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Show results" })));
    expect(nav.replace).toHaveBeenCalledWith("/desk/billing?status=open&card=yes&kind=fee&autopay=1", { scroll: false });
  });

  it("Clear all empties the filter form; custom dates show From and To", async () => {
    resetNav("/desk/billing", "card=yes&due=last-month");
    render(<Toolbar filters={filters} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Filter · 2" })));
    const sheet = await screen.findByRole("dialog", { name: "Filter" });
    await act(async () => fireEvent.change(within(sheet).getByRole("combobox", { name: "Due" }), { target: { value: "custom" } }));
    expect(within(sheet).getByLabelText("From")).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Clear all" })));
    expect(within(sheet).getByLabelText("Card on file")).toHaveValue("");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Show results" })));
    expect(nav.replace).toHaveBeenCalledWith("/desk/billing", { scroll: false });
  });

  it("desktop: Filter opens a 360 px popover instead of a sheet", async () => {
    setDesktop(true);
    render(<Toolbar filters={filters} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Filter" })));
    const popover = screen.getByRole("dialog", { name: "Filter" });
    expect(popover.className).toContain("w-[360px]");
    expect(within(popover).getByLabelText("Card on file")).toBeInTheDocument();
  });

  it("shows one removable chip per active filter, plus Clear all", () => {
    resetNav("/desk/billing", "status=open&card=no&kind=rent,sale&due=custom&from=2026-10-01&to=2026-10-31");
    render(<Toolbar filters={filters} />);
    const chips = screen.getByRole("list", { name: "Active filters" });
    expect(within(chips).getByRole("link", { name: "Remove filter Card on file: No card" })).toHaveAttribute(
      "href",
      "/desk/billing?status=open&kind=rent%2Csale&due=custom&from=2026-10-01&to=2026-10-31",
    );
    expect(within(chips).getByRole("link", { name: "Remove filter Kind: Rent, Sale" })).toBeInTheDocument();
    expect(within(chips).getByRole("link", { name: "Remove filter Due: 2026-10-01 to 2026-10-31" })).toHaveAttribute(
      "href",
      "/desk/billing?status=open&card=no&kind=rent%2Csale",
    );
    expect(within(chips).getByRole("link", { name: "Clear all" })).toHaveAttribute("href", "/desk/billing?status=open");
  });

  it("Sort is a menu of radio items that writes ?sort and drops the cursor", async () => {
    render(<Toolbar sorts={[{ value: "due", label: "Due date" }, { value: "amount", label: "Amount" }]} currentSort="due" />);
    await openMenu(screen.getByRole("button", { name: "Sort" }));
    const due = screen.getByRole("menuitemradio", { name: "Due date" });
    expect(due).toHaveAttribute("aria-checked", "true");
    await act(async () => fireEvent.click(screen.getByRole("menuitemradio", { name: "Amount" })));
    expect(nav.replace).toHaveBeenCalledWith("/desk/billing?status=open&sort=amount", { scroll: false });
  });

  it("Views lists built-in views first, then saved ones, and can save this view", async () => {
    const saveViewAction = vi.fn(async () => undefined);
    resetNav("/desk/billing", "status=past-due&cursor=abc&open=inv_1&q=lopez");
    render(
      <Toolbar
        views={[
          { id: "mine", label: "Lopez bills", href: "/desk/billing?q=lopez", builtIn: false },
          { id: "late", label: "Late bills", href: "/desk/billing?status=past-due", builtIn: true },
        ]}
        currentViewId="late"
        saveViewAction={saveViewAction}
      />,
    );
    await openMenu(screen.getByRole("button", { name: "View: Late bills" }));
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Late bills", "Lopez bills", "Save this view"]);
    await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: "Save this view" })));
    const sheet = await screen.findByRole("dialog", { name: "Save this view" });
    await act(async () => fireEvent.change(within(sheet).getByLabelText("Name"), { target: { value: "Late Lopez" } }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save view" })));
    expect(saveViewAction).toHaveBeenCalledTimes(1);
    const data = (saveViewAction.mock.calls[0] as unknown as [FormData])[0];
    expect(data.get("label")).toBe("Late Lopez");
    expect(JSON.parse(String(data.get("filters")))).toEqual({ status: "past-due", q: "lopez" });
  });
});
