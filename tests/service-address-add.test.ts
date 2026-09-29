import { describe, it, expect, vi, beforeEach } from "vitest";

// Adding a property to a customer who already exists (2026-09-28) — the
// "still open" gap from docs/BUSINESS-RULES.md's "Property managers /
// portfolio accounts" section: previously an address could only be
// added at customer-creation time (createCustomerDirectly, see
// tests/customer-direct-create.test.ts); anything after that needed a
// direct database edit.

const customerFindUnique = vi.fn();
const serviceAddressCreate = vi.fn();
const auditLogCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    customer: {
      findUnique: (...args: unknown[]) => customerFindUnique(...args),
    },
    serviceAddress: {
      create: (...args: unknown[]) => serviceAddressCreate(...args),
    },
    auditLog: {
      create: (...args: unknown[]) => auditLogCreate(...args),
    },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  },
}));

describe("addServiceAddress — adding a property to an existing customer", () => {
  beforeEach(() => {
    customerFindUnique.mockReset().mockResolvedValue({ id: "cust-1" });
    serviceAddressCreate.mockReset().mockResolvedValue({ id: "addr-2", line1: "2 Main St" });
    auditLogCreate.mockReset().mockResolvedValue({});
  });

  it("creates a ServiceAddress under the given customer", async () => {
    const { addServiceAddress } = await import("@/domains/customers");

    await addServiceAddress("cust-1", "owner-1", {
      line1: "2 Main St",
      city: "Greeley",
      zip: "80631",
    });

    expect(serviceAddressCreate).toHaveBeenCalledTimes(1);
    expect(serviceAddressCreate.mock.calls[0][0].data).toMatchObject({
      customerId: "cust-1",
      line1: "2 Main St",
      city: "Greeley",
      state: "CO",
      zip: "80631",
    });
  });

  it("defaults state to CO when not given, same as customer creation", async () => {
    const { addServiceAddress } = await import("@/domains/customers");

    await addServiceAddress("cust-1", "owner-1", { line1: "9 Elm St", city: "Fort Collins", zip: "80521" });

    expect(serviceAddressCreate.mock.calls[0][0].data.state).toBe("CO");
  });

  it("logs an audit entry distinct from customer.create", async () => {
    const { addServiceAddress } = await import("@/domains/customers");

    await addServiceAddress("cust-1", "owner-1", { line1: "2 Main St", city: "Greeley", zip: "80631" });

    expect(auditLogCreate).toHaveBeenCalledTimes(1);
    const args = auditLogCreate.mock.calls[0][0].data;
    expect(args.action).toBe("customer.address.add");
    expect(args.entityType).toBe("Customer");
    expect(args.entityId).toBe("cust-1");
  });

  it("refuses to add an address to a customer that doesn't exist", async () => {
    customerFindUnique.mockResolvedValue(null);
    const { addServiceAddress } = await import("@/domains/customers");

    await expect(
      addServiceAddress("missing-cust", "owner-1", { line1: "2 Main St", city: "Greeley", zip: "80631" }),
    ).rejects.toThrow(/couldn't find that customer/i);
    expect(serviceAddressCreate).not.toHaveBeenCalled();
  });
});
