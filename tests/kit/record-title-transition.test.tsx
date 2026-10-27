import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { RecordTitleTransition, recordTransitionName } from "@/components/kit/record-title-transition";
import { RecordHeader } from "@/components/kit/record-header";
import { DataList } from "@/components/ui/data-list";
import { readFileSync } from "node:fs";
afterEach(cleanup);
describe("AR-11 shared record titles", () => {
  it("matches a list record id to the header, without conflating different records", () => {
    expect(recordTransitionName("customer-123")).toBe("record-customer-123");
    expect(recordTransitionName("customer-124")).not.toBe(recordTransitionName("customer-123"));
    // A view-transition name must be unique within any one rendered screen.
    // The same name appears first on the list, then on the destination record.
    const { rerender } = render(
      <RecordTitleTransition id="customer-123"><span>Pat Customer</span></RecordTitleTransition>,
    );
    expect(screen.getByText("Pat Customer")).toBeInTheDocument();
    rerender(<RecordHeader transitionId="customer-123" title="Pat Customer" back={{href:"/desk/customers",label:"Customers"}} />);
    expect(screen.getByRole("heading", { level: 1, name: "Pat Customer" })).toBeInTheDocument();
  });
  it("renders the shared title only on the phone row, never twice in the same DOM", () => {
    const { container } = render(<DataList
      rows={[{ id: "customer-123", title: "Pat Customer" }]}
      columns={[{ key: "customer", header: "Customer", primary: true,
        cell: (customer, surface) => surface === "mobile"
          ? <RecordTitleTransition id={customer.id}><span data-shared-title>{customer.title}</span></RecordTitleTransition>
          : <span>{customer.title}</span>,
      }]}
      caption="Customers"
      empty={null}
    />);
    expect(container.querySelectorAll("[data-shared-title]")).toHaveLength(1);
    expect(screen.getAllByText("Pat Customer")).toHaveLength(2);
  });
  it("keys the navigation transition by desk area, not by a child node", () => {
    const source = readFileSync("src/components/ui/app-shell.tsx", "utf8");
    expect(source).toContain('ViewTransition key={pathname?.split("/")[2] ?? "desk"}');
    expect(source).not.toContain('<div key={pathname?.split("/")[2] ?? "desk"}');
  });
  it("uses exactly 180ms animations and disables all movement for reduced-motion", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css).toContain("::view-transition-group(.desk-record-title)");
    expect(css).toMatch(/::view-transition-new\(\.desk-area-enter\).*180ms/s);
    const reduced = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toContain("::view-transition-group(*)");
    expect(reduced).toContain("animation: none !important");
  });
});
