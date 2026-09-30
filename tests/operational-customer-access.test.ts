import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ role: vi.fn(), customer: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireRole: mocks.role }));
vi.mock("@/lib/prisma", () => ({ prisma: { customer: { findUnique: mocks.customer } } }));
import { getOperationalCustomerById } from "@/domains/customers/operational";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.role.mockResolvedValue({ user: { role: "STAFF" } });
  mocks.customer.mockResolvedValue(null);
});

it("uses an allowlisted customer query without credits, referrals, agreement prices or job costs", async () => {
  await getOperationalCustomerById("c-1");
  const query = mocks.customer.mock.calls[0][0];
  expect(query.where).toEqual({ id: "c-1" });
  expect(Object.keys(query.select).sort()).toEqual([
    "companyName", "contacts", "id", "jobs", "notes", "phone", "rentalAgreements", "serviceAddresses", "user",
  ]);
  expect(query.select.rentalAgreements.select).toEqual({ id: true, status: true, serviceAddressId: true });
  expect(query.select.jobs.select).toEqual({ id: true, type: true, status: true, scheduledAt: true });
  expect(query.select.user.select).toEqual({ name: true, email: true });
});

it("rejects unauthorized callers before loading another customer's operational record", async () => {
  mocks.role.mockRejectedValue(new Error("unauthorized"));
  await expect(getOperationalCustomerById("other-customer")).rejects.toThrow("unauthorized");
  expect(mocks.customer).not.toHaveBeenCalled();
});
