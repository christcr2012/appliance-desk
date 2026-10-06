import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  Checkbox,
  DataList,
  Field,
  Select,
  Textarea,
} from "@/components/ui";

afterEach(cleanup);

const rows = [
  { id: "c1", name: "Ada Lovelace", email: "ada@example.com", hidden: "Internal" },
];

const columns = [
  {
    key: "name",
    header: "Customer",
    primary: true,
    cell: (row: (typeof rows)[number]) => row.name,
  },
  {
    key: "email",
    header: "Email",
    cell: (row: (typeof rows)[number]) => row.email,
  },
  {
    key: "hidden",
    header: "Internal",
    hideOnPhone: true,
    cell: (row: (typeof rows)[number]) => row.hidden,
  },
];

describe.each(["light", "dark"] as const)("E2 data/form primitives in %s mode", (mode) => {
  it("renders one data source as a semantic table and phone list", () => {
    render(
      <div className={mode === "dark" ? "dark" : undefined}>
        <DataList
          rows={rows}
          columns={columns}
          caption="Customers"
          empty={<p>No customers</p>}
        />
      </div>,
    );

    expect(screen.getByRole("table", { name: "Customers" })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Customers" })).toBeTruthy();
    expect(screen.getAllByText("Ada Lovelace")).toHaveLength(2);
    expect(screen.getAllByText("Internal")).toHaveLength(2);
  });

  it("links form help and errors to native controls", () => {
    render(
      <div className={mode === "dark" ? "dark" : undefined}>
        <Field id="customer-name" label="Customer name" help="Legal name" error="Required" />
        <Select id="term" label="Term" help="Choose a term" defaultValue="">
          <option value="">Choose</option>
          <option value="monthly">Monthly</option>
        </Select>
        <Textarea id="notes" label="Notes" help="Visible to staff" />
        <Checkbox id="consent" label="Customer consent recorded" error="Required" />
      </div>,
    );

    const field = screen.getByLabelText("Customer name");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(field.getAttribute("aria-describedby")).toBe(
      "customer-name-help customer-name-error",
    );
    expect(screen.getAllByRole("alert")).toHaveLength(2);
    expect(document.getElementById("customer-name-error")?.textContent).toBe("Required");
    expect(document.getElementById("consent-error")?.textContent).toBe("Required");

    expect(screen.getByLabelText("Term").getAttribute("aria-describedby")).toBe("term-help");
    expect(screen.getByLabelText("Notes").getAttribute("aria-describedby")).toBe("notes-help");

    const checkbox = screen.getByLabelText("Customer consent recorded");
    expect(checkbox.getAttribute("aria-invalid")).toBe("true");
    expect(checkbox.getAttribute("aria-describedby")).toBe("consent-error");
  });
});

it("renders the caller-provided empty state", () => {
  render(
    <DataList
      rows={[]}
      columns={columns}
      caption="Customers"
      empty={<p>No customers yet</p>}
    />,
  );
  expect(screen.getByText("No customers yet")).toBeTruthy();
});
