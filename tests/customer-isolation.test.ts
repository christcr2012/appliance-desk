import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const session = vi.hoisted(() => vi.fn());
vi.mock("@/lib/session", () => ({ getServerSession: session }));
vi.mock("@/lib/photo-storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/photo-storage")>()),
  getPrivatePhotoStore: () => ({ storeId: "store_abc123", token: "test" }),
}));
import { getPortalHome } from "@/domains/portal/workspace";
import { createDraftAgreement } from "@/domains/agreements";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import {
  getPortalData,
  getPortalApplianceOptions,
  createMaintenanceRequestForUser,
  getPortalMaintenanceCounts,
  getPortalMaintenancePage,
} from "@/domains/portal";
import { getInvoiceDetail } from "@/domains/billing/invoice-detail";
import { getPayNowUrl } from "@/domains/portal/pay-now";
import { setAutoRenew } from "@/domains/agreements/term";
import { GET as statementRouteGET } from "@/app/api/documents/statement/[month]/route";
import { businessDateKey } from "@/lib/business-date";

// ---------------------------------------------------------------------------
// The first real, database-backed integration test in this project (Phase
// 6A item 3 — see docs/archive/HANDOFF-2026-09-26-to-2026-10-02.md). Deliberately does NOT mock @/lib/prisma:
// docs/BUSINESS-RULES.md's "Customer data isolation (security-critical)"
// rule — a customer must never be able to see or touch another customer's
// records — is exactly the kind of thing a mocked prisma client can't
// actually prove, because the mock always returns whatever the test tells
// it to. Only a real query against a real Postgres proves the `where`
// clauses in src/domains/portal/index.ts and
// src/domains/agreements/active-appliances.ts actually scope by the caller's
// own userId.
//
// This can't be run or verified in this sandbox (no local Prisma client —
// see AGENTS.md's "A real constraint you should know about"). It's verified
// by CI instead: .github/workflows/ci.yml runs a real, disposable Postgres
// service container, applies migrations, seeds it, and only then runs
// `npm test` — so this file's real prisma.* calls hit a real, migrated
// database exactly like every other vitest file, they just aren't mocked.
//
// Every row this file creates is tagged with a random per-run suffix and
// cleaned up in afterAll, so re-running this suite (or running it alongside
// other tests that use the real database, if any are ever added) never
// leaves stray data behind or collides with prisma/seed.ts's fixed rows.
// ---------------------------------------------------------------------------

const RUN_ID = Math.random().toString(36).slice(2, 10);

type Fixture = {
  userId: string;
  customerId: string;
  serviceAddressId: string;
  agreementId: string;
  lineId: string;
  applianceId: string;
  assignmentId: string;
  invoiceId: string;
};

let applianceTypeId: string;
let customerA: Fixture;
let customerB: Fixture;

it("concurrent draft saves create one agreement and audit, reject foreign property, and rollback failed audit", async () => {
  const actor = await prisma.user.findFirstOrThrow({
    where: { role: "OWNER" },
    select: { id: true },
  });
  const input = {
    customerId: customerA.customerId,
    serviceAddressId: customerA.serviceAddressId,
    requestKey: randomUUID(),
    termMonths: 6,
  };
  let savedId: string | undefined;
  try {
    const [a, b] = await Promise.all([
      createDraftAgreement(actor.id, input),
      createDraftAgreement(actor.id, input),
    ]);
    savedId = a.id;
    expect(a.id).toBe(b.id);
    expect(
      await prisma.auditLog.count({
        where: { entityId: a.id, action: "agreement.create" },
      }),
    ).toBe(1);
    await expect(
      createDraftAgreement(actor.id, { ...input, depositCents: 123 }),
    ).rejects.toThrow("different terms");
    await expect(
      createDraftAgreement(actor.id, {
        ...input,
        requestKey: randomUUID(),
        serviceAddressId: customerB.serviceAddressId,
      }),
    ).rejects.toThrow("active customer");
    const count = await prisma.rentalAgreement.count({
      where: { customerId: customerA.customerId },
    });
    await expect(
      createDraftAgreement(`missing-${randomUUID()}`, {
        ...input,
        requestKey: randomUUID(),
      }),
    ).rejects.toThrow();
    expect(
      await prisma.rentalAgreement.count({
        where: { customerId: customerA.customerId },
      }),
    ).toBe(count);
  } finally {
    if (savedId) {
      await prisma.auditLog.deleteMany({
        where: { entityType: "RentalAgreement", entityId: savedId },
      });
      await prisma.rentalAgreement.delete({ where: { id: savedId } });
    }
  }
});

