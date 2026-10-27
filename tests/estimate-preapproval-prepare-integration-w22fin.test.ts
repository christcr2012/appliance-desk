import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { prepareEstimateAgreementsBeforeApproval } from "@/domains/estimates/preapproval-agreements";
import { approveEstimate, convertEstimateToAgreements } from "@/domains/estimates";
import { getPreparedEstimateQuoteInTx } from "@/domains/estimates/preapproval-quote";

vi.mock("@/domains/estimates/preapproval-quote", () => ({
  getPreparedEstimateQuoteInTx: vi.fn(),
}));
const mockedQuote = vi.mocked(getPreparedEstimateQuoteInTx);

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && url.pathname === "/appliance_desk_test"
  && ["localhost", "127.0.0.1"].includes(url.hostname);
describe.skipIf(!enabled)("preapproval estimate preparation on disposable PostgreSQL", () => {
  const marker = randomUUID().replaceAll("-", "");
  let owner = "", staff = "", customer = "", customerUserId = "", estimate = "";
  let addressA = "", addressB = "", packageId = "";
  const approvalIds:string[]=[];
  beforeAll(async () => {
    const [u, staffRow, customerUser] = await Promise.all([
      prisma.user.create({ data: { email: `prep-owner-${marker}@example.test`,
        role: "OWNER", passwordHash: "test-only" } }),
      prisma.user.create({ data: { email: `prep-staff-${marker}@example.test`,
        role: "STAFF", passwordHash: "test-only" } }),
      prisma.user.create({ data: { email: `prep-customer-${marker}@example.test`,
        role: "CUSTOMER", passwordHash: "test-only" } }),
    ]);
    owner = u.id; staff = staffRow.id; customerUserId = customerUser.id;
    const customerRow = await prisma.customer.create({ data: { userId: customerUser.id, referralCode: ("W22" + marker).slice(0,20).toUpperCase() } });
    customer = customerRow.id;
    const [a, b] = await Promise.all([
      prisma.serviceAddress.create({ data: { customerId: customer,
        line1: "100 Test Lane", city: "Greeley", zip: "80631" } }),
      prisma.serviceAddress.create({ data: { customerId: customer,
        line1: "200 Test Lane", city: "Greeley", zip: "80631" } }),
    ]);
    addressA = a.id; addressB = b.id;
    // FEETAX-2: converting an estimate refuses an address whose tax places
    // are not confirmed yet, so both addresses are confirmed into the
    // state-collected state jurisdiction (ready: no city license rule and
    // the state does not tax rent through a city readiness row).
    for (const id of [addressA, addressB]) {
      await prisma.addressTaxLocation.create({ data: {
        serviceAddressId: id, status: "VERIFIED", source: "MANUAL",
        lookedUpAt: new Date(), isCurrent: true,
        jurisdictions: { create: [{ jurisdictionId: "tax-jurisdiction-co" }] },
      } });
    }
    const pkg = await prisma.rentalPackage.create({ data: {
      name: `Preparation ${marker}`, slug: `prep-${marker}`, isActive: true, monthlyPriceCents: 6000,
    } });
    packageId = pkg.id;
    const quote = await prisma.estimate.create({ data: {
      customerId: customer, createdByUserId: owner, title: "Per-property preparation",
      status: "DRAFT",
    } });
    estimate = quote.id;
    await prisma.estimateLineItem.createMany({ data: [
      { estimateId: estimate, serviceAddressId: addressA, packageId, description: "Set A",
        quantity: 1, monthlyPriceCents: 6000 },
      { estimateId: estimate, serviceAddressId: addressB, packageId, description: "Set B",
        quantity: 1, monthlyPriceCents: 6000 },
    ] });
  });
  afterAll(async () => {
    await prisma.rentalAgreement.deleteMany({ where: { sourceEstimateId: estimate } });
    await prisma.estimate.deleteMany({ where: { id: { in: [estimate,...approvalIds] } } });
    await prisma.rentalPackage.deleteMany({ where: { id: packageId } });
    await prisma.addressTaxLocation.deleteMany({ where: { serviceAddressId: { in: [addressA, addressB] } } });
    await prisma.serviceAddress.deleteMany({ where: { id: { in: [addressA, addressB] } } });
    await prisma.customer.deleteMany({ where: { id: customer } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: [owner, staff] } } });
    await prisma.user.deleteMany({ where: { id: { in: [owner, staff, customerUserId] } } });

  });
  it("denies staff and preserves no-created-shell transactional side effects", async () => {
    await expect(prepareEstimateAgreementsBeforeApproval(staff, estimate,
      { mode: "per-property" })).rejects.toThrow();
    expect(await prisma.rentalAgreement.count({ where: { sourceEstimateId: estimate } })).toBe(0);
  });
  it("creates once, replays idempotently and leaves estimate unapproved/unpaid", async () => {
    const first = await prepareEstimateAgreementsBeforeApproval(owner, estimate, { mode: "per-property" });
    const second = await prepareEstimateAgreementsBeforeApproval(owner, estimate, { mode: "per-property" });
    expect(first).toHaveLength(2);
    expect(second).toEqual(first);
    const quote = await prisma.estimate.findUniqueOrThrow({ where: { id: estimate } });
    expect(quote.status).toBe("DRAFT");
    expect(quote.depositPaidAt).toBeNull();
    expect(quote.reviewedQuoteFingerprint).toBeNull();
    const agreements = await prisma.rentalAgreement.findMany({
      where: { sourceEstimateId: estimate }, select: {
        customerId: true, serviceAddressId: true, status: true,
      },
    });
    expect(agreements).toHaveLength(2);
    expect(agreements.map(a => a.customerId)).toEqual([customer, customer]);
    expect(new Set(agreements.map(a => a.serviceAddressId))).toEqual(new Set([addressA, addressB]));
    expect(agreements.every(a => a.status === "DRAFT")).toBe(true);
    expect(await prisma.auditLog.count({ where: {
      entityId: estimate, action: "estimate.prepare_signing_drafts",
    } })).toBe(1);
  });
  it("atomically adopts the same drafts on concurrent conversion without a second agreement or early invoice credit", async () => {
    const owned = await prisma.rentalAgreement.findMany({
      where: { sourceEstimateId: estimate }, orderBy: { id: "asc" },
    });
    expect(owned).toHaveLength(2);
    const originalIds = owned.map(a => a.id).sort();
    const f = "a".repeat(64), o = "b".repeat(64);
    mockedQuote.mockResolvedValue({
      status: "READY", reasons: [], permissionToCollect: false,
      quoteFingerprint: f, orderFingerprint: o,
      locations: owned.map(a => ({
        agreementId: a.id, serviceAddressId: a.serviceAddressId,
        serviceAddress: "Test service address", monthlyRentCents: 6000,
        monthlyRentTaxCents: 0, setupFeeCents: 0,
        setupTaxCents: 0, advanceCents: 0,
        signingAmountCents: 0, rateVersionIds: [],
      })),
      totals: { monthlyRentCents: 12000, monthlyRentTaxCents: 0,
        setupFeeCents: 0, setupTaxCents: 0, advanceCents: 0,
        dueAtSigningCents: 0 },
    });
    await prisma.estimate.update({ where: { id: estimate }, data: {
      status: "APPROVED", reviewedQuoteFingerprint: f, reviewedOrderFingerprint: o,
      reviewedQuoteAt: new Date(),
    } });
    const [first, second] = await Promise.all([
      convertEstimateToAgreements(owner, estimate, { mode: "per-property" }),
      convertEstimateToAgreements(owner, estimate, { mode: "per-property" }),
    ]);
    expect(first.sort()).toEqual(originalIds);
    expect(second.sort()).toEqual(originalIds);
    expect(await prisma.rentalAgreement.count({ where: { sourceEstimateId: estimate } })).toBe(2);
    expect((await prisma.estimate.findUniqueOrThrow({ where: { id: estimate } })).status).toBe("CONVERTED");
    expect(await prisma.deposit.count({ where: { agreementId: { in: originalIds } } })).toBe(0);
    expect(await prisma.invoice.count({ where: { agreementId: { in: originalIds } } })).toBe(0);
    expect(await prisma.agreementSigningPayment.count({ where: { agreementId: { in: originalIds } } })).toBe(0);
    expect(await prisma.signingDownPaymentCredit.count({ where: { agreementId: { in: originalIds } } })).toBe(0);
    expect(await prisma.signingFirstInvoiceApplication.count({ where: { agreementId: { in: originalIds } } })).toBe(0);
    expect(await prisma.auditLog.count({ where: {
      entityId: estimate, action: "estimate.convert_prepared",
    } })).toBe(1);
  });
  async function replacementOffer() {
    const fingerprint="c".repeat(64),order="d".repeat(64);
    const row=await prisma.estimate.create({data:{customerId:customer,createdByUserId:owner,
      status:"SENT",title:"Replacement offer",reviewedQuoteFingerprint:fingerprint,
      reviewedOrderFingerprint:order,reviewedQuoteAt:new Date()}});
    approvalIds.push(row.id);
    mockedQuote.mockResolvedValue({status:"READY",reasons:[],permissionToCollect:false,
      quoteFingerprint:fingerprint,orderFingerprint:order,locations:[],
      totals:{monthlyRentCents:6000,monthlyRentTaxCents:0,setupFeeCents:0,
        setupTaxCents:0,advanceCents:0,dueAtSigningCents:0}});
    return {id:row.id,fingerprint};
  }
  const customerApproval=(fingerprint:string|undefined)=>({
    expectedQuoteFingerprint:fingerprint as string,
    approverName:"Quote viewer",approverEmail:"viewed@example.test",ipAddress:"127.0.0.1",
  });
  it.each([undefined,"","malformed","a".repeat(64)])("rejects missing, malformed or old viewed revision %s before approval writes",async fingerprint=>{
    const row=await replacementOffer();
    await expect(approveEstimate(row.id,customerApproval(fingerprint))).rejects.toThrow(/reviewed|all-in/i);
    expect(await prisma.estimate.findUniqueOrThrow({where:{id:row.id}}))
      .toMatchObject({status:"SENT",respondedAt:null,approverName:null,depositPaidAt:null});
    expect(await prisma.auditLog.count({where:{entityId:row.id}})).toBe(0);
  });
  it("accepts only the actually viewed current offer in a concurrent old/new tab race",async()=>{
    const row=await replacementOffer();
    const results=await Promise.allSettled([
      approveEstimate(row.id,customerApproval("a".repeat(64))),
      approveEstimate(row.id,customerApproval(row.fingerprint)),
    ]);
    expect(results.map(r=>r.status)).toEqual(["rejected","fulfilled"]);
    expect(await prisma.estimate.findUniqueOrThrow({where:{id:row.id}}))
      .toMatchObject({status:"APPROVED",reviewedQuoteFingerprint:row.fingerprint,approverName:"Quote viewer"});
    expect((await prisma.estimate.findUniqueOrThrow({where:{id:row.id}})).respondedAt).not.toBeNull();
  });
});
