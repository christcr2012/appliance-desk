import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { prepareEstimateAgreementsBeforeApproval } from "@/domains/estimates/preapproval-agreements";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && url.pathname === "/appliance_desk_test"
  && ["localhost", "127.0.0.1"].includes(url.hostname);
describe.skipIf(!enabled)("preapproval estimate preparation on disposable PostgreSQL", () => {
  const marker = randomUUID().replaceAll("-", "");
  let owner = "", staff = "", customer = "", customerUserId = "", estimate = "";
  let addressA = "", addressB = "", packageId = "";
  beforeAll(async () => {
    const [u, staffRow, customerUser] = await Promise.all([
      prisma.user.create({ data: { email: `prep-owner-${marker}@example.test`,
        role: "OWNER", passwordHash: "test-only" } }),
      prisma.user.create({ data: { email: `prep-staff-${marker}@example.test`,
        role: "STAFF", passwordHash: "test-only" } }),
      prisma.user.create({ data: { email: `prep-customer-${marker}@example.test`,
        role: "CUSTOMER", passwordHash: "test-only" } }),
    ]);
    owner = u.id; staff = staffRow.id; customerUserId = customerUser.id;
    const customerRow = await prisma.customer.create({ data: { userId: customerUser.id, referralCode: ("W22" + marker).slice(0,20).toUpperCase() } });
    customer = customerRow.id;
    const [a, b] = await Promise.all([
      prisma.serviceAddress.create({ data: { customerId: customer,
        line1: "100 Test Lane", city: "Greeley", zip: "80631" } }),
      prisma.serviceAddress.create({ data: { customerId: customer,
        line1: "200 Test Lane", city: "Greeley", zip: "80631" } }),
    ]);
    addressA = a.id; addressB = b.id;
    const pkg = await prisma.rentalPackage.create({ data: {
      name: `Preparation ${marker}`, slug: `prep-${marker}`, isActive: true, monthlyPriceCents: 6000,
    } });
    packageId = pkg.id;
    const quote = await prisma.estimate.create({ data: {
      customerId: customer, createdByUserId: owner, title: "Per-property preparation",
      status: "DRAFT",
    } });
    estimate = quote.id;
    await prisma.estimateLineItem.createMany({ data: [
      { estimateId: estimate, serviceAddressId: addressA, packageId, description: "Set A",
        quantity: 1, monthlyPriceCents: 6000 },
      { estimateId: estimate, serviceAddressId: addressB, packageId, description: "Set B",
        quantity: 1, monthlyPriceCents: 6000 },
    ] });
  });
  afterAll(async () => {
    await prisma.rentalAgreement.deleteMany({ where: { sourceEstimateId: estimate } });
    await prisma.estimate.deleteMany({ where: { id: estimate } });
    await prisma.rentalPackage.deleteMany({ where: { id: packageId } });
    await prisma.serviceAddress.deleteMany({ where: { id: { in: [addressA, addressB] } } });
    await prisma.customer.deleteMany({ where: { id: customer } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: [owner, staff] } } });
    await prisma.user.deleteMany({ where: { id: { in: [owner, staff, customerUserId] } } });

  });
  it("denies staff and preserves no-created-shell transactional side effects", async () => {
    await expect(prepareEstimateAgreementsBeforeApproval(staff, estimate,
      { mode: "per-property" })).rejects.toThrow();
    expect(await prisma.rentalAgreement.count({ where: { sourceEstimateId: estimate } })).toBe(0);
  });
  it("creates once, replays idempotently and leaves estimate unapproved/unpaid", async () => {
    const first = await prepareEstimateAgreementsBeforeApproval(owner, estimate, { mode: "per-property" });
    const second = await prepareEstimateAgreementsBeforeApproval(owner, estimate, { mode: "per-property" });
    expect(first).toHaveLength(2);
    expect(second).toEqual(first);
    const quote = await prisma.estimate.findUniqueOrThrow({ where: { id: estimate } });
    expect(quote.status).toBe("DRAFT");
    expect(quote.depositPaidAt).toBeNull();
    expect(quote.reviewedQuoteFingerprint).toBeNull();
    const agreements = await prisma.rentalAgreement.findMany({
      where: { sourceEstimateId: estimate }, select: {
        customerId: true, serviceAddressId: true, status: true,
      },
    });
    expect(agreements).toHaveLength(2);
    expect(agreements.map(a => a.customerId)).toEqual([customer, customer]);
    expect(new Set(agreements.map(a => a.serviceAddressId))).toEqual(new Set([addressA, addressB]));
    expect(agreements.every(a => a.status === "DRAFT")).toBe(true);
    expect(await prisma.auditLog.count({ where: {
      entityId: estimate, action: "estimate.prepare_signing_drafts",
    } })).toBe(1);
  });
});
