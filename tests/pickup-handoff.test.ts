import { describe, expect, it, vi } from "vitest";
import { handoffItemsText, handoffNamesFromLines, pickupHandoffTitle } from "@/domains/delivery/pickup-handoff";
import { agreementZoneLocationInTx, isAgreementPickupInTx } from "@/domains/delivery/pickup-guard";
import { ensureSignedDeliveryDraftInTx } from "@/domains/agreements/signed-delivery";
import { jobKindLabel } from "@/lib/status-labels";
import type { Prisma } from "@prisma/client";

// ZONE-1 (Codex findings on PR #604): the customer pickup hand-over job, and a signed agreement never following its
// (still editable) source estimate.
const pickupLocation = { serviceAddressId: "a1", zone: 1, name: "Local", miles: 4, method: "STRAIGHT_LINE",
  center: { lat: 40.4, lon: -104.7 }, priceCents: 0, pickupPriceCents: 0, choice: "CUSTOMER_PICKUP", checkedAt: "2026-10-01T00:00:00.000Z" };

function fakeTx(agreement: Record<string, unknown> | null, estimateSnapshot: unknown = null) {
  const created: unknown[] = [];
  const tx = {
    rentalAgreement: { findUnique: vi.fn(async () => agreement) },
    estimate: { findUnique: vi.fn(async () => ({ customerId: "c1", deliveryZoneSnapshot: estimateSnapshot })) },
    job: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async (args: { data: unknown }) => { created.push(args.data); return { id: "job-new" }; }),
    },
  };
  return { tx: tx as unknown as Prisma.TransactionClient, raw: tx, created };
}

describe("customer pickup hand-over words", () => {
  it("names what is handed over and to whom, never 'Schedule delivery'", () => {
    expect(handoffItemsText([])).toBe("the rented appliances");
    expect(handoffItemsText(["Washer"])).toBe("Washer");
    expect(handoffItemsText(["Washer", " Dryer ", "Freezer", "Washer"])).toBe("Washer, Dryer and Freezer");
    expect(pickupHandoffTitle(["Washer", "Dryer"], "Pat")).toBe("Customer pickup: hand over Washer and Dryer to Pat");
    expect(handoffNamesFromLines([{ label: "Set", assignments: [] }])).toEqual(["Set"]);
    expect(handoffNamesFromLines([{ label: "Set", assignments: [{ appliance: { applianceType: { name: "Washer" } } }] }]))
      .toEqual(["Washer"]);
  });
  it("labels a hand-over job 'Customer pickup' in English and Spanish; other jobs keep their labels", () => {
    expect(jobKindLabel({ type: "DELIVERY", customerPickupHandoff: true })).toBe("Customer pickup (hand-over)");
    expect(jobKindLabel({ type: "DELIVERY", customerPickupHandoff: true }, "es")).toBe("Recogida por el cliente");
    expect(jobKindLabel({ type: "DELIVERY", customerPickupHandoff: false })).toBe("Delivery");
    expect(jobKindLabel({ type: "REMOVAL" })).toBe("Pickup / removal");
  });
});

describe("signing creates the right job", () => {
  const base = { id: "g1", customerId: "c1", serviceAddressId: "a1", renewedFromAgreementId: null };
  it("a pickup rental gets one unscheduled hand-over job (DELIVERY marked customerPickupHandoff)", async () => {
    const { tx, raw, created } = fakeTx({ serviceAddressId: "a1", deliveryZoneSnapshot: pickupLocation, sourceEstimateId: null,
      customerId: "c1", status: "ACTIVE" });
    expect(await ensureSignedDeliveryDraftInTx(tx, base)).toBe("job-new");
    expect(raw.job.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ type: "DELIVERY", customerPickupHandoff: true }) }));
    expect(created).toEqual([expect.objectContaining({ type: "DELIVERY", status: "SCHEDULED", scheduledAt: null,
      customerPickupHandoff: true, agreementId: "g1" })]);
    const note = (created[0] as { notes: string }).notes;
    expect(note).toMatch(/Customer pickup/);
    expect(note).toMatch(/Handed over/);
    expect(note).not.toMatch(/schedule delivery/i);
  });
  it("a delivery rental still gets its ordinary delivery visit", async () => {
    const { tx, created } = fakeTx({ serviceAddressId: "a1", deliveryZoneSnapshot: { ...pickupLocation, choice: "DELIVER" },
      sourceEstimateId: null, customerId: "c1", status: "ACTIVE" });
    await ensureSignedDeliveryDraftInTx(tx, base);
    expect(created).toEqual([expect.objectContaining({ customerPickupHandoff: false,
      notes: "Agreement signed. Owner: review the signing payment and schedule delivery." })]);
  });
});

