import { beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
const m = vi.hoisted(() => ({ role: vi.fn(), customer: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/prisma", () => ({
  prisma: { customer: { findUnique: m.customer } },
}));
import { PropertyServiceContext } from "@/components/desk/property-service-context";
import { getCustomerProperties } from "@/domains/customers/workspace";
beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  m.role.mockResolvedValue({ user: { role: "OWNER" } });
});
const addresses = [
  { id: "a", line1: "10 Oak", city: "Greeley" },
  { id: "b", line1: "20 Elm", city: "Evans" },
];
it("links each recorded visit/request to its actual property, without assigning unrelated requests", () => {
  render(
    <PropertyServiceContext
      addresses={addresses}
      jobs={[
        {
          id: "visit",
          serviceAddressId: "b",
          scheduledAt: null,
          type: "MAINTENANCE_VISIT",
          status: "SCHEDULED",
        },
      ]}
      requests={[
        {
          id: "one",
          status: "SCHEDULED",
          problem: "Leaks",
          jobs: [{ serviceAddressId: "a" }],
        },
        { id: "unknown", status: "SUBMITTED", problem: "Noise", jobs: [] },
        {
          id: "foreign",
          status: "REVIEWING",
          problem: "Foreign link",
          jobs: [{ serviceAddressId: "other-account" }],
        },
      ]}
    />,
  );
  const oak = screen
    .getByRole("heading", { name: "10 Oak, Greeley" })
    .closest("section")!;
  const elm = screen
    .getByRole("heading", { name: "20 Elm, Evans" })
    .closest("section")!;
  expect(within(oak).getByRole("link", { name: /Leaks/ })).toHaveAttribute(
    "href",
    "/desk/maintenance/one",
  );
  expect(
    within(oak).queryByRole("link", { name: /MAINTENANCE VISIT/ }),
  ).toBeNull();
  expect(
    within(elm).getByRole("link", { name: /MAINTENANCE VISIT/ }),
  ).toHaveAttribute("href", "/desk/jobs/visit");
  expect(within(elm).getByText("Not scheduled")).toBeVisible();
  const unknown = screen
    .getByRole("heading", { name: "Requests without a recorded property" })
    .closest("section")!;
  expect(within(unknown).getAllByRole("link")).toHaveLength(2);
  expect(within(unknown).getByRole("link", { name: /Noise/ })).toHaveAttribute(
    "href",
    "/desk/maintenance/unknown",
  );
});
it("discloses multiple recorded property links and deduplicates repeated jobs at one property", () => {
  render(
    <PropertyServiceContext
      addresses={addresses}
      jobs={[]}
      requests={[
        {
          id: "shared",
          status: "IN_PROGRESS",
          problem: "Follow up",
          jobs: [
            { serviceAddressId: "a" },
            { serviceAddressId: "a" },
            { serviceAddressId: "b" },
          ],
        },
      ]}
    />,
  );
  expect(screen.getAllByRole("link", { name: /Follow up/ })).toHaveLength(2);
  expect(
    screen.getAllByText(
      "Recorded visits link this request to more than one property.",
    ),
  ).toHaveLength(2);
});
it("denies property context before fetching any customer records", async () => {
  m.role.mockRejectedValue(new Error("Denied"));
  await expect(getCustomerProperties("customer")).rejects.toThrow("Denied");
  expect(m.customer).not.toHaveBeenCalled();
});
