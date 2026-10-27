import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { leadStage, leadStageWhere, type LeadStage } from "@/domains/leads/stage";
import type { LeadStatus } from "@prisma/client";

// Disposable CI Postgres only; never creates fixtures or attempts rollback on Neon.
const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

type Fixture = {
  id: string;
  status: LeadStatus;
  firstContactedAt: Date | null;
  openQuote: boolean;
  merged: boolean;
};

describe.skipIf(!enabled)("lead stages: where-clauses match the derived stage", () => {
  const tag = randomUUID();
  const fixtures: Fixture[] = [];
  const estimateIds: string[] = [];
  let ownerId: string;

  async function makeLead(
    i: number,
    data: { status: LeadStatus; firstContactedAt?: Date | null; mergedIntoLeadId?: string },
    openQuote?: "SENT" | "VIEWED",
  ): Promise<Fixture> {
    const lead = await prisma.lead.create({
      data: {
        contactName: `Stage fixture ${tag} ${i}`,
        phone: `555${String(1000000 + i)}`,
        email: `stage-${tag}-${i}@example.com`,
        status: data.status,
        firstContactedAt: data.firstContactedAt ?? null,
        mergedIntoLeadId: data.mergedIntoLeadId ?? null,
        mergedAt: data.mergedIntoLeadId ? new Date() : null,
      },
    });
    if (openQuote) {
      const estimate = await prisma.estimate.create({
        data: { leadId: lead.id, status: openQuote, title: `Stage fixture ${tag} ${i}`, createdByUserId: ownerId },
      });
      estimateIds.push(estimate.id);
    }
    const fixture: Fixture = {
      id: lead.id,
      status: data.status,
      firstContactedAt: data.firstContactedAt ?? null,
      openQuote: Boolean(openQuote),
      merged: Boolean(data.mergedIntoLeadId),
    };
    fixtures.push(fixture);
    return fixture;
  }

  beforeAll(async () => {
    ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    const now = new Date("2026-10-20T12:00:00Z");
    // new (4): NEW, never contacted, no open quote.
    for (let i = 0; i < 4; i++) await makeLead(i, { status: "NEW" });
    // contacted (5): CONTACTED with a first contact, plus one NEW lead that
    // was already contacted once (stored NEW, firstContactedAt set).
    for (let i = 4; i < 8; i++) await makeLead(i, { status: "CONTACTED", firstContactedAt: now });
    await makeLead(8, { status: "NEW", firstContactedAt: now });
    // quoted (3): a NEW lead with a sent quote is quoted, not new.
    await makeLead(9, { status: "NEW" }, "SENT");
    await makeLead(10, { status: "CONTACTED", firstContactedAt: now }, "VIEWED");
    await makeLead(11, { status: "NEW" }, "SENT");
    // won (3): CONVERTED, one of them still holding an open quote.
    await makeLead(12, { status: "CONVERTED", firstContactedAt: now });
    await makeLead(13, { status: "CONVERTED" });
    await makeLead(14, { status: "CONVERTED", firstContactedAt: now }, "SENT");
    // lost (3): LOST, one of them still holding an open quote.
    await makeLead(15, { status: "LOST", firstContactedAt: now });
    await makeLead(16, { status: "LOST", firstContactedAt: now }, "SENT");
    await makeLead(17, { status: "LOST" });
    // merged (2): merged away — in no stage at all.
    const kept = fixtures[0]!;
    await makeLead(18, { status: "LOST", firstContactedAt: now, mergedIntoLeadId: kept.id });
    await makeLead(19, { status: "LOST", mergedIntoLeadId: kept.id });
  });

  afterAll(async () => {
    await prisma.estimate.deleteMany({ where: { id: { in: estimateIds } } });
    await prisma.lead.deleteMany({ where: { id: { in: fixtures.map((f) => f.id) } } });
  });

  it("every live lead is selected by exactly its stage's filter, and merged leads by none", async () => {
    expect(fixtures).toHaveLength(20);
    const stages: LeadStage[] = ["new", "contacted", "quoted", "won", "lost"];
    for (const stage of stages) {
      const expected = fixtures
        .filter((f) => !f.merged && leadStage(f) === stage)
        .map((f) => f.id)
        .sort();
      const found = await prisma.lead.findMany({
        where: { ...leadStageWhere[stage], id: { in: fixtures.map((f) => f.id) } },
        select: { id: true },
      });
      expect(found.map((r) => r.id).sort()).toEqual(expected);
    }
    // No stage selects a merged lead.
    const mergedIds = fixtures.filter((f) => f.merged).map((f) => f.id);
    for (const stage of stages) {
      const found = await prisma.lead.count({
        where: { ...leadStageWhere[stage], id: { in: mergedIds } },
      });
      expect(found).toBe(0);
    }
  });
});
