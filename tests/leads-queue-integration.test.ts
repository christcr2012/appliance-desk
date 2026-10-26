import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getLeadQueue, getLeadStageCounts } from "@/domains/leads/queue";
import { setLeadFollowUp } from "@/domains/leads/follow-up";
import { businessDateKey, businessDayBounds } from "@/lib/business-date";

// Disposable CI Postgres only; never creates fixtures or attempts rollback on Neon.
const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("leads queue", () => {
  // Letter-prefixed so the tags always take the name-search path (an
  // all-digit tag would be read as a phone-number search and match nothing).
  const tag = `q${randomUUID().slice(0, 8)}`;
  const bulkTag = `b${randomUUID().slice(0, 8)}`;
  const now = new Date();
  const { start: todayStart, end: todayEnd } = businessDayBounds(now);
  const yesterday = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
  const tomorrow = todayEnd;
  let ownerId: string;
  let adminId: string;
  const leadIds: string[] = [];
  const estimateIds: string[] = [];

  async function makeLead(
    name: string,
    phone: string,
    data: {
      status?: "NEW" | "CONTACTED" | "CONVERTED" | "LOST";
      firstContactedAt?: Date | null;
      nextFollowUpOn?: Date | null;
      createdAt?: Date;
      lastRealContactAt?: Date | null;
      score?: number;
      email?: string;
    } = {},
  ) {
    const lead = await prisma.lead.create({
      data: {
        contactName: name,
        phone,
        phoneDigits: phone.replace(/\D/g, "") || null,
        email: data.email ?? null,
        emailLower: data.email?.trim().toLowerCase() || null,
        status: data.status ?? "NEW",
        firstContactedAt: data.firstContactedAt ?? null,
        nextFollowUpOn: data.nextFollowUpOn ?? null,
        createdAt: data.createdAt ?? now,
        lastRealContactAt: data.lastRealContactAt ?? null,
        score: data.score ?? 10,
        scoreReasons: [],
        isHighValue: false,
        scoringPolicyVersion: 1,
      },
    });
    leadIds.push(lead.id);
    return lead;
  }

  async function makeQuote(leadId: string, sentAt: Date, monthlyCents: number) {
    const estimate = await prisma.estimate.create({
      data: {
        leadId,
        title: `Quote ${tag}`,
        status: "SENT",
        sentAt,
        depositCents: 0,
        createdByUserId: ownerId,
      },
    });
    estimateIds.push(estimate.id);
    await prisma.estimateLineItem.create({
      data: {
        estimateId: estimate.id,
        description: "Washer",
        quantity: 2,
        monthlyPriceCents: monthlyCents,
      },
    });
    return estimate;
  }

  beforeAll(async () => {
    ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    adminId = (
      await prisma.user.create({
        data: { email: `queue-admin-${tag}@example.com`, name: "Queue Admin", role: "ADMIN" },
      })
    ).id;
    // Rank 1: overdue follow-up. Rank 2: new, oldest first. Rank 3: due today.
    // Rank 4: quoted, oldest sent first. Rank 5: everything else by score.
    await makeLead(`Queue ${tag} Overdue`, "5552000001", {
      status: "CONTACTED",
      firstContactedAt: yesterday,
      nextFollowUpOn: yesterday,
      createdAt: new Date(now.getTime() - 9 * 86400000),
      lastRealContactAt: yesterday,
      score: 5,
    });
    await makeLead(`Queue ${tag} NewOld`, "5552000002", {
      createdAt: new Date(now.getTime() - 8 * 86400000),
      score: 1,
    });
    await makeLead(`Queue ${tag} NewRecent`, "5552000003", {
      createdAt: new Date(now.getTime() - 1 * 86400000),
      score: 1,
    });
    await makeLead(`Queue ${tag} Today`, "5552000004", {
      status: "CONTACTED",
      firstContactedAt: yesterday,
      nextFollowUpOn: todayStart,
      createdAt: new Date(now.getTime() - 7 * 86400000),
      lastRealContactAt: yesterday,
      score: 5,
    });
    await makeLead(`Queue ${tag} Tomorrow`, "5552000005", {
      status: "CONTACTED",
      firstContactedAt: yesterday,
      nextFollowUpOn: tomorrow,
      createdAt: new Date(now.getTime() - 6 * 86400000),
      lastRealContactAt: yesterday,
      score: 5,
    });
    const quoted = await makeLead(`Queue ${tag} Quoted`, "5552000006", {
      createdAt: new Date(now.getTime() - 5 * 86400000),
      score: 40,
    });
    await makeQuote(quoted.id, new Date(now.getTime() - 4 * 86400000), 5000);
    const quotedNewer = await makeLead(`Queue ${tag} QuotedNewer`, "5552000007", {
      status: "CONTACTED",
      firstContactedAt: yesterday,
      createdAt: new Date(now.getTime() - 3 * 86400000),
      score: 30,
    });
    await makeQuote(quotedNewer.id, new Date(now.getTime() - 2 * 86400000), 1500);
    await makeLead(`Queue ${tag} Won`, "5552000008", {
      status: "CONVERTED",
      firstContactedAt: yesterday,
      nextFollowUpOn: todayStart,
      createdAt: new Date(now.getTime() - 2 * 86400000),
      score: 50,
    });
    await makeLead(`Queue ${tag} Lost`, "5552000009", {
      status: "LOST",
      firstContactedAt: yesterday,
      nextFollowUpOn: todayStart,
      createdAt: new Date(now.getTime() - 2 * 86400000),
      score: 10,
    });
    await makeLead(`Queue ${tag} HighScore`, "5552000010", {
      createdAt: new Date(now.getTime() - 2 * 86400000),
      score: 90,
      email: `queue-${tag}@example.com`,
    });
    // 55 more new leads, for the cursor test (page size 50).
    await prisma.lead.createMany({
      data: Array.from({ length: 55 }, (_, i) => ({
        contactName: `Queue ${bulkTag} Bulk ${i}`,
        phone: `555300${String(1000 + i)}`,
        phoneDigits: `555300${String(1000 + i)}`,
        status: "NEW" as const,
        createdAt: new Date(now.getTime() - i * 60_000),
        score: i,
        scoreReasons: [],
        isHighValue: false,
        scoringPolicyVersion: 1,
      })),
    });
    const bulk = await prisma.lead.findMany({
      where: { contactName: { startsWith: `Queue ${bulkTag}` } },
      select: { id: true },
    });
    leadIds.push(...bulk.map((l) => l.id));
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: leadIds } } });
    await prisma.estimate.deleteMany({ where: { id: { in: estimateIds } } });
    await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
    await prisma.user.deleteMany({ where: { id: adminId } });
  });

  it("orders Next up: overdue, new oldest, due today, quoted oldest, then score", async () => {
    const { rows } = await getLeadQueue({ sort: "next-up", q: tag }, now);
    expect(rows.map((r) => r.contactName)).toEqual([
      `Queue ${tag} Overdue`,
      `Queue ${tag} NewOld`,
      `Queue ${tag} HighScore`,
      `Queue ${tag} NewRecent`,
      `Queue ${tag} Today`,
      `Queue ${tag} Quoted`,
      `Queue ${tag} QuotedNewer`,
      `Queue ${tag} Won`,
      `Queue ${tag} Lost`,
      `Queue ${tag} Tomorrow`,
    ]);
    expect(rows[0]!.stage).toBe("contacted");
    expect(rows[1]!.stage).toBe("new");
    expect(rows[5]!.stage).toBe("quoted");
    expect(rows[5]!.monthlyValueCents).toBe(10000);
    expect(rows[6]!.monthlyValueCents).toBe(3000);
    expect(rows[7]!.stage).toBe("won");
    expect(rows[8]!.stage).toBe("lost");
  });

  it("grows the window with the cursor and shows each row once (next-up and newest)", async () => {
    for (const sort of ["next-up", "newest"] as const) {
      const first = await getLeadQueue({ sort, q: bulkTag }, now);
      expect(first.rows).toHaveLength(50);
      expect(first.nextCursor).not.toBeNull();
      expect(first.capped).toBe(false);
      const second = await getLeadQueue({ sort, q: bulkTag, cursor: first.nextCursor! }, now);
      expect(second.rows).toHaveLength(55);
      expect(second.nextCursor).toBeNull();
      expect(new Set(second.rows.map((r) => r.id)).size).toBe(55);
      expect(second.rows.slice(0, 50).map((r) => r.id)).toEqual(first.rows.map((r) => r.id));
    }
  });

  it("searches by phone digits, name, and email prefix", async () => {
    const byPhone = await getLeadQueue({ sort: "newest", q: "5552000004" }, now);
    expect(byPhone.rows.map((r) => r.contactName)).toEqual([`Queue ${tag} Today`]);
    const byName = await getLeadQueue({ sort: "newest", q: `Queue ${tag} QuotedNewer` }, now);
    expect(byName.rows.map((r) => r.contactName)).toEqual([`Queue ${tag} QuotedNewer`]);
    const byEmail = await getLeadQueue({ sort: "newest", q: `queue-${tag}@` }, now);
    expect(byEmail.rows.map((r) => r.contactName)).toEqual([`Queue ${tag} HighScore`]);
    // A one-character search does not filter yet.
    const oneChar = await getLeadQueue({ sort: "newest", q: "Q" }, now);
    expect(oneChar.rows.length).toBeGreaterThan(10);
  });

  it("follow today shows overdue and today, never tomorrow or won/lost with a date", async () => {
    const { rows } = await getLeadQueue({ sort: "newest", q: tag, follow: "today" }, now);
    const names = rows.map((r) => r.contactName);
    expect(names).toContain(`Queue ${tag} Overdue`);
    expect(names).toContain(`Queue ${tag} Today`);
    expect(names).not.toContain(`Queue ${tag} Tomorrow`);
    expect(names).not.toContain(`Queue ${tag} Won`);
    expect(names).not.toContain(`Queue ${tag} Lost`);
  });

  it("counts one stage at a time with the same filters", async () => {
    expect(await getLeadStageCounts({ q: tag })).toEqual({
      new: 3,
      contacted: 3,
      quoted: 2,
      won: 1,
      lost: 1,
    });
  });

  it("sorts by biggest monthly value first", async () => {
    const { rows } = await getLeadQueue({ sort: "value", q: tag }, now);
    expect(rows[0]!.contactName).toBe(`Queue ${tag} Quoted`);
    expect(rows[0]!.monthlyValueCents).toBe(10000);
    expect(rows[1]!.contactName).toBe(`Queue ${tag} QuotedNewer`);
    expect(rows[1]!.monthlyValueCents).toBe(3000);
  });

  it("sets a follow-up only with the current version, only on a contacted lead", async () => {
    const lead = await prisma.lead.findFirstOrThrow({
      where: { contactName: `Queue ${tag} Today` },
    });
    const key = businessDateKey(new Date(now.getTime() + 2 * 86400000));
    await expect(setLeadFollowUp(ownerId, lead.id, lead.version + 1, key)).rejects.toThrow(
      /changed in another session/,
    );
    await setLeadFollowUp(ownerId, lead.id, lead.version, key);
    const updated = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(updated.version).toBe(lead.version + 1);
    expect(businessDateKey(updated.nextFollowUpOn!)).toBe(key);

    const fresh = await makeLead(`Queue ${tag} Fresh`, "5552000011", {});
    await expect(
      setLeadFollowUp(ownerId, fresh.id, 1, key),
    ).rejects.toThrow(/Only a contacted lead/);

    // The assignee can set the follow-up on their own lead.
    await prisma.lead.update({
      where: { id: lead.id },
      data: { assignedToUserId: adminId },
    });
    await setLeadFollowUp(adminId, lead.id, updated.version, key);
  });
});
