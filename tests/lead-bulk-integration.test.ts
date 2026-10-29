import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { createLeadManually, updateLeadStatus } from "@/domains/leads";
import { bulkUpdateLeads } from "@/domains/leads/bulk";
import { addBusinessDays, businessDateFromKey, businessDateKey } from "@/lib/business-date";

// Disposable CI Postgres only (same gate as the other lead integration tests).
const url = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? "");
  } catch {
    return null;
  }
})();
const enabled =
  process.env.CI === "true" &&
  url !== null &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

const keyInDays = (days: number) => businessDateKey(addBusinessDays(new Date(), days));
const dateInDays = (days: number) => businessDateFromKey(keyInDays(days))!;

describe.skipIf(!enabled)("bulk lead updates (AR-4b)", () => {
  const tag = randomUUID().replace(/\D/g, "").padEnd(12, "9");
  let ownerId: string;
  let staffId: string;
  let counter = 0;
  const leadIds: string[] = [];
  const phone = () => `97055${tag.slice(0, 3)}${String(counter++).padStart(2, "0")}`.slice(0, 12);

  async function makeLead(contacted = false) {
    const lead = await createLeadManually(ownerId, {
      contactName: `Bulk fixture ${tag}`,
      phone: phone(),
    });
    leadIds.push(lead.id);
    if (contacted) await updateLeadStatus(ownerId, lead.id, "CONTACTED");
    return lead;
  }

  beforeAll(async () => {
    ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    staffId = (await prisma.user.findFirstOrThrow({ where: { role: "STAFF" } })).id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: leadIds } } });
    await prisma.leadNote.deleteMany({ where: { leadId: { in: leadIds } } });
    await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
  });

  it("assigns many leads in one call", async () => {
    const a = await makeLead();
    const b = await makeLead();
    const result = await bulkUpdateLeads(ownerId, "assign", [a.id, b.id], { toUserId: staffId });
    expect(result).toEqual({ done: 2, failed: [] });
    const rows = await prisma.lead.findMany({ where: { id: { in: [a.id, b.id] } } });
    expect(rows.every((r) => r.assignedToUserId === staffId)).toBe(true);
  });

  it("reports per-lead failures without rolling back the others (its own transaction each)", async () => {
    const contacted = await makeLead(true);
    const fresh = await makeLead(false); // NEW: follow-up refuses
    const result = await bulkUpdateLeads(ownerId, "follow-up", [contacted.id, fresh.id], {
      dateKey: keyInDays(4),
    });
    expect(result.done).toBe(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.id).toBe(fresh.id);
    expect(result.failed[0]!.message).toMatch(/contacted/i);
    const row = await prisma.lead.findUniqueOrThrow({ where: { id: contacted.id } });
    expect(row.nextFollowUpOn?.getTime()).toBe(dateInDays(4).getTime());
  });

  it("marks leads lost with one shared reason", async () => {
    const lead = await makeLead();
    const result = await bulkUpdateLeads(ownerId, "lost", [lead.id], { reason: "Too expensive" });
    expect(result.done).toBe(1);
    const row = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(row.status).toBe("LOST");
    expect(row.lostReason).toBe("Too expensive");
  });

  it("refuses more than 200 leads, and a lost call with no reason, up front", async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `lead-${i}`);
    await expect(bulkUpdateLeads(ownerId, "assign", ids, { toUserId: null })).rejects.toThrow(
      /at most 200/,
    );
    const lead = await makeLead();
    await expect(bulkUpdateLeads(ownerId, "lost", [lead.id], {})).rejects.toThrow(/reason/i);
  });

  it("keeps the domain role rules per lead: staff cannot assign (owner/admin only)", async () => {
    const lead = await makeLead();
    const result = await bulkUpdateLeads(staffId, "assign", [lead.id], { toUserId: staffId });
    expect(result.done).toBe(0);
    expect(result.failed).toHaveLength(1);
  });
});
