import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { recordMandatorySigningPolicy } from "@/domains/billing/signing-mandatory-policy";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && url.pathname === "/appliance_desk_test"
  && ["localhost", "127.0.0.1"].includes(url.hostname);

describe.skipIf(!enabled)("owner policy revision and audit in disposable Postgres", () => {
  const marker = randomUUID().replaceAll("-", "");
  let owner = "", staff = "";
  let previous: unknown;
  beforeAll(async () => {
    const settings = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    previous = settings.signingMandatoryPolicyVersions;
    const u = await prisma.user.create({ data: {
      email: `policy-owner-${marker}@example.test`, role: "OWNER", passwordHash: "test-only",
    } });
    const s = await prisma.user.create({ data: {
      email: `policy-staff-${marker}@example.test`, role: "STAFF", passwordHash: "test-only",
    } });
    owner = u.id; staff = s.id;
  });
  afterAll(async () => {
    // Restore the exact prior policy and clean only our isolated disposable fixture.
    await prisma.businessSettings.update({ where: { id: "singleton" },
      data: { signingMandatoryPolicyVersions: previous as never } });
    await prisma.auditLog.deleteMany({ where: {
      action: "signing.mandatory_policy_version", userId: owner,
    } });
    await prisma.user.deleteMany({ where: { id: { in: [owner, staff] } } });
  });
  const approval = {
    effectiveFromKey: "2026-10-14",
    reason: "Owner-reviewed mandatory charge decisions, test only.",
    decisions: {
      delivery: "REQUIRED" as const, installation: "NOT_APPLICABLE" as const,
      removal: "NOT_APPLICABLE" as const, damageWaiver: "UNDECIDED" as const,
      retailDelivery: "EXEMPT" as const,
    },
  };
  it("rejects inactive roles under the database transaction lock", async () => {
    await expect(recordMandatorySigningPolicy(staff, approval)).rejects.toThrow();
    expect((await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } }))
      .signingMandatoryPolicyVersions).toEqual(previous);
  });
  it("appends signed owner identity, reason and immutable history", async () => {
    const first = await recordMandatorySigningPolicy(owner, approval);
    const next = await recordMandatorySigningPolicy(owner, {
      ...approval, effectiveFromKey: "2026-11-02",
      reason: "Later owner reviewed applicability revisions, future only.",
      decisions: { ...approval.decisions, delivery: "NOT_APPLICABLE" },
    });
    expect(next.revision).toBe(first.revision + 1);
    const stored = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    const revisions = stored.signingMandatoryPolicyVersions as unknown[];
    expect(revisions.at(-2)).toEqual(expect.objectContaining({
      revision: first.revision, recordedByUserId: owner, reason: approval.reason,
    }));
    expect(revisions.at(-1)).toEqual(expect.objectContaining({ revision: next.revision }));
    expect((await prisma.auditLog.count({
      where: { userId: owner, action: "signing.mandatory_policy_version" },
    }))).toBe(2);
  });
});
