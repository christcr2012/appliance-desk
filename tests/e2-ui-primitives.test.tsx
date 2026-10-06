import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  Button,
  ButtonLink,
  Card,
  PageHeader,
  StatCard,
  StatusPill,
} from "@/components/ui";

afterEach(cleanup);

describe.each(["light", "dark"] as const)("E2 shared primitives in %s mode", (mode) => {
  it("renders controls and cards with the expected semantics", () => {
    render(
      <div className={mode === "dark" ? "dark" : undefined}>
        <PageHeader
          title="Customers"
          description="Manage customer records."
          primaryAction={{ href: "/desk/customers/new", label: "New customer" }}
        />
        <Button>Save</Button>
        <ButtonLink href="/desk/today" variant="secondary">
          Today
        </ButtonLink>
        <Card title="Account" description="Current customer information">
          <p>Details</p>
        </Card>
        <StatCard label="Visits today" value="4" detail="2 deliveries" tone="headline" />
        <StatCard label="Open tasks" value="3" href="/desk/tasks" />
        <StatusPill tone="success" label="Active" />
      </div>,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Customers" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "New customer" }).getAttribute("href")).toBe(
      "/desk/customers/new",
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Today" }).getAttribute("href")).toBe("/desk/today");
    expect(screen.getByRole("heading", { level: 2, name: "Account" })).toBeTruthy();
    expect(screen.getByText("Visits today")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open tasks/ }).getAttribute("href")).toBe(
      "/desk/tasks",
    );
    expect(screen.getByText("Active")).toBeTruthy();
  });
});