it("portal home ignores foreign properties and reconciles only the signed-in customer's records", async () => {
  for (const [own, foreign] of [
    [customerA, customerB],
    [customerB, customerA],
  ]) {
    session.mockResolvedValue({ user: { id: own.userId } });
    const result = await getPortalHome(foreign.serviceAddressId);
    expect(result?.customerId).toBe(own.customerId);
    expect(result?.addressId).toBeUndefined();
    expect(result?.properties.map((a) => a.id)).toEqual([own.serviceAddressId]);
    expect(result?.activeRentalCount).toBe(1);
    expect(result?.rentals.map((a) => a.id)).toEqual([own.agreementId]);
    expect(result?.invoice?.id).toBe(own.invoiceId);
    expect(JSON.stringify(result)).not.toContain(foreign.customerId);
    expect(result?.invoice).not.toHaveProperty("stripeInvoiceId");
  }
});

async function createCustomerFixture(label: "a" | "b"): Promise<Fixture> {
  const user = await prisma.user.create({
    data: {
      email: `isolation-test-${label}-${RUN_ID}@example.test`,
      name: `Isolation Test Customer ${label.toUpperCase()}`,
      role: "CUSTOMER",
      emailVerified: true,
    },
  });

  const customer = await prisma.customer.create({
    data: {
      userId: user.id,
      referralCode: `ISO${label.toUpperCase()}${RUN_ID}`
        .slice(0, 20)
        .toUpperCase(),
    },
  });

  const serviceAddress = await prisma.serviceAddress.create({
    data: {
      customerId: customer.id,
      line1: `${label === "a" ? "100" : "200"} Test St`,
      city: "Denver",
      zip: "80201",
    },
  });

  // FEETAX-2: saving a draft agreement refuses an address whose tax
  // places are not confirmed yet, so the address is confirmed into the
  // state-collected state jurisdiction (ready: no city license rule).
  await prisma.addressTaxLocation.create({
    data: {
      serviceAddressId: serviceAddress.id,
      status: "VERIFIED",
      source: "MANUAL",
      lookedUpAt: new Date(),
      isCurrent: true,
      jurisdictions: { create: [{ jurisdictionId: "tax-jurisdiction-co" }] },
    },
  });

  const agreement = await prisma.rentalAgreement.create({
    data: {
      customerId: customer.id,
      serviceAddressId: serviceAddress.id,
      status: "ACTIVE",
    },
  });

  const line = await prisma.rentalLine.create({
    data: {
      agreementId: agreement.id,
      label: "Washer",
      monthlyPriceCents: 5000,
      listPriceCents: 5000,
    },
  });

  const appliance = await prisma.appliance.create({
    data: {
      assetNumber: `ISO-${label.toUpperCase()}-${RUN_ID}`,
      applianceTypeId,
      status: "RENTED",
    },
  });

  const assignment = await prisma.applianceAssignment.create({
    data: {
      rentalLineId: line.id,
      applianceId: appliance.id,
    },
  });

  const invoice = await prisma.invoice.create({
    data: {
      customerId: customer.id,
      agreementId: agreement.id,
      status: "OPEN",
      amountDueCents: 5000,
      lineItems: {
        create: [
          {
            kind: "RENTAL",
            description: "Washer rental",
            amountCents: 5000,
            quantity: 1,
          },
        ],
      },
    },
  });

  return {
    userId: user.id,
    customerId: customer.id,
    serviceAddressId: serviceAddress.id,
    agreementId: agreement.id,
    lineId: line.id,
    applianceId: appliance.id,
    assignmentId: assignment.id,
    invoiceId: invoice.id,
  };
}

