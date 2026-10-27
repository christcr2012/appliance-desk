import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { RecordTitleTransition, recordTransitionName } from "@/components/kit/record-title-transition";
import { RecordHeader } from "@/components/kit/record-header";
import { readFileSync } from "node:fs";
afterEach(cleanup);
describe("AR-11 shared record titles", () => {
  it("matches a list record id to the header, without conflating different records", () => {
    expect(recordTransitionName("customer-123")).toBe("record-customer-123");
    expect(recordTransitionName("customer-124")).not.toBe(recordTransitionName("customer-123"));
    render(<>
      <RecordTitleTransition id="customer-123"><span>Pat Customer</span></RecordTitleTransition>
      <RecordHeader transitionId="customer-123" title="Pat Customer" back={{href:"/desk/customers",label:"Customers"}} />
    </>);
    expect(screen.getByRole("heading", { level: 1, name: "Pat Customer" })).toBeInTheDocument();
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
