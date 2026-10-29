import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
const reset = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ auth: {
  $context: Promise.resolve({ password: { hash: (password: string) => hashPassword(password) } }),
  api: { requestPasswordReset: reset },
} }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn().mockResolvedValue({ sent: true }) }));
import { prisma } from "@/lib/prisma";
import { convertLeadToCustomer, updateLeadStatus } from "@/domains/leads";
import { mergeLeads } from "@/domains/leads/merge";

// AR-9: Lead.closedAt is written by every close path and cleared on reopen;
// the migration backfill takes the newest lead.status / lead.convert audit
// row. Disposable CI Postgres only (same gate as the other lead suites).
let parsed: URL | null = null;
try { parsed = new URL(process.env.DATABASE_URL ?? ""); } catch { parsed = null; }
const enabled =
  process.env.CI === "true" && parsed !== null &&
  ["localhost", "127.0.0.1"].includes(parsed.hostname) &&
  parsed.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("lead closedAt (AR-9)", () => {
  const tag = randomUUID();
  const leadIds: string[] = [];
  const emails: string[] = [];
  let ownerId: string;

  async function makeLead(i: number): Promise<string> {
    const email = `closedat-${tag}-${i}@example.com`;
    emails.push(email);
    const lead = await prisma.lead.create({
      data: { contactName: `ClosedAt fixture ${i}`, email, phone: "5551234567", status: "NEW" },
    });
    leadIds.push(lead.id);
    return lead.id;
  }

  beforeAll(async () => {
    ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    reset.mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: leadIds } } });
    await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
    await prisma.customer.deleteMany({ where: { user: { email: { in: emails } } } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
  });

  it("marking lost sets closedAt; reopening clears it", async () => {
    const id = await makeLead(0);
    const before = new Date();
    await updateLeadStatus(ownerId, id, "LOST", "Went with someone else");
    const lost = await prisma.lead.findUniqueOrThrow({ where: { id } });
    expect(lost.status).toBe("LOST");
    expect(lost.closedAt).not.toBeNull();
    expect(lost.closedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);

    await updateLeadStatus(ownerId, id, "CONTACTED");
    const reopened = await prisma.lead.findUniqueOrThrow({ where: { id } });
    expect(reopened.status).toBe("CONTACTED");
    expect(reopened.closedAt).toBeNull();
  });

  it("converting sets closedAt", async () => {
    const id = await makeLead(1);
    await convertLeadToCustomer(ownerId, id);
    const converted = await prisma.lead.findUniqueOrThrow({ where: { id } });
    expect(converted.status).toBe("CONVERTED");
    expect(converted.closedAt).not.toBeNull();
  });

  it("merging sets the merged-away lead's closedAt", async () => {
    const keepId = await makeLead(2);
    const mergeId = await makeLead(3);
    await mergeLeads(ownerId, keepId, mergeId);
    const merged = await prisma.lead.findUniqueOrThrow({ where: { id: mergeId } });
    expect(merged.status).toBe("LOST");
    expect(merged.mergedIntoLeadId).toBe(keepId);
    expect(merged.closedAt).not.toBeNull();
  });

  it("the migration backfill takes the newest status/convert audit row", async () => {
    const id = await makeLead(4);
    const older = new Date("2026-09-01T12:00:00Z");
    const newer = new Date("2026-10-02T12:00:00Z");
    await prisma.lead.update({ where: { id }, data: { status: "LOST", closedAt: null } });
    await prisma.auditLog.createMany({
      data: [
        { userId: ownerId, action: "lead.status", entityType: "Lead", entityId: id, createdAt: older },
        { userId: ownerId, action: "lead.status", entityType: "Lead", entityId: id, createdAt: newer },
        { userId: ownerId, action: "lead.note", entityType: "Lead", entityId: id, createdAt: new Date("2026-10-03T12:00:00Z") },
      ],
    });
    // The migration's backfill statement, scoped to this fixture lead.
    await prisma.$executeRaw`
      UPDATE "Lead" l SET "closedAt" = a."createdAt" FROM (SELECT DISTINCT ON ("entityId") "entityId", "createdAt" FROM "AuditLog" WHERE action IN ('lead.status','lead.convert') ORDER BY "entityId", "createdAt" DESC) a WHERE a."entityId" = l.id AND l.status IN ('CONVERTED','LOST') AND l.id = ${id}`;
    const backfilled = await prisma.lead.findUniqueOrThrow({ where: { id } });
    expect(backfilled.closedAt?.toISOString()).toBe(newer.toISOString());
  });
});
