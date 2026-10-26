import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { recordFirstRetailDeliveryFeeThresholdCrossing } from "@/domains/tax/rdf-threshold-evidence";

const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(target.hostname) &&
  target.pathname === "/appliance_desk_test";
const day = (s: string) => businessDateFromKey(s)!;

describe.skipIf(!enabled)("T-6C1 RDF first crossing (real Postgres)", () => {
  it("locks the threshold date once, preserves original evidence on retry", async () => {
    const old = await prisma.businessSettings.findUnique({
      where: { id: "singleton" },
      select: { rdfThresholdCrossedOn: true },
    });
    const marker = randomUUID();
    try {
      // TFA-1: the small-seller limit is the seeded co.rdf.qualified_threshold
      // rule (50,000,000 cents), not the rdfThresholdCents setting. Only the
      // crossing date itself still lives on the settings row.
      await prisma.businessSettings.upsert({
        where: { id: "singleton" },
        create: { rdfThresholdCrossedOn: null },
        update: { rdfThresholdCrossedOn: null },
      });
      const below = await recordFirstRetailDeliveryFeeThresholdCrossing({
        previousYearRetailCents: 0, currentYearRetailCents: 50000000,
        crossedOn: day("2026-07-01"),
      });
      expect(below).toBeNull();
      const first = await recordFirstRetailDeliveryFeeThresholdCrossing({
        previousYearRetailCents: 0, currentYearRetailCents: 50000001,
        crossedOn: day("2026-07-02"),
      });
      expect(businessDateKey(first!)).toBe("2026-07-02");
      const repeat = await recordFirstRetailDeliveryFeeThresholdCrossing({
        previousYearRetailCents: 0, currentYearRetailCents: 50000100,
        crossedOn: day("2026-07-03"),
      });
      expect(businessDateKey(repeat!)).toBe("2026-07-02");
      const stored = await prisma.businessSettings.findUniqueOrThrow({
        where: { id: "singleton" },
        select: { rdfThresholdCrossedOn: true },
      });
      expect(businessDateKey(stored.rdfThresholdCrossedOn!)).toBe("2026-07-02");
      const logs = await prisma.auditLog.findMany({
        where: { action: "tax.rdf.threshold_crossed", entityId: "singleton" },
        orderBy: { createdAt: "desc" },
      });
      // This test may run against a reused disposable database; verify the
      // current period crossing appears once among the audit records.
      expect(logs.filter(x => (x.newValue as { date?: string } | null)?.date === "2026-07-02")).toHaveLength(1);
    } finally {
      if (old) await prisma.businessSettings.update({
        where: { id: "singleton" }, data: {
          rdfThresholdCrossedOn: old.rdfThresholdCrossedOn,
        },
      });
      await prisma.auditLog.deleteMany({
        where: {
          action: "tax.rdf.threshold_crossed",
          entityId: "singleton",
          newValue: { path: ["date"], equals: "2026-07-02" },
        },
      });
      void marker;
    }
  });
});
