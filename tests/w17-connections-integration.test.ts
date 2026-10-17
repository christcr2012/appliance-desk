import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ role: "OWNER" as "OWNER" | "ADMIN" | "STAFF" }));
vi.mock("@/lib/session", () => ({
  requireRole: vi.fn(async (...roles: string[]) => {
    if (!roles.includes(auth.role)) throw new Error("forbidden");
    return { user: { id: "w17-session", role: auth.role } };
  }),
  getServerSession: vi.fn(async () => null),
}));
vi.mock("@/domains/billing/payment-link", () => ({ getHostedPaymentUrl: vi.fn(async () => "https://invoice.stripe.com/i/test") }));

import { prisma } from "@/lib/prisma";
import { getInspectionChecklist, recordApplianceInspection } from "@/domains/inventory/guided-actions";
import { markCleaningDone } from "@/domains/inventory/cleaning";
import { listCleaningNeeded, listVisitNeedsAssignment } from "@/domains/exceptions/turning-points-attention";
import { getRecordConnections } from "@/domains/connections";
import { searchAll } from "@/domains/search";
import { getPayNowUrl, PayNowError } from "@/domains/portal/pay-now";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/appliance_desk_test";
const DAY = 86_400_000;

describe.skipIf(!enabled)("W-17 connected records, cleaning and repair drafts; W-20 Pay now, on real PostgreSQL", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ownerId = "w17-owner-" + tag, staffId = "w17-staff-" + tag;
  const custA = { user: "w17-ua-" + tag, id: "w17-ca-" + tag, addr: "w17-aa-" + tag };
  const custB = { user: "w17-ub-" + tag, id: "w17-cb-" + tag, addr: "w17-ab-" + tag };
  const typeId = "w17-type-" + tag;
  const applianceIds: string[] = [];
  const now = new Date();
  let agreementId = "", lineId = "", jobId = "", invoiceA = "", invoiceB = "", supplierId = "", purchaseId = "", rentedId = "";

  async function waiting() {
    const id = `w17-ap-${applianceIds.length}-${tag}`;
    applianceIds.push(id);
    await prisma.appliance.create({ data: { id, assetNumber: `W17${applianceIds.length}-${tag.slice(0, 6)}`, applianceTypeId: typeId, status: "AWAITING_INSPECTION", serialNumber: `SN-${applianceIds.length}-${tag.slice(0, 8)}` } });
    return id;
  }
  const statusOf = async (id: string) => (await prisma.appliance.findUniqueOrThrow({ where: { id } })).status;
  const drafts = (id: string) => prisma.job.findMany({ where: { type: "MAINTENANCE_VISIT", appliances: { some: { applianceId: id } } } });

  beforeAll(async () => {
    await prisma.user.createMany({ data: [
      { id: ownerId, email: tag + "-o@example.test", name: "W17 Owner", role: "OWNER", emailVerified: true },
      { id: staffId, email: tag + "-s@example.test", name: "W17 Staff", role: "STAFF", emailVerified: true },
      { id: custA.user, email: tag + "-a@example.test", name: "Alex Renter", role: "CUSTOMER", emailVerified: true },
      { id: custB.user, email: tag + "-b@example.test", name: "Bo Other", role: "CUSTOMER", emailVerified: true } ] });
    for (const c of [custA, custB]) {
      await prisma.customer.create({ data: { id: c.id, userId: c.user, referralCode: "W" + c.id.slice(5, 7) + tag.slice(0, 16) } });
      await prisma.serviceAddress.create({ data: { id: c.addr, customerId: c.id, line1: "1 Test St", city: "Greeley", zip: "80631" } });
    }
    await prisma.applianceType.create({ data: { id: typeId, name: "Washer " + tag, slug: "w17-washer-" + tag, monthlyPriceCents: 3500 } });
    const agreement = await prisma.rentalAgreement.create({ data: {
      customerId: custA.id, serviceAddressId: custA.addr, status: "ACTIVE", termMonths: 12, startDate: new Date(now.getTime() - 30 * DAY),
      depositCents: 0, damageWaiverCents: 0, lateFeeGraceDays: 5, lateFeeCents: 0, lateFeePercent: 0, taxRateMilliPercent: 0 } });
    agreementId = agreement.id;
    lineId = (await prisma.rentalLine.create({ data: { agreementId, label: "Washer", monthlyPriceCents: 3500 } })).id;
    supplierId = (await prisma.supplier.create({ data: { name: "Sunrise Salvage " + tag } })).id;
    purchaseId = (await prisma.purchase.create({ data: {
      operationKey: "w17-op-" + tag, payloadHash: "h" + tag, supplierId, sellerName: "Sunrise Salvage", purchasedOn: now, reference: "RCPT-" + tag.slice(0, 8),
      subtotalCents: 20000, sellerTaxKind: "NONE", createdByUserId: ownerId, taxRevisionAt: now } })).id;
    rentedId = `w17-rented-${tag}`;
    applianceIds.push(rentedId);
    await prisma.appliance.create({ data: { id: rentedId, assetNumber: "W17R-" + tag.slice(0, 8), applianceTypeId: typeId, status: "RENTED", purchaseId } });
    await prisma.applianceAssignment.create({ data: { rentalLineId: lineId, applianceId: rentedId } });
    jobId = (await prisma.job.create({ data: { type: "DELIVERY", status: "SCHEDULED", scheduledAt: new Date(now.getTime() + DAY), customerId: custA.id, agreementId, appliances: { create: [{ applianceId: rentedId }] } } })).id;
    invoiceA = (await prisma.invoice.create({ data: { customerId: custA.id, agreementId, status: "OPEN", amountDueCents: 6000, dueDate: new Date(now.getTime() - 3 * DAY), stripeInvoiceId: "in_w17a_" + tag } })).id;
    invoiceB = (await prisma.invoice.create({ data: { customerId: custB.id, status: "OPEN", amountDueCents: 6000, dueDate: new Date(now.getTime() - 3 * DAY), stripeInvoiceId: "in_w17b_" + tag } })).id;
    await prisma.auditLog.create({ data: { userId: ownerId, action: "rental_agreement.status_changed", entityType: "RentalAgreement", entityId: agreementId, newValue: { reason: "Signed in person" } } });
  });

  afterAll(async () => {
    auth.role = "OWNER";
    await prisma.$transaction([
      prisma.$executeRawUnsafe('ALTER TABLE "ApplianceInspection" DISABLE TRIGGER "ApplianceInspection_append_only"'),
      prisma.applianceInspectionAmendment.deleteMany({ where: { inspection: { applianceId: { in: applianceIds } } } }),
      prisma.applianceInspection.deleteMany({ where: { applianceId: { in: applianceIds } } }),
      prisma.$executeRawUnsafe('ALTER TABLE "ApplianceInspection" ENABLE TRIGGER "ApplianceInspection_append_only"'),
    ]);
    const jobs = await prisma.job.findMany({ where: { appliances: { some: { applianceId: { in: applianceIds } } } }, select: { id: true } });
    const jobIds = jobs.map((j) => j.id);
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: [...applianceIds, agreementId, ...jobIds] } }, { userId: ownerId }] } });
    await prisma.jobAppliance.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
    await prisma.invoice.deleteMany({ where: { id: { in: [invoiceA, invoiceB] } } });
    await prisma.applianceAssignment.deleteMany({ where: { applianceId: { in: applianceIds } } });
    await prisma.appliance.deleteMany({ where: { id: { in: applianceIds } } });
    await prisma.purchase.deleteMany({ where: { id: purchaseId } });
    await prisma.supplier.deleteMany({ where: { id: supplierId } });
    await prisma.rentalLine.deleteMany({ where: { id: lineId } });
    await prisma.rentalAgreement.deleteMany({ where: { id: agreementId } });
    await prisma.applianceType.deleteMany({ where: { id: typeId } });
    await prisma.serviceAddress.deleteMany({ where: { id: { in: [custA.addr, custB.addr] } } });
    await prisma.customer.deleteMany({ where: { id: { in: [custA.id, custB.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, staffId, custA.user, custB.user] } } });
  });

  it("a passed inspection sends the machine to Cleaning, onto Today, and only Cleaning done makes it Available", async () => {
    auth.role = "OWNER";
    const current = await getInspectionChecklist();
    const unit = await waiting();
    await recordApplianceInspection(ownerId, unit, { expectedChecklistVersionId: current.versionId, answers: current.items.map(() => true) });
    expect(await statusOf(unit)).toBe("CLEANING");
    const row = (await listCleaningNeeded(50)).rows.find((r) => r.href === "/desk/inventory/" + unit);
    expect(row).toMatchObject({ category: "CLEANING_NEEDED", href: "/desk/inventory/" + unit });
    expect(row?.title).toMatch(/^Clean Washer/);
    await expect(markCleaningDone(staffId, unit)).rejects.toThrow();
    expect(await statusOf(unit)).toBe("CLEANING");
    expect(await markCleaningDone(ownerId, unit)).toEqual({ changed: true });
    expect(await statusOf(unit)).toBe("AVAILABLE");
    expect(await markCleaningDone(ownerId, unit)).toEqual({ changed: false });
    expect((await listCleaningNeeded(50)).rows.some((r) => r.href === "/desk/inventory/" + unit)).toBe(false);
    const trail = await prisma.auditLog.findMany({ where: { entityId: unit, action: "appliance.unit.status" } });
    expect(trail.filter((r) => (r.newValue as { reason?: string }).reason === "Cleaning done")).toHaveLength(1); // the repeat press adds nothing
  });

  it("a failed inspection drafts exactly one unscheduled repair visit, shows it on Today, and a repeat adds no second", async () => {
    auth.role = "OWNER";
    const current = await getInspectionChecklist();
    const unit = await waiting();
    const answers = current.items.map((_, i) => i !== 0);
    await recordApplianceInspection(ownerId, unit, { expectedChecklistVersionId: current.versionId, answers });
    expect(await statusOf(unit)).toBe("MAINTENANCE");
    const first = await drafts(unit);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ status: "SCHEDULED", scheduledAt: null });
    const todo = (await listVisitNeedsAssignment(50, now)).rows.find((r) => r.href === "/desk/jobs/" + first[0].id);
    expect(todo?.title).toMatch(/^Schedule the repair/);
    // The same machine fails again before the first repair visit is done: still one draft.
    await prisma.appliance.update({ where: { id: unit }, data: { status: "AWAITING_INSPECTION" } });
    await recordApplianceInspection(ownerId, unit, { expectedChecklistVersionId: current.versionId, answers });
    expect(await drafts(unit)).toHaveLength(1);
  });

  it("Related and History show the right records in plain words, for owner and admin only", async () => {
    auth.role = "OWNER";
    const appliance = await getRecordConnections("appliance", rentedId);
    expect(appliance.related.map((r) => r.href)).toEqual(expect.arrayContaining([
      "/desk/customers/" + custA.id, "/desk/agreements/" + agreementId, "/desk/purchases/" + purchaseId, "/desk/suppliers/" + supplierId, "/desk/jobs/" + jobId ]));
    const customer = await getRecordConnections("customer", custA.id);
    expect(customer.related.map((r) => r.href)).toEqual(expect.arrayContaining([
      "/desk/agreements/" + agreementId, "/desk/inventory/" + rentedId, `/desk/billing/customer/${custA.id}/invoice/${invoiceA}`, "/desk/jobs/" + jobId ]));
    const agreement = await getRecordConnections("agreement", agreementId);
    expect(agreement.related.map((r) => r.href)).toEqual(expect.arrayContaining(["/desk/customers/" + custA.id, "/desk/inventory/" + rentedId]));
    expect(agreement.history[0]).toMatchObject({ who: "W17 Owner", what: "Status changed", detail: "Signed in person" });
    expect(JSON.stringify(agreement.history)).not.toMatch(/rental_agreement|_changed/);
    expect((await getRecordConnections("purchase", purchaseId)).related.map((r) => r.href)).toEqual(expect.arrayContaining(["/desk/suppliers/" + supplierId, "/desk/inventory/" + rentedId]));
    expect((await getRecordConnections("seller", supplierId)).related.map((r) => r.href)).toContain("/desk/purchases/" + purchaseId);
    expect((await getRecordConnections("visit", jobId)).related.map((r) => r.href)).toEqual(expect.arrayContaining(["/desk/customers/" + custA.id, "/desk/agreements/" + agreementId, "/desk/inventory/" + rentedId]));
    expect((await getRecordConnections("invoice", invoiceA)).related.map((r) => r.href)).toEqual(expect.arrayContaining(["/desk/customers/" + custA.id, "/desk/agreements/" + agreementId]));
    auth.role = "ADMIN";
    expect((await getRecordConnections("customer", custA.id)).related.length).toBeGreaterThan(0);
    auth.role = "STAFF";
    await expect(getRecordConnections("customer", custA.id)).rejects.toThrow("forbidden");
    await expect(getRecordConnections("invoice", invoiceA)).rejects.toThrow("forbidden");
  });

  it("search finds purchases by seller or receipt and sellers by name for owner/admin, never staff, and still finds serial numbers", async () => {
    auth.role = "OWNER";
    const byReceipt = await searchAll("RCPT-" + tag.slice(0, 8));
    expect(byReceipt.purchases.map((p) => p.id)).toContain(purchaseId);
    const bySeller = await searchAll("Sunrise Salvage " + tag);
    expect(bySeller.sellers.map((s) => s.id)).toContain(supplierId);
    expect(bySeller.purchases.map((p) => p.id)).toContain(purchaseId);
    const unit = await prisma.appliance.findFirstOrThrow({ where: { id: { in: applianceIds }, serialNumber: { not: null } } });
    expect((await searchAll(unit.serialNumber!)).appliances.map((a) => a.id)).toContain(unit.id);
    auth.role = "STAFF";
    const staff = await searchAll("Sunrise Salvage " + tag);
    expect(staff.purchases).toEqual([]);
    expect(staff.sellers).toEqual([]);
    expect((await searchAll("RCPT-" + tag.slice(0, 8))).purchases).toEqual([]);
    expect((await searchAll(unit.serialNumber!)).appliances.map((a) => a.id)).toContain(unit.id);
  });

  it("Pay now works only for the customer's own overdue Stripe invoice", async () => {
    await expect(getPayNowUrl(custA.user, invoiceA, now)).resolves.toBe("https://invoice.stripe.com/i/test");
    await expect(getPayNowUrl(custA.user, invoiceB, now)).rejects.toBeInstanceOf(PayNowError); // someone else's
    await expect(getPayNowUrl(custB.user, invoiceA, now)).rejects.toBeInstanceOf(PayNowError);
    await prisma.invoice.update({ where: { id: invoiceA }, data: { status: "PAID", amountPaidCents: 6000 } });
    await expect(getPayNowUrl(custA.user, invoiceA, now)).rejects.toBeInstanceOf(PayNowError); // paid
    await prisma.invoice.update({ where: { id: invoiceA }, data: { status: "OPEN", amountPaidCents: 0, stripeInvoiceId: null } });
    await expect(getPayNowUrl(custA.user, invoiceA, now)).rejects.toBeInstanceOf(PayNowError); // local invoice
  });
});
