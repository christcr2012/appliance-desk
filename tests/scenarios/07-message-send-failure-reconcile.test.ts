// PLAN scenario 7 (BATCH-F WU-F3): a customer message fails to send AFTER the business change was saved. The change stands and is
// reported as done with the message still to do; a retry never creates a second account; a send whose outcome is unknown is held
// for a person (UNCERTAIN) rather than repeated, and a person confirms it; a switched-off sender is a different state from a
// failing one; a reminder whose last day passed is MISSED and never sent. The email providers are faked at their client boundary.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const sender = vi.hoisted(() => ({
  account: vi.fn(), // staff/account email (invitations) through @/lib/email
  customer: vi.fn(), // customer-facing messages through @/lib/customer-email
}));
vi.mock("@/lib/email", () => ({ sendEmail: (...a: unknown[]) => sender.account(...a), getEmailAcceptedAt: async () => null }));
vi.mock("@/lib/customer-email", () => ({ sendCustomerEmail: (...a: unknown[]) => sender.customer(...a) }));
vi.mock("@/lib/auth", async () => {
  const { sendPasswordEmail } = await import("@/lib/password-email");
  return {
    auth: {
      api: {
        // The real reset flow hands its message to the password-email sender, which uses the faked provider above.
        requestPasswordReset: async ({ body }: { body: { email: string } }) => {
          await sendPasswordEmail({ to: body.email, subject: "Set your password", text: "scenario" });
          return { status: true };
        },
      },
      $context: Promise.resolve({ password: { hash: async (password: string) => `scenario-hash:${password.length}` } }),
    },
  };
});
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { prisma } from "@/lib/prisma";
import { businessDateKey } from "@/lib/business-date";
import { createLead, convertLeadToCustomer, sendCustomerActivationEmail } from "@/domains/leads";
import { leadFormSchema } from "@/domains/leads/schema";
import { createNoticeInTx, confirmEmailOutcome, sendPendingNotices } from "@/domains/notices";
import { purgeScenarioQueues } from "../helpers/scenario-order";

