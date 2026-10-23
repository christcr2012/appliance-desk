import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  addStarterChecklist,
  createPaperwork,
  deletePaperwork,
  getPaperwork,
  listPaperwork,
  listPaperworkAttention,
  markPaperworkDone,
  updatePaperwork,
} from "@/domains/paperwork";
import { PAPERWORK_TEMPLATES } from "@/domains/paperwork/templates";
import { paperworkInputSchema } from "@/domains/paperwork/schema";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

const tag = randomUUID().slice(0, 10);
const ownerId = `paper-owner-${tag}`;
const staffId = `paper-staff-${tag}`;
const input = (over: Record<string, unknown> = {}) =>
  paperworkInputSchema.parse({
    title: `Permit ${tag}`,
    groupName: "Licenses and permits",
    status: "DONE",
    remindDaysBefore: "30",
    repeatEveryMonths: "",
    ...over,
  });

describe.skipIf(!enabled)("business paperwork on disposable Postgres", () => {
  beforeAll(async () => {
    await prisma.businessPaperwork.deleteMany({});
    await prisma.user.createMany({
      data: [
        { id: ownerId, email: `${ownerId}@example.test`, role: "OWNER" },
        { id: staffId, email: `${staffId}@example.test`, role: "STAFF" },
      ],
    });
  });
  afterAll(async () => {
    await prisma.businessPaperwork.deleteMany({});
    await prisma.auditLog.deleteMany({ where: { userId: { in: [ownerId, staffId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, staffId] } } });
  });

  it("only the owner can read or write; staff and admins are refused", async () => {
    await expect(listPaperwork("STAFF")).rejects.toThrow(/Only the owner/);
    await expect(listPaperwork("ADMIN")).rejects.toThrow(/Only the owner/);
    await expect(addStarterChecklist(staffId)).rejects.toThrow();
    await expect(createPaperwork(staffId, input())).rejects.toThrow();
    expect(await prisma.businessPaperwork.count()).toBe(0);
  });

  it("adds the starter checklist once, without overwriting an owner's edits", async () => {
    const first = await addStarterChecklist(ownerId);
    expect(first.added).toBe(PAPERWORK_TEMPLATES.length);
    const llc = await prisma.businessPaperwork.findUniqueOrThrow({ where: { templateKey: "llc" } });
    await updatePaperwork(ownerId, llc.id, input({ title: "Register my LLC", groupName: "Start the business", referenceNumber: "SECRET-123456" }), llc.version);
    const second = await addStarterChecklist(ownerId);
    expect(second.added).toBe(0);
    const again = await prisma.businessPaperwork.findUniqueOrThrow({ where: { templateKey: "llc" } });
    expect(again.title).toBe("Register my LLC");
  });

  it("keeps numbers out of the activity log and detects an out-of-date edit", async () => {
    const llc = await prisma.businessPaperwork.findUniqueOrThrow({ where: { templateKey: "llc" } });
    expect(llc.referenceNumber).toBe("SECRET-123456");
    const logs = await prisma.auditLog.findMany({ where: { userId: ownerId, entityType: "BusinessPaperwork" } });
    expect(JSON.stringify(logs)).not.toContain("SECRET-123456");
    await expect(
      updatePaperwork(ownerId, llc.id, input({ title: "Stale edit", groupName: "Start the business" }), llc.version - 1),
    ).rejects.toThrow(/changed somewhere else/);
    expect((await getPaperwork("OWNER", llc.id))?.title).toBe("Register my LLC");
  });

  it("puts dated items on the Today list only inside their window, plus one setup summary", async () => {
    const now = new Date("2026-10-23T18:00:00Z");
    const soon = await createPaperwork(ownerId, input({ title: `Soon ${tag}`, dueOn: "2026-11-10" }));
    await createPaperwork(ownerId, input({ title: `Far ${tag}`, dueOn: "2027-06-10" }));
    const late = await createPaperwork(ownerId, input({ title: `Late ${tag}`, dueOn: "2026-10-01" }));
    await createPaperwork(ownerId, input({ title: `Skipped ${tag}`, status: "NOT_NEEDED", dueOn: "2026-10-01" }));
    const items = await listPaperworkAttention(now);
    const titles = items.map((i) => i.title);
    expect(titles.some((t) => t.startsWith(`Soon ${tag}`))).toBe(true);
    expect(titles.some((t) => t.startsWith(`Late ${tag}`) && t.includes("overdue"))).toBe(true);
    expect(titles.some((t) => t.includes(`Far ${tag}`))).toBe(false);
    expect(titles.some((t) => t.includes(`Skipped ${tag}`))).toBe(false);
    expect(titles.filter((t) => t.startsWith("Business setup:"))).toHaveLength(1);
    const lateItem = items.find((i) => i.href.endsWith(late));
    expect(lateItem?.severity).toBe("high");
    expect(items.find((i) => i.href.endsWith(soon))?.category).toBe("BUSINESS_PAPERWORK");
  });

  it("marks a yearly item done by moving to next year, and a one-time item done by clearing its date", async () => {
    const yearly = await createPaperwork(ownerId, input({ title: `Yearly ${tag}`, dueOn: "2026-10-30", repeatEveryMonths: "12" }));
    const once = await createPaperwork(ownerId, input({ title: `Once ${tag}`, status: "IN_PROGRESS", dueOn: "2026-10-30" }));
    await markPaperworkDone(ownerId, yearly, new Date("2026-10-23T18:00:00Z"));
    await markPaperworkDone(ownerId, once, new Date("2026-10-23T18:00:00Z"));
    const y = await prisma.businessPaperwork.findUniqueOrThrow({ where: { id: yearly } });
    const o = await prisma.businessPaperwork.findUniqueOrThrow({ where: { id: once } });
    expect(y.status).toBe("DONE");
    expect(y.dueOn?.toISOString().slice(0, 10)).toBe("2027-10-30");
    expect(o.status).toBe("DONE");
    expect(o.dueOn).toBeNull();
    expect(o.lastDoneOn).not.toBeNull();
  });

  it("lets the owner delete their own items but never starter items", async () => {
    const own = await createPaperwork(ownerId, input({ title: `Mine ${tag}` }));
    await deletePaperwork(ownerId, own);
    expect(await prisma.businessPaperwork.findUnique({ where: { id: own } })).toBeNull();
    const starter = await prisma.businessPaperwork.findUniqueOrThrow({ where: { templateKey: "ein" } });
    await expect(deletePaperwork(ownerId, starter.id)).rejects.toThrow(/Not needed/);
  });
});
