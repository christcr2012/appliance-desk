import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";

const session = vi.hoisted(() => vi.fn());
vi.mock("@/lib/session", () => ({ getServerSession: session, requireSession: session }));

import {
  getPortalData,
  getPortalJobsPage,
  getPortalMaintenancePage,
  PORTAL_PAGE_SIZE,
} from "@/domains/portal";
import { getPortalHome } from "@/domains/portal/workspace";
import { setCustomerAutoRenewAction } from "@/app/account/rentals/actions";

const tag = randomUUID().replaceAll("-", "");
const ids = {
  userA: `pd-a-u-${tag}`,
  userB: `pd-b-u-${tag}`,
  customerA: `pd-a-c-${tag}`,
  customerB: `pd-b-c-${tag}`,
  addressA: `pd-a-a-${tag}`,
  addressB: `pd-b-a-${tag}`,
  agreementA: `pd-a-r-${tag}`,
  agreementB: `pd-b-r-${tag}`,
  lineA: `pd-a-l-${tag}`,
  lineB: `pd-b-l-${tag}`,
};

let bJobId = "";
let bRequestId = "";

beforeAll(async () => {
  await prisma.user.createMany({
    data: [
      { id: ids.userA, email: `${tag}-a@example.test`, role: "CUSTOMER", emailVerified: true },
      { id: ids.userB, email: `${tag}-b@example.test`, role: "CUSTOMER", emailVerified: true },
    ],
  });
  await prisma.customer.createMany({
    data: [
      { id: ids.customerA, userId: ids.userA, referralCode: `PDA${tag.slice(0, 12)}` },
      { id: ids.customerB, userId: ids.userB, referralCode: `PDB${tag.slice(0, 12)}` },
    ],
  });
  await prisma.serviceAddress.createMany({
    data: [
      { id: ids.addressA, customerId: ids.customerA, line1: "100 Portal A", city: "Denver", zip: "80201" },
      { id: ids.addressB, customerId: ids.customerB, line1: "200 Portal B", city: "Denver", zip: "80202" },
    ],
  });
  await prisma.rentalAgreement.createMany({
    data: [
      { id: ids.agreementA, customerId: ids.customerA, serviceAddressId: ids.addressA, status: "ACTIVE", termMonths: 12 },
      { id: ids.agreementB, customerId: ids.customerB, serviceAddressId: ids.addressB, status: "ACTIVE", termMonths: 12 },
    ],
  });
  await prisma.rentalLine.createMany({
    data: [
      { id: ids.lineA, agreementId: ids.agreementA, label: "A washer", monthlyPriceCents: 3500, listPriceCents: 3500 },
      { id: ids.lineB, agreementId: ids.agreementB, label: "B washer", monthlyPriceCents: 3500, listPriceCents: 3500 },
    ],
  });

  const now = Date.now();
  for (let i = 0; i < PORTAL_PAGE_SIZE + 1; i += 1) {
    await prisma.job.create({
      data: {
        id: `pd-job-a-${String(i).padStart(2, "0")}-${tag}`,
        type: "DELIVERY",
        status: i === 0 ? "SCHEDULED" : "COMPLETED",
        customerId: ids.customerA,
        serviceAddressId: ids.addressA,
        agreementId: ids.agreementA,
        scheduledAt: new Date(now + (i === 0 ? 86_400_000 : -(i + 1) * 86_400_000)),
        notes: `internal staff note ${i}`,
        partsCostCents: 1234,
        laborCostCents: 5678,
      },
    });
  }
  bJobId = `pd-job-b-${tag}`;
  await prisma.job.create({
    data: {
      id: bJobId,
      type: "DELIVERY",
      status: "COMPLETED",
      customerId: ids.customerB,
      serviceAddressId: ids.addressB,
      agreementId: ids.agreementB,
      notes: "customer B internal note",
    },
  });

  await prisma.maintenanceRequest.createMany({
    data: Array.from({ length: PORTAL_PAGE_SIZE + 1 }, (_, i) => ({
      customerId: ids.customerA,
      problem: `A request ${i}`,
      priority: "NORMAL" as const,
    })),
  });
  const bRequest = await prisma.maintenanceRequest.create({
    data: { customerId: ids.customerB, problem: "B private request", priority: "HIGH" },
    select: { id: true },
  });
  bRequestId = bRequest.id;
});

