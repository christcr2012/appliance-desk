import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { encryptCommunicationContent, hashCommunicationContent } from "@/domains/messaging/communications-content";
import {
  assignSmsThread, getSmsInboxThread, inboxCursor, listSmsInbox,
  markSmsInboxRead, updateSmsThreadStatus,
} from "@/domains/messaging/inbox";

const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/disabled");
const isolated = process.env.CI === "true" &&
  ["localhost","127.0.0.1"].includes(target.hostname) &&
  target.pathname === "/appliance_desk_test";

describe.skipIf(!isolated)("COM-L6B authorized private inbox and per-user cursor (disposable PostgreSQL)", () => {
  const name = "inbox-" + randomUUID().slice(0,9);
  const owner = name + "-owner";
  const staff = name + "-staff";
  const unrelated = name + "-staff2";
  const customer = name + "-customer";
  const accountId = name + "-account";
  const numberId = name + "-number";
  const pointId = name + "-point";
  const threadId = name + "-thread";
  const messageId = name + "-message";
  const address = "+13035550193";
  const previousKey = process.env.COMMUNICATION_CONTENT_KEY;

  beforeAll(async () => {
    process.env.COMMUNICATION_CONTENT_KEY = randomBytes(32).toString("base64");
    for (const [id,role] of [
      [owner,"OWNER"],[staff,"STAFF"],[unrelated,"STAFF"],[customer,"CUSTOMER"],
    ] as const) {
      await prisma.user.create({ data: {
        id, role, email: id+"@example.test",
      } });
    }
    await prisma.telecomAccount.create({ data: {
      id: accountId, label: name, provider:"twilio",
      environment:"TEST", externalAccountId:name, status:"READY",
    } });
    await prisma.businessPhoneNumber.create({ data: {
      id: numberId, accountId, address:"+13035550194",
      providerNumberId:name, registrationStatus:"APPROVED", verifiedAt:new Date(),
    } });
    await prisma.contactPoint.create({ data: {
      id: pointId, environment:"TEST", channel:"SMS", address,
    } });
    await prisma.communicationThread.create({ data: {
      id: threadId, accountId, businessNumberId:numberId,
      externalContactPointId:pointId, resolution:"AMBIGUOUS",
    } });
    await prisma.communicationMessage.create({ data: {
      id: messageId, threadId, accountId,
      direction:"INBOUND", occurredAt:new Date("2026-10-09T19:00:00Z"),
      bodyEncrypted:encryptCommunicationContent("Private inbound fixture"),
      bodyHash:hashCommunicationContent("Private inbound fixture"),
    } });
  });
  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { entityType: "CommunicationThread", entityId: threadId },
    });
    await prisma.communicationReadMarker.deleteMany({ where: { threadId } });
    await prisma.communicationMessage.deleteMany({ where: { threadId } });
    await prisma.communicationThread.deleteMany({ where: { id:threadId } });
    await prisma.contactPoint.deleteMany({ where: { id:pointId } });
    await prisma.businessPhoneNumber.deleteMany({ where: { id:numberId } });
    await prisma.telecomAccount.deleteMany({ where: { id:accountId } });
    await prisma.user.deleteMany({ where: { id: { in: [owner,staff,unrelated,customer] } } });
    if (previousKey === undefined) delete process.env.COMMUNICATION_CONTENT_KEY;
    else process.env.COMMUNICATION_CONTENT_KEY = previousKey;
  });

  it("only allows assigned staff and owner, enforces cursor, and disallows other customer information", async () => {
    const original = await listSmsInbox(owner);
    expect(original.rows.some(row=>row.id===threadId)).toBe(true);
    expect(original.rows.find(row=>row.id===threadId)?.unread).toBe(true);
    expect((await listSmsInbox(staff)).rows).toEqual([]);
    expect((await listSmsInbox(unrelated)).rows).toEqual([]);
    await expect(listSmsInbox(customer)).rejects.toThrow();
    await expect(getSmsInboxThread(unrelated,threadId)).rejects.toThrow();
    const before = await getSmsInboxThread(owner,threadId);
    expect(before.resolution).toBe("AMBIGUOUS");
    expect(before.customerId).toBeNull();
    expect(before.messages[0]?.text).toBe("Private inbound fixture");

    const assigned = await assignSmsThread(owner,threadId,before.version,staff);
    expect(assigned.assignedUserId).toBe(staff);
    expect((await listSmsInbox(staff)).rows.map(row=>row.id)).toContain(threadId);
    const visible = await getSmsInboxThread(staff,threadId);
    expect(visible.messages[0]?.text).toBe("Private inbound fixture");
    await expect(getSmsInboxThread(unrelated,threadId)).rejects.toThrow();
    await expect(assignSmsThread(customer,threadId,assigned.version,customer)).rejects.toThrow();
    await expect(markSmsInboxRead(staff,threadId,"from-another-thread")).rejects.toThrow();
    expect(await markSmsInboxRead(staff,threadId,messageId)).toBe(true);
    expect(await markSmsInboxRead(staff,threadId,messageId)).toBe(false);
    expect((await listSmsInbox(staff)).rows.find(r=>r.id===threadId)?.unread).toBe(false);
    expect((await listSmsInbox(owner)).rows.find(r=>r.id===threadId)?.unread).toBe(true);
    const moved=await updateSmsThreadStatus(staff,threadId,assigned.version,"WAITING");
    expect(moved.status).toBe("WAITING");
    expect(await prisma.auditLog.count({
      where: { entityType: "CommunicationThread", entityId: threadId },
    })).toBe(2);
    await expect(updateSmsThreadStatus(staff,threadId,assigned.version,"CLOSED")).rejects.toThrow();
    const page=await listSmsInbox(owner,{status:"WAITING"});
    expect(page.rows.map(r=>r.id)).toContain(threadId);
    const token = inboxCursor({lastActivityAt:new Date(),id:threadId});
    await expect(listSmsInbox(owner,{},"bad cursor %%%%")).rejects.toThrow();
    expect((await listSmsInbox(owner,{},token)).rows.some(r=>r.id===threadId)).toBe(true);
  });
});
