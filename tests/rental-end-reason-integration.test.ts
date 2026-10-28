import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  getRentalEndReasons,
  recordAgreementEndReason,
  saveRentalEndReasons,
} from "@/domains/agreements/end-reasons";

// AR-4a (RENTALS spec section 5): recording why a rental ended writes the
// fields and an audit row; the owner list saves compare-and-set. Runs only
// against the local throwaway test database. This test writes the shared
// BusinessSettings row, so vitest.config registers it as a shared-state test.
const ready = (() => {
  try {
    const url = new URL(process.env.DATABASE_URL ?? "");
    return (
      process.env.CI === "true" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
      url.pathname === "/appliance_desk_test"
    );
  } catch {
    return false;
  }
})();

const tag = `rer-${Date.now().toString(36)}`;
const ownerId = `rer-owner-${tag}`;
const ids: string[] = [];
let agreementId = "";

describe.skipIf(!ready)("rental end reason recording (real Postgres)", () => {
  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { entityId: { in: [...ids, "singleton"] }, userId: ownerId },
    });
    await prisma.rentalAgreement.deleteMany({ where: { id: { in: ids } } });
    await prisma.serviceAddress.deleteMany({
      where: { customer: { user: { email: { contains: tag } } } },
    });
    await prisma.customer.deleteMany({
      where: { user: { email: { contains: tag } } },
    });
    await prisma.user.deleteMany({ where: { email: { contains: tag } } });
  });

  it("setup: an owner, a customer and a rental", async () => {
    await prisma.user.create({
      data: { id: ownerId, email: `${tag}-owner@example.test`, name: "RER Owner", role: "OWNER", emailVerified: true },
    });
    const user = await prisma.user.create({
      data: { name: "RER Customer", email: `${tag}-c@example.test`, role: "CUSTOMER" },
    });
    const customer = await prisma.customer.create({
      data: { userId: user.id, referralCode: `REF-${tag}` },
    });
    const address = await prisma.serviceAddress.create({
      data: { customerId: customer.id, line1: "1 Main St", city: "Greeley", zip: "80631" },
    });
    const agreement = await prisma.rentalAgreement.create({
      data: { customerId: customer.id, serviceAddressId: address.id, status: "ACTIVE" },
    });
    agreementId = agreement.id;
    ids.push(agreement.id);
    expect(agreementId).toBeTruthy();
  });

  it("records the reason and note with an audit row, then clears them", async () => {
    await recordAgreementEndReason(ownerId, agreementId, {
      reason: "Moving away",
      note: "Job moved to Denver",
    });
    const stored = await prisma.rentalAgreement.findUnique({
      where: { id: agreementId },
      select: { endReason: true, endReasonNote: true },
    });
    expect(stored).toEqual({
      endReason: "Moving away",
      endReasonNote: "Job moved to Denver",
    });
    const audit = await prisma.auditLog.findFirst({
      where: { entityId: agreementId, action: "agreement.end_reason_set" },
    });
    expect(audit?.userId).toBe(ownerId);

    await recordAgreementEndReason(ownerId, agreementId, {
      reason: null,
      note: null,
    });
    const cleared = await prisma.rentalAgreement.findUnique({
      where: { id: agreementId },
      select: { endReason: true, endReasonNote: true },
    });
    expect(cleared).toEqual({ endReason: null, endReasonNote: null });
  });

  it("the owner list saves compare-and-set and restores", async () => {
    const before = await getRentalEndReasons();
    await saveRentalEndReasons(ownerId, ["Reason A", "Reason B"], before);
    expect(await getRentalEndReasons()).toEqual(["Reason A", "Reason B"]);
    // A stale expected value is refused.
    await expect(
      saveRentalEndReasons(ownerId, ["Reason C"], before),
    ).rejects.toThrow(/changed in another session/);
    await saveRentalEndReasons(ownerId, before, ["Reason A", "Reason B"]);
    expect(await getRentalEndReasons()).toEqual(before);
  });
});
