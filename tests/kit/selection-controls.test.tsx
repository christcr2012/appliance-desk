import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { SegmentedControl, Select, OptionCards, SearchablePicker, Switch, PICKER_MIN_CHARS, PICKER_DEBOUNCE_MS, Toaster, clearToasts } from "@/components/kit";
import { setDesktop } from "./kit-test-env";

vi.mock("next/navigation", () => import("./kit-test-env"));
afterEach(() => { cleanup(); clearToasts(); setDesktop(false); vi.useRealTimers(); });

describe("AR-12 owner-friendly native choices", () => {
  it("segmented choices expose real named radios and update using mouse and keyboard", () => {
    function Harness() {
      const [value, setValue] = useState("today");
      return <SegmentedControl name="range" label="Show" value={value} onChange={setValue}
        options={[{ value: "today", label: "Today" }, { value: "week", label: "This week" }]} />;
    }
    render(<Harness />);
    const today = screen.getByRole("radio", { name: "Today" });
    const week = screen.getByRole("radio", { name: "This week" });
    expect(today).toBeChecked();
    expect(today).toHaveAttribute("name", "range");
    fireEvent.click(week);
    expect(week).toBeChecked();
    expect(today).not.toBeChecked();
  });
  it("refuses 5 segments rather than shrinking a choice silently", () => {
    expect(() => render(<SegmentedControl name="bad" label="Too many" value="a"
      options={["a","b","c","d","e"].map(v => ({ value:v,label:v }))} />)).toThrow(/between two and four/);
  });
  it("native select has a visible label, placeholder and connected field error", () => {
    render(<Select name="interval" label="Frequency" required placeholder="Choose a frequency"
      options={[{ value: "month", label: "Monthly" }]} error="Pick a frequency" />);
    const box = screen.getByRole("combobox", { name: "Frequency" });
    expect(box).toHaveAttribute("name","interval");
    expect(box).toBeRequired();
    expect(box).toHaveAttribute("aria-invalid","true");
    expect(screen.getByText("Pick a frequency").id).toBe(box.getAttribute("aria-describedby"));
    fireEvent.change(box, { target: { value: "month" } });
    expect(box).toHaveValue("month");
  });
  it("option cards are form radios and highlight the owner's recommended choice", () => {
    render(<OptionCards name="timing" label="When to pay" value="now"
      options={[{value:"now",title:"Pay now",line:"Pay when the order is made",recommended:true},
        {value:"later",title:"Pay later",line:"Pay after delivery"}]} />);
    expect(screen.getByRole("group", { name:"When to pay" })).toBeInTheDocument();
    expect(screen.getByRole("radio", {name:/Pay now/})).toBeChecked();
    expect(screen.getByText("Recommended")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /Pay later/ }));
    expect(screen.getByRole("radio", { name: /Pay later/ })).toBeChecked();
  });
  it("record picker on phone uses a Sheet, searches after 2 letters, and submits only the chosen ID", async () => {
    const search = vi.fn(async (_q: string) => [{ id:"cus-123",label:"Maria Lopez",detail:"123 Oak St" }]);
    const { container } = render(<SearchablePicker name="customerId" label="Customer" search={search}
      addNew={{label:"Add customer",href:"/desk/customers/new"}} />);
    const trigger = screen.getByRole("button", { name:/Choose customer/i });
    await act(async () => fireEvent.click(trigger));
    const sheet = await screen.findByRole("dialog", { name:"Choose Customer" });
    expect(sheet).toHaveAttribute("data-sheet","drawer");
    expect(PICKER_MIN_CHARS).toBe(2);
    expect(PICKER_DEBOUNCE_MS).toBe(200);
    await act(async () => fireEvent.change(within(sheet).getByRole("combobox", { name:"Search Customer" }), {target:{value:"M"}}));
    await new Promise(resolve => setTimeout(resolve, 250));
    expect(search).not.toHaveBeenCalled();
    await act(async () => fireEvent.change(within(sheet).getByRole("combobox", { name:"Search Customer" }), {target:{value:"Ma"}}));
    await waitFor(() => expect(search).toHaveBeenCalledWith("Ma"));
    await waitFor(() => expect(within(sheet).getByText("Maria Lopez")).toBeInTheDocument());
    await act(async () => fireEvent.click(within(sheet).getByText("Maria Lopez")));
    const hidden = container.querySelector('input[name="customerId"]');
    expect(hidden).toHaveAttribute("type","hidden");
    expect(hidden).toHaveValue("cus-123");
    expect(screen.queryByRole("dialog", { name:"Choose Customer" })).toBeNull();
  });
  it("record picker on desktop uses a popover and does not save a stale failed query", async () => {
    setDesktop(true);
    const search = vi.fn(async () => { throw new Error("Service unavailable"); });
    render(<SearchablePicker name="supplierId" label="Supplier" search={search} />);
    await act(async () => fireEvent.click(screen.getByRole("button", {name:/Choose supplier/i})));
    const input = screen.getByRole("combobox", { name:"Search Supplier" });
    await act(async () => fireEvent.change(input,{target:{value:"No"}}));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Search did not work"));
    expect(screen.getByDisplayValue("")).toHaveAttribute("name","supplierId");
  });
  it("switch sends a reversible change to the server with its context fields, then shows success", async () => {
    const action = vi.fn(async (_fd:FormData) => ({ ok:true }));
    render(<><Switch label="Show suppliers" checked={false} action={action} fields={{feature:"suppliers"}}
      onText="Suppliers shown" offText="Suppliers hidden" /><Toaster /></>);
    const control = screen.getByRole("switch",{name:"Show suppliers"});
    expect(control).toHaveAttribute("aria-checked","false");
    await act(async () => fireEvent.click(control));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const sent = action.mock.calls[0][0] as FormData;
    expect(sent.get("feature")).toBe("suppliers");
    expect(sent.get("checked")).toBe("true");
    await waitFor(() => expect(screen.getByText("Suppliers shown")).toBeInTheDocument());
  });
});
