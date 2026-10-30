import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resolveInboundContact } from "@/domains/messaging/inbound-resolution";
import {
  linkThreadIdentity,
  listThreadOtherMatches,
  unlinkThreadIdentity,
} from "@/domains/messaging/thread-identity";

let enabled = false;
try {
  const t = new URL(process.env.DATABASE_URL ?? "");
  enabled =
    process.env.CI === "true" &&
    ["localhost", "127.0.0.1"].includes(t.hostname) &&
    t.pathname === "/appliance_desk_test";
} catch {
  enabled = false;
}

// AR-4d / QUOTES-MESSAGES spec sections 3 + 4: link a conversation's number
// to a person (and unlink it), with bindings, audits and resolver proof.
describe.skipIf(!enabled)("thread identity linking (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "").slice(0, 10);
  const owner = `tid-owner-${tag}`;
  const staff = `tid-staff-${tag}`;
  const custUserA = `tid-cust-user-a-${tag}`;
  const customerA = `tid-customer-a-${tag}`;
  const customerArchived = `tid-customer-x-${tag}`;
  const custUserX = `tid-cust-user-x-${tag}`;
  const leadB = `tid-lead-b-${tag}`;
  const account = `tid-account-${tag}`;
  const number = `tid-number-${tag}`;
  const point1 = `tid-point-1-${tag}`;
  const point2 = `tid-point-2-${tag}`;
  const point3 = `tid-point-3-${tag}`;
  const threadUnknown = `tid-thread-u-${tag}`;
  const threadAmbiguous = `tid-thread-a-${tag}`;
  const threadRace = `tid-thread-r-${tag}`;
  const consentId = `tid-consent-${tag}`;
  const threadIds = [threadUnknown, threadAmbiguous, threadRace];

  async function bindingsFor(pointId: string) {
    const rows = await prisma.contactBinding.findMany({
      where: { contactPointId: pointId },
      select: {
        id: true, customerId: true, leadId: true, source: true,
        verifiedAt: true, revokedAt: true,
        customerContact: { select: { customerId: true } },
      },
    });
    return rows;
  }

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: owner, role: "OWNER", email: `${owner}@example.test`, name: "Identity Olivia" },
        { id: staff, role: "STAFF", email: `${staff}@example.test`, name: "Identity Stan" },
        { id: custUserA, role: "CUSTOMER", email: `${custUserA}@example.test`, name: "Identity Irene" },
        { id: custUserX, role: "CUSTOMER", email: `${custUserX}@example.test`, name: "Identity Xena" },
      ],
    });
    await prisma.customer.createMany({
      data: [
        { id: customerA, userId: custUserA, referralCode: `TA${tag}` },
        { id: customerArchived, userId: custUserX, referralCode: `TX${tag}`, archivedAt: new Date() },
      ],
    });
    await prisma.lead.create({
      data: { id: leadB, contactName: "Identity Leo", phone: "9705550118" },
    });
    await prisma.telecomAccount.create({
      data: { id: account, label: `tid ${tag}`, provider: "twilio", environment: "TEST", externalAccountId: `tid-${tag}`, status: "READY" },
    });
    await prisma.businessPhoneNumber.create({
      data: { id: number, accountId: account, address: "+13035550196", providerNumberId: `tid-${tag}`, registrationStatus: "APPROVED", verifiedAt: new Date() },
    });
    for (const [pointId, address] of [
      [point1, "+13035550211"],
      [point2, "+13035550212"],
      [point3, "+13035550213"],
    ] as const) {
      await prisma.contactPoint.create({
        data: { id: pointId, environment: "TEST", channel: "SMS", address },
      });
    }
    await prisma.communicationThread.createMany({
      data: [
        { id: threadUnknown, accountId: account, businessNumberId: number, externalContactPointId: point1, resolution: "UNRESOLVED", status: "OPEN" },
        { id: threadAmbiguous, accountId: account, businessNumberId: number, externalContactPointId: point2, resolution: "AMBIGUOUS", status: "OPEN" },
        { id: threadRace, accountId: account, businessNumberId: number, externalContactPointId: point3, resolution: "UNRESOLVED", status: "OPEN" },
      ],
    });
    // The ambiguous number is verified to two different people.
    await prisma.contactBinding.createMany({
      data: [
        { id: `tid-bind-a-${tag}`, contactPointId: point2, customerId: customerA, source: "INBOUND", verifiedAt: new Date() },
        { id: `tid-bind-b-${tag}`, contactPointId: point2, leadId: leadB, source: "INBOUND", verifiedAt: new Date() },
      ],
    });
    await prisma.consentRecord.create({
      data: {
        id: consentId, contactPointId: point1, kind: "OPT_IN",
        purpose: "SMS_TRANSACTIONAL", action: "GRANT",
      },
    });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { entityType: "CommunicationThread", entityId: { in: threadIds } } });
    await prisma.consentRecord.deleteMany({ where: { id: consentId } });
    await prisma.contactBinding.deleteMany({ where: { contactPointId: { in: [point1, point2, point3] } } });
    await prisma.communicationThread.deleteMany({ where: { id: { in: threadIds } } });
    await prisma.contactPoint.deleteMany({ where: { id: { in: [point1, point2, point3] } } });
    await prisma.businessPhoneNumber.deleteMany({ where: { id: number } });
    await prisma.telecomAccount.deleteMany({ where: { id: account } });
    await prisma.lead.deleteMany({ where: { id: leadB } });
    await prisma.customer.deleteMany({ where: { id: { in: [customerA, customerArchived] } } });
    await prisma.user.deleteMany({ where: { id: { in: [owner, staff, custUserA, custUserX] } } });
  });

  it("unknown number links to a customer and resolves for later inbound", async () => {
    const before = await prisma.communicationThread.findUnique({ where: { id: threadUnknown } });
    await linkThreadIdentity(owner, threadUnknown, { customerId: customerA }, before!.version);
    const thread = await prisma.communicationThread.findUnique({ where: { id: threadUnknown } });
    expect(thread?.resolution).toBe("RESOLVED");
    expect(thread?.customerId).toBe(customerA);
    expect(thread?.version).toBe(before!.version + 1);
    const bindings = await bindingsFor(point1);
    const active = bindings.filter((b) => !b.revokedAt);
    expect(active).toHaveLength(1);
    expect(active[0].source).toBe("STAFF");
    expect(active[0].verifiedAt).not.toBeNull();
    expect(resolveInboundContact(bindings)).toEqual({
      resolution: "RESOLVED", customerId: customerA, leadId: null,
    });
    const audit = await prisma.auditLog.findFirst({
      where: { entityType: "CommunicationThread", entityId: threadUnknown, action: "communication.identity_linked" },
    });
    expect(audit).not.toBeNull();
    // Consent belongs to the contact point and is never changed by linking.
    const consent = await prisma.consentRecord.findUnique({ where: { id: consentId } });
    expect(consent?.action).toBe("GRANT");
  });

  it("staff are refused, and archived people can't be linked", async () => {
    await expect(
      linkThreadIdentity(staff, threadRace, { customerId: customerA }),
    ).rejects.toThrow();
    await expect(
      linkThreadIdentity(owner, threadRace, { customerId: customerArchived }),
    ).rejects.toThrow(/isn't available/);
  });

  it("ambiguous number: linking keeps one person and revokes the other", async () => {
    const others = await listThreadOtherMatches(owner, threadAmbiguous);
    expect(others.map((o) => o.name).sort()).toEqual(["Identity Irene", "Identity Leo"]);
    await linkThreadIdentity(owner, threadAmbiguous, { customerId: customerA });
    const bindings = await bindingsFor(point2);
    const byPerson = new Map(bindings.map((b) => [b.customerId ?? b.leadId, b]));
    expect(byPerson.get(customerA)?.revokedAt).toBeNull();
    expect(byPerson.get(leadB)?.revokedAt).not.toBeNull();
    expect(resolveInboundContact(bindings)).toEqual({
      resolution: "RESOLVED", customerId: customerA, leadId: null,
    });
    const thread = await prisma.communicationThread.findUnique({ where: { id: threadAmbiguous } });
    expect(thread?.resolution).toBe("RESOLVED");
    expect(thread?.leadId).toBeNull();
  });

  it("concurrent links of the same thread: one wins, the other is told it changed", async () => {
    const thread = await prisma.communicationThread.findUnique({ where: { id: threadRace } });
    const results = await Promise.allSettled([
      linkThreadIdentity(owner, threadRace, { customerId: customerA }, thread!.version),
      linkThreadIdentity(owner, threadRace, { leadId: leadB }, thread!.version),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String((rejected[0] as PromiseRejectedResult).reason)).toMatch(/changed/);
    const after = await prisma.communicationThread.findUnique({ where: { id: threadRace } });
    expect(after?.version).toBe(thread!.version + 1);
    expect(after?.resolution).toBe("RESOLVED");
  });

  it("unlink revokes the person's binding and returns the thread to unknown", async () => {
    await unlinkThreadIdentity(owner, threadUnknown);
    const thread = await prisma.communicationThread.findUnique({ where: { id: threadUnknown } });
    expect(thread?.resolution).toBe("UNRESOLVED");
    expect(thread?.customerId).toBeNull();
    const bindings = await bindingsFor(point1);
    expect(bindings.every((b) => b.revokedAt !== null)).toBe(true);
    expect(resolveInboundContact(bindings).resolution).toBe("UNRESOLVED");
    const audit = await prisma.auditLog.findFirst({
      where: { entityType: "CommunicationThread", entityId: threadUnknown, action: "communication.identity_unlinked" },
    });
    expect(audit).not.toBeNull();
  });
});
