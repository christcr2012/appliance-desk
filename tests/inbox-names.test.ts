import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  encryptCommunicationContent,
  hashCommunicationContent,
} from "@/domains/messaging/communications-content";
import { getSmsInboxCounts, listSmsInbox } from "@/domains/messaging/inbox";

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

// AR-4d / QUOTES-MESSAGES spec sections 3 + 4: the inbox list now carries
// the person's name and the assignee's name — and still no message text —
// while staff keep seeing only their own threads.
describe.skipIf(!enabled)("inbox names (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "").slice(0, 10);
  const owner = `inames-owner-${tag}`;
  const staff = `inames-staff-${tag}`;
  const custUser = `inames-cust-user-${tag}`;
  const customer = `inames-customer-${tag}`;
  const lead = `inames-lead-${tag}`;
  const account = `inames-account-${tag}`;
  const number = `inames-number-${tag}`;
  const pointA = `inames-point-a-${tag}`;
  const pointB = `inames-point-b-${tag}`;
  const pointC = `inames-point-c-${tag}`;
  const threadA = `inames-thread-a-${tag}`;
  const threadB = `inames-thread-b-${tag}`;
  const threadC = `inames-thread-c-${tag}`;
  const previousKey = process.env.COMMUNICATION_CONTENT_KEY;

  beforeAll(async () => {
    process.env.COMMUNICATION_CONTENT_KEY = randomBytes(32).toString("base64");
    await prisma.user.createMany({
      data: [
        { id: owner, role: "OWNER", email: `${owner}@example.test`, name: "Inbox Olivia" },
        { id: staff, role: "STAFF", email: `${staff}@example.test`, name: "Inbox Stan" },
        { id: custUser, role: "CUSTOMER", email: `${custUser}@example.test`, name: "Inbox Irene" },
      ],
    });
    await prisma.customer.create({
      data: { id: customer, userId: custUser, companyName: "Irene Homes", referralCode: `IN${tag}` },
    });
    await prisma.lead.create({
      data: { id: lead, contactName: "Inbox Leo", phone: "9705550117" },
    });
    await prisma.telecomAccount.create({
      data: { id: account, label: `inames ${tag}`, provider: "twilio", environment: "TEST", externalAccountId: `inames-${tag}`, status: "READY" },
    });
    await prisma.businessPhoneNumber.create({
      data: { id: number, accountId: account, address: "+13035550195", providerNumberId: `inames-${tag}`, registrationStatus: "APPROVED", verifiedAt: new Date() },
    });
    for (const [pointId, address] of [
      [pointA, "+13035550201"],
      [pointB, "+13035550202"],
      [pointC, "+13035550203"],
    ] as const) {
      await prisma.contactPoint.create({
        data: { id: pointId, environment: "TEST", channel: "SMS", address },
      });
    }
    await prisma.communicationThread.create({
      data: {
        id: threadA, accountId: account, businessNumberId: number,
        externalContactPointId: pointA, resolution: "RESOLVED",
        customerId: customer, assignedUserId: staff, status: "OPEN",
      },
    });
    await prisma.communicationThread.create({
      data: {
        id: threadB, accountId: account, businessNumberId: number,
        externalContactPointId: pointB, resolution: "UNRESOLVED", status: "OPEN",
      },
    });
    await prisma.communicationThread.create({
      data: {
        id: threadC, accountId: account, businessNumberId: number,
        externalContactPointId: pointC, resolution: "RESOLVED",
        leadId: lead, assignedUserId: owner, status: "WAITING",
      },
    });
    await prisma.communicationMessage.create({
      data: {
        id: `inames-msg-${tag}`, threadId: threadA, accountId: account,
        direction: "INBOUND", occurredAt: new Date(),
        bodyEncrypted: encryptCommunicationContent("Private fixture A"),
        bodyHash: hashCommunicationContent("Private fixture A"),
      },
    });
  });

  afterAll(async () => {
    await prisma.communicationMessage.deleteMany({ where: { threadId: { in: [threadA, threadB, threadC] } } });
    await prisma.communicationThread.deleteMany({ where: { id: { in: [threadA, threadB, threadC] } } });
    await prisma.contactPoint.deleteMany({ where: { id: { in: [pointA, pointB, pointC] } } });
    await prisma.businessPhoneNumber.deleteMany({ where: { id: number } });
    await prisma.telecomAccount.deleteMany({ where: { id: account } });
    await prisma.lead.deleteMany({ where: { id: lead } });
    await prisma.customer.deleteMany({ where: { id: customer } });
    await prisma.user.deleteMany({ where: { id: { in: [owner, staff, custUser] } } });
    if (previousKey === undefined) delete process.env.COMMUNICATION_CONTENT_KEY;
    else process.env.COMMUNICATION_CONTENT_KEY = previousKey;
  });

  it("rows carry person and assignee names, and never message text", async () => {
    const { rows } = await listSmsInbox(owner, { status: "OPEN" });
    const a = rows.find((r) => r.id === threadA);
    const b = rows.find((r) => r.id === threadB);
    expect(a?.customerName).toBe("Inbox Irene");
    expect(a?.assignedName).toBe("Inbox Stan");
    expect(a?.unread).toBe(true);
    expect(b?.customerName).toBeNull();
    expect(b?.leadName).toBeNull();
    expect(b?.assignedName).toBeNull();
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain("Private fixture");
    expect(serialized).not.toContain("bodyEncrypted");
    expect(serialized).not.toContain("bodyHash");
  });

  it("lead threads carry the lead's name", async () => {
    const { rows } = await listSmsInbox(owner, { status: "WAITING" });
    const c = rows.find((r) => r.id === threadC);
    expect(c?.leadName).toBe("Inbox Leo");
    expect(c?.assignedName).toBe("Inbox Olivia");
  });

  it("staff still see only threads assigned to them", async () => {
    const { rows } = await listSmsInbox(staff, { status: "OPEN" });
    expect(rows.some((r) => r.id === threadA)).toBe(true);
    expect(rows.some((r) => r.id === threadB)).toBe(false);
    const waiting = await listSmsInbox(staff, { status: "WAITING" });
    expect(waiting.rows.some((r) => r.id === threadC)).toBe(false);
  });

  it("counts follow the same scoping", async () => {
    const ownerCounts = await getSmsInboxCounts(owner, {});
    expect(ownerCounts.open).toBeGreaterThanOrEqual(2);
    expect(ownerCounts.waiting).toBeGreaterThanOrEqual(1);
    const staffCounts = await getSmsInboxCounts(staff, {});
    expect(staffCounts.open).toBeGreaterThanOrEqual(1);
    expect(staffCounts.waiting).toBe(0);
  });
});
