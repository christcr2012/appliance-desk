import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  closeIncident, determineIncident, markIncidentStepDone, saveIncidentInformation, markVendorReviewed, openIncident,
  recordAccessibilityComplaint, resolveAccessibilityComplaint, savePrivacySettings, setLegalHold, RECOMMENDED_PRIVACY_SETTINGS,
} from "@/domains/security/actions";
import { runRetentionPurge } from "@/domains/security/retention";
import { listPrivacyAttention } from "@/domains/security/reads";
import { fulfillPrivacyDeletion } from "@/domains/privacy";
import { deliverMessage } from "@/domains/messaging/deliver";

// OPS-7 on real Postgres.
const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(target.hostname) && target.pathname === "/appliance_desk_test";
const DAY = 86_400_000;

describe.skipIf(!enabled)("privacy and security duties (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "").slice(0, 10);
  const ownerId = `ops7-owner-${tag}`;
  const adminId = `ops7-admin-${tag}`;
  const custUser = `ops7-cust-${tag}`;
  let customerId = "";
  const leadIds: string[] = [];
  let saved: Awaited<ReturnType<typeof prisma.businessSettings.upsert>>;
  const now = new Date();

  beforeAll(async () => {
    for (const [id, role] of [[ownerId, "OWNER"], [adminId, "ADMIN"], [custUser, "CUSTOMER"]] as const) {
      await prisma.user.create({ data: { id, email: `${id}@example.test`, name: `OPS7 ${role}`, role, emailVerified: true } });
    }
    customerId = (await prisma.customer.create({ data: { userId: custUser, referralCode: `O7${tag}`, phone: "9705550177" } })).id;
    saved = await prisma.businessSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton" }, update: {} });
  });

  afterAll(async () => {
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: {
      retentionPurgeEnabled: saved.retentionPurgeEnabled, retentionLeadYears: saved.retentionLeadYears,
      marketingTextStartHour: saved.marketingTextStartHour, marketingTextEndHour: saved.marketingTextEndHour,
    } });
    await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
    await prisma.securityIncident.deleteMany({ where: { openedByUserId: ownerId } });
    await prisma.accessibilityComplaint.deleteMany({ where: { recordedByUserId: adminId } });
    await prisma.privacyRequest.deleteMany({ where: { customerId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: [ownerId, adminId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, adminId, custUser] } } });
  });

  async function oldLead(label: string, extra: Record<string, unknown> = {}) {
    const lead = await prisma.lead.create({ data: { contactName: `OPS7 ${label} ${tag}`, phone: `97055500${Math.floor(Math.random() * 90 + 10)}`, ...extra } });
    // updatedAt is managed by Prisma, so age it directly.
    await prisma.$executeRaw`UPDATE "Lead" SET "updatedAt" = ${new Date(now.getTime() - 3 * 365 * DAY)} WHERE "id" = ${lead.id}`;
    leadIds.push(lead.id);
    return lead.id;
  }

  it("runs a security incident with fixed deadlines and only the owner can work it", async () => {
    await expect(openIncident(adminId, { summary: "x", discoveredAt: new Date() })).rejects.toThrow();
    const id = await openIncident(ownerId, { summary: "A laptop with customer files was lost", discoveredAt: new Date(now.getTime() - 3 * DAY) });
    // Before the decision there is exactly one To do: decide.
    let items = (await listPrivacyAttention(now)).filter((i) => i.title.startsWith("Security problem"));
    expect(items).toHaveLength(1);
    await expect(markIncidentStepDone(ownerId, id, "RESIDENTS", now)).rejects.toThrow(/decision first/i);

    const decided = new Date(now.getTime() - 2 * DAY);
    await determineIncident(ownerId, id, { determinedAt: decided, residentsAffected: 600 });
    items = (await listPrivacyAttention(now)).filter((i) => i.title.startsWith("Security problem"));
    expect(items.map((i) => i.title.split(" by ")[0])).toEqual(["Security problem: tell the affected people", "Security problem: tell the colorado attorney general"]);
    // The date can move earlier, never later.
    await expect(determineIncident(ownerId, id, { determinedAt: new Date(decided.getTime() + DAY), residentsAffected: 600 })).rejects.toThrow(/earlier/i);
    // Not closable until the owed notices are recorded.
    await expect(closeIncident(ownerId, id, "fixed")).rejects.toThrow(/tell the affected people/);
    await markIncidentStepDone(ownerId, id, "RESIDENTS", now);
    await expect(closeIncident(ownerId, id, "fixed")).rejects.toThrow(/Attorney General/);
    await markIncidentStepDone(ownerId, id, "ATTORNEY_GENERAL", now);
    await closeIncident(ownerId, id, "Laptop encrypted; passwords changed");
    expect((await prisma.securityIncident.findUniqueOrThrow({ where: { id } })).state).toBe("CLOSED");
    expect((await listPrivacyAttention(now)).filter((i) => i.title.startsWith("Security problem"))).toHaveLength(0);
  });

  it("asks for a yearly security-terms check per provider and clears it when recorded", async () => {
    const before = (await listPrivacyAttention(now)).filter((i) => i.title.startsWith("Re-read"));
    expect(before).toHaveLength(1);
    const vendors = await prisma.serviceVendor.findMany({ where: { active: true } });
    expect(vendors.map((v) => v.name)).toEqual(expect.arrayContaining(["Vercel", "Neon", "Stripe", "Twilio", "Resend"]));
    for (const v of vendors) await markVendorReviewed(adminId, v.id, now, "read it");
    expect((await listPrivacyAttention(now)).filter((i) => i.title.startsWith("Re-read"))).toHaveLength(0);
    await prisma.serviceVendor.updateMany({ data: { termsReviewedOn: null, termsReviewedByUserId: null, notes: null } });
  });

  it("puts an accessibility complaint on the To do list with its fix date", async () => {
    const id = await recordAccessibilityComplaint(adminId, { receivedAt: now, fromWho: "A customer", description: "The pay button can't be reached with a keyboard" });
    const item = (await listPrivacyAttention(now)).find((i) => i.title.startsWith("Fix the accessibility problem"));
    expect(item).toBeDefined();
    await resolveAccessibilityComplaint(adminId, id, "Fixed the button order");
    expect((await listPrivacyAttention(now)).find((i) => i.title.startsWith("Fix the accessibility problem"))).toBeUndefined();
  });

  it("ships the purge OFF, then removes only old enquiries that never became customers, a few per night, respecting legal holds", async () => {
    const stale = await oldLead("stale");
    const stale2 = await oldLead("stale2");
    const converted = await oldLead("converted", { status: "CONVERTED", convertedCustomerId: customerId });
    const fresh = (await prisma.lead.create({ data: { contactName: `OPS7 fresh ${tag}`, phone: "9705550111" } })).id;
    leadIds.push(fresh);
    const held = await oldLead("held", { phone: "9705550177", phoneDigits: "9705550177" });

    // Settings start OFF: nothing is removed.
    expect((await prisma.businessSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton" }, update: {} })).retentionPurgeEnabled).toBe(false);
    expect(await runRetentionPurge(now)).toMatchObject({ enabled: false, leadsRemoved: 0 });
    expect(await prisma.lead.count({ where: { id: { in: [stale, stale2] } } })).toBe(2);

    await savePrivacySettings(ownerId, { ...RECOMMENDED_PRIVACY_SETTINGS, retentionPurgeEnabled: true });
    await setLegalHold(ownerId, customerId, true, "Dispute about a damaged washer");
    // Only 1 per night when the limit is 1: bounded.
    const first = await runRetentionPurge(now, 1);
    expect(first.leadsRemoved).toBe(1);
    const all = await runRetentionPurge(now);
    expect(first.leadsRemoved + all.leadsRemoved).toBeGreaterThanOrEqual(2);
    const remaining = await prisma.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true } });
    const ids = remaining.map((l) => l.id);
    expect(ids).toEqual(expect.arrayContaining([converted, fresh, held])); // converted, recent and held-customer leads stay
    expect(ids).not.toContain(stale);
    expect(ids).not.toContain(stale2);
    expect(await prisma.auditLog.count({ where: { action: "retention.purge", userId: null, createdAt: { gte: new Date(now.getTime() - 60_000) } } })).toBeGreaterThan(0);

    // Lifting the hold lets the held customer's old enquiry go on a later night.
    await setLegalHold(ownerId, customerId, false, "");
    await runRetentionPurge(now);
    expect(await prisma.lead.count({ where: { id: held } })).toBe(0);
    await savePrivacySettings(ownerId, RECOMMENDED_PRIVACY_SETTINGS);
  });

  it("refuses a privacy deletion for a customer on legal hold", async () => {
    await setLegalHold(ownerId, customerId, true, "Lawyer asked us to keep everything");
    const req = await prisma.privacyRequest.create({ data: { kind: "DELETE", status: "VERIFIED", customerId, requesterEmail: `${custUser}@example.test`, verifiedAt: new Date() } });
    await expect(fulfillPrivacyDeletion(ownerId, req.id, "DELETE")).rejects.toThrow(/legal hold/i);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: customerId } })).legalHoldAt).not.toBeNull();
    await setLegalHold(ownerId, customerId, false, "");
  });

  it("holds marketing texts outside the allowed hours but leaves transactional texts alone", async () => {
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { marketingTextStartHour: 4, marketingTextEndHour: 4 } }); // never
    const result = await deliverMessage({
      idempotencyKey: `ops7-mkt-${tag}`, channel: "SMS", purpose: "MARKETING", templateKey: "ops7.test", customerFacing: true,
      recipient: { type: "TEST", address: "+19705550199" }, render: () => ({ text: "Spring sale" }),
    });
    expect(result.state).toBe("NOT_SENT");
    const row = await prisma.messageDelivery.findUniqueOrThrow({ where: { idempotencyKey: `ops7-mkt-${tag}` } });
    expect(row.lastError).toMatch(/marketing text hours/);
    await prisma.messageDelivery.deleteMany({ where: { idempotencyKey: `ops7-mkt-${tag}` } });
  });

  it("a hold cannot be placed while a deletion is already running, and a suspected incident can be closed as a false alarm", async () => {
    const req = await prisma.privacyRequest.create({ data: { kind: "DELETE", status: "VERIFIED", customerId, requesterEmail: `${custUser}@example.test`, verifiedAt: new Date(), fulfilledByUserId: ownerId } });
    await expect(setLegalHold(ownerId, customerId, true, "late hold")).rejects.toThrow(/already under way/);
    await prisma.privacyRequest.delete({ where: { id: req.id } });

    const id = await openIncident(ownerId, { summary: "Laptop lost, probably encrypted", discoveredAt: new Date(now.getTime() - DAY) });
    await expect(closeIncident(adminId, id, "x")).rejects.toThrow();
    await closeIncident(ownerId, id, "Checked: disk was encrypted, nothing exposed");
    expect((await prisma.securityIncident.findUniqueOrThrow({ where: { id } })).state).toBe("CLOSED");

    const other = await openIncident(ownerId, { summary: "Spreadsheet shared too widely", discoveredAt: new Date(now.getTime() - DAY) });
    await expect(saveIncidentInformation(ownerId, other, "   ")).rejects.toThrow(/kinds of information/);
    await saveIncidentInformation(ownerId, other, "names and phone numbers");
    expect((await prisma.securityIncident.findUniqueOrThrow({ where: { id: other } })).informationInvolved).toBe("names and phone numbers");
  });
});
