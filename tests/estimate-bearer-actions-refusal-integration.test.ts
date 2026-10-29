import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { requestEstimateChanges } from "@/domains/estimates";
import { continueApprovedCustomerOrder } from "@/domains/orders/customer-finish";
import { sendSignedCustomerAccountLink } from "@/domains/orders/activation";

/**
 * AR-10b: the estimate bearer-link actions (FINAL-SWEEP 5.1 fixture evidence).
 * The quote link id is the capability, so the domain functions behind the
 * actions must refuse estimates that are not in a respondable state and
 * change nothing when they refuse.
 */
const uri = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(uri.hostname) &&
  uri.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("estimate bearer-link actions refuse non-respondable estimates (Postgres)", () => {
  const prefix = "arb-" + randomUUID().slice(0, 12);
  const ownerId = prefix + "-owner";
  const customerUserId = prefix + "-user";
  const customerId = prefix + "-customer";
  let addressId: string;
  let draftEstimateId: string;

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: ownerId, role: "OWNER", email: prefix + "-o@example.test" },
        { id: customerUserId, role: "CUSTOMER", email: prefix + "-c@example.test" },
      ],
    });
    await prisma.customer.create({
      data: { id: customerId, userId: customerUserId, referralCode: "ARB" + prefix.slice(-8) },
    });
    addressId = (
      await prisma.serviceAddress.create({
        data: { customerId, line1: "118 ARB Sample Rd", city: "Greeley", zip: "80631" },
      })
    ).id;
    draftEstimateId = (
      await prisma.estimate.create({
        data: {
          id: prefix + "-draft",
          customerId,
          createdByUserId: ownerId,
          title: "ARB refusal offer",
          status: "DRAFT",
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.estimate.deleteMany({ where: { id: draftEstimateId } });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, customerUserId] } } });
  });

  it("requestEstimateChanges refuses a DRAFT estimate and changes nothing", async () => {
    await expect(requestEstimateChanges(draftEstimateId, "Please change the date")).rejects.toThrow(
      /isn't available to respond/i,
    );
    const after = await prisma.estimate.findUnique({ where: { id: draftEstimateId } });
    expect(after?.status).toBe("DRAFT");
    expect(after?.changesRequestedMessage).toBeNull();
    expect(after?.respondedAt).toBeNull();
  });

  it("requestEstimateChanges refuses an unknown estimate id", async () => {
    await expect(requestEstimateChanges(prefix + "-missing", "Hello")).rejects.toThrow();
  });

  it("continueApprovedCustomerOrder waits on a DRAFT estimate and creates no agreement", async () => {
    const result = await continueApprovedCustomerOrder(draftEstimateId);
    expect(result.state).toBe("WAITING");
    const agreements = await prisma.rentalAgreement.count({
      where: { sourceEstimateId: draftEstimateId },
    });
    expect(agreements).toBe(0);
  });

  it("continueApprovedCustomerOrder waits on an unknown estimate id", async () => {
    const result = await continueApprovedCustomerOrder(prefix + "-missing");
    expect(result.state).toBe("WAITING");
  });

  it("sendSignedCustomerAccountLink sends nothing for a DRAFT estimate or an unknown id", async () => {
    await expect(sendSignedCustomerAccountLink(draftEstimateId)).resolves.toBe(false);
    await expect(sendSignedCustomerAccountLink(prefix + "-missing")).resolves.toBe(false);
  });
});
