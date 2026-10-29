import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { createLeadManually, updateLeadStatus } from "@/domains/leads";
import {
  createEstimateDraftForLead,
  createEstimateDraftForNewLead,
} from "@/domains/estimates/index-base";

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

describe.skipIf(!enabled)("quote for an existing lead (AR-4b)", () => {
  const tag = randomUUID().replace(/\D/g, "").padEnd(12, "3");
  let ownerId: string;
  let adminId: string;
  let counter = 0;
  const leadIds: string[] = [];
  const estimateIds: string[] = [];
  const phone = () => `97055${tag.slice(0, 3)}${String(counter++).padStart(2, "0")}`.slice(0, 12);

  async function makeLead() {
    const lead = await createLeadManually(ownerId, {
      contactName: `Quote fixture ${tag}`,
      phone: phone(),
    });
    leadIds.push(lead.id);
    return lead;
  }

  beforeAll(async () => {
    ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    adminId = (await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { OR: [{ entityId: { in: leadIds } }, { entityId: { in: estimateIds } }] },
    });
    await prisma.estimate.deleteMany({ where: { id: { in: estimateIds } } });
    await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
  });

  it("creates the estimate against the lead, with the estimate.create audit row", async () => {
    const lead = await makeLead();
    const estimate = await createEstimateDraftForLead(ownerId, lead.id, { title: "Washer · Month to month" });
    estimateIds.push(estimate.id);
    expect(estimate.leadId).toBe(lead.id);
    expect(estimate.customerId).toBeNull();
    const audit = await prisma.auditLog.findFirst({
      where: { action: "estimate.create", entityId: estimate.id },
    });
    expect(audit).not.toBeNull();
  });

  it("refuses lost and converted leads with the closed-lead words", async () => {
    const lost = await makeLead();
    await updateLeadStatus(ownerId, lost.id, "LOST", "Too expensive");
    await expect(createEstimateDraftForLead(ownerId, lost.id, { title: "Nope" })).rejects.toThrow(
      /This lead is closed/,
    );

    const converted = await makeLead();
    await prisma.lead.update({ where: { id: converted.id }, data: { status: "CONVERTED" } });
    await expect(createEstimateDraftForLead(ownerId, converted.id, { title: "Nope" })).rejects.toThrow(
      /This lead is closed/,
    );
  });

  it("refuses a missing lead and a staff actor (owner/admin only)", async () => {
    await expect(
      createEstimateDraftForLead(ownerId, "no-such-lead", { title: "Nope" }),
    ).rejects.toThrow(/no longer exists/);
    const lead = await makeLead();
    const staff = await prisma.user.findFirstOrThrow({ where: { role: "STAFF" } });
    await expect(createEstimateDraftForLead(staff.id, lead.id, { title: "Nope" })).rejects.toThrow();
    void adminId;
  });

  it("the new-lead flow is one transaction: a failed estimate leaves no lead behind", async () => {
    const before = await prisma.lead.count({ where: { contactName: `Rollback fixture ${tag}` } });
    // A title over the DB's comfort is not a failure; force one instead:
    // an empty title is refused by the DB check? Use a null-forging cast —
    // the create must throw inside the transaction.
    await expect(
      createEstimateDraftForNewLead(
        ownerId,
        { contactName: `Rollback fixture ${tag}`, phone: phone() },
        { title: undefined as unknown as string },
      ),
    ).rejects.toThrow();
    const after = await prisma.lead.count({ where: { contactName: `Rollback fixture ${tag}` } });
    expect(after).toBe(before);
  });
});