async function deleteFixture(fixture: Fixture) {
  // Photo rows (2026-09-28: a customer can attach photos to their own
  // maintenance request — see createMaintenanceRequestForUser) have no
  // cascade delete, so they have to go before the MaintenanceRequest they
  // point at, or Postgres rejects that delete with a foreign-key
  // violation — same reasoning as the AuditLog cleanup right below.
  await prisma.photo.deleteMany({
    where: { maintenanceRequest: { customerId: fixture.customerId } },
  });
  await prisma.maintenanceRequest.deleteMany({
    where: { customerId: fixture.customerId },
  });
  // createMaintenanceRequestForUser writes an AuditLog row keyed to this
  // user's id (AuditLog.userId is a real foreign key to User) — that row
  // has to go before the User itself can be deleted, or Postgres rejects
  // the delete with a foreign-key-constraint violation.
  await prisma.auditLog.deleteMany({ where: { userId: fixture.userId } });
  // InvoiceLineItem cascades from Invoice (see prisma/schema.prisma), so
  // deleting the invoice is enough to clean up its line items too.
  await prisma.invoice.delete({ where: { id: fixture.invoiceId } });
  await prisma.applianceAssignment.delete({
    where: { id: fixture.assignmentId },
  });
  await prisma.appliance.delete({ where: { id: fixture.applianceId } });
  await prisma.rentalLine.delete({ where: { id: fixture.lineId } });
  await prisma.rentalAgreement.delete({ where: { id: fixture.agreementId } });
  await prisma.addressTaxLocation.deleteMany({
    where: { serviceAddressId: fixture.serviceAddressId },
  });
  await prisma.serviceAddress.delete({
    where: { id: fixture.serviceAddressId },
  });
  await prisma.customer.delete({ where: { id: fixture.customerId } });
  await prisma.user.delete({ where: { id: fixture.userId } });
}

beforeAll(async () => {
  const applianceType = await prisma.applianceType.create({
    data: {
      name: `Isolation Test Type ${RUN_ID}`,
      slug: `isolation-test-type-${RUN_ID}`,
      monthlyPriceCents: 5000,
    },
  });
  applianceTypeId = applianceType.id;

  customerA = await createCustomerFixture("a");
  customerB = await createCustomerFixture("b");
});

afterAll(async () => {
  await deleteFixture(customerA);
  await deleteFixture(customerB);
  await prisma.applianceType.delete({ where: { id: applianceTypeId } });
});

