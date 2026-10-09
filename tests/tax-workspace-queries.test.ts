import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { TaxExemptionReason } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getTaxAreasPage, getTaxExemptionsPage } from "@/domains/tax/workspace-queries";

const connection = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && connection.pathname === "/appliance_desk_test"
  && ["localhost", "127.0.0.1"].includes(connection.hostname);

async function fixture(run: (context: {
  ownerId: string; adminId: string; staffId: string;
  ids: string[]; exemptionIds: string[];
}) => Promise<void>) {
  const token = randomUUID().replaceAll("-", "");
  const users = await Promise.all(["OWNER", "ADMIN", "STAFF"].map((role, index) =>
    prisma.user.create({ data: {
      email: token + index + "@t7b.example.test", role: role as "OWNER" | "ADMIN" | "STAFF",
      name: "Tax workspace test", passwordHash: "test-only",
    } })));
  const customer = await prisma.customer.create({
    data: { userId: users[0]!.id, referralCode: "T7B" + token.slice(0, 12) },
  });
  const ids: string[] = [], addresses: string[] = [], exemptionIds: string[] = [];
  try {
    const createdAt = new Date("2001-01-01T00:00:00Z");
    for (let i = 0; i < 3; i++) {
      const address = await prisma.serviceAddress.create({ data: {
        customerId: customer.id, line1: i + " Test St",
        city: "Greeley", state: "CO", zip: "80631",
      } });
      addresses.push(address.id);
      const location = await prisma.addressTaxLocation.create({ data: {
        serviceAddressId: address.id, createdAt, lookedUpAt: new Date(),
        isCurrent: true, status: "NEEDS_REVIEW", source: "MANUAL",
        reviewNote: "Official provider unavailable — review manually",
      } });
      ids.push(location.id);
      const exemption = await prisma.customerTaxExemption.create({ data: {
        customerId: customer.id, createdAt,
        reason: Object.values(TaxExemptionReason)[0]!,
        verifiedByUserId: users[0]!.id, validFrom: new Date("2026-01-01"),
      } });
      exemptionIds.push(exemption.id);
    }
    await run({ ownerId: users[0]!.id, adminId: users[1]!.id,
      staffId: users[2]!.id, ids, exemptionIds });
  } finally {
    await prisma.customerTaxExemption.deleteMany({ where: { id: { in: exemptionIds } } });
    await prisma.addressTaxLocation.deleteMany({ where: { id: { in: ids } } });
    await prisma.serviceAddress.deleteMany({ where: { id: { in: addresses } } });
    await prisma.customer.delete({ where: { id: customer.id } });
    await prisma.user.deleteMany({ where: { id: { in: users.map(x => x.id) } } });
  }
}

describe.skipIf(!enabled)("T-7B owner/admin tax page queries", () => {
  it("stable (createdAt, id) pagination doesn't duplicate address or certificate rows", async () => fixture(async f => {
    const first = await getTaxAreasPage(f.ownerId, { limit: 2, status: "REVIEW" });
    const second = await getTaxAreasPage(f.ownerId, {
      limit: 2, status: "REVIEW", cursor: first.nextCursor!,
    });
    expect(first.rows.map(x => x.id)).toEqual([...f.ids].sort().slice(0, 2));
    expect(second.rows[0]?.id).toBe([...f.ids].sort()[2]);
    expect(new Set([...first.rows, ...second.rows].map(x => x.id)).size).toBe(3);
    const e1 = await getTaxExemptionsPage(f.ownerId, { limit: 2 });
    const e2 = await getTaxExemptionsPage(f.ownerId, {
      limit: 2, cursor: e1.nextCursor!,
    });
    expect(new Set([...e1.rows, ...e2.rows].map(x => x.id)).size).toBe(3);
    expect(e1.rows[0]).not.toHaveProperty("certificatePhotoId");
  }));

  it("admin can read private finance DTOs while staff is denied", async () => fixture(async f => {
    expect((await getTaxAreasPage(f.adminId, { limit: 2, status: "REVIEW" })).rows.length).toBe(2);
    await expect(getTaxAreasPage(f.staffId, { limit: 2 })).rejects.toThrow();
    await expect(getTaxExemptionsPage(f.staffId, { limit: 2 })).rejects.toThrow();
    await expect(getTaxAreasPage(f.ownerId, { limit: 0 })).rejects.toThrow();
  }));

  it("failed current provider lookups appear under Needs review until manually confirmed", async () =>
    fixture(async f => {
      await prisma.addressTaxLocation.update({
        where: { id: f.ids[0]! }, data: { status: "FAILED", reviewNote: "Provider says NOT_FOUND" },
      });
      const review = await getTaxAreasPage(f.ownerId, { limit: 10, status: "REVIEW" });
      const failed = review.rows.find(row => row.id === f.ids[0]);
      expect(failed).toMatchObject({ status: "FAILED", reviewNote: "Provider says NOT_FOUND" });
      const verified = await getTaxAreasPage(f.ownerId, { limit: 10, status: "VERIFIED" });
      expect(verified.rows).not.toContainEqual(expect.objectContaining({ id: f.ids[0] }));
    }));

  it("unknown official provider status remains visible as needs review", async () => fixture(async f => {
    const areas = await getTaxAreasPage(f.ownerId, { limit: 10, status: "REVIEW" });
    const sample = areas.rows.find(x => x.id === f.ids[0]);
    expect(sample).toMatchObject({
      status: "NEEDS_REVIEW", source: "MANUAL",
      reviewNote: "Official provider unavailable — review manually",
    });
  }));
});