const scenarioStartedAt = new Date();
const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("scenario 7: a message fails to send after the change was saved", () => {
  const tag = randomUUID().replaceAll("-", "");
  const originalVercel = process.env.VERCEL;
  const originalVercelEnv = process.env.VERCEL_ENV;
  let owner = "";
  let leadId = "";
  let customerId = "";
  let noticeUserId = "";
  let noticeCustomerId = "";
  const noticeIds: string[] = [];
  const email = `scenario7-${tag}@test.invalid`;

  const makeNotice = async (name: string, extra: { earliestAt?: Date | null; deadlineAt?: Date | null } = {}) => {
    const { id } = await prisma.$transaction((tx) =>
      createNoticeInTx(tx, {
        customerId: noticeCustomerId, agreementId: null, kind: "RENEWAL_REMINDER", dedupeKey: `sc7-${tag}-${name}`,
        subject: `Scenario 7 ${name}`, body: "Your rental renews soon.", ...extra,
      }),
    );
    noticeIds.push(id);
    return id;
  };
  const status = async (id: string) => (await prisma.customerNotice.findUniqueOrThrow({ where: { id } })).status;
  const ledger = (id: string) => prisma.messageDelivery.findUnique({ where: { idempotencyKey: `customer-notice-${id}` } });

  beforeAll(async () => {
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    owner = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    noticeUserId = (await prisma.user.create({ data: { email: `sc7-notice-${tag}@example.test`, name: "SC7 Notice", role: "CUSTOMER", emailVerified: true } })).id;
    noticeCustomerId = (await prisma.customer.create({ data: { userId: noticeUserId, referralCode: `N${tag.slice(0, 18)}` } })).id;
  });
  beforeEach(() => {
    sender.account.mockReset().mockResolvedValue({ sent: true });
    sender.customer.mockReset().mockResolvedValue({ sent: true, outcome: "SENT", providerMessageId: `sc7-${randomUUID()}` });
  });
  afterAll(async () => {
    await purgeScenarioQueues(scenarioStartedAt);
    if (originalVercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = originalVercel;
    if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = originalVercelEnv;
    await prisma.auditLog.deleteMany({ where: { entityId: { in: [...noticeIds, leadId, customerId].filter(Boolean) } } });
    await prisma.messageDelivery.deleteMany({ where: { idempotencyKey: { in: noticeIds.map((id) => `customer-notice-${id}`) } } });
    await prisma.customerNotice.deleteMany({ where: { customerId: noticeCustomerId } });
    await prisma.customer.deleteMany({ where: { id: { in: [noticeCustomerId, customerId].filter(Boolean) } } });
    await prisma.lead.deleteMany({ where: { id: leadId || "none" } });
    await prisma.account.deleteMany({ where: { user: { email: { in: [email, `sc7-notice-${tag}@example.test`] } } } });
    await prisma.user.deleteMany({ where: { email: { in: [email, `sc7-notice-${tag}@example.test`] } } });
  });

  it("a conversion whose activation email fails is still done; the retry never makes a second account", async () => {
    const type = await prisma.applianceType.findFirstOrThrow();
    const lead = await createLead(leadFormSchema.parse({
      accountType: "individual", isPropertyManager: false, contactName: "Scenario Seven", phone: "5551230007", email, applianceTypeIds: [type.id], quantity: 1,
      desiredTerm: "12-month", city: "Greeley", zip: "80631", consent: true,
    }));
    leadId = lead.id;
    sender.account.mockResolvedValue({ sent: false, outcome: "REJECTED" });
    const converted = await convertLeadToCustomer(owner, leadId);
    customerId = converted.customer.id;
    expect(converted).toMatchObject({ isNewAccount: true, activationEmailSent: false });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).status).toBe("CONVERTED");
    expect(await prisma.user.count({ where: { email } })).toBe(1);

    // Converting again is refused (the saved change is not repeated); only the message is re-sent, and now it works.
    await expect(convertLeadToCustomer(owner, leadId)).rejects.toThrow();
    sender.account.mockResolvedValue({ sent: true });
    expect(await sendCustomerActivationEmail(email)).toBe(true);
    expect(await prisma.user.count({ where: { email } })).toBe(1);
    expect(await prisma.customer.count({ where: { id: customerId } })).toBe(1);
  });

  it("a send with an unknown outcome is held for a person, not repeated, and the person's confirmation is recorded", async () => {
    const id = await makeNotice("unknown");
    sender.customer.mockRejectedValue(new Error("socket hang up"));
    const tally = await sendPendingNotices();
    expect(tally.uncertain).toBeGreaterThanOrEqual(1);
    expect(await status(id)).toBe("UNCERTAIN");
    expect((await ledger(id))!.state).toBe("UNKNOWN");
    // Only this notice's sends are counted: the shared database may hold other tests' waiting notices too.
    const callsFor = () => sender.customer.mock.calls.filter((call) => JSON.stringify(call).includes(id)).length;
    const calls = callsFor();
    expect(calls).toBe(2); // the one attempt and the single allowed retry with the same key

    // A later run does not send it a third time.
    await sendPendingNotices();
    expect(callsFor()).toBe(calls);
    expect(await status(id)).toBe("UNCERTAIN");

    // The owner checks the email service and records that it went out; the notice becomes SENT with who/when on the audit trail.
    await confirmEmailOutcome(owner, id, { sent: true, acceptedOn: businessDateKey(new Date()) });
    expect(await prisma.customerNotice.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "SENT", sentVia: "EMAIL", sentByUserId: owner });
    expect(await prisma.auditLog.count({ where: { entityId: id, action: "notice.email_confirmed_sent" } })).toBe(1);
    await expect(confirmEmailOutcome(owner, id, { sent: true, acceptedOn: businessDateKey(new Date()) })).rejects.toThrow(/not waiting/);
  });

  it("a switched-off sender is a different state from a failing one: the notice waits, then sends once when it is on", async () => {
    const id = await makeNotice("disabled");
    sender.customer.mockResolvedValue({ sent: false, outcome: "NOT_ATTEMPTED" });
    await sendPendingNotices();
    expect(await status(id)).toBe("PENDING"); // never claimed as sent
    expect((await ledger(id))!.state).toBe("NOT_SENT");

    sender.customer.mockReset().mockResolvedValue({ sent: true, outcome: "SENT", providerMessageId: `sc7-on-${tag}` });
    await sendPendingNotices();
    expect(await status(id)).toBe("SENT");
    expect((await ledger(id))!.state).toBe("ACCEPTED");
    expect(sender.customer).toHaveBeenCalledTimes(1);
    await sendPendingNotices();
    expect(sender.customer).toHaveBeenCalledTimes(1);
  });

  it("a definite refusal is retried later and a reminder past its last day is MISSED and never sent", async () => {
    const refused = await makeNotice("refused");
    sender.customer.mockResolvedValue({ sent: false, outcome: "REJECTED" });
    await sendPendingNotices();
    expect(await prisma.customerNotice.findUniqueOrThrow({ where: { id: refused } })).toMatchObject({ status: "PENDING", attempts: 1 });
    expect((await ledger(refused))!.state).toBe("FAILED");

    sender.customer.mockReset().mockResolvedValue({ sent: true, outcome: "SENT", providerMessageId: `sc7-late-${tag}` });
    const missed = await makeNotice("missed", { earliestAt: new Date("2020-01-01T00:00:00Z"), deadlineAt: new Date("2020-01-31T00:00:00Z") });
    const tally = await sendPendingNotices();
    expect(tally.missed).toBeGreaterThanOrEqual(1);
    expect(await status(missed)).toBe("MISSED");
    expect(await ledger(missed)).toBeNull(); // no provider contact at all for the stale promise
  });
});
