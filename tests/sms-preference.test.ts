import { describe, it, expect, vi, beforeEach } from "vitest";

// updateSmsPreference (src/domains/portal/index.ts, Task #71) — the
// customer-facing SMS opt-in/opt-out, per docs/BUSINESS-RULES.md's
// privacy baseline: real, recorded consent, never assumed.

const customerFindUniqueOrThrow = vi.fn();
const customerUpdate = vi.fn();
const consentRecordCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    customer: {
      findUniqueOrThrow: (...args: unknown[]) => customerFindUniqueOrThrow(...args),
    },
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        customer: { update: (...args: unknown[]) => customerUpdate(...args) },
        consentRecord: { create: (...args: unknown[]) => consentRecordCreate(...args) },
      }),
  },
}));

vi.mock("@/lib/email", () => ({ sendEmail: vi.fn().mockResolvedValue({ sent: true }) }));
vi.mock("@/domains/settings", () => ({ getBusinessSettings: vi.fn() }));
vi.mock("@/domains/agreements/active-appliances", () => ({
  ACTIVE_ASSIGNMENT_WHERE: {},
  getActiveApplianceOptionsForUser: vi.fn(),
}));

import { updateSmsPreference } from "@/domains/portal";

describe("updateSmsPreference", () => {
  beforeEach(() => {
    customerFindUniqueOrThrow.mockReset().mockResolvedValue({
      id: "cust-1",
      phone: "3035550100",
    });
    customerUpdate.mockReset().mockImplementation(({ data }) =>
      Promise.resolve({ phone: data.phone, smsOptInAt: data.smsOptInAt }),
    );
    consentRecordCreate.mockReset().mockResolvedValue({});
  });

  it("opts in using the phone number already on file, and records consent", async () => {
    const result = await updateSmsPreference("user-1", { optedIn: true, phone: null });

    expect(result.phone).toBe("3035550100");
    expect(result.smsOptInAt).toBeInstanceOf(Date);
    expect(consentRecordCreate).toHaveBeenCalledWith({
      data: { customerId: "cust-1", kind: "sms_opt_in", details: { optedIn: true } },
    });
  });

  it("opts in using a freshly-entered phone number, overriding the one on file", async () => {
    const result = await updateSmsPreference("user-1", { optedIn: true, phone: "7205551234" });

    expect(customerUpdate).toHaveBeenCalledWith({
      where: { id: "cust-1" },
      data: { phone: "7205551234", smsOptInAt: expect.any(Date) },
    });
    expect(result.phone).toBe("7205551234");
  });

  it("refuses to opt in with no phone number on file and none given", async () => {
    customerFindUniqueOrThrow.mockResolvedValue({ id: "cust-1", phone: null });

    await expect(updateSmsPreference("user-1", { optedIn: true, phone: null })).rejects.toThrow(
      /add a phone number/i,
    );
    expect(customerUpdate).not.toHaveBeenCalled();
  });

  it("opting out clears smsOptInAt and still records the consent change", async () => {
    const result = await updateSmsPreference("user-1", { optedIn: false, phone: null });

    expect(result.smsOptInAt).toBeNull();
    expect(consentRecordCreate).toHaveBeenCalledWith({
      data: { customerId: "cust-1", kind: "sms_opt_in", details: { optedIn: false } },
    });
  });

  it("opting out with no phone number on file is fine (nothing to validate against)", async () => {
    customerFindUniqueOrThrow.mockResolvedValue({ id: "cust-1", phone: null });

    await expect(
      updateSmsPreference("user-1", { optedIn: false, phone: null }),
    ).resolves.not.toThrow();
  });
});
