// PLAN scenario 17 (BATCH-F WU-F4): a signed-in customer requests a pickup, reports a problem, sees both, and pays an open
// bill, only for their own records; a second customer gets nothing of the first one's through any of these paths.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const stripe = vi.hoisted(() => ({ tag: "" }));
vi.mock("@/lib/stripe", () => ({
  getStripeClient: () => ({
    invoices: { retrieve: async () => ({ id: "x", status: "open", amount_remaining: 4400, hosted_invoice_url: `https://pay.example.test/${stripe.tag}` }) },
  }),
}));
vi.mock("@/lib/email", () => ({ sendEmail: async () => ({ sent: true }), getEmailAcceptedAt: async () => null }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));
vi.mock("@/domains/security/two-factor", () => ({ twoFactorEnrollmentRequired: async () => false }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { prisma } from "@/lib/prisma";
import { openCustodyEpisodeInTx } from "@/domains/inventory/custody";
import {
  createMaintenanceRequestForUser, createPickupRequestForUser, getPortalData, getPortalMaintenancePage, getPortalPickupRequests,
} from "@/domains/portal";
import { getPayNowUrl, PayNowError } from "@/domains/portal/pay-now";
import { purgeScenarioQueues } from "../helpers/scenario-order";
const scenarioStartedAt = new Date();

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && url.pathname === "/appliance_desk_test" && ["localhost", "127.0.0.1"].includes(url.hostname);

describe.skipIf(!enabled)("scenario 17: customer portal journeys stay inside the customer's own records", () => {
  const tag = randomUUID().replaceAll("-", "");
  stripe.tag = tag;
  const side = ["a", "b"].map((k) => ({
    userId: `s17-user-${k}-${tag}`, customerId: `s17-cust-${k}-${tag}`, addressId: `s17-addr-${k}-${tag}`,
    agreementId: `s17-agr-${k}-${tag}`, applianceId: `s17-unit-${k}-${tag}`, setupId: `s17-setup-${k}-${tag}`,
    asset: `S17${k.toUpperCase()}-${tag.slice(0, 8)}`,
  }));
  const [a, b] = side;
  const typeId = `s17-type-${tag}`;
  let invoiceA = "";

  beforeAll(async () => {
    await prisma.applianceType.create({ data: { id: typeId, name: `S17 ${tag}`, slug: `s17-${tag}` } });
    for (const s of side) {
      await prisma.user.create({ data: { id: s.userId, email: `${s.userId}@example.test`, name: `Portal ${s.asset}`, role: "CUSTOMER", emailVerified: true } });
      await prisma.customer.create({ data: { id: s.customerId, userId: s.userId, referralCode: `S${s.asset.slice(3, 4)}${tag.slice(0, 17)}` } });
      await prisma.serviceAddress.create({ data: { id: s.addressId, customerId: s.customerId, line1: "17 Test St", city: "Greeley", zip: "80631" } });
      await prisma.rentalAgreement.create({
        data: { id: s.agreementId, customerId: s.customerId, serviceAddressId: s.addressId, status: "ACTIVE", termMonths: 12,
          startDate: new Date("2026-10-08T19:00:00Z"), endDate: new Date("2027-11-08T06:59:59Z"), firstDeliveredOn: new Date("2026-10-08T19:00:00Z"),
          lines: { create: { label: "Washer", monthlyPriceCents: 3000, listPriceCents: 3000 } } },
      });
      const line = await prisma.rentalLine.findFirstOrThrow({ where: { agreementId: s.agreementId } });
      await prisma.job.create({ data: { id: s.setupId, type: "DELIVERY", status: "COMPLETED", customerId: s.customerId, serviceAddressId: s.addressId, agreementId: s.agreementId } });
      await prisma.appliance.create({ data: { id: s.applianceId, assetNumber: s.asset, applianceTypeId: typeId, status: "RENTED" } });
      await prisma.applianceAssignment.create({ data: { rentalLineId: line.id, applianceId: s.applianceId } });
      await prisma.$transaction((tx) => openCustodyEpisodeInTx(tx, { applianceId: s.applianceId, customerId: s.customerId, serviceAddressId: s.addressId, agreementId: s.agreementId, startedOn: new Date("2026-10-08T19:00:00Z"), startJobId: s.setupId }));
    }
    const invoice = await prisma.invoice.create({ data: { customerId: a.customerId, agreementId: a.agreementId, stripeInvoiceId: `in_s17_${tag}`, status: "DELINQUENT", amountDueCents: 4400 } });
    invoiceA = invoice.id;
  });

  afterAll(async () => {
    await purgeScenarioQueues(scenarioStartedAt);
    const ids = side.map((s) => s.customerId);
    const jobs = (await prisma.job.findMany({ where: { customerId: { in: ids } }, select: { id: true } })).map((j) => j.id);
    const requests = (await prisma.maintenanceRequest.findMany({ where: { customerId: { in: ids } }, select: { id: true } })).map((r) => r.id);
    await prisma.staffTask.deleteMany({ where: { jobId: { in: jobs } } });
    await prisma.maintenanceRequest.deleteMany({ where: { id: { in: requests } } }).catch(() => undefined);
    await prisma.invoice.deleteMany({ where: { customerId: { in: ids } } });
    await prisma.applianceCustodyEpisode.deleteMany({ where: { customerId: { in: ids } } });
    await prisma.applianceAssignment.deleteMany({ where: { applianceId: { in: side.map((s) => s.applianceId) } } });
    await prisma.jobAppliance.deleteMany({ where: { jobId: { in: jobs } } });
    await prisma.job.deleteMany({ where: { id: { in: jobs } } }).catch(() => undefined);
  });

  it("A requests a pickup, reports a problem, sees both and pays; B sees and can do nothing with A's records", async () => {
    // Pickup request: one draft pickup visit on A's rental, listed for A only.
    const pickup = await createPickupRequestForUser(a.userId, { note: "Moving out Friday" });
    expect(pickup).toMatchObject({ created: true });
    expect((await getPortalPickupRequests(a.userId)).map((r) => r.id)).toEqual([pickup!.jobId]);
    expect(await getPortalPickupRequests(b.userId)).toEqual([]);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: pickup!.jobId } })).agreementId).toBe(a.agreementId);
    // A repeat is folded into the same visit, not a second one.
    expect((await createPickupRequestForUser(a.userId, { note: "Moving out Friday, again" }))).toMatchObject({ created: false, jobId: pickup!.jobId });
    expect(await prisma.job.count({ where: { agreementId: a.agreementId, type: "REMOVAL", status: { not: "CANCELLED" } } })).toBe(1);
    // B cannot ask for pickup of A's machine.
    await expect(createPickupRequestForUser(b.userId, { note: "x", applianceId: a.applianceId })).rejects.toThrow(/isn't on one of your active rentals/);

    // Problem report: stored for A, listed for A only; B cannot file one against A's machine.
    const request = await createMaintenanceRequestForUser(a.userId, { problem: "Washer will not drain", applianceId: a.applianceId });
    expect(request.customerId).toBe(a.customerId);
    expect((await getPortalMaintenancePage(a.userId, 1))!.items.map((r) => r.id)).toEqual([request.id]);
    expect((await getPortalMaintenancePage(b.userId, 1))!.items).toEqual([]);
    await expect(createMaintenanceRequestForUser(b.userId, { problem: "x", applianceId: a.applianceId })).rejects.toThrow(/isn't on one of your active rentals/);

    // Paying: A gets the hosted payment page for their own open bill; B gets the same answer as for a missing bill.
    expect(await getPayNowUrl(a.userId, invoiceA)).toBe(`https://pay.example.test/${tag}`);
    await expect(getPayNowUrl(b.userId, invoiceA)).rejects.toBeInstanceOf(PayNowError);
    await expect(getPayNowUrl(b.userId, invoiceA)).rejects.toThrow("We couldn't find that bill.");

    // B's whole portal view carries nothing of A's.
    const bView = JSON.stringify(await getPortalData(b.userId));
    for (const secret of [a.asset, a.agreementId, a.customerId, invoiceA, request.id, pickup!.jobId, "Washer will not drain", "Moving out Friday"]) {
      expect(bView).not.toContain(secret);
    }
    const aView = JSON.stringify(await getPortalData(a.userId));
    expect(aView).toContain(a.asset);
    expect(aView).not.toContain(b.asset);
  });
});
