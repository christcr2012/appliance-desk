import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ExceptionItem } from "@/domains/exceptions";
import { AttentionList, VisitRow } from "@/components/ui";

afterEach(cleanup);

const item: ExceptionItem = {
  category: "PAST_DUE_INVOICE",
  severity: "high",
  title: "Invoice overdue",
  detail: "Customer has an unpaid invoice.",
  href: "/desk/billing/invoices/inv-1",
  since: new Date("2026-10-01T12:00:00.000Z"),
};

describe.each(["light", "dark"] as const)("E2 Today primitives in %s mode", (mode) => {
  it("renders a visit with type and status words, not color alone", () => {
    render(
      <div className={mode === "dark" ? "dark" : undefined}>
        <ul>
          <VisitRow
            time="9:00 AM"
            customer="Ada Lovelace"
            address="123 Main St"
            type="DELIVERY"
            status="SCHEDULED"
            href="/desk/jobs/job-1"
          />
        </ul>
      </div>,
    );

    const visit = screen.getByRole("link", { name: /Ada Lovelace/ });
    expect(visit.getAttribute("href")).toBe("/desk/jobs/job-1");
    expect(screen.getByText("Delivery")).toBeTruthy();
    expect(screen.getByText("Scheduled")).toBeTruthy();
    expect(screen.getByText("9:00 AM")).toBeTruthy();
  });

  it("renders grouped exceptions with true totals and truncation text", () => {
    render(
      <div className={mode === "dark" ? "dark" : undefined}>
        <AttentionList
          groups={[
            {
              category: "billing",
              title: "Billing",
              total: 3,
              items: [item],
            },
          ]}
        />
      </div>,
    );

    expect(screen.getByRole("heading", { name: "Billing" })).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("and 2 more")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Invoice overdue/ }).getAttribute("href")).toBe(
      "/desk/billing/invoices/inv-1",
    );
  });
});

it("renders an explicit empty attention state", () => {
  render(<AttentionList groups={[]} />);
  expect(screen.getByText("Nothing needs attention right now.")).toBeTruthy();
});
