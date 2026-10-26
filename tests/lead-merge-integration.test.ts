import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

// listLeadFollowUps requires a desk session; stub it like w5-w6 does.
const mocks = vi.hoisted(() => ({
  role: vi.fn(async () => ({ user: { id: "x", role: "OWNER" } })),
}));
vi.mock("@/lib/session", () => ({ requireRole: mocks.role }));

import { prisma } from "@/lib/prisma";
import { addLeadNote, canConvertLead, createLeadManually } from "@/domains/leads";
import { mergeLeads } from "@/domains/leads/merge";
import { getLeadsCount, getLeadsPage } from "@/domains/leads";
import { listLeadFollowUps } from "@/domains/exceptions/lead-turning-points";

// Disposable CI Postgres only; never creates fixtures or attempts rollback on Neon.
const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("lead merge", () => {
  const tag = randomUUID();
  let ownerId: string;
  let staffId: string;
  let applianceTypeId: string;
  const leadIds: string[] = [];
  const threadIds: string[] = [];
  const numberIds: string[] = [];
  const accountIds: string[] = [];
  const contactPointIds: string[] = [];
  const deliveryKeys: string[] = [];

  async function makeLead(phone: string, email?: string) {
    const lead = await createLeadManually(ownerId, {
      contactName: `Merge fixture ${tag}`,
      phone,
      email: email ?? null,
    });
    leadIds.push(lead.id);
    return lead;
  }

  beforeAll(async () => {
    ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    staffId = (
      await prisma.user.create({
        data: { email: `merge-${tag}-staff@example.com`, name: "Merge Staff", role: "STAFF" },
      })
    ).id;
    applianceTypeId = (
      await prisma.applianceType.findFirstOrThrow({ where: { isActive: true } })
    ).id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: leadIds } } });
    await prisma.communicationLink.deleteMany({ where: { entityId: { in: leadIds } } });
    await prisma.communicationMessage.deleteMany({ where: { threadId: { in: threadIds } } });
    await prisma.communicationThread.deleteMany({ where: { id: { in: threadIds } } });
    await prisma.consentRecord.deleteMany({ where: { leadId: { in: leadIds } } });
    await prisma.contactBinding.deleteMany({ where: { leadId: { in: leadIds } } });
    await prisma.estimate.deleteMany({ where: { leadId: { in: leadIds } } });
    await prisma.staffTask.deleteMany({ where: { leadId: { in: leadIds } } });
    await prisma.messageDelivery.deleteMany({ where: { idempotencyKey: { in: deliveryKeys } } });
    await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
    if (staffId) await prisma.user.deleteMany({ where: { id: staffId } });
    await prisma.businessPhoneNumber.deleteMany({ where: { id: { in: numberIds } } });
    await prisma.telecomAccount.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.contactPoint.deleteMany({ where: { id: { in: contactPointIds } } });
  });

  it("moves every child to the kept lead and leaves the merged lead pointing at it", async () => {
    const keep = await makeLead("5551000001", "keep@example.com");
    const away = await makeLead("5551000002", "away@example.com");
    // The merged lead was further along: contacted, with a follow-up and notes.
    await prisma.lead.update({
      where: { id: away.id },
      data: {
        status: "CONTACTED",
        firstContactedAt: new Date("2026-01-02T10:00:00Z"),
        lastRealContactAt: new Date("2026-01-03T10:00:00Z"),
        nextFollowUpOn: new Date("2026-01-10T00:00:00Z"),
        notes: "Wants a washer",
        email: null,
        emailLower: null,
      },
    });
    await prisma.lead.update({
      where: { id: keep.id },
      data: {
        firstContactedAt: new Date("2026-01-05T10:00:00Z"),
        lastRealContactAt: new Date("2026-01-01T10:00:00Z"),
        notes: "Kept notes",
      },
    });

    await addLeadNote(away.id, ownerId, "Called, no answer");
    // addLeadNote stamps the merged lead's last real contact to now; put the
    // intended fixture date back so the merge's "later wins" is exact.
    await prisma.lead.update({
      where: { id: away.id },
      data: { lastRealContactAt: new Date("2026-01-03T10:00:00Z") },
    });
    await prisma.leadApplianceRequest.create({
      data: { leadId: away.id, applianceTypeId, quantity: 1 },
    });
    await prisma.estimate.create({
      data: { leadId: away.id, title: "Washer quote", depositCents: 0, createdByUserId: ownerId },
    });
    await prisma.staffTask.create({
      data: { note: "Call back", leadId: away.id, createdByUserId: ownerId },
    });
    const consent = await prisma.consentRecord.create({
      data: {
        kind: "lead_form_privacy",
        leadId: away.id,
        occurredAt: new Date("2026-01-02T09:00:00Z"),
        details: { source: "website" },
      },
    });
    const cp = await prisma.contactPoint.create({
      data: { environment: "TEST", channel: "SMS", address: "+15551000002" },
    });
    contactPointIds.push(cp.id);
    await prisma.contactBinding.create({
      data: { contactPointId: cp.id, leadId: away.id, source: "STAFF" },
    });
    const account = await prisma.telecomAccount.create({
      data: { provider: "test", environment: "TEST", externalAccountId: tag, label: "test" },
    });
    accountIds.push(account.id);
    const number = await prisma.businessPhoneNumber.create({
      data: { accountId: account.id, address: "+15550001111", providerNumberId: "pn1" },
    });
    numberIds.push(number.id);
    const thread = await prisma.communicationThread.create({
      data: {
        accountId: account.id,
        businessNumberId: number.id,
        externalContactPointId: cp.id,
        leadId: away.id,
      },
    });
    threadIds.push(thread.id);
    const message = await prisma.communicationMessage.create({
      data: {
        threadId: thread.id,
        accountId: account.id,
        direction: "INBOUND",
        bodyHash: "x",
        bodyEncrypted: "test-ciphertext",
        occurredAt: new Date(),
      },
    });
    // The kept lead already links the same message: the merged lead's
    // duplicate link is dropped, not moved.
    await prisma.communicationLink.create({
      data: { messageId: message.id, entityType: "Lead", entityId: keep.id, source: "STAFF_CONFIRMED" },
    });
    await prisma.communicationLink.create({
      data: { messageId: message.id, entityType: "Lead", entityId: away.id, source: "STAFF_CONFIRMED" },
    });
    const deliveryKey = `merge-${tag}`;
    deliveryKeys.push(deliveryKey);
    await prisma.messageDelivery.create({
      data: {
        idempotencyKey: deliveryKey,
        channel: "SMS",
        purpose: "TRANSACTIONAL",
        templateKey: "t",
        recipientType: "Lead",
        recipientId: away.id,
        recipientAddress: "+15551000002",
      },
    });

    await mergeLeads(ownerId, keep.id, away.id);

    const counts = await Promise.all([
      prisma.leadNote.count({ where: { leadId: keep.id } }),
      prisma.leadApplianceRequest.count({ where: { leadId: keep.id } }),
      prisma.estimate.count({ where: { leadId: keep.id } }),
      prisma.staffTask.count({ where: { leadId: keep.id } }),
      prisma.consentRecord.count({ where: { leadId: keep.id } }),
      prisma.contactBinding.count({ where: { leadId: keep.id } }),
      prisma.communicationThread.count({ where: { leadId: keep.id } }),
      prisma.messageDelivery.count({ where: { recipientType: "Lead", recipientId: keep.id } }),
      prisma.communicationLink.count({
        where: { entityType: "Lead", entityId: keep.id, messageId: message.id },
      }),
    ]);
    expect(counts).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(
      (await prisma.consentRecord.findUniqueOrThrow({ where: { id: consent.id } })).occurredAt,
    ).toEqual(new Date("2026-01-02T09:00:00Z"));

    const kept = await prisma.lead.findUniqueOrThrow({ where: { id: keep.id } });
    expect(kept.status).toBe("CONTACTED");
    expect(kept.firstContactedAt).toEqual(new Date("2026-01-02T10:00:00Z"));
    expect(kept.lastRealContactAt).toEqual(new Date("2026-01-03T10:00:00Z"));
    expect(kept.nextFollowUpOn).toEqual(new Date("2026-01-10T00:00:00Z"));
    expect(kept.email).toBe("keep@example.com");
    expect(kept.notes).toBe("Kept notes\n\nFrom merged lead: Wants a washer");

    const merged = await prisma.lead.findUniqueOrThrow({ where: { id: away.id } });
    expect(merged.mergedIntoLeadId).toBe(keep.id);
    expect(merged.mergedAt).not.toBeNull();
    expect(merged.status).toBe("LOST");
    expect(merged.lostReason).toBe("Merged into another lead");
    expect(merged.possibleDuplicateOfLeadId).toBeNull();

    const audits = await prisma.auditLog.findMany({
      where: { action: "lead.merge", entityId: { in: [keep.id, away.id] } },
    });
    expect(audits).toHaveLength(2);
    expect(canConvertLead(merged)).toEqual({ ok: false, reason: expect.stringMatching(/merged/i) });
  });

  it("refuses the same lead, a converted lead, an approved quote, and a second merge", async () => {
    const a = await makeLead("5551000011");
    const b = await makeLead("5551000012");
    // Merging stays owner/admin even though staff can now work leads.
    await expect(mergeLeads(staffId, a.id, b.id)).rejects.toThrow(/no longer has access/);
    await expect(mergeLeads(ownerId, a.id, a.id)).rejects.toThrow(/itself/);
    await prisma.lead.update({ where: { id: b.id }, data: { status: "CONVERTED" } });
    await expect(mergeLeads(ownerId, a.id, b.id)).rejects.toThrow(/converted/);
    await prisma.lead.update({ where: { id: b.id }, data: { status: "NEW" } });
    await prisma.estimate.create({
      data: {
        leadId: b.id,
        title: "Approved quote",
        status: "APPROVED",
        depositCents: 0,
        createdByUserId: ownerId,
      },
    });
    await expect(mergeLeads(ownerId, a.id, b.id)).rejects.toThrow(/approved or converted quote/);
    await prisma.estimate.deleteMany({ where: { leadId: b.id } });
    await mergeLeads(ownerId, a.id, b.id);
    await expect(mergeLeads(ownerId, a.id, b.id)).rejects.toThrow(/already merged/);
  });

  it("two people merging the same pair at once: one succeeds, one is refused", async () => {
    const a = await makeLead("5551000021");
    const b = await makeLead("5551000022");
    const results = await Promise.allSettled([
      mergeLeads(ownerId, a.id, b.id),
      mergeLeads(ownerId, a.id, b.id),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect(rejected?.status).toBe("rejected");
    if (rejected?.status === "rejected") {
      expect(String(rejected.reason)).toMatch(/already merged/);
    }
  });

  it("flags a possible duplicate at create, by phone or by email, but never blocks", async () => {
    const first = await makeLead("5551000031", "dup@example.com");
    const byPhone = await makeLead("5551000031", "other@example.com");
    expect(byPhone.possibleDuplicateOfLeadId).toBe(first.id);
    const byEmail = await makeLead("5551000032", "dup@example.com");
    expect(byEmail.possibleDuplicateOfLeadId).toBe(first.id);
    // A 3-digit string is not a phone number: no flag.
    const short1 = await makeLead("123");
    const short2 = await makeLead("123");
    expect(short1.possibleDuplicateOfLeadId).toBeNull();
    expect(short2.possibleDuplicateOfLeadId).toBeNull();
  });

  it("audits a lead whose email matches an existing customer", async () => {
    const customerEmail = process.env.TEST_CUSTOMER_EMAIL ?? "ci-customer@example.test";
    const lead = await makeLead("5551000041", customerEmail);
    expect(lead.possibleDuplicateOfLeadId).toBeNull();
    const audit = await prisma.auditLog.findFirst({
      where: { action: "lead.matches_customer", entityId: lead.id },
    });
    expect(audit?.newValue).toMatchObject({ customerId: expect.any(String) });
  });

  it("merged leads never appear in lists, counts, or the To do list", async () => {
    const keep = await makeLead("5551000051");
    const away = await makeLead("5551000052");
    await mergeLeads(ownerId, keep.id, away.id);
    expect(await getLeadsCount()).toBeGreaterThan(0);
    const page = await getLeadsPage(undefined, 0, 500);
    expect(page.map((l) => l.id)).not.toContain(away.id);
    const followUps = await listLeadFollowUps(50, new Date());
    expect(followUps.rows.every((r) => !r.href.includes(away.id))).toBe(true);
  });
});
