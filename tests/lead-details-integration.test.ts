import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { createLeadManually, updateLeadDetails, type LeadDetailsInput } from "@/domains/leads";

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

describe.skipIf(!enabled)("lead details editing (AR-4b)", () => {
  const tag = randomUUID().replace(/\D/g, "").padEnd(12, "1");
  let ownerId: string;
  let counter = 0;
  const leadIds: string[] = [];
  const phone = () => `97055${tag.slice(0, 3)}${String(counter++).padStart(2, "0")}`.slice(0, 12);

  async function makeLead() {
    const lead = await createLeadManually(ownerId, {
      contactName: `Details fixture ${tag}`,
      phone: phone(),
    });
    leadIds.push(lead.id);
    return lead;
  }

  function inputFor(lead: { contactName: string; phone: string }, over: Partial<LeadDetailsInput> = {}): LeadDetailsInput {
    return {
      contactName: lead.contactName,
      companyName: null,
      isBusiness: false,
      isPropertyManager: false,
      phone: lead.phone,
      email: null,
      bestTimeToContact: null,
      howHeard: null,
      desiredTerm: null,
      desiredStartDate: null,
      quantity: 1,
      addressLine1: null,
      city: null,
      zip: null,
      notes: null,
      ...over,
    };
  }

  beforeAll(async () => {
    ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: leadIds } } });
    await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
  });

  it("saves edited fields and audits only what changed", async () => {
    const lead = await makeLead();
    await updateLeadDetails(ownerId, lead.id, inputFor(lead, {
      city: "Greeley",
      desiredTerm: "12-month",
      quantity: 2,
      notes: "Wants a quiet set.",
    }));
    const row = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(row.city).toBe("Greeley");
    expect(row.desiredTerm).toBe("12-month");
    expect(row.quantity).toBe(2);
    expect(row.notes).toBe("Wants a quiet set.");
    expect(row.inServiceArea).toBe(true); // Greeley is a zoned town

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "lead.details", entityId: lead.id },
    });
    const newValue = audit.newValue as Record<string, unknown>;
    expect(Object.keys(newValue).sort()).toEqual(["city", "desiredTerm", "notes", "quantity"]);
    expect(newValue.city).toBe("Greeley");
  });

  it("recomputes the score under the current policy when the want changes", async () => {
    const lead = await makeLead();
    const before = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    await updateLeadDetails(ownerId, lead.id, inputFor(lead, {
      desiredTerm: "12-month",
      quantity: 3,
      isPropertyManager: true,
    }));
    const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after.score).toBeGreaterThan(before.score);
    expect(after.scoringPolicyVersion).toBe(before.scoringPolicyVersion);
  });

  it("refuses a converted lead", async () => {
    const lead = await makeLead();
    await prisma.lead.update({ where: { id: lead.id }, data: { status: "CONVERTED" } });
    await expect(updateLeadDetails(ownerId, lead.id, inputFor(lead, { city: "Evans" }))).rejects.toThrow(
      /already been converted/,
    );
  });

  it("surfaces the schema's own validation words", async () => {
    const lead = await makeLead();
    await expect(
      updateLeadDetails(ownerId, lead.id, inputFor(lead, { quantity: 51 })),
    ).rejects.toThrow();
    await expect(
      updateLeadDetails(ownerId, lead.id, inputFor(lead, { email: "not-an-email" })),
    ).rejects.toThrow(/valid email/);
  });
});
