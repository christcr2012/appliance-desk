import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => vi.fn());
vi.mock("@/lib/session", () => ({ getServerSession: session }));
vi.mock("@/lib/photo-storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/photo-storage")>()),
  getPrivatePhotoStore: () => ({ storeId: "store_abc123", token: "test" }),
}));
vi.mock("@vercel/blob", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@vercel/blob")>()),
  get: async () => {
    throw new Error("no blob in tests");
  },
}));

import { prisma } from "@/lib/prisma";
import {
  createMaintenanceRequestForUser,
  createPickupRequestForUser,
  getPortalApplianceOptions,
  getPortalData,
  getPortalMaintenancePage,
  updateSmsPreference,
} from "@/domains/portal";
import { getInvoiceDetail } from "@/domains/billing/invoice-detail";
import { getPayNowUrl } from "@/domains/portal/pay-now";
import { readArtifactForViewer } from "@/domains/documents/artifacts";
import { locationWorkspace } from "@/domains/customers/location-contacts";
import { listPrivacyRequestsForCustomer } from "@/domains/privacy";
import { feedbackAttachmentForViewer } from "@/domains/feedback";
import { GET as getPhoto } from "@/app/api/photos/[id]/route";

/**
 * AR-10b (FINAL-SWEEP 5.4): the customer A/B matrix. For every customer
 * surface below, customer A sees only A's data, customer B asking for A's
 * ids gets exactly what a made-up id gets, a staff login gets nothing
 * customer-shaped, an archived customer gets nothing, and a refused write
 * changes no rows. New customer surfaces must be added to CUSTOMER_SURFACES
 * with a runner here — that is the list new units extend.
 */
const uri = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(uri.hostname) &&
  uri.pathname === "/appliance_desk_test";

type Fixture = {
  userId: string;
  customerId: string;
  addressId: string;
  agreementId: string;
  applianceId: string;
  invoiceId: string;
  email: string;
};

const RUN = "abm-" + randomUUID().slice(0, 8);
let applianceTypeId: string;
let A: Fixture;
let B: Fixture;
let C: Fixture; // archived customer
let staffUserId: string;
let aRequestId: string;
let aPrivacyRequestId: string;
let aArtifactId: string;
let aAttachmentId: string;
let aAttachmentPath: string;
let aPhotoId: string;
const extraRequestIds: string[] = [];
const MISSING = RUN + "-missing";

async function buildCustomer(label: string): Promise<Fixture> {
  const user = await prisma.user.create({
    data: {
      email: `${RUN}-${label}@example.test`,
      name: `AB Matrix ${label}`,
      role: "CUSTOMER",
      emailVerified: true,
    },
  });
  const customer = await prisma.customer.create({
    data: { userId: user.id, referralCode: ("ABM" + label + RUN).slice(0, 20).toUpperCase() },
  });
  const address = await prisma.serviceAddress.create({
    data: { customerId: customer.id, line1: `1${label} Matrix St`, city: "Greeley", zip: "80631" },
  });
  const agreement = await prisma.rentalAgreement.create({
    data: { customerId: customer.id, serviceAddressId: address.id, status: "ACTIVE" },
  });
  const line = await prisma.rentalLine.create({
    data: { agreementId: agreement.id, label: "Washer", monthlyPriceCents: 5000, listPriceCents: 5000 },
  });
  const appliance = await prisma.appliance.create({
    data: { assetNumber: `ABM-${label}-${RUN}`, applianceTypeId, status: "RENTED" },
  });
  await prisma.applianceAssignment.create({ data: { rentalLineId: line.id, applianceId: appliance.id } });
  const invoice = await prisma.invoice.create({
    data: {
      customerId: customer.id,
      agreementId: agreement.id,
      status: "OPEN",
      amountDueCents: 5000,
      lineItems: { create: [{ kind: "RENTAL", description: "Washer rental", amountCents: 5000, quantity: 1 }] },
    },
  });
  return {
    userId: user.id,
    customerId: customer.id,
    addressId: address.id,
    agreementId: agreement.id,
    applianceId: appliance.id,
    invoiceId: invoice.id,
    email: user.email,
  };
}