afterAll(async () => {
  await prisma.maintenanceRequest.deleteMany({ where: { customerId: { in: [ids.customerA, ids.customerB] } } });
  await prisma.job.deleteMany({ where: { customerId: { in: [ids.customerA, ids.customerB] } } });
  await prisma.rentalLine.deleteMany({ where: { agreementId: { in: [ids.agreementA, ids.agreementB] } } });
  await prisma.rentalAgreement.deleteMany({ where: { id: { in: [ids.agreementA, ids.agreementB] } } });
  await prisma.serviceAddress.deleteMany({ where: { id: { in: [ids.addressA, ids.addressB] } } });
  await prisma.customer.deleteMany({ where: { id: { in: [ids.customerA, ids.customerB] } } });
  await prisma.user.deleteMany({ where: { id: { in: [ids.userA, ids.userB] } } });
});

describe("Batch D customer portal completion", () => {
  it("returns an explicit customer-visible DTO and never internal job fields", async () => {
    const data = await getPortalData(ids.userA);
    expect(data).not.toBeNull();
    expect(Object.keys(data!).sort()).toEqual([
      "id",
      "jobs",
      "jobsHasMore",
      "maintenanceHasMore",
      "maintenanceRequests",
      "phone",
      "rentalAgreements",
      "serviceAddresses",
      "smsOptInAt",
    ].sort());

    const agreement = data!.rentalAgreements.find((row) => row.id === ids.agreementA)!;
    expect(Object.keys(agreement).sort()).toEqual([
      "depositCents",
      "endDate",
      "freeMonthGranted",
      "id",
      "jobs",
      "lines",
      "nextBillingDate",
      "paidInFullInAdvance",
      "renewalPreference",
      "serviceAddress",
      "startDate",
      "status",
      "termMonths",
      "terminationEffectiveOn",
      "terminationRequestedAt",
      "termsSnapshot",
    ].sort());
    expect(Object.keys(agreement.lines[0]!).sort()).toEqual([
      "assignments",
      "id",
      "label",
      "listPriceCents",
      "monthlyPriceCents",
      "prepayDiscountCentsPerMonth",
    ].sort());

    const job = data!.jobs[0]!;
    expect(Object.keys(job).sort()).toEqual([
      "id",
      "performedOn",
      "scheduledAt",
      "serviceAddress",
      "status",
      "type",
    ].sort());
    expect(job).not.toHaveProperty("notes");
    expect(job).not.toHaveProperty("assignedToUserId");
    expect(job).not.toHaveProperty("partsCostCents");
    expect(job).not.toHaveProperty("laborCostCents");
  });

  it("caps activity at 20, exposes bounded pages, and never returns another customer's rows", async () => {
    const data = await getPortalData(ids.userA);
    expect(data?.jobs).toHaveLength(PORTAL_PAGE_SIZE);
    expect(data?.jobsHasMore).toBe(true);
    expect(data?.maintenanceRequests).toHaveLength(PORTAL_PAGE_SIZE);
    expect(data?.maintenanceHasMore).toBe(true);
    expect(data?.jobs.some((row) => row.id === bJobId)).toBe(false);
    expect(data?.maintenanceRequests.some((row) => row.id === bRequestId)).toBe(false);

    const jobs2 = await getPortalJobsPage(ids.userA, 2);
    const requests2 = await getPortalMaintenancePage(ids.userA, 2);
    expect(jobs2?.items).toHaveLength(1);
    expect(requests2?.items).toHaveLength(1);
    expect(JSON.stringify(jobs2)).not.toContain(bJobId);
    expect(JSON.stringify(requests2)).not.toContain(bRequestId);
  });

  it("the customer server action cannot change another customer's rental", async () => {
    session.mockResolvedValue({ user: { id: ids.userA } });
    const result = await setCustomerAutoRenewAction({
      agreementId: ids.agreementB,
      enabled: false,
      termsVersion: "",
    });
    expect(result.status).toBe("error");
    expect((await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: ids.agreementB } })).renewalPreference).toBeNull();
  });

  it("the portal home next visit is future-only", async () => {
    session.mockResolvedValue({ user: { id: ids.userA } });
    const home = await getPortalHome();
    expect(home?.nextVisit?.scheduledAt?.getTime()).toBeGreaterThan(Date.now());
  });
});