describe("a signed agreement keeps its own frozen zone", () => {
  const estimatePickup = { version: 1, locations: [pickupLocation] };
  it("before signing, an agreement without its own copy follows the source estimate", async () => {
    const { tx } = fakeTx({ serviceAddressId: "a1", deliveryZoneSnapshot: null, sourceEstimateId: "e1", customerId: "c1",
      status: "AWAITING_SIGNATURE" }, estimatePickup);
    expect(await isAgreementPickupInTx(tx, "g1")).toBe(true);
    expect(await agreementZoneLocationInTx(tx, { serviceAddressId: "a1", deliveryZoneSnapshot: null, sourceEstimateId: "e1",
      customerId: "c1", status: "AWAITING_SIGNATURE" })).toMatchObject({ choice: "CUSTOMER_PICKUP" });
  });
  it("after signing, a later estimate change never turns it into pickup", async () => {
    for (const status of ["ACTIVE", "SCHEDULED", "ENDED", "CANCELLED"]) {
      const { tx, raw } = fakeTx({ serviceAddressId: "a1", deliveryZoneSnapshot: null, sourceEstimateId: "e1", customerId: "c1",
        status }, estimatePickup);
      expect(await isAgreementPickupInTx(tx, "g1")).toBe(false);
      expect(await agreementZoneLocationInTx(tx, { serviceAddressId: "a1", deliveryZoneSnapshot: null, sourceEstimateId: "e1",
        customerId: "c1", status })).toBeNull();
      expect(raw.estimate.findUnique).not.toHaveBeenCalled();
    }
  });
  it("the agreement's own copy wins over the estimate in both directions", async () => {
    const own = fakeTx({ serviceAddressId: "a1", deliveryZoneSnapshot: { ...pickupLocation, choice: "DELIVER" },
      sourceEstimateId: "e1", customerId: "c1", status: "DRAFT" }, estimatePickup);
    expect(await isAgreementPickupInTx(own.tx, "g1")).toBe(false);
    const frozenPickup = fakeTx({ serviceAddressId: "a1", deliveryZoneSnapshot: pickupLocation, sourceEstimateId: "e1",
      customerId: "c1", status: "ACTIVE" }, { version: 1, locations: [{ ...pickupLocation, choice: "DELIVER" }] });
    expect(await isAgreementPickupInTx(frozenPickup.tx, "g1")).toBe(true);
  });
});

describe("customer pickup: no retail delivery fee, no delivery-license gate (Codex findings on PR #604)", () => {
  it("allocates no retail delivery fee to a pickup address and refuses to put the event on one", async () => {
    const { allocateReviewedRdfForLocation } = await import("@/domains/billing/mandatory-charge-assessment");
    const rdf = { status: "APPLIES", amountCents: 29, rateId: "r", ruleVersionId: "v", handling: "COLLECT_FROM_CUSTOMER",
      reason: "evidence" } as unknown as Parameters<typeof allocateReviewedRdfForLocation>[0];
    for (const policy of ["REQUIRED", "EXEMPT"] as const)
      expect(allocateReviewedRdfForLocation(rdf, policy, false, true)).toMatchObject({ event: false, status: "EXEMPT", amountCents: 0 });
    expect(() => allocateReviewedRdfForLocation(rdf, "REQUIRED", true, true)).toThrow(/customer pickup has no delivery/);
    // An undecided owner policy still needs deciding; a delivery is unchanged.
    expect(allocateReviewedRdfForLocation(rdf, "UNDECIDED", false, true).status).toBe("UNDECIDED");
    expect(allocateReviewedRdfForLocation(rdf, "REQUIRED", true)).toMatchObject({ status: "APPLIES", amountCents: 29 });
  });
});
