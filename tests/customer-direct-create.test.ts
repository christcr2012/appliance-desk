import { sendPasswordEmail } from "@/lib/password-email";
import { describe, it, expect, vi, beforeEach } from "vitest";

// "Add a customer directly" (2026-09-27) — Chris signing someone up
// himself (a call-in, a walk-in, a property manager he's already been
// talking to) instead of always waiting for a website lead to convert.
// createCustomerDirectly (src/domains/customers/index.ts) deliberately
// reuses convertLeadToCustomer's exact account-creation rules (see
// tests/leads-conversion.test.ts) via the same shared helpers, so these
// tests focus on what's actually different here: creating more than one
// ServiceAddress up front for a property-manager customer, and the two
// "this email already belongs to someone" guards.

const userFindUnique = vi.fn();
const userUpdate = vi.fn();
const customerFindUnique = vi.fn();
const customerCreate = vi.fn();
const serviceAddressCreate = vi.fn();
const auditLogCreate = vi.fn();
const signUpEmail = vi.fn();
const requestPasswordReset = vi.fn();

const txCustomerFindUnique = vi.fn();

function makeTx() {
  return {
    customer: { create: customerCreate, findUnique: txCustomerFindUnique },
    serviceAddress: { create: serviceAddressCreate },
    auditLog: { create: auditLogCreate },
  };
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => userFindUnique(...args),
      update: (...args: unknown[]) => userUpdate(...args),
    },
    customer: {
      findUnique: (...args: unknown[]) => customerFindUnique(...args),
    },
    $transaction: async (fn: (tx: unknown) => unknown) => fn(makeTx()),
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      signUpEmail: (...args: unknown[]) => signUpEmail(...args),
      requestPasswordReset: (...args: unknown[]) => requestPasswordReset(...args),
    },
  },
}));

vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn().mockResolvedValue({ sent: true }),
}));

vi.mock("@/domains/settings", () => ({
  getBusinessSettings: vi.fn(),
  parseServiceArea: vi.fn(),
}));

const INPUT = {
  name: "Pat Landlord",
  email: "pat@example.com",
  phone: "555-1234",
  isBusiness: true,
  isPropertyManager: true,
  companyName: "Pat Properties LLC",
  addresses: [
    { line1: "1 Main St", city: "Greeley", zip: "80631" },
    { line1: "2 Main St", city: "Greeley", zip: "80631" },
    { line1: "3 Main St", city: "Greeley", zip: "80631" },
  ],
};

describe("createCustomerDirectly — Chris adding a customer himself", () => {
  beforeEach(() => {
    userFindUnique.mockReset();
    userUpdate.mockReset().mockResolvedValue({ id: "user-1", role: "CUSTOMER" });
    customerFindUnique.mockReset().mockResolvedValue(null);
    txCustomerFindUnique.mockReset().mockResolvedValue(null);
    customerCreate.mockReset().mockResolvedValue({ id: "cust-1" });
    serviceAddressCreate.mockReset().mockImplementation((args: { data: { line1: string } }) =>
      Promise.resolve({ id: `addr-${args.data.line1}`, ...args.data }),
    );
    auditLogCreate.mockReset().mockResolvedValue({});
    signUpEmail.mockReset().mockResolvedValue({ user: { id: "user-1" } });
    requestPasswordReset.mockReset().mockImplementation(async ({ body }) => {
      await sendPasswordEmail({ to: body.email, subject: "Setup", text: "Setup" });
      return { status: true };
    });
  });

  it("creates one ServiceAddress per property for a portfolio (property-manager) customer", async () => {
    userFindUnique.mockResolvedValue(null);
    const { createCustomerDirectly } = await import("@/domains/customers");

    const result = await createCustomerDirectly("owner-1", INPUT);

    expect(customerCreate).toHaveBeenCalledTimes(1);
    expect(customerCreate.mock.calls[0][0].data.isPropertyManager).toBe(true);
    expect(serviceAddressCreate).toHaveBeenCalledTimes(3);
    expect(result.customer.id).toBe("cust-1");
  });

  it("returns the created service addresses alongside the customer — the rental builder wizard uses these to move straight to picking one", async () => {
    userFindUnique.mockResolvedValue(null);
    const { createCustomerDirectly } = await import("@/domains/customers");

    const result = await createCustomerDirectly("owner-1", INPUT);

    expect(result.serviceAddresses).toHaveLength(3);
    expect(result.serviceAddresses[0]).toMatchObject({ line1: "1 Main St", city: "Greeley" });
  });

  it("creates a new account with a discarded random password and emails an activation link", async () => {
    userFindUnique.mockResolvedValue(null);
    const { createCustomerDirectly } = await import("@/domains/customers");

    const result = await createCustomerDirectly("owner-1", INPUT);

    expect(signUpEmail).toHaveBeenCalledTimes(1);
    const signUpArgs = signUpEmail.mock.calls[0][0];
    expect(signUpArgs.body.email).toBe("pat@example.com");
    expect(typeof signUpArgs.body.password).toBe("string");
    expect(signUpArgs.body.password.length).toBeGreaterThan(20);
    expect(result.isNewAccount).toBe(true);
    expect(result.activationEmailSent).toBe(true);
    expect(result).not.toHaveProperty("tempPassword");
  });

  it("refuses to add a customer on an email that already belongs to a customer account", async () => {
    userFindUnique.mockResolvedValue({ id: "user-1", role: "CUSTOMER" });
    customerFindUnique.mockResolvedValue({ id: "cust-existing" });
    const { createCustomerDirectly } = await import("@/domains/customers");

    await expect(createCustomerDirectly("owner-1", INPUT)).rejects.toThrow(
      /already a customer/i,
    );
    expect(customerCreate).not.toHaveBeenCalled();
  });

  it("refuses to add a customer on an email that belongs to a staff (OWNER/ADMIN) account", async () => {
    userFindUnique.mockResolvedValue({ id: "staff-1", role: "OWNER" });
    const { createCustomerDirectly } = await import("@/domains/customers");

    await expect(createCustomerDirectly("owner-1", INPUT)).rejects.toThrow(
      /staff account/i,
    );
    expect(signUpEmail).not.toHaveBeenCalled();
    expect(customerCreate).not.toHaveBeenCalled();
  });

  it("logs an audit entry recording how many properties were added", async () => {
    userFindUnique.mockResolvedValue(null);
    const { createCustomerDirectly } = await import("@/domains/customers");

    await createCustomerDirectly("owner-1", INPUT);

    expect(auditLogCreate).toHaveBeenCalledTimes(1);
    const auditArgs = auditLogCreate.mock.calls[0][0].data;
    expect(auditArgs.action).toBe("customer.create");
    expect(auditArgs.newValue.addressCount).toBe(3);
    expect(auditArgs.newValue.isPropertyManager).toBe(true);
  });
});
