import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  session: vi.fn(),
  customer: { findUnique: vi.fn() },
  rentalAgreement: { count: vi.fn(), findMany: vi.fn() },
  job: { count: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
  invoice: { findFirst: vi.fn() },
  maintenanceRequest: { count: vi.fn() },
}));
vi.mock("@/lib/session", () => ({ getServerSession: m.session }));
vi.mock("@/lib/prisma", () => ({ prisma: m }));
import { getPortalHome } from "@/domains/portal/workspace";
beforeEach(() => {
  vi.clearAllMocks();
  m.session.mockResolvedValue({ user: { id: "customer-user" } });
  m.customer.findUnique.mockResolvedValue({
    id: "c1",
    archivedAt: null,
    serviceAddresses: [
      { id: "a1", line1: "My home", line2: null, city: "Greeley" },
    ],
  });
  m.rentalAgreement.count.mockResolvedValue(12);
  m.rentalAgreement.findMany.mockResolvedValue([]);
  m.job.count.mockResolvedValue(1);
  m.job.findFirst.mockResolvedValue(null);
  m.job.findMany.mockResolvedValue([]);
  m.invoice.findFirst.mockResolvedValue(null);
  m.maintenanceRequest.count.mockResolvedValue(2);
});
it("resolves identity from the session and scopes every read to that customer", async () => {
  const data = await getPortalHome("a1");
  expect(data).toMatchObject({
    addressId: "a1",
    activeRentalCount: 12,
    upcomingVisitCount: 1,
    openRequestCount: 2,
  });
  expect(m.customer.findUnique.mock.calls[0][0].where).toEqual({
    userId: "customer-user",
  });
  for (const fn of [
    m.rentalAgreement.count,
    m.rentalAgreement.findMany,
    m.job.count,
    m.job.findFirst,
    m.invoice.findFirst,
    m.maintenanceRequest.count,
  ])
    expect(fn.mock.calls[0][0].where.customerId).toBe("c1");
  expect(m.rentalAgreement.findMany.mock.calls[0][0].take).toBe(6);
  expect(m.job.findFirst.mock.calls[0][0].where.serviceAddressId).toBe("a1");
  expect(m.invoice.findFirst.mock.calls[0][0].where.agreement).toEqual({
    serviceAddressId: "a1",
  });
  const select = m.job.findFirst.mock.calls[0][0].select;
  expect(select.notes).toBeUndefined();
  expect(select.completionNotes).toBeUndefined();
  expect(select.partsCostCents).toBeUndefined();
});
it("ignores another customer's property rather than reading their records", async () => {
  const data = await getPortalHome("other-property");
  expect(data?.addressId).toBeUndefined();
  expect(m.job.findFirst.mock.calls[0][0].where).not.toHaveProperty(
    "serviceAddressId",
  );
  expect(m.invoice.findFirst.mock.calls[0][0].where.customerId).toBe("c1");
});
it("unauthenticated and archived accounts do not read operations or invoices", async () => {
  m.session.mockResolvedValue(null);
  expect(await getPortalHome()).toBeNull();
  expect(m.customer.findUnique).not.toHaveBeenCalled();
  m.session.mockResolvedValue({ user: { id: "customer-user" } });
  m.customer.findUnique.mockResolvedValue({
    id: "c1",
    archivedAt: new Date(),
    serviceAddresses: [],
  });
  expect(await getPortalHome()).toBeNull();
  expect(m.invoice.findFirst).not.toHaveBeenCalled();
});
it("excludes closed/cancelled jobs and draft/refunded/void invoices from next actions", async () => {
  await getPortalHome();
  expect(m.job.findFirst.mock.calls[0][0].where.status).toEqual({
    in: ["SCHEDULED", "IN_PROGRESS"],
  });
  expect(m.invoice.findFirst.mock.calls[0][0].where.status).toEqual({
    in: ["OPEN", "PARTIALLY_PAID", "DELINQUENT", "FAILED"],
  });
});
it("returns domain-computed money totals and the signing-waiting list", async () => {
  const rental = {
    id: "r1",
    status: "ACTIVE",
    serviceAddress: { line1: "My home", line2: null, city: "Greeley" },
    lines: [
      { label: "Washer", monthlyPriceCents: 4500, packageId: null, assignments: [] },
      { label: "Dryer", monthlyPriceCents: 4500, packageId: null, assignments: [] },
    ],
    outOfServicePeriods: [],
  };
  m.rentalAgreement.findMany.mockImplementation(
    async (args: { where?: { status?: unknown } }) =>
      args?.where?.status === "AWAITING_SIGNATURE"
        ? [
            { id: "r2", signature: { id: "sig-9" } },
            { id: "r3", signature: null },
          ]
        : [rental],
  );
  m.invoice.findFirst.mockResolvedValue({
    id: "inv1",
    invoiceNumber: 7,
    status: "OPEN",
    amountDueCents: 10000,
    amountPaidCents: 2500,
    dueDate: null,
  });
  const data = await getPortalHome();
  expect(data?.rentals[0]?.monthlyTotalCents).toBe(9000);
  expect(data?.balanceCents).toBe(7500);
  // Only the agreement with a signature record gets a sign-in link, and
  // the query stays scoped to the signed-in customer.
  expect(data?.signingWaiting).toEqual([
    { agreementId: "r2", signHref: "/sign/sig-9" },
  ]);
  const awaitingCall = m.rentalAgreement.findMany.mock.calls.find(
    (call) => call[0].where?.status === "AWAITING_SIGNATURE",
  );
  expect(awaitingCall?.[0].where.customerId).toBe("c1");
});
it("clamps the balance at zero and reports no balance without an open bill", async () => {
  m.invoice.findFirst.mockResolvedValue({
    id: "inv2",
    invoiceNumber: 8,
    status: "PARTIALLY_PAID",
    amountDueCents: 5000,
    amountPaidCents: 6000,
    dueDate: null,
  });
  expect((await getPortalHome())?.balanceCents).toBe(0);
  m.invoice.findFirst.mockResolvedValue(null);
  const data = await getPortalHome();
  expect(data?.balanceCents).toBe(0);
  expect(data?.signingWaiting).toEqual([]);
});