async function errorMessage(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const CUSTOMER_SURFACES: { name: string; run: () => Promise<void> }[] = [
  {
    name: "portal home and rentals (getPortalData)",
    run: async () => {
      const data = await getPortalData(A.userId);
      expect(data).not.toBeNull();
      expect(JSON.stringify(data)).toContain(A.agreementId);
      expect(JSON.stringify(data)).not.toContain(B.customerId);
      expect(JSON.stringify(data)).not.toContain(B.agreementId);
      expect(JSON.stringify(data)).not.toContain(B.invoiceId);
      const bData = await getPortalData(B.userId);
      expect(JSON.stringify(bData)).toContain(B.agreementId);
      expect(JSON.stringify(bData)).not.toContain(A.customerId);
      await expect(getPortalData(staffUserId)).resolves.toBeNull();
      await expect(getPortalData(C.userId)).resolves.toBeNull();
      await expect(getPortalData(MISSING)).resolves.toBeNull();
    },
  },
  {
    name: "rental appliance options (getPortalApplianceOptions)",
    run: async () => {
      const mine = await getPortalApplianceOptions(A.userId);
      expect(mine.map((o) => o.id)).toContain(A.applianceId);
      expect(mine.map((o) => o.id)).not.toContain(B.applianceId);
      await expect(getPortalApplianceOptions(staffUserId)).resolves.toEqual([]);
      await expect(getPortalApplianceOptions(C.userId)).resolves.toEqual([]);
    },
  },
  {
    name: "repairs list (getPortalMaintenancePage)",
    run: async () => {
      const page = await getPortalMaintenancePage(A.userId, 1);
      expect(JSON.stringify(page)).toContain(aRequestId);
      expect(JSON.stringify(page)).not.toContain(B.customerId);
      const bPage = await getPortalMaintenancePage(B.userId, 1);
      expect(JSON.stringify(bPage)).not.toContain(aRequestId);
      await expect(getPortalMaintenancePage(staffUserId, 1)).resolves.toBeNull();
      await expect(getPortalMaintenancePage(C.userId, 1)).resolves.toBeNull();
    },
  },
  {
    name: "repairs create with another customer's appliance (createMaintenanceRequestForUser)",
    run: async () => {
      const before = await prisma.maintenanceRequest.count({ where: { customerId: B.customerId } });
      const message = await errorMessage(() =>
        createMaintenanceRequestForUser(B.userId, {
          applianceId: A.applianceId,
          problem: "It leaks",
        } as never),
      );
      expect(message).toMatch(/isn't on one of your active rentals/i);
      const after = await prisma.maintenanceRequest.count({ where: { customerId: B.customerId } });
      expect(after).toBe(before);
      const own = await createMaintenanceRequestForUser(B.userId, {
        applianceId: B.applianceId,
        problem: "It hums",
      } as never);
      const ownId = (own as { id?: unknown } | null)?.id;
      if (typeof ownId === "string") extraRequestIds.push(ownId);
    },
  },
  {
    name: "bill page (getInvoiceDetail scoped by customer)",
    run: async () => {
      await expect(getInvoiceDetail(A.invoiceId, { customerId: B.customerId })).resolves.toBeNull();
      await expect(getInvoiceDetail(MISSING, { customerId: B.customerId })).resolves.toBeNull();
      const own = await getInvoiceDetail(A.invoiceId, { customerId: A.customerId });
      expect(own?.id).toBe(A.invoiceId);
    },
  },
  {
    name: "pay now (getPayNowUrl)",
    run: async () => {
      const foreign = await errorMessage(() => getPayNowUrl(B.userId, A.invoiceId));
      const missing = await errorMessage(() => getPayNowUrl(B.userId, MISSING));
      expect(foreign).toMatch(/couldn't find that bill/i);
      expect(foreign).toBe(missing);
      const archived = await errorMessage(() => getPayNowUrl(C.userId, C.invoiceId));
      expect(archived).toBe(foreign);
      const own = await errorMessage(() => getPayNowUrl(A.userId, A.invoiceId));
      expect(own).not.toBe(foreign);
      expect(own).toMatch(/can't be paid online/i);
    },
  },
  {
    name: "documents and statements download (readArtifactForViewer)",
    run: async () => {
      await expect(
        readArtifactForViewer(aArtifactId, { userId: B.userId, role: "CUSTOMER" }),
      ).resolves.toBeNull();
      await expect(readArtifactForViewer(MISSING, { userId: A.userId, role: "CUSTOMER" })).resolves.toBeNull();
      const own = await readArtifactForViewer(aArtifactId, { userId: A.userId, role: "CUSTOMER" });
      expect(own?.html).toContain("A statement");
    },
  },
  {
    name: "properties and on-site contacts (locationWorkspace)",
    run: async () => {
      const foreign = await errorMessage(() =>
        locationWorkspace({ userId: B.userId, role: "CUSTOMER", customerId: B.customerId }, A.customerId),
      );
      expect(foreign).not.toBe("");
      const own = await locationWorkspace(
        { userId: A.userId, role: "CUSTOMER", customerId: A.customerId },
        A.customerId,
      );
      expect(JSON.stringify(own)).toContain(A.addressId);
      const archived = await errorMessage(() =>
        locationWorkspace({ userId: C.userId, role: "CUSTOMER", customerId: C.customerId }, C.customerId),
      );
      expect(archived).toMatch(/not available/i);
    },
  },
  {
    name: "privacy requests list (listPrivacyRequestsForCustomer)",
    run: async () => {
      const mine = await listPrivacyRequestsForCustomer(A.userId);
      expect(mine.map((r) => r.id)).toEqual([aPrivacyRequestId]);
      await expect(listPrivacyRequestsForCustomer(B.userId)).resolves.toEqual([]);
      await expect(listPrivacyRequestsForCustomer(staffUserId)).resolves.toEqual([]);
    },
  },
  {
    name: "feedback attachments (feedbackAttachmentForViewer)",
    run: async () => {
      await expect(
        feedbackAttachmentForViewer(aAttachmentId, { id: B.userId, role: "CUSTOMER" }),
      ).resolves.toBeNull();
      await expect(feedbackAttachmentForViewer(MISSING, { id: A.userId, role: "CUSTOMER" })).resolves.toBeNull();
      await expect(
        feedbackAttachmentForViewer(aAttachmentId, { id: A.userId, role: "CUSTOMER" }),
      ).resolves.toBe(aAttachmentPath);
    },
  },
  {
    name: "archived customer portal writes are refused (repairs, pickup, sms)",
    run: async () => {
      const requestsBefore = await prisma.maintenanceRequest.count({ where: { customerId: C.customerId } });
      const repair = await errorMessage(() =>
        createMaintenanceRequestForUser(C.userId, { applianceId: C.applianceId, problem: "Still broken" } as never),
      );
      expect(repair).toMatch(/no customer account/i);
      const after = await prisma.maintenanceRequest.count({ where: { customerId: C.customerId } });
      expect(after).toBe(requestsBefore);
      const pickup = await errorMessage(() => createPickupRequestForUser(C.userId, { note: "Pick it up" }));
      expect(pickup).toMatch(/no customer account/i);
      const sms = await errorMessage(() => updateSmsPreference(C.userId, { optedIn: false, phone: null }));
      expect(sms).toMatch(/no customer account/i);
    },
  },
  {
    name: "photos (GET /api/photos/[id])",
    run: async () => {
      const call = async (userId: string, role: string, photoId: string) => {
        session.mockResolvedValue({ user: { id: userId, role, archivedAt: null } });
        const response = await getPhoto(new Request(`http://test/api/photos/${photoId}`), {
          params: Promise.resolve({ id: photoId }),
        });
        return response.status;
      };
      await expect(call(B.userId, "CUSTOMER", aPhotoId)).resolves.toBe(404);
      await expect(call(A.userId, "CUSTOMER", MISSING)).resolves.toBe(404);
      // Staff are the team: the photo route admits team roles by design.
      await expect(call(staffUserId, "STAFF", aPhotoId)).resolves.not.toBe(404);
      const own = await call(A.userId, "CUSTOMER", aPhotoId);
      expect(own).not.toBe(404);
    },
  },
];

describe.skipIf(!enabled)("AR-10b customer A/B matrix (Postgres)", () => {
  beforeAll(async () => {
    const type = await prisma.applianceType.create({
      data: { name: `ABM Type ${RUN}`, slug: `abm-type-${RUN}`, monthlyPriceCents: 5000 },
    });
    applianceTypeId = type.id;
    A = await buildCustomer("a");
    B = await buildCustomer("b");
    C = await buildCustomer("c");
    await prisma.customer.update({ where: { id: C.customerId }, data: { archivedAt: new Date() } });
    const staff = await prisma.user.create({
      data: { email: `${RUN}-staff@example.test`, name: "AB Matrix Staff", role: "STAFF", emailVerified: true },
    });
    staffUserId = staff.id;

    const request = await prisma.maintenanceRequest.create({
      data: { customerId: A.customerId, applianceId: A.applianceId, problem: "Washer leaks" },
    });
    aRequestId = request.id;
    const privacy = await prisma.privacyRequest.create({
      data: { kind: "EXPORT", customerId: A.customerId, requesterEmail: A.email },
    });
    aPrivacyRequestId = privacy.id;
    const artifact = await prisma.documentArtifact.create({
      data: {
        kind: "STATEMENT",
        subjectType: "Customer",
        subjectId: A.customerId,
        customerId: A.customerId,
        payload: {},
        html: "<p>A statement</p>",
        sha256: "a".repeat(64),
        rendererVersion: 1,
      },
    });
    aArtifactId = artifact.id;
    const report = await prisma.feedbackReport.create({
      data: {
        reporterUserId: A.userId,
        reporterRole: "CUSTOMER",
        kind: "BUG",
        title: "AB matrix report",
        description: "Something broke",
        routeTemplate: "/account",
        safeContext: {},
        requestKey: `abm-${RUN}`,
      },
    });
    aAttachmentPath = `feedback/${report.id}/${RUN}.webp`;
    const attachment = await prisma.feedbackAttachment.create({
      data: {
        reportId: report.id,
        uploaderId: A.userId,
        pathname: aAttachmentPath,
        sizeBytes: 10,
        sha256: "b".repeat(64),
        width: 10,
        height: 10,
      },
    });
    aAttachmentId = attachment.id;
    const photo = await prisma.photo.create({
      data: {
        url: "https://abc123.private.blob.vercel-storage.com/maintenance/arb.jpg",
        maintenanceRequestId: aRequestId,
      },
    });
    aPhotoId = photo.id;
  });

  afterAll(async () => {
    const customers = [A, B, C].filter(Boolean);
    if (!customers.length) return;
    const userIds = [...customers.map((f) => f.userId), staffUserId].filter(Boolean);
    await prisma.photo.deleteMany({ where: { id: aPhotoId } });
    await prisma.feedbackAttachment.deleteMany({ where: { id: aAttachmentId } });
    await prisma.feedbackReport.deleteMany({ where: { reporterUserId: { in: userIds } } });
    await prisma.documentArtifact.deleteMany({ where: { id: aArtifactId } });
    await prisma.privacyRequest.deleteMany({ where: { customerId: { in: customers.map((f) => f.customerId) } } });
    await prisma.auditLog.deleteMany({
      where: { OR: [{ userId: { in: userIds } }, { entityId: { in: [aRequestId, ...extraRequestIds] } }] },
    });
    await prisma.maintenanceRequest.deleteMany({
      where: { customerId: { in: customers.map((f) => f.customerId) } },
    });
    await prisma.applianceAssignment.deleteMany({
      where: { applianceId: { in: customers.map((f) => f.applianceId) } },
    });
    await prisma.invoice.deleteMany({ where: { id: { in: customers.map((f) => f.invoiceId) } } });
    await prisma.rentalLine.deleteMany({
      where: { agreementId: { in: customers.map((f) => f.agreementId) } },
    });
    await prisma.rentalAgreement.deleteMany({ where: { id: { in: customers.map((f) => f.agreementId) } } });
    await prisma.appliance.deleteMany({ where: { id: { in: customers.map((f) => f.applianceId) } } });
    await prisma.serviceAddress.deleteMany({ where: { id: { in: customers.map((f) => f.addressId) } } });
    await prisma.customer.deleteMany({ where: { id: { in: customers.map((f) => f.customerId) } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.applianceType.deleteMany({ where: { id: applianceTypeId } });
  });

  it("covers every named customer surface", () => {
    expect(CUSTOMER_SURFACES.map((s) => s.name)).toEqual([
      "portal home and rentals (getPortalData)",
      "rental appliance options (getPortalApplianceOptions)",
      "repairs list (getPortalMaintenancePage)",
      "repairs create with another customer's appliance (createMaintenanceRequestForUser)",
      "bill page (getInvoiceDetail scoped by customer)",
      "pay now (getPayNowUrl)",
      "documents and statements download (readArtifactForViewer)",
      "properties and on-site contacts (locationWorkspace)",
      "privacy requests list (listPrivacyRequestsForCustomer)",
      "feedback attachments (feedbackAttachmentForViewer)",
      "archived customer portal writes are refused (repairs, pickup, sms)",
      "photos (GET /api/photos/[id])",
    ]);
  });

  for (const surface of CUSTOMER_SURFACES) {
    it(`A/B isolation: ${surface.name}`, surface.run);
  }
});
