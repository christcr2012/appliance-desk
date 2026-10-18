// ENH-F (BATCH-F, F2-D): the customer's estimate approval is saved first; the activation email goes out after the save.
// A thrown sender, a switched-off sender and a successful send all leave exactly one account, no agreement is created by the
// approval, the approval itself is reported as done (it never throws because of the email), and a retry after the save creates
// no second account or agreement - only the message can be sent again. The email provider is faked at its client boundary.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const sender = vi.hoisted(() => ({ account: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendEmail: (...a: unknown[]) => sender.account(...a), getEmailAcceptedAt: async () => null }));
vi.mock("@/lib/auth", async () => {
  const { sendPasswordEmail } = await import("@/lib/password-email");
  return {
    auth: {
      api: {
        requestPasswordReset: async ({ body }: { body: { email: string } }) => {
          await sendPasswordEmail({ to: body.email, subject: "Set your password", text: "scenario" });
          return { status: true };
        },
      },
      $context: Promise.resolve({ password: { hash: async (password: string) => `scenario-hash:${password.length}` } }),
    },
  };
});
vi.mock("@/domains/tax/locations", async (original) => ({ ...(await original<Record<string, unknown>>()), locateServiceAddress: async () => null }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
const quote = vi.hoisted(() => ({ fingerprint: "e".repeat(64), order: "f".repeat(64) }));
vi.mock("@/domains/estimates/preapproval-quote", () => ({
  getPreparedEstimateQuoteInTx: async () => ({
    status: "READY", reasons: [], permissionToCollect: false, quoteFingerprint: quote.fingerprint, orderFingerprint: quote.order,
    locations: [], totals: { monthlyRentCents: 6000, monthlyRentTaxCents: 0, setupFeeCents: 0, setupTaxCents: 0, advanceCents: 0, dueAtSigningCents: 0 },
  }),
}));

import { prisma } from "@/lib/prisma";
import { createLead, sendCustomerActivationEmail } from "@/domains/leads";
import { leadFormSchema } from "@/domains/leads/schema";
import { approveEstimate } from "@/domains/estimates";
import { purgeScenarioQueues } from "../helpers/scenario-order";

const scenarioStartedAt = new Date();
const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("scenario 7b: the approval is saved even when the activation email cannot be sent", () => {
  const tag = randomUUID().replaceAll("-", "");
  let owner = "";
  const leads: string[] = [];
  const estimates: string[] = [];
  const emails: string[] = [];

  async function newApprovableEstimate(name: string) {
    const email = `sc7b-${name}-${tag}@test.invalid`;
    emails.push(email);
    const type = await prisma.applianceType.findFirstOrThrow();
    const lead = await createLead(leadFormSchema.parse({
      accountType: "individual", isPropertyManager: false, contactName: `Scenario 7b ${name}`, phone: "5551230071", email, applianceTypeIds: [type.id],
      quantity: 1, desiredTerm: "12-month", city: "Greeley", zip: "80631", consent: true,
    }));
    leads.push(lead.id);
    const estimate = await prisma.estimate.create({
      data: { leadId: lead.id, createdByUserId: owner, title: `Scenario 7b ${name}`, status: "SENT", reviewedQuoteFingerprint: quote.fingerprint, reviewedOrderFingerprint: quote.order, reviewedQuoteAt: new Date() },
    });
    estimates.push(estimate.id);
    return { email, id: estimate.id, leadId: lead.id };
  }
  const approval = { expectedQuoteFingerprint: quote.fingerprint, approverName: "Scenario Approver", approverEmail: "approver@test.invalid", ipAddress: "127.0.0.1" };
  // The staff "New lead" alert from creating the lead is not part of the approval; count only mail to this customer.
  const sentTo = (email: string) => sender.account.mock.calls.filter((c: unknown[]) => (c[0] as { to?: string })?.to === email).length;
  const counts = async (email: string, estimateId: string) => ({
    users: await prisma.user.count({ where: { email } }),
    customers: await prisma.customer.count({ where: { user: { email } } }),
    agreements: await prisma.rentalAgreement.count({ where: { sourceEstimateId: estimateId } }),
  });

  beforeAll(async () => {
    owner = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
  });
  beforeEach(() => sender.account.mockReset().mockResolvedValue({ sent: true }));
  afterAll(async () => {
    await purgeScenarioQueues(scenarioStartedAt);
    const customers = (await prisma.customer.findMany({ where: { user: { email: { in: emails } } }, select: { id: true } })).map((c) => c.id);
    await prisma.auditLog.deleteMany({ where: { entityId: { in: [...estimates, ...leads, ...customers] } } });
    await prisma.estimate.deleteMany({ where: { id: { in: estimates } } });
    await prisma.lead.deleteMany({ where: { id: { in: leads } } });
    await prisma.serviceAddress.deleteMany({ where: { customerId: { in: customers } } });
    await prisma.customer.deleteMany({ where: { id: { in: customers } } });
    await prisma.account.deleteMany({ where: { user: { email: { in: emails } } } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
  });

  it("a sender that throws after the save does not fail the approval; a retry creates nothing new and the email can be sent again", async () => {
    const fixture = await newApprovableEstimate("throws");
    sender.account.mockRejectedValue(new Error("provider is down"));
    await expect(approveEstimate(fixture.id, approval)).resolves.toBeUndefined();
    expect((await prisma.estimate.findUniqueOrThrow({ where: { id: fixture.id } })).status).toBe("APPROVED");
    expect(await counts(fixture.email, fixture.id)).toEqual({ users: 1, customers: 1, agreements: 0 });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: fixture.leadId } })).status).toBe("CONVERTED");

    // The customer presses approve again: the saved approval is not repeated and nothing new is created.
    await expect(approveEstimate(fixture.id, approval)).rejects.toThrow(/isn't available/);
    expect(await counts(fixture.email, fixture.id)).toEqual({ users: 1, customers: 1, agreements: 0 });

    // Only the message is retried, and it works once the provider is back.
    expect(sentTo(fixture.email)).toBe(1); // the one attempt that threw
    sender.account.mockReset().mockResolvedValue({ sent: true });
    expect(await sendCustomerActivationEmail(fixture.email)).toBe(true);
    expect(sentTo(fixture.email)).toBe(1); // only the retry
    expect(await counts(fixture.email, fixture.id)).toEqual({ users: 1, customers: 1, agreements: 0 });
  });

  it("a switched-off sender is not a failure: the approval is saved and the email is simply not sent", async () => {
    const fixture = await newApprovableEstimate("off");
    sender.account.mockResolvedValue({ sent: false, outcome: "NOT_ATTEMPTED" });
    await expect(approveEstimate(fixture.id, approval)).resolves.toBeUndefined();
    expect((await prisma.estimate.findUniqueOrThrow({ where: { id: fixture.id } })).status).toBe("APPROVED");
    expect(await counts(fixture.email, fixture.id)).toEqual({ users: 1, customers: 1, agreements: 0 });
    expect(sentTo(fixture.email)).toBe(1);
  });

  it("a successful send makes one account, sends one email and creates no agreement by itself", async () => {
    const fixture = await newApprovableEstimate("ok");
    await expect(approveEstimate(fixture.id, approval)).resolves.toBeUndefined();
    expect((await prisma.estimate.findUniqueOrThrow({ where: { id: fixture.id } })).status).toBe("APPROVED");
    expect(await counts(fixture.email, fixture.id)).toEqual({ users: 1, customers: 1, agreements: 0 });
    expect(sentTo(fixture.email)).toBe(1);
  });
});
