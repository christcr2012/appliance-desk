import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";

import { seedTaxReadyContext } from "../tests/helpers/tax-ready";

// AR-5 section 9: the Schedule area end to end — an owner books waiting visits from the Board
// (including confirming a double-booking), staff get a read-only Board and Visits list, and
// finishing a visit announces its hand-off (billing for a delivery, the deposit for a pickup).
const owner = "e2e/.auth/owner.json";
const staff = "e2e/.auth/staff.json";
const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

/** Tomorrow at the given Denver clock time, as a datetime-local value (YYYY-MM-DDTHH:mm). */
function denverTomorrowAt(hhmm: string): string {
  const tomorrow = new Date(Date.now() + 86_400_000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Denver",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(tomorrow);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}T${hhmm}`;
}

async function makeCustomer(tag: string) {
  const { prisma } = await import("../src/lib/prisma");
  const user = await prisma.user.create({
    data: { email: `ar5s-${tag}@example.test`, name: `AR5 Schedule ${tag}`, role: "CUSTOMER", emailVerified: true },
  });
  const customer = await prisma.customer.create({
    data: { userId: user.id, referralCode: `S${tag.replaceAll("-", "").slice(0, 18)}` },
  });
  const address = await prisma.serviceAddress.create({
    data: { customerId: customer.id, line1: "9 Schedule Test Way", city: "Greeley", state: "CO", zip: "80631" },
  });
  return { prisma, user, customer, address };
}

test.describe("owner books from the Board", () => {
  test.use({ storageState: fs.existsSync(owner) ? owner : undefined });

  test("books a waiting visit, then confirms a double-booking for the same person", async ({ page }) => {
    test.skip(!enabled || !fs.existsSync(owner), "Disposable CI database only");
    const tag = randomUUID().slice(0, 8);
    const { prisma, user, customer, address } = await makeCustomer(tag);
    // Scheduling a delivery re-checks the address's tax readiness (FEETAX-2), so the fixture
    // address stands up the same verified tax context the unit suites use.
    const tax = await seedTaxReadyContext(address.id);
    const jobIds: string[] = [];
    try {
      for (let i = 0; i < 2; i++) {
        const job = await prisma.job.create({
          data: { type: "DELIVERY", status: "SCHEDULED", customerId: customer.id, serviceAddressId: address.id },
        });
        jobIds.push(job.id);
      }
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto("/desk/dispatch");
      // This test's own waiting rows (the seeded board carries other waiting visits too, so
      // every click below is scoped to rows naming this test's customer).
      const myRow = page.locator("li").filter({ hasText: `AR5 Schedule ${tag}` });
      if (!(await myRow.first().isVisible().catch(() => false))) {
        await page.getByText(/Waiting for a time/).click();
      }
      await expect(myRow).toHaveCount(2);

      // Book the first waiting visit for the first team member at tomorrow 10:00.
      await myRow.first().getByRole("button", { name: "Schedule", exact: true }).click();
      const when = page.getByLabel("When");
      await when.fill(denverTomorrowAt("10:00"));
      const who = page.getByLabel("Who is doing it");
      await who.selectOption({ index: 1 });
      const assignee = await who.inputValue();
      expect(assignee).not.toBe("");
      await page.getByRole("button", { name: "Book the visit" }).click();
      await expect(page.getByText(/Visit booked for .* at 10:00 AM/)).toBeVisible();

      // Book the second waiting visit for the SAME person at 10:30 — the board warns, and
      // "Book it anyway" is the deliberate confirm.
      await expect(myRow).toHaveCount(1);
      await myRow.first().getByRole("button", { name: "Schedule", exact: true }).click();
      await page.getByLabel("When").fill(denverTomorrowAt("10:30"));
      await page.getByLabel("Who is doing it").selectOption(assignee);
      await page.getByRole("button", { name: "Book the visit" }).click();
      await expect(page.getByRole("alert")).toContainText("already booked at that time");
      await page.getByRole("button", { name: "Book it anyway" }).click();
      await expect(page.getByText(/Visit booked for .* at 10:30 AM/)).toBeVisible();

      // Both visits are really scheduled for that person now.
      const booked = await prisma.job.findMany({ where: { id: { in: jobIds } } });
      expect(booked.every((job) => job.scheduledAt !== null && job.assignedToUserId === assignee)).toBe(true);
    } finally {
      await prisma.auditLog.deleteMany({ where: { entityId: { in: jobIds } } });
      await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
      await tax.cleanup();
      await prisma.serviceAddress.deleteMany({ where: { id: address.id } });
      await prisma.customer.deleteMany({ where: { id: customer.id } });
      await prisma.user.deleteMany({ where: { id: user.id } });
      await prisma.$disconnect();
    }
  });
});

test.describe("staff see a read-only Schedule area", () => {
  test.use({ storageState: fs.existsSync(staff) ? staff : undefined });

  test("no schedule buttons on the Board or Visits; visits still listed", async ({ page }) => {
    test.skip(!enabled || !fs.existsSync(staff), "Disposable CI database only");
    const tag = randomUUID().slice(0, 8);
    const { prisma, user, customer, address } = await makeCustomer(tag);
    let jobId = "";
    try {
      const job = await prisma.job.create({
        data: { type: "DELIVERY", status: "SCHEDULED", customerId: customer.id, serviceAddressId: address.id },
      });
      jobId = job.id;
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto("/desk/dispatch");
      await expect(page.getByRole("link", { name: "Schedule a visit" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Schedule", exact: true })).toHaveCount(0);
      await page.goto("/desk/jobs?status=no-time");
      // The list renders the visit in both its phone cards and its desktop table;
      // at this viewport the table is the visible one.
      await expect(page.getByRole("table").getByText(`AR5 Schedule ${tag}`)).toBeVisible();
      await expect(page.getByRole("link", { name: "Schedule a visit" })).toHaveCount(0);
    } finally {
      await prisma.job.deleteMany({ where: { id: jobId } });
      await prisma.serviceAddress.deleteMany({ where: { id: address.id } });
      await prisma.customer.deleteMany({ where: { id: customer.id } });
      await prisma.user.deleteMany({ where: { id: user.id } });
      await prisma.$disconnect();
    }
  });
});

test.describe("owner finishes a visit and hears the hand-off", () => {
  test.use({ storageState: fs.existsSync(owner) ? owner : undefined });

  async function makeRental(tag: string, kind: "DELIVERY" | "REMOVAL") {
    const { prisma, user, customer, address } = await makeCustomer(tag);
    const type = await prisma.applianceType.findFirstOrThrow();
    const agreement = await prisma.rentalAgreement.create({
      data: {
        customerId: customer.id,
        serviceAddressId: address.id,
        status: "ACTIVE",
        lines: { create: { label: "Washer", monthlyPriceCents: 3500, listPriceCents: 3500 } },
      },
      include: { lines: true },
    });
    const appliance = await prisma.appliance.create({
      data: {
        assetNumber: `AR5S-${tag}`,
        applianceTypeId: type.id,
        status: kind === "DELIVERY" ? "RESERVED" : "RENTED",
      },
    });
    await prisma.applianceAssignment.create({
      data: { rentalLineId: agreement.lines[0]!.id, applianceId: appliance.id },
    });
    const job = await prisma.job.create({
      data: {
        type: kind,
        status: "IN_PROGRESS",
        customerId: customer.id,
        serviceAddressId: address.id,
        agreementId: agreement.id,
        scheduledAt: new Date(),
        appliances: { create: { applianceId: appliance.id } },
      },
    });
    return { prisma, user, customer, address, agreement, appliance, job };
  }

  async function cleanupRental(r: Awaited<ReturnType<typeof makeRental>>) {
    const { prisma } = r;
    await prisma.auditLog.deleteMany({ where: { entityId: { in: [r.job.id, r.agreement.id, r.appliance.id] } } });
    await prisma.staffTask.deleteMany({ where: { jobId: r.job.id } });
    await prisma.jobBillingHandoff.deleteMany({ where: { jobId: r.job.id } });
    await prisma.deposit.deleteMany({ where: { agreementId: r.agreement.id } });
    await prisma.invoice.deleteMany({ where: { agreementId: r.agreement.id } });
    await prisma.retailDeliveryFeeRecord.deleteMany({ where: { agreementId: r.agreement.id } });
    await prisma.applianceCustodyEpisode.deleteMany({ where: { applianceId: r.appliance.id } });
    await prisma.pendingDelivery.deleteMany({ where: { agreementId: r.agreement.id } });
    await prisma.jobAppliance.deleteMany({ where: { jobId: r.job.id } });
    await prisma.job.deleteMany({ where: { id: r.job.id } });
    await prisma.applianceAssignment.deleteMany({ where: { applianceId: r.appliance.id } });
    await prisma.rentalLine.deleteMany({ where: { agreementId: r.agreement.id } });
    await prisma.rentalAgreement.deleteMany({ where: { id: r.agreement.id } });
    await prisma.appliance.deleteMany({ where: { id: r.appliance.id } });
    await prisma.serviceAddress.deleteMany({ where: { id: r.address.id } });
    await prisma.customer.deleteMany({ where: { id: r.customer.id } });
    await prisma.user.deleteMany({ where: { id: r.user.id } });
    await prisma.$disconnect();
  }

  test("finishing a delivery announces that monthly billing starts", async ({ page }) => {
    test.skip(!enabled || !fs.existsSync(owner), "Disposable CI database only");
    const tag = randomUUID().slice(0, 8);
    const rental = await makeRental(tag, "DELIVERY");
    try {
      await page.goto(`/desk/jobs/${rental.job.id}`);
      const hookups = page.getByRole("combobox", { name: /New hookup items for/i });
      if (await hookups.count()) await hookups.selectOption("yes");
      await page.getByRole("button", { name: "Complete job", exact: true }).click();
      await expect(
        page.getByText("Delivered. Monthly billing starts automatically."),
      ).toBeVisible();
    } finally {
      await cleanupRental(rental);
    }
  });

  test("finishing a pickup that closes the rental points at the deposit", async ({ page }) => {
    test.skip(!enabled || !fs.existsSync(owner), "Disposable CI database only");
    const tag = randomUUID().slice(0, 8);
    const rental = await makeRental(tag, "REMOVAL");
    try {
      await rental.prisma.deposit.create({
        data: { agreementId: rental.agreement.id, amountCents: 15000 },
      });
      await page.goto(`/desk/jobs/${rental.job.id}`);
      await page.getByRole("button", { name: "Complete job", exact: true }).click();
      await expect(
        page.getByText("Picked up. The rental is closed — settle the deposit next."),
      ).toBeVisible();
      await expect
        .poll(async () =>
          (await rental.prisma.rentalAgreement.findUniqueOrThrow({ where: { id: rental.agreement.id } })).status,
        )
        .toBe("ENDED");
    } finally {
      await cleanupRental(rental);
    }
  });
});
