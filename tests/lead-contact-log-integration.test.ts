import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { addLeadNote, createLeadManually, logLeadAttempt, logLeadContact } from "@/domains/leads";
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

const dateInDays = (days: number) =>
  businessDateFromKey(businessDateKey(addBusinessDays(new Date(), days)))!;

describe.skipIf(!enabled)("lead contact log (AR-4b)", () => {
  const tag = randomUUID().replace(/\D/g, "").padEnd(12, "5");
  let ownerId: string;
  let counter = 0;
  const leadIds: string[] = [];
  const phone = () => `97055${tag.slice(0, 3)}${String(counter++).padStart(2, "0")}`.slice(0, 12);

  async function makeLead() {
    const lead = await createLeadManually(ownerId, {
      contactName: `Contact log fixture ${tag}`,
      phone: phone(),
    });
    leadIds.push(lead.id);
    return lead;
  }

  beforeAll(async () => {
    ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: leadIds } } });
    await prisma.leadNote.deleteMany({ where: { leadId: { in: leadIds } } });
    await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
  });

  it("CONTACTED sets firstContactedAt once and moves a new lead to contacted", async () => {
    const lead = await makeLead();
    await logLeadContact(ownerId, lead.id, "Reached them on the phone.");
    const after1 = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after1.status).toBe("CONTACTED");
    expect(after1.firstContactedAt).not.toBeNull();

    await logLeadContact(ownerId, lead.id, "Spoke again about the start date.");
    const after2 = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after2.firstContactedAt?.getTime()).toBe(after1.firstContactedAt?.getTime());

    const notes = await prisma.leadNote.findMany({ where: { leadId: lead.id }, orderBy: { createdAt: "asc" } });
    expect(notes.map((n) => n.kind)).toEqual(["CONTACTED", "CONTACTED"]);
  });

  it("ATTEMPT never counts as contact: a new lead stays new with no first contact", async () => {
    const lead = await makeLead();
    await logLeadAttempt(ownerId, lead.id, "Tried, no answer.");
    const row = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(row.status).toBe("NEW");
    expect(row.firstContactedAt).toBeNull();
    const note = await prisma.leadNote.findFirstOrThrow({ where: { leadId: lead.id } });
    expect(note.kind).toBe("ATTEMPT");
  });

  it("a plain NOTE does not count as contact either", async () => {
    const lead = await makeLead();
    await addLeadNote(lead.id, ownerId, "They prefer mornings.");
    const row = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(row.status).toBe("NEW");
    expect(row.firstContactedAt).toBeNull();
  });

  it("an ATTEMPT can plan a follow-up on a new lead without moving it to contacted", async () => {
    const lead = await makeLead();
    const when = dateInDays(3);
    await logLeadAttempt(ownerId, lead.id, "Tried, no answer — will retry.", when);
    const row = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(row.status).toBe("NEW");
    expect(row.firstContactedAt).toBeNull();
    expect(row.nextFollowUpOn?.getTime()).toBe(when.getTime());
  });

  it("a CONTACTED log can set the follow-up date in the same save", async () => {
    const lead = await makeLead();
    const when = dateInDays(5);
    await logLeadContact(ownerId, lead.id, "Reached them; asked to think it over.", when);
    const row = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(row.status).toBe("CONTACTED");
    expect(row.nextFollowUpOn?.getTime()).toBe(when.getTime());
  });
});
