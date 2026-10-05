import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { signAgreement } from "@/domains/agreements";
import {
  canonicalJson,
  createSignedAgreementArtifactInTx,
  freezeFinalInvoiceArtifacts,
  freezeInvoiceArtifact,
  readArtifactForViewer,
  resolveArtifactForViewer,
  sha256Hex,
  statementArtifact,
} from "@/domains/documents/artifacts";
import {
  RENDERER_VERSION,
  renderInvoice,
  renderSignedAgreement,
  renderStatement,
  type InvoicePayload,
  type SignedAgreementPayload,
  type StatementPayload,
} from "@/domains/documents/render";

const business = { name: "Robinson Appliance Rentals", phone: "970-555-0100", email: "hi@example.test", address: "1 Main St, Greeley, CO" };

const agreementPayload: SignedAgreementPayload = {
  agreementId: "agr-1",
  business,
  customerName: "Jane <b>Doe</b>",
  customerEmail: "jane@example.test",
  serviceAddress: "100 Test St, Denver, CO 80201",
  termMonths: 12,
  lines: [{ label: "Washer", monthlyPriceCents: 4000, listPriceCents: 4500, prepayDiscountCentsPerMonth: 500 }],
  monthlyTotalCents: 4000,
  freeMonthGranted: false,
  depositCents: 15000,
  damageWaiverCents: 0,
  lateFeeGraceDays: 5,
  lateFeeCents: 1000,
  lateFeePercent: 0,
  taxRateMilliPercent: 7375,
  terms: { ending: { lines: ["Ending early: no early-ending fee."], termsText: "Plain terms." }, autoRenew: null },
  signerName: "Jane Doe",
  signerEmail: "jane@example.test",
  signerIp: "1.2.3.4",
  signedAtIso: "2026-10-05T15:00:00.000Z",
};

describe("renderers are pure and reproducible", () => {
  it("renders the same payload to the same bytes and the same hash, every time", () => {
    const a = renderSignedAgreement(agreementPayload);
    const b = renderSignedAgreement(structuredClone(agreementPayload));
    expect(a).toBe(b);
    expect(sha256Hex(a)).toBe(sha256Hex(b));
    expect(sha256Hex(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(RENDERER_VERSION).toBe(1);
  });

  it("escapes customer-supplied text and shows money and Denver dates", () => {
    const html = renderSignedAgreement(agreementPayload);
    expect(html).not.toContain("<b>Doe</b>");
    expect(html).toContain("Jane &lt;b&gt;Doe&lt;/b&gt;");
    expect(html).toContain("$40");
    expect(html).toContain("Plain terms.");
    expect(html).toContain('lang="en"');
    expect(html).toContain("October 5, 2026");
  });

  it("invoice and statement renderers include their numbers", () => {
    const inv: InvoicePayload = {
      invoiceId: "i", invoiceNumber: 42, status: "PAID", business, customerName: "Jane", customerCompany: null,
      customerEmail: "j@example.test", propertyAddress: null, billingPeriodStartIso: null, billingPeriodEndIso: null,
      dueDateIso: null, createdAtIso: "2026-10-01T12:00:00.000Z",
      lineItems: [{ description: "Washer rental", quantity: 1, amountCents: 4000 }],
      subtotalCents: 4000, discountCents: 0, taxCents: 295, lateFeeCents: 0, amountDueCents: 4295, amountPaidCents: 4295,
      balanceCents: 0, payments: [],
    };
    expect(renderInvoice(inv)).toContain("Invoice #42");
    const st: StatementPayload = {
      customerId: "c", month: "2026-09", business, customerName: "Jane", customerCompany: null,
      invoices: [{ invoiceNumber: 42, status: "PAID", billingPeriodStartIso: null, amountDueCents: 4295, amountPaidCents: 4295, balanceCents: 0 }],
      totalDueCents: 4295, totalPaidCents: 4295, totalBalanceCents: 0,
    };
    expect(renderStatement(st)).toContain("Statement for 2026-09");
  });

  it("canonicalJson ignores key order", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
  });
});

const RUN = randomUUID().slice(0, 8);
type Fx = { userId: string; customerId: string; addressId: string; agreementId: string; sigId: string; invoiceId: string };
let owner: { id: string };
let a: Fx;
let b: Fx;
let staffUser: { id: string };

async function fixture(label: string): Promise<Fx> {
  const user = await prisma.user.create({
    data: { email: `doc-${label}-${RUN}@example.test`, name: `Doc ${label}`, role: "CUSTOMER", emailVerified: true },
  });
  const customer = await prisma.customer.create({ data: { userId: user.id, referralCode: `DOC${label.toUpperCase()}${RUN}`.slice(0, 20) } });
  const address = await prisma.serviceAddress.create({
    data: { customerId: customer.id, line1: `${label} Doc St`, city: "Denver", zip: "80201" },
  });
  const agreement = await prisma.rentalAgreement.create({
    data: {
      customerId: customer.id, serviceAddressId: address.id, status: "AWAITING_SIGNATURE", termMonths: null,
      depositCents: 5000,
      lines: { create: [{ label: "Washer", monthlyPriceCents: 5000, listPriceCents: 5000 }] },
    },
  });
  const sig = await prisma.signatureRecord.create({ data: { agreementId: agreement.id, provider: "in-house" } });
  const invoice = await prisma.invoice.create({
    data: {
      customerId: customer.id, agreementId: agreement.id, status: "PAID", amountDueCents: 5000, amountPaidCents: 5000,
      subtotalCents: 5000,
      billingPeriodStart: new Date("2026-09-10T12:00:00Z"),
      lineItems: { create: [{ kind: "RENTAL", description: "Washer rental", amountCents: 5000, quantity: 1 }] },
    },
  });
  return { userId: user.id, customerId: customer.id, addressId: address.id, agreementId: agreement.id, sigId: sig.id, invoiceId: invoice.id };
}

async function cleanup(f: Fx) {
  await prisma.documentArtifact.deleteMany({ where: { customerId: f.customerId } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: f.agreementId }, { userId: f.userId }] } });
  await prisma.invoice.deleteMany({ where: { customerId: f.customerId } });
  await prisma.signatureRecord.deleteMany({ where: { agreementId: f.agreementId } });
  await prisma.rentalAgreement.deleteMany({ where: { customerId: f.customerId } });
  await prisma.serviceAddress.deleteMany({ where: { customerId: f.customerId } });
  await prisma.customer.delete({ where: { id: f.customerId } });
  await prisma.user.delete({ where: { id: f.userId } });
}

