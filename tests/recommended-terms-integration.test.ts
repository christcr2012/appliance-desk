import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { RECOMMENDED_TERMS_POLICY } from "@/domains/settings/recommended-terms";
import { termsPolicyUpdate } from "@/domains/settings/terms-policy";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

const KEYS = [
  "earlyTerminationFeeCents",
  "earlyTerminationFeePercent",
  "earlyTerminationFeeCapCents",
  "earlyTerminationNoticeDays",
  "unusedTermTreatment",
  "terminationTermsText",
  "autoRenewNoticeDays",
  "autoRenewTermsVersion",
  "renewalTermsText",
] as const;

const sql = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20261003200000_recommended_terms_starting_values/migration.sql",
  ),
  "utf8",
);

describe.skipIf(!enabled)("the starting-terms migration matches the app's recommended terms", () => {
  let original: Record<string, unknown> = {};

  async function policyRow() {
    const row = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    return Object.fromEntries(KEYS.map((k) => [k, row[k]]));
  }

  beforeAll(async () => {
    await prisma.businessSettings.upsert({ where: { id: "singleton" }, update: {}, create: { id: "singleton" } });
    original = await policyRow();
  });

  afterAll(async () => {
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: original });
  });

  it("writes exactly what the form's recommended values would save, including the version label", async () => {
    await prisma.businessSettings.update({
      where: { id: "singleton" },
      data: Object.fromEntries(KEYS.map((k) => [k, null])),
    });
    await prisma.$executeRawUnsafe(sql);
    const expected = termsPolicyUpdate(RECOMMENDED_TERMS_POLICY);
    if (!expected.success) throw new Error(expected.message);
    const actual = await policyRow();
    for (const k of KEYS) expect(actual[k], k).toEqual((expected.update as Record<string, unknown>)[k]);
  });

  it("never overwrites anything the owner already entered", async () => {
    await prisma.businessSettings.update({
      where: { id: "singleton" },
      data: Object.fromEntries(KEYS.map((k) => [k, null])),
    });
    await prisma.businessSettings.update({
      where: { id: "singleton" },
      data: { earlyTerminationNoticeDays: 14 },
    });
    await prisma.$executeRawUnsafe(sql);
    const actual = await policyRow();
    expect(actual.earlyTerminationNoticeDays).toBe(14);
    expect(actual.earlyTerminationFeeCents).toBeNull();
    expect(actual.renewalTermsText).toBeNull();
  });
});
