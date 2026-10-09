import { describe, it, expect, vi, beforeEach } from "vitest";

// updateSmsPreference (src/domains/portal/index.ts, Task #71) — the
// customer-facing SMS opt-in/opt-out, per docs/BUSINESS-RULES.md's
// privacy baseline: real, recorded consent, never assumed.

const customerFindUniqueOrThrow = vi.fn();
const customerUpdate = vi.fn();
const consentRecordCreate = vi.fn();
const consentRecordCreateMany = vi.fn();
const contactPointUpsert = vi.fn();
const bindingUpdateMany = vi.fn();
const bindingFindMany = vi.fn();
const businessSettingsFindUnique = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    customer: {
      findUniqueOrThrow: (...args: unknown[]) => customerFindUniqueOrThrow(...args),
    },
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        customer: {
          update: (...args: unknown[]) => customerUpdate(...args),
          findUniqueOrThrow: (...args: unknown[]) => customerFindUniqueOrThrow(...args),
        },
        $queryRaw: vi.fn().mockResolvedValue([]),
        consentRecord: {
          create: (...args: unknown[]) => consentRecordCreate(...args),
          createMany: (...args: unknown[]) => consentRecordCreateMany(...args),
        },
        businessSettings: { findUnique: (...args: unknown[]) => businessSettingsFindUnique(...args) },
        contactPoint: { upsert: (...args: unknown[]) => contactPointUpsert(...args) },
        contactBinding: {
          updateMany: (...args: unknown[]) => bindingUpdateMany(...args),
          findMany: (...args: unknown[]) => bindingFindMany(...args),
        },
        $executeRaw: vi.fn().mockResolvedValue(1),
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
    consentRecordCreateMany.mockReset().mockResolvedValue({ count: 1 });
    contactPointUpsert.mockReset().mockResolvedValue({ id: "point-test" });
    bindingUpdateMany.mockReset().mockResolvedValue({ count: 0 });
    bindingFindMany.mockReset().mockResolvedValue([]);
    businessSettingsFindUnique.mockReset().mockResolvedValue(null);
  });

  it("opts in using the phone number already on file, canonicalizes it, and records consent", async () => {
    const result = await updateSmsPreference("user-1", { optedIn: true, phone: null });

    expect(result.phone).toBe("+13035550100");
    expect(result.smsOptInAt).toBeInstanceOf(Date);
    const scoped = consentRecordCreateMany.mock.calls[0][0].data;
    expect(scoped).toHaveLength(1);
    expect(scoped[0]).toMatchObject({
      purpose: "SMS_TRANSACTIONAL", action: "GRANT", source: "PORTAL",
      scope: { businessNumberId: null, channel: "SMS" },
      disclosureVersion: expect.any(String), textHash: expect.any(String),
    });
    expect(scoped[0].details.disclosure).toContain("Reply STOP");
    expect(customerUpdate).toHaveBeenCalledWith({
      where: { id: "cust-1" },
      data: { phone: "+13035550100", smsOptInAt: expect.any(Date) },
    });
    expect(consentRecordCreate).toHaveBeenCalledWith({
      data: {
        customerId: "cust-1",
        kind: "sms_opt_in",
        details: { optedIn: true, phone: "+13035550100" },
      },
    });
  });

  it("opts in using a freshly-entered formatted phone number and stores E.164", async () => {
    const result = await updateSmsPreference("user-1", {
      optedIn: true,
      phone: "(720) 555-1234",
    });

    expect(customerUpdate).toHaveBeenCalledWith({
      where: { id: "cust-1" },
      data: { phone: "+17205551234", smsOptInAt: expect.any(Date) },
    });
    expect(result.phone).toBe("+17205551234");
  });

  it("cannot use a stranger's verified phone binding to grant outbound texts", async () => {
    businessSettingsFindUnique.mockResolvedValue({
      communicationsPolicyVersion: 1,
      communicationsPolicy: {
        schemaVersion: 1, manualSmsEnabled: true,
        primaryAccountId: "account-1", primaryNumberId: "business-number-1",
        approvedPolicyVersion: 1, maxSegments: 3,
        supportedCountries: ["US"],
      },
    });
    bindingFindMany.mockResolvedValueOnce([
      { customerId: "different-customer", leadId: null, customerContact: null },
    ]);
    await updateSmsPreference("user-1", { optedIn: true, phone: "+13035550100" });
    expect(consentRecordCreateMany.mock.calls[0][0].data[0].scope.businessNumberId).toBeNull();

    bindingFindMany.mockResolvedValueOnce([
      { customerId: "cust-1", leadId: null, customerContact: null },
    ]);
    await updateSmsPreference("user-1", { optedIn: true, phone: "+13035550100" });
    expect(consentRecordCreateMany.mock.calls[1][0].data[0].scope.businessNumberId)
      .toBe("business-number-1");
  });

  it("rejects a concurrently changed phone rather than attaching consent to an outdated number", async () => {
    customerFindUniqueOrThrow
      .mockResolvedValueOnce({ id: "cust-1", phone: "+13035550100" })
      .mockResolvedValueOnce({ phone: "+17205550100" });
    await expect(updateSmsPreference("user-1", {
      optedIn: true, phone: "+13035550100",
    })).rejects.toThrow(/phone number changed/i);
    expect(consentRecordCreateMany).not.toHaveBeenCalled();
    expect(customerUpdate).not.toHaveBeenCalled();
  });

  it("refuses to opt in with no phone number on file and none given", async () => {
    customerFindUniqueOrThrow.mockResolvedValue({ id: "cust-1", phone: null });

    await expect(updateSmsPreference("user-1", { optedIn: true, phone: null })).rejects.toThrow(
      /add a phone number/i,
    );
    expect(customerUpdate).not.toHaveBeenCalled();
  });

  it("refuses an invalid phone before recording opt-in", async () => {
    await expect(
      updateSmsPreference("user-1", { optedIn: true, phone: "555" }),
    ).rejects.toThrow(/valid.*phone/i);
    expect(customerUpdate).not.toHaveBeenCalled();
  });

  it("opting out clears smsOptInAt and still records the consent change", async () => {
    const result = await updateSmsPreference("user-1", { optedIn: false, phone: null });

    expect(result.smsOptInAt).toBeNull();
    expect(consentRecordCreate).toHaveBeenCalledWith({
      data: {
        customerId: "cust-1",
        kind: "sms_opt_in",
        details: { optedIn: false, phone: "3035550100" },
      },
    });
  });

  it("opting out with no phone number on file is fine (nothing to validate against)", async () => {
    customerFindUniqueOrThrow.mockResolvedValue({ id: "cust-1", phone: null });

    await expect(
      updateSmsPreference("user-1", { optedIn: false, phone: null }),
    ).resolves.not.toThrow();
    expect(consentRecordCreate).toHaveBeenCalledWith({
      data: { customerId: "cust-1", kind: "sms_opt_in", details: { optedIn: false } },
    });
  });
});
