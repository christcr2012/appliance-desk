import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ role: "OWNER" }));
vi.mock("@/lib/session", () => ({
  requireRole: vi.fn(async () => ({ user: { role: session.role } })),
}));

import { getExceptions, LINE_REDUCE_KEY_PREFIX } from "@/domains/exceptions";
import { lineReduceKey } from "@/domains/billing/subscription-line";
import { prisma } from "@/lib/prisma";

const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(target.hostname) &&
  target.pathname === "/appliance_desk_test";

describe("the Today key prefix matches the billing key", () => {
  it("is the same format", () => {
    expect(lineReduceKey("abc")).toBe(`${LINE_REDUCE_KEY_PREFIX}abc`);
  });
});

describe.skipIf(!enabled)("Today shows a cancelled item whose Stripe change is unfinished (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const userId = `sp-user-${tag}`;
  const customerId = `sp-customer-${tag}`;
  const addressId = `sp-address-${tag}`;
  const typeId = `sp-type-${tag}`;
  const agreementId = `sp-agreement-${tag}`;
  const jobId = `sp-job-${tag}`;
  const applianceIds: string[] = [];
  const pendingIds: string[] = [];
  const opKeys: string[] = [];

  async function removedItem(suffix: string, status: "FAILED" | "PENDING" | "UNKNOWN" | "SUCCEEDED" | null) {
    const applianceId = `sp-unit-${suffix}-${tag}`;
    applianceIds.push(applianceId);
    await prisma.appliance.create({
      data: { id: applianceId, assetNumber: `SP-${suffix}-${tag.slice(0, 6)}`, applianceTypeId: typeId, status: "RESERVED" },
    });
    const pd = await prisma.pendingDelivery.create({
      data: {
        agreementId,
        rentalLineId: `sp-line-${suffix}`,
        applianceId,
        originalJobId: jobId,
        originalDeliveryDate: new Date("2026-09-01T06:00:00Z"),
        removedAt: new Date(),
      },
    });
    pendingIds.push(pd.id);
    if (status) {
      const key = lineReduceKey(pd.id);
      opKeys.push(key);
      await prisma.providerOperation.create({
        data: { kind: "SUBSCRIPTION_UPDATE", subjectType: "PendingDelivery", subjectId: pd.id, idempotencyKey: key, status },
      });
    }
    return pd.id;
  }
  const hrefs = async () =>
    (await getExceptions()).filter((x) => x.category === "SUBSCRIPTION_UPDATE_PENDING").map((x) => x.href);

  beforeAll(async () => {
    await prisma.user.create({ data: { id: userId, email: `${tag}@example.test`, name: "SP", role: "CUSTOMER" } });
    await prisma.customer.create({ data: { id: customerId, userId, referralCode: `SP${tag.slice(0, 16)}` } });
    await prisma.serviceAddress.create({ data: { id: addressId, customerId, line1: "1 Pending St", city: "Greeley", zip: "80631" } });
    await prisma.applianceType.create({ data: { id: typeId, name: `SP ${tag}`, slug: `sp-${tag}` } });
    await prisma.rentalAgreement.create({ data: { id: agreementId, customerId, serviceAddressId: addressId, status: "ACTIVE" } });
    await prisma.job.create({ data: { id: jobId, type: "DELIVERY", status: "COMPLETED", customerId, agreementId } });
  });
  afterAll(async () => {
    await prisma.providerOperation.deleteMany({ where: { idempotencyKey: { in: opKeys } } });
    await prisma.pendingDelivery.deleteMany({ where: { id: { in: pendingIds } } });
    await prisma.appliance.deleteMany({ where: { id: { in: applianceIds } } });
    await prisma.job.deleteMany({ where: { id: jobId } });
    await prisma.rentalAgreement.deleteMany({ where: { id: agreementId } });
    await prisma.applianceType.deleteMany({ where: { id: typeId } });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("lists failed, pending and unknown changes, not finished ones and not items with no recorded change", async () => {
    await removedItem("failed", "FAILED");
    await removedItem("pending", "PENDING");
    await removedItem("unknown", "UNKNOWN");
    await removedItem("done", "SUCCEEDED");
    await removedItem("none", null);
    session.role = "OWNER";
    const found = await hrefs();
    expect(found.filter((h) => h === `/desk/jobs/${jobId}`)).toHaveLength(3);
  });

  it("is a money item: staff do not see it", async () => {
    session.role = "STAFF";
    expect(await hrefs()).toEqual([]);
    session.role = "OWNER";
  });

  it("disappears once Stripe has the change", async () => {
    const id = await removedItem("later", "FAILED");
    const before = (await hrefs()).length;
    await prisma.providerOperation.update({ where: { idempotencyKey: lineReduceKey(id) }, data: { status: "SUCCEEDED" } });
    expect((await hrefs()).length).toBe(before - 1);
  });
});