describe("customer data isolation (Phase 6A item 3)", () => {
  it("getPortalData only ever returns the signed-in user's own customer record", async () => {
    const dataA = await getPortalData(customerA.userId);
    const dataB = await getPortalData(customerB.userId);

    expect(dataA?.id).toBe(customerA.customerId);
    expect(dataB?.id).toBe(customerB.customerId);

    // A's data must never mention B's agreement, service address, or
    // appliance — and vice versa.
    const agreementIdsA = dataA?.rentalAgreements.map((a) => a.id) ?? [];
    expect(agreementIdsA).toContain(customerA.agreementId);
    expect(agreementIdsA).not.toContain(customerB.agreementId);

    const addressIdsA = dataA?.serviceAddresses.map((s) => s.id) ?? [];
    expect(addressIdsA).toContain(customerA.serviceAddressId);
    expect(addressIdsA).not.toContain(customerB.serviceAddressId);

    const agreementIdsB = dataB?.rentalAgreements.map((a) => a.id) ?? [];
    expect(agreementIdsB).toContain(customerB.agreementId);
    expect(agreementIdsB).not.toContain(customerA.agreementId);
  });

  it("getPortalData returns null for a userId with no Customer record at all", async () => {
    // A brand-new User created here with no matching Customer row (e.g. an
    // OWNER/ADMIN account, or a race between signup and conversion) — this
    // must come back null, never someone else's customer record.
    const orphanUser = await prisma.user.create({
      data: {
        email: `isolation-test-orphan-${RUN_ID}@example.test`,
        role: "OWNER",
        emailVerified: true,
      },
    });
    try {
      const result = await getPortalData(orphanUser.id);
      expect(result).toBeNull();
    } finally {
      await prisma.user.delete({ where: { id: orphanUser.id } });
    }
  });

  it("getPortalApplianceOptions only returns appliances actually assigned to that user's own ACTIVE agreement", async () => {
    const optionsA = await getPortalApplianceOptions(customerA.userId);
    const optionsB = await getPortalApplianceOptions(customerB.userId);

    expect(optionsA.map((o) => o.id)).toEqual([customerA.applianceId]);
    expect(optionsB.map((o) => o.id)).toEqual([customerB.applianceId]);

    expect(optionsA.map((o) => o.id)).not.toContain(customerB.applianceId);
    expect(optionsB.map((o) => o.id)).not.toContain(customerA.applianceId);
  });

  it("rejects a maintenance request naming another customer's appliance", async () => {
    await expect(
      createMaintenanceRequestForUser(customerA.userId, {
        problem: "Trying to file against someone else's washer",
        applianceId: customerB.applianceId,
      }),
    ).rejects.toThrow(/isn't on one of your active rentals/i);
  });

  it("accepts a maintenance request naming the caller's own appliance, scoped to their own customerId", async () => {
    const request = await createMaintenanceRequestForUser(customerA.userId, {
      problem: "Washer is leaking",
      applianceId: customerA.applianceId,
    });

    expect(request.customerId).toBe(customerA.customerId);
    expect(request.applianceId).toBe(customerA.applianceId);

    // And it must show up in A's own portal data, never B's.
    const dataA = await getPortalData(customerA.userId);
    const dataB = await getPortalData(customerB.userId);
    expect(dataA?.maintenanceRequests.map((r) => r.id)).toContain(request.id);
    expect(dataB?.maintenanceRequests.map((r) => r.id)).not.toContain(
      request.id,
    );
  });

  it("attaches photoUrls to the request as real Photo rows (2026-09-28)", async () => {
    const request = await createMaintenanceRequestForUser(customerA.userId, {
      problem: "Dryer won't heat, here's what it looks like",
      photoUrls: [
        `https://abc123.private.blob.vercel-storage.com/maintenance-requests/${customerA.customerId}/photo-one.jpg`,
        `https://abc123.private.blob.vercel-storage.com/maintenance-requests/${customerA.customerId}/photo-two.jpg`,
      ],
    });

    const photos = await prisma.photo.findMany({
      where: { maintenanceRequestId: request.id },
    });
    expect(photos).toHaveLength(2);
    expect(photos.map((p) => p.url).sort()).toEqual(
      [
        `https://abc123.private.blob.vercel-storage.com/maintenance-requests/${customerA.customerId}/photo-one.jpg`,
        `https://abc123.private.blob.vercel-storage.com/maintenance-requests/${customerA.customerId}/photo-two.jpg`,
      ].sort(),
    );
  });

  it("getInvoiceDetail refuses to return another customer's invoice when scoped by customerId (2026-09-29)", async () => {
    // The one thing standing between a customer viewing their own
    // invoice document (/account/billing/invoice/[invoiceId]) and
    // viewing someone else's, just by guessing/changing the id in the
    // URL — see src/domains/billing/invoice-detail.ts.
    const ownInvoice = await getInvoiceDetail(customerA.invoiceId, {
      customerId: customerA.customerId,
    });
    expect(ownInvoice?.id).toBe(customerA.invoiceId);
    expect(ownInvoice?.lineItems.map((l) => l.description)).toContain(
      "Washer rental",
    );

    const othersInvoice = await getInvoiceDetail(customerB.invoiceId, {
      customerId: customerA.customerId,
    });
    expect(othersInvoice).toBeNull();
  });

  it("getInvoiceDetail returns the invoice for any customerId when unscoped (the desk/staff view)", async () => {
    const invoice = await getInvoiceDetail(customerB.invoiceId);
    expect(invoice?.id).toBe(customerB.invoiceId);
    expect(invoice?.customer.id).toBe(customerB.customerId);
  });
});

describe("customer data isolation — PORTAL-1 surfaces", () => {
  it("maintenance tab pages and counts only ever return the signed-in customer's requests", async () => {
    const requestA = await createMaintenanceRequestForUser(customerA.userId, {
      problem: "PORTAL-1 tab isolation check (A)",
      applianceId: customerA.applianceId,
    });
    const requestB = await createMaintenanceRequestForUser(customerB.userId, {
      problem: "PORTAL-1 tab isolation check (B)",
      applianceId: customerB.applianceId,
    });

    const openA = await getPortalMaintenancePage(customerA.userId, 1, "open");
    expect(openA?.items.map((item) => item.id)).toContain(requestA.id);
    expect(openA?.items.map((item) => item.id)).not.toContain(requestB.id);

    const openB = await getPortalMaintenancePage(customerB.userId, 1, "open");
    expect(openB?.items.map((item) => item.id)).toContain(requestB.id);
    expect(openB?.items.map((item) => item.id)).not.toContain(requestA.id);

    const countsA = await getPortalMaintenanceCounts(customerA.userId);
    const countsB = await getPortalMaintenanceCounts(customerB.userId);
    expect(countsA?.open).toBeGreaterThanOrEqual(1);
    expect(countsB?.open).toBeGreaterThanOrEqual(1);
    expect(countsA?.done).toBe(0);
    expect(countsB?.done).toBe(0);

    // Once A's request is resolved it moves to A's Done tab only.
    await prisma.maintenanceRequest.update({
      where: { id: requestA.id },
      data: { status: "RESOLVED" },
    });
    const doneA = await getPortalMaintenancePage(customerA.userId, 1, "done");
    expect(doneA?.items.map((item) => item.id)).toContain(requestA.id);
    const openAAfter = await getPortalMaintenancePage(customerA.userId, 1, "open");
    expect(openAAfter?.items.map((item) => item.id)).not.toContain(requestA.id);
    const doneB = await getPortalMaintenancePage(customerB.userId, 1, "done");
    expect(doneB?.items.map((item) => item.id)).not.toContain(requestA.id);
  });

  it("getPayNowUrl treats another customer's bill exactly like a missing one", async () => {
    await expect(
      getPayNowUrl(customerA.userId, customerB.invoiceId),
    ).rejects.toThrow("We couldn't find that bill.");
    // The same call with B's own bill gets past the lookup and fails
    // later, at eligibility (a local, non-shop-sale invoice) — proving
    // the not-found above is the ownership boundary, not a data error.
    await expect(
      getPayNowUrl(customerB.userId, customerB.invoiceId),
    ).rejects.toThrow("This bill can't be paid online right now.");
  });

  it("setAutoRenew as customer A on customer B's rental throws the not-found message", async () => {
    await expect(
      setAutoRenew(
        { userId: customerA.userId, kind: "customer" },
        customerB.agreementId,
        { enabled: false, termsVersion: "" },
      ),
    ).rejects.toThrow("Couldn't find that rental agreement.");
  });

  it("the statement route only ever mints an artifact for the signed-in customer", async () => {
    const currentMonth = businessDateKey(new Date()).slice(0, 7);
    const [year, month] = currentMonth.split("-").map(Number);
    const previousMonth = new Date(Date.UTC(year, month - 2, 1))
      .toISOString()
      .slice(0, 7);
    const artifactIds: string[] = [];
    try {
      for (const [own] of [[customerA], [customerB]] as const) {
        session.mockResolvedValue({
          user: { id: own.userId, role: "CUSTOMER" },
        });
        const response = await statementRouteGET(
          new Request(`http://localhost/api/documents/statement/${previousMonth}`),
          { params: Promise.resolve({ month: previousMonth }) },
        );
        expect(response.status).toBe(303);
        const artifactId = response.headers
          .get("location")
          ?.split("/")
          .filter(Boolean)
          .pop();
        expect(artifactId).toBeTruthy();
        artifactIds.push(artifactId!);
        const artifact = await prisma.documentArtifact.findUnique({
          where: { id: artifactId! },
        });
        expect(artifact?.customerId).toBe(own.customerId);
        expect(artifact?.subjectId).toBe(`${own.customerId}:${previousMonth}`);
      }
      expect(artifactIds[0]).not.toBe(artifactIds[1]);

      // A staff session is refused outright, before any customer lookup.
      session.mockResolvedValue({
        user: { id: customerA.userId, role: "STAFF" },
      });
      const staffResponse = await statementRouteGET(
        new Request(`http://localhost/api/documents/statement/${previousMonth}`),
        { params: Promise.resolve({ month: previousMonth }) },
      );
      expect(staffResponse.status).toBe(404);
    } finally {
      await prisma.documentArtifact.deleteMany({
        where: { id: { in: artifactIds } },
      });
    }
  });

  it("a STAFF user opening the portal has no account and sees no customer data", async () => {
    const staffUser = await prisma.user.create({
      data: {
        email: `isolation-test-staff-${RUN_ID}@example.test`,
        name: "Isolation Test Staff",
        role: "STAFF",
        emailVerified: true,
      },
    });
    try {
      expect(await getPortalData(staffUser.id)).toBeNull();
      session.mockResolvedValue({ user: { id: staffUser.id } });
      expect(await getPortalHome()).toBeNull();
    } finally {
      await prisma.user.delete({ where: { id: staffUser.id } });
    }
  });
});