beforeAll(async () => {
  owner = await prisma.user.findFirstOrThrow({ where: { role: "OWNER" }, select: { id: true } });
  staffUser = await prisma.user.create({
    data: { email: `doc-staff-${RUN}@example.test`, name: "Doc staff", role: "STAFF", emailVerified: true },
  });
  a = await fixture("a");
  b = await fixture("b");
});

afterAll(async () => {
  await cleanup(a);
  await cleanup(b);
  await prisma.user.delete({ where: { id: staffUser.id } });
});

describe("saved copies against a real database", () => {
  it("signing saves the copy in the same step, and later settings changes never alter it", async () => {
    await signAgreement(a.sigId, { signerName: "Ann A", signerEmail: "ann@example.test", ipAddress: "9.9.9.9" });
    const saved = await prisma.documentArtifact.findFirstOrThrow({
      where: { kind: "SIGNED_AGREEMENT", subjectId: a.agreementId },
    });
    expect(saved.version).toBe(1);
    expect(saved.customerId).toBe(a.customerId);
    expect(saved.html).toContain("Ann A");
    expect(saved.html).toContain("9.9.9.9");
    expect(sha256Hex(saved.html)).toBe(saved.sha256);
    // Rendering the stored input again gives the stored text.
    expect(renderSignedAgreement(saved.payload as unknown as SignedAgreementPayload)).toBe(saved.html);

    const before = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" }, select: { publicBusinessName: true } });
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { publicBusinessName: `Renamed ${RUN}` } });
    try {
      const again = await prisma.documentArtifact.findUniqueOrThrow({ where: { id: saved.id } });
      expect(again.html).toBe(saved.html);
      expect(again.sha256).toBe(saved.sha256);
    } finally {
      await prisma.businessSettings.update({ where: { id: "singleton" }, data: { publicBusinessName: before.publicBusinessName } });
    }
    expect(await prisma.documentArtifact.count({ where: { kind: "SIGNED_AGREEMENT", subjectId: a.agreementId } })).toBe(1);
  });

  it("signing rolls back completely when the copy cannot be saved", async () => {
    // A temporary database rule makes the copy's insert fail for this customer only.
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION doc_test_fail_${RUN}() RETURNS trigger AS $$
      BEGIN IF NEW."customerId" = '${b.customerId}' THEN RAISE EXCEPTION 'disk full'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER doc_test_fail_${RUN} BEFORE INSERT ON "DocumentArtifact" FOR EACH ROW EXECUTE FUNCTION doc_test_fail_${RUN}()`,
    );
    try {
      await expect(
        signAgreement(b.sigId, { signerName: "Bo B", signerEmail: "bo@example.test", ipAddress: null }),
      ).rejects.toThrow(/disk full/);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER doc_test_fail_${RUN} ON "DocumentArtifact"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION doc_test_fail_${RUN}()`);
    }
    const sig = await prisma.signatureRecord.findUniqueOrThrow({ where: { id: b.sigId } });
    const ag = await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: b.agreementId } });
    expect(sig.signedAt).toBeNull();
    expect(ag.status).toBe("AWAITING_SIGNATURE");
    expect(await prisma.documentArtifact.count({ where: { subjectId: b.agreementId } })).toBe(0);
  });

  it("createSignedAgreementArtifactInTx is safe to call twice (one copy)", async () => {
    const id1 = await prisma.$transaction((tx) => createSignedAgreementArtifactInTx(tx, a.agreementId));
    const id2 = await prisma.$transaction((tx) => createSignedAgreementArtifactInTx(tx, a.agreementId));
    expect(id1).toBe(id2);
  });

  it("a customer can read only their own copy; staff only the signed agreement; owner everything", async () => {
    const agreementCopy = await prisma.documentArtifact.findFirstOrThrow({ where: { kind: "SIGNED_AGREEMENT", subjectId: a.agreementId } });
    const invoiceCopyId = await freezeInvoiceArtifact(a.invoiceId);
    expect(invoiceCopyId).toBeTruthy();

    expect(await readArtifactForViewer(agreementCopy.id, { userId: a.userId, role: "CUSTOMER" })).not.toBeNull();
    expect(await readArtifactForViewer(agreementCopy.id, { userId: b.userId, role: "CUSTOMER" })).toBeNull();
    expect(await readArtifactForViewer(invoiceCopyId!, { userId: b.userId, role: "CUSTOMER" })).toBeNull();
    expect(await readArtifactForViewer(agreementCopy.id, { userId: staffUser.id, role: "STAFF" })).not.toBeNull();
    expect(await readArtifactForViewer(invoiceCopyId!, { userId: staffUser.id, role: "STAFF" })).toBeNull();
    expect(await readArtifactForViewer(invoiceCopyId!, { userId: owner.id, role: "OWNER" })).not.toBeNull();
    expect(await readArtifactForViewer("does-not-exist", { userId: owner.id, role: "OWNER" })).toBeNull();

    // The find step gives the same answers (nothing is created for someone who may not see it).
    expect(await resolveArtifactForViewer({ userId: b.userId, role: "CUSTOMER" }, { kind: "invoice", id: a.invoiceId })).toBeNull();
    expect(await resolveArtifactForViewer({ userId: b.userId, role: "CUSTOMER" }, { kind: "agreement", id: a.agreementId })).toBeNull();
    expect(await resolveArtifactForViewer({ userId: a.userId, role: "CUSTOMER" }, { kind: "invoice", id: a.invoiceId })).toBe(invoiceCopyId);
  });

  it("a changed final invoice gets version 2 and version 1 stays as it was", async () => {
    const v1 = await freezeInvoiceArtifact(a.invoiceId);
    const first = await prisma.documentArtifact.findUniqueOrThrow({ where: { id: v1! } });
    expect(await freezeInvoiceArtifact(a.invoiceId)).toBe(v1); // unchanged: same copy
    await prisma.invoice.update({ where: { id: a.invoiceId }, data: { status: "REFUNDED" } });
    const v2 = await freezeInvoiceArtifact(a.invoiceId);
    expect(v2).not.toBe(v1);
    const second = await prisma.documentArtifact.findUniqueOrThrow({ where: { id: v2! } });
    expect(second.version).toBe(first.version + 1);
    const stillFirst = await prisma.documentArtifact.findUniqueOrThrow({ where: { id: v1! } });
    expect(stillFirst.html).toBe(first.html);
    expect(second.html).toContain("REFUNDED");
  });

  it("an invoice that is not final gets no copy; the sweep saves missing final copies and is bounded", async () => {
    await prisma.invoice.update({ where: { id: b.invoiceId }, data: { status: "OPEN" } });
    expect(await freezeInvoiceArtifact(b.invoiceId)).toBeNull();
    await prisma.invoice.update({ where: { id: b.invoiceId }, data: { status: "PAID" } });
    const result = await freezeFinalInvoiceArtifacts(200);
    expect(result.failed).toBe(0);
    expect(result.checked).toBeLessThanOrEqual(200);
    expect(await prisma.documentArtifact.count({ where: { kind: "INVOICE", subjectId: b.invoiceId } })).toBe(1);
    const small = await freezeFinalInvoiceArtifacts(1);
    expect(small.checked).toBeLessThanOrEqual(1);
  });

  it("a statement is refused for the current or a future month and saved once for a finished month", async () => {
    const now = new Date();
    const thisMonth = now.toISOString().slice(0, 7);
    const nextYear = `${now.getUTCFullYear() + 1}-01`;
    await expect(statementArtifact(a.customerId, thisMonth)).rejects.toThrow(/month has ended/);
    await expect(statementArtifact(a.customerId, nextYear)).rejects.toThrow(/month has ended/);
    await expect(statementArtifact(a.customerId, "2026-13")).rejects.toThrow(/Choose a month/);
    const id1 = await statementArtifact(a.customerId, "2026-09");
    const id2 = await statementArtifact(a.customerId, "2026-09");
    expect(id1).toBe(id2);
    const saved = await prisma.documentArtifact.findUniqueOrThrow({ where: { id: id1 } });
    expect(saved.html).toContain("Statement for 2026-09");
    expect(canonicalJson(saved.payload)).toContain(`"month":"2026-09"`);
    expect(await readArtifactForViewer(id1, { userId: b.userId, role: "CUSTOMER" })).toBeNull();
    expect(await readArtifactForViewer(id1, { userId: staffUser.id, role: "STAFF" })).toBeNull();
  });
});
