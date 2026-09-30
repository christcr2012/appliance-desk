import { describe, it, expect, vi, beforeEach } from "vitest";

// Phase 6A item 2 (customer account invitation & password recovery):
// converting a lead into a customer must never generate a password Chris
// has to see or relay — a brand-new account gets an unusable random
// password that's thrown away, and the customer is emailed a "set your
// password" link instead (src/domains/leads/index.ts's
// sendCustomerActivationEmail, which reuses Better Auth's own
// forgot-password token machinery — see src/lib/auth.ts's
// sendResetPassword). These tests prove that wiring without a real
// database or a real email provider.

const leadFindUniqueOrThrow = vi.fn();
const userFindUnique = vi.fn();
const userUpdate = vi.fn();
const customerFindUnique = vi.fn();
const customerCreate = vi.fn();
const serviceAddressCreate = vi.fn();
const leadUpdate = vi.fn();
const leadClaim = vi.fn();
const auditLogCreate = vi.fn();
const signUpEmail = vi.fn();
const requestPasswordReset = vi.fn();

function makeTx() {
  return {
    customer: { findUnique: customerFindUnique, create: customerCreate },
    serviceAddress: { create: serviceAddressCreate },
    lead: { update: leadUpdate, updateMany: leadClaim },
    auditLog: { create: auditLogCreate },
  };
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    lead: {
      findUniqueOrThrow: (...args: unknown[]) => leadFindUniqueOrThrow(...args),
    },
    user: {
      findUnique: (...args: unknown[]) => userFindUnique(...args),
      update: (...args: unknown[]) => userUpdate(...args),
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

const LEAD = {
  id: "lead-1",
  status: "NEW",
  email: "customer@example.com",
  contactName: "Pat Customer",
  phone: "555-1234",
  isBusiness: false,
  isPropertyManager: false,
  companyName: null,
  addressLine1: null,
  city: null,
  zip: null,
};

describe("convertLeadToCustomer — customer activation, no relayed passwords", () => {
  beforeEach(() => {
    leadFindUniqueOrThrow.mockReset().mockResolvedValue({ ...LEAD });
    userFindUnique.mockReset();
    userUpdate.mockReset().mockResolvedValue({ id: "user-1", role: "CUSTOMER" });
    customerFindUnique.mockReset().mockResolvedValue(null);
    customerCreate.mockReset().mockResolvedValue({ id: "cust-1" });
    serviceAddressCreate.mockReset().mockResolvedValue({});
    leadClaim.mockReset().mockResolvedValue({ count: 1 });
    leadUpdate.mockReset().mockResolvedValue({});
    auditLogCreate.mockReset().mockResolvedValue({});
    signUpEmail.mockReset().mockResolvedValue({ user: { id: "user-1" } });
    requestPasswordReset.mockReset().mockResolvedValue({ status: true });
  });

  it("creates a new account with a discarded random password and emails an activation link — never returns a password", async () => {
    userFindUnique.mockResolvedValue(null); // no existing account
    const { convertLeadToCustomer } = await import("@/domains/leads");

    const result = await convertLeadToCustomer("owner-1", "lead-1");

    expect(signUpEmail).toHaveBeenCalledTimes(1);
    const signUpArgs = signUpEmail.mock.calls[0][0];
    expect(signUpArgs.body.email).toBe("customer@example.com");
    expect(typeof signUpArgs.body.password).toBe("string");
    expect(signUpArgs.body.password.length).toBeGreaterThan(20);

    // The activation email is sent via Better Auth's own reset-password
    // request — not a bespoke token system.
    expect(requestPasswordReset).toHaveBeenCalledWith({
      body: { email: "customer@example.com", redirectTo: "/reset-password" },
    });

    expect(result.isNewAccount).toBe(true);
    expect(result.activationEmailSent).toBe(true);
    expect(result).not.toHaveProperty("tempPassword");
  });

  it("reuses an existing customer account and sends no activation email — nothing new to send", async () => {
    userFindUnique.mockResolvedValue({ id: "user-1", role: "CUSTOMER" });
    const { convertLeadToCustomer } = await import("@/domains/leads");

    const result = await convertLeadToCustomer("owner-1", "lead-1");

    expect(signUpEmail).not.toHaveBeenCalled();
    expect(requestPasswordReset).not.toHaveBeenCalled();
    expect(result.isNewAccount).toBe(false);
    expect(result.activationEmailSent).toBe(false);
  });

  it("still converts the lead even if the activation email fails to send — the account isn't blocked by a flaky send", async () => {
    userFindUnique.mockResolvedValue(null);
    requestPasswordReset.mockRejectedValue(new Error("network down"));
    const { convertLeadToCustomer } = await import("@/domains/leads");

    const result = await convertLeadToCustomer("owner-1", "lead-1");

    expect(result.isNewAccount).toBe(true);
    expect(result.activationEmailSent).toBe(false);
    expect(customerCreate).toHaveBeenCalledTimes(1);
  });

  it("refuses to convert a lead onto an existing staff (OWNER/ADMIN) email", async () => {
    userFindUnique.mockResolvedValue({ id: "staff-1", role: "OWNER" });
    const { convertLeadToCustomer } = await import("@/domains/leads");

    await expect(convertLeadToCustomer("owner-1", "lead-1")).rejects.toThrow(
      /staff account/i,
    );
    expect(signUpEmail).not.toHaveBeenCalled();
  });
  it("rejects a competing conversion before customer, address and audit writes", async () => {
    userFindUnique.mockResolvedValue({ id: "user-1", role: "CUSTOMER" });
    leadClaim.mockResolvedValue({ count: 0 });
    const { convertLeadToCustomer } = await import("@/domains/leads");
    await expect(convertLeadToCustomer("owner-1", "lead-1")).rejects.toThrow(/changed while converting/);
    expect(customerCreate).not.toHaveBeenCalled();
    expect(serviceAddressCreate).not.toHaveBeenCalled();
    expect(auditLogCreate).not.toHaveBeenCalled();
  });
  it("claims the original stage before writing the conversion", async () => {
    userFindUnique.mockResolvedValue({ id: "user-1", role: "CUSTOMER" });
    const { convertLeadToCustomer } = await import("@/domains/leads");
    await convertLeadToCustomer("owner-1", "lead-1");
    expect(leadClaim).toHaveBeenCalledWith({ where: { id: "lead-1", status: "NEW" }, data: { status: "CONVERTED" } });
    expect(leadClaim.mock.invocationCallOrder[0]).toBeLessThan(customerFindUnique.mock.invocationCallOrder[0]);
  });

});

describe("sendCustomerActivationEmail", () => {
  beforeEach(() => {
    requestPasswordReset.mockReset();
  });

  it("returns true when Better Auth's request-password-reset call succeeds", async () => {
    requestPasswordReset.mockResolvedValue({ status: true });
    const { sendCustomerActivationEmail } = await import("@/domains/leads");

    await expect(sendCustomerActivationEmail("a@example.com")).resolves.toBe(true);
    expect(requestPasswordReset).toHaveBeenCalledWith({
      body: { email: "a@example.com", redirectTo: "/reset-password" },
    });
  });

  it("returns false, without throwing, when the send fails", async () => {
    requestPasswordReset.mockRejectedValue(new Error("boom"));
    const { sendCustomerActivationEmail } = await import("@/domains/leads");

    await expect(sendCustomerActivationEmail("a@example.com")).resolves.toBe(false);
  });

});

