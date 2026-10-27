import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { createLeadManually, updateLeadStatus } from "@/domains/leads";
import { mergeLeads } from "@/domains/leads/merge";
import { setLeadFollowUp } from "@/domains/leads/follow-up";
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

describe.skipIf(!enabled)("lead creation race and follow-up version writers", () => {
  const tag = randomUUID().replace(/\D/g, "").padEnd(12, "7");
  let ownerId: string;
  let counter = 0;
  const leadIds: string[] = [];

  const phone = () => `97055${tag.slice(0, 3)}${String(counter++).padStart(2, "0")}`.slice(0, 12);

  async function makeLead(phoneNumber: string) {
    const lead = await createLeadManually(ownerId, {
      contactName: `Version fixture ${tag}`,
      phone: phoneNumber,
    });
    leadIds.push(lead.id);
    return lead;
  }

  beforeAll(async () => {
    ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: leadIds } } });
    await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
  });

  it("flags exactly one of two leads created at the same moment with the same phone", async () => {
    const shared = phone();
    const [a, b] = await Promise.all([makeLead(shared), makeLead(shared)]);
    const flagged = [a, b].filter((l) => l.possibleDuplicateOfLeadId !== null);
    expect(flagged).toHaveLength(1);
    const other = flagged[0]!.id === a.id ? b : a;
    expect(flagged[0]!.possibleDuplicateOfLeadId).toBe(other.id);
  });

  it("a status change that moves the follow-up advances its version, so a stale save is refused", async () => {
    const lead = await makeLead(phone());
    expect(lead.version).toBe(1);

    await updateLeadStatus(ownerId, lead.id, "CONTACTED", undefined, dateInDays(7));
    let row = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(row.nextFollowUpOn?.getTime()).toBe(dateInDays(7).getTime());
    expect(row.version).toBe(2);

    // A session still holding version 1 cannot overwrite the newer date.
    await expect(setLeadFollowUp(ownerId, lead.id, 1, keyInDays(10))).rejects.toThrow(
      /changed in another session/,
    );
    await setLeadFollowUp(ownerId, lead.id, 2, keyInDays(10));
    row = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(row.version).toBe(3);
    expect(row.nextFollowUpOn?.getTime()).toBe(dateInDays(10).getTime());

    // A status save that keeps the same follow-up date leaves the version alone.
    await updateLeadStatus(ownerId, lead.id, "CONTACTED", undefined, row.nextFollowUpOn);
    row = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(row.version).toBe(3);

    // Clearing the follow-up (marking lost) is a change: the version advances.
    await updateLeadStatus(ownerId, lead.id, "LOST", "No longer needed");
    row = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(row.nextFollowUpOn).toBeNull();
    expect(row.version).toBe(4);
  });

  it("a merge that moves the kept lead's follow-up advances its version", async () => {
    const keep = await makeLead(phone());
    const away = await makeLead(phone());
    await updateLeadStatus(ownerId, keep.id, "CONTACTED", undefined, dateInDays(14));
    await updateLeadStatus(ownerId, away.id, "CONTACTED", undefined, dateInDays(5));
    const before = await prisma.lead.findUniqueOrThrow({ where: { id: keep.id } });

    await mergeLeads(ownerId, keep.id, away.id);
    leadIds.push(away.id);
    const after = await prisma.lead.findUniqueOrThrow({ where: { id: keep.id } });
    expect(after.nextFollowUpOn?.getTime()).toBe(dateInDays(5).getTime());
    expect(after.version).toBe(before.version + 1);

    await expect(
      setLeadFollowUp(ownerId, keep.id, before.version, keyInDays(20)),
    ).rejects.toThrow(/changed in another session/);
  });
});
