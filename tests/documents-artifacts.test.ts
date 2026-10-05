import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { signAgreement } from "@/domains/agreements";
import {
  freezeInvoiceArtifact,
  readArtifactForViewer,
} from "@/domains/documents/artifacts";
import {
  renderInvoice,
  renderSignedAgreement,
  type InvoicePayload,
  type SignedAgreementPayload,
} from "@/domains/documents/render";

const databaseUrl = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(databaseUrl.hostname) &&
  databaseUrl.pathname === "/appliance_desk_test";

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

describe.skipIf(!enabled)("Batch D evidence artifacts (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ids = {
    userA: `d9-user-a-${tag}`,
    userB: `d9-user-b-${tag}`,
    staff: `d9-staff-${tag}`,
    customerA: `d9-customer-a-${tag}`,
    customerB: `d9-customer-b-${tag}`,
    addressA: `d9-address-a-${tag}`,
    addressB: `d9-address-b-${tag}`,
    agreementA: `d9-agreement-a-${tag}`,
    agreementFail: `d9-agreement-fail-${tag}`,
    invoiceB: `d9-invoice-b-${tag}`,
    statementB: `d9-statement-b-${tag}`,
  };

  let signatureA = "";
  let signatureFail = "";
  let originalBusinessName = "";

  async function createAgreement(
    id: string,
    customerId: string,
    serviceAddressId: string,
    label: string,
  ): Promise<string> {
    await prisma.rentalAgreement.create({
      data: {
        id,
        customerId,
        serviceAddressId,
        status: "AWAITING_SIGNATURE",
        termMonths: 12,
        depositCents: 10000,
        damageWaiverCents: 1200,
        lateFeeGraceDays: 5,
        lateFeeCents: 1500,
        taxRateMilliPercent: 7250,
      },
    });
    await prisma.rentalLine.create({
      data: {
        agreementId: id,
        label,
        listPriceCents: 4500,
        monthlyPriceCents: 4000,
        prepayDiscountCentsPerMonth: 500,
      },
    });
    const signature = await prisma.signatureRecord.create({
      data: { agreementId: id, provider: "typed_signature" },
      select: { id: true },
    });
    return signature.id;
  }

  beforeAll(async () => {
    const settings = await prisma.businessSettings.findUniqueOrThrow({
      where: { id: "singleton" },
      select: { publicBusinessName: true },
    });
    originalBusinessName = settings.publicBusinessName;

    await prisma.user.createMany({
      data: [
        { id: ids.userA, email: `${tag}-a@example.test`, name: "Artifact A", role: "CUSTOMER", emailVerified: true },
        { id: ids.userB, email: `${tag}-b@example.test`, name: "Artifact B", role: "CUSTOMER", emailVerified: true },
        { id: ids.staff, email: `${tag}-staff@example.test`, name: "Artifact Staff", role: "STAFF", emailVerified: true },
      ],
    });
    await prisma.customer.createMany({
      data: [
        { id: ids.customerA, userId: ids.userA, referralCode: `D9A${tag.slice(0, 12)}` },
        { id: ids.customerB, userId: ids.userB, referralCode: `D9B${tag.slice(0, 12)}` },
      ],
    });
    await prisma.serviceAddress.createMany({
      data: [
        { id: ids.addressA, customerId: ids.customerA, line1: "100 Evidence Ave", city: "Greeley", state: "CO", zip: "80631" },
        { id: ids.addressB, customerId: ids.customerB, line1: "200 Evidence Ave", city: "Greeley", state: "CO", zip: "80631" },
      ],
    });

    signatureA = await createAgreement(ids.agreementA, ids.customerA, ids.addressA, "Washer");
    signatureFail = await createAgreement(ids.agreementFail, ids.customerB, ids.addressB, "Dryer");

    await prisma.invoice.create({
      data: {
        id: ids.invoiceB,
        customerId: ids.customerB,
        status: "PAID",
        subtotalCents: 10000,
        amountDueCents: 10000,
        amountPaidCents: 10000,
        lineItems: {
          create: { kind: "RENTAL", description: "October rental", amountCents: 10000, quantity: 1 },
        },
      },
    });
  });

  afterAll(async () => {
    await prisma.businessSettings.update({
      where: { id: "singleton" },
      data: { publicBusinessName: originalBusinessName },
    });
    await prisma.documentArtifact.deleteMany({ where: { customerId: { in: [ids.customerA, ids.customerB] } } });
    await prisma.invoice.deleteMany({ where: { id: ids.invoiceB } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: [ids.agreementA, ids.agreementFail] } } });
    await prisma.signatureRecord.deleteMany({ where: { agreementId: { in: [ids.agreementA, ids.agreementFail] } } });
    await prisma.rentalLine.deleteMany({ where: { agreementId: { in: [ids.agreementA, ids.agreementFail] } } });
    await prisma.rentalAgreement.deleteMany({ where: { id: { in: [ids.agreementA, ids.agreementFail] } } });
    await prisma.serviceAddress.deleteMany({ where: { id: { in: [ids.addressA, ids.addressB] } } });
    await prisma.customer.deleteMany({ where: { id: { in: [ids.customerA, ids.customerB] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ids.userA, ids.userB, ids.staff] } } });
  });

  it("renders the same frozen payload to the same sha256", () => {
    const payload: InvoicePayload = {
      invoiceId: "invoice-fixed",
      invoiceNumber: 42,
      status: "PAID",
      business: { name: "Robinson Appliance Rentals", phone: "970-555-0100", email: "billing@example.test", address: "Greeley, CO" },
      customer: { name: "Test Customer", companyName: null, email: "customer@example.test" },
      propertyAddress: "100 Test St, Greeley, CO 80631",
      createdAt: "2026-09-05T18:00:00.000Z",
      dueDate: "2026-09-10T18:00:00.000Z",
      billingPeriodStart: "2026-09-01T06:00:00.000Z",
      billingPeriodEnd: "2026-10-01T06:00:00.000Z",
      lineItems: [{ description: "Washer rental", quantity: 1, amountCents: 4000 }],
      subtotalCents: 4000,
      discountCents: 0,
      taxCents: 0,
      lateFeeCents: 0,
      amountDueCents: 4000,
      amountPaidCents: 4000,
      balanceCents: 0,
    };
    const first = renderInvoice(payload);
    const second = renderInvoice(payload);
    expect(first).toBe(second);
    expect(hash(first)).toBe(hash(second));
    expect(first).toContain('<html lang="en">');
    expect(first).toContain("#123C2D");
  });

  it("keeps signed evidence unchanged after business settings change", async () => {
    await signAgreement(signatureA, {
      signerName: "Artifact A",
      signerEmail: `${tag}-a@example.test`,
      ipAddress: "192.0.2.10",
    });
    const frozen = await prisma.documentArtifact.findFirstOrThrow({
      where: { kind: "SIGNED_AGREEMENT", subjectId: ids.agreementA },
      select: { id: true, html: true, sha256: true, payload: true },
    });

    const changedName = `Changed after signing ${tag}`;
    await prisma.businessSettings.update({
      where: { id: "singleton" },
      data: { publicBusinessName: changedName },
    });
    try {
      const after = await prisma.documentArtifact.findUniqueOrThrow({
        where: { id: frozen.id },
        select: { html: true, sha256: true, payload: true },
      });
      expect(after.html).toBe(frozen.html);
      expect(after.sha256).toBe(frozen.sha256);
      expect(after.html).not.toContain(changedName);
      const rerendered = renderSignedAgreement(after.payload as unknown as SignedAgreementPayload);
      expect(hash(rerendered)).toBe(after.sha256);
    } finally {
      await prisma.businessSettings.update({
        where: { id: "singleton" },
        data: { publicBusinessName: originalBusinessName },
      });
    }
  });

  it("rolls signing back when the signed artifact insert fails", async () => {
    const fn = `d9_artifact_fail_${tag}`;
    const trigger = `d9_artifact_fail_trigger_${tag}`;
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION "${fn}"() RETURNS trigger AS $$ BEGIN IF NEW."subjectId" = '${ids.agreementFail}' THEN RAISE EXCEPTION 'simulated artifact failure'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER "${trigger}" BEFORE INSERT ON "DocumentArtifact" FOR EACH ROW EXECUTE FUNCTION "${fn}"()`,
    );
    try {
      await expect(
        signAgreement(signatureFail, {
          signerName: "Artifact B",
          signerEmail: `${tag}-b@example.test`,
          ipAddress: "192.0.2.20",
        }),
      ).rejects.toBeDefined();
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${trigger}" ON "DocumentArtifact"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${fn}"()`);
    }

    const [signature, agreement, artifacts] = await Promise.all([
      prisma.signatureRecord.findUniqueOrThrow({ where: { id: signatureFail }, select: { signedAt: true } }),
      prisma.rentalAgreement.findUniqueOrThrow({ where: { id: ids.agreementFail }, select: { status: true } }),
      prisma.documentArtifact.count({ where: { kind: "SIGNED_AGREEMENT", subjectId: ids.agreementFail } }),
    ]);
    expect(signature.signedAt).toBeNull();
    expect(agreement.status).toBe("AWAITING_SIGNATURE");
    expect(artifacts).toBe(0);
  });

  it("keeps customer and staff document reads isolated", async () => {
    const invoiceArtifactId = await freezeInvoiceArtifact(ids.invoiceB);
    expect(invoiceArtifactId).not.toBeNull();

    const statement = await prisma.documentArtifact.create({
      data: {
        id: ids.statementB,
        kind: "STATEMENT",
        subjectType: "CustomerStatement",
        subjectId: `${ids.customerB}:2026-09`,
        customerId: ids.customerB,
        version: 1,
        payload: { month: "2026-09" },
        html: "<!doctype html><html lang=\"en\"><body>private statement</body></html>",
        sha256: hash("<!doctype html><html lang=\"en\"><body>private statement</body></html>"),
        rendererVersion: 1,
      },
      select: { id: true },
    });

    await expect(
      readArtifactForViewer(invoiceArtifactId!, { userId: ids.userA, role: "CUSTOMER" }),
    ).resolves.toBeNull();
    await expect(
      readArtifactForViewer(invoiceArtifactId!, { userId: ids.staff, role: "STAFF" }),
    ).resolves.toBeNull();
    await expect(
      readArtifactForViewer(statement.id, { userId: ids.staff, role: "STAFF" }),
    ).resolves.toBeNull();
    await expect(
      readArtifactForViewer(invoiceArtifactId!, { userId: ids.userB, role: "CUSTOMER" }),
    ).resolves.toMatchObject({ filename: expect.stringContaining("invoice-") });
  });

  it("creates a new immutable invoice version when a frozen final invoice later changes", async () => {
    const firstId = await freezeInvoiceArtifact(ids.invoiceB);
    expect(firstId).not.toBeNull();
    await prisma.invoice.update({
      where: { id: ids.invoiceB },
      data: { status: "REFUNDED" },
    });
    const secondId = await freezeInvoiceArtifact(ids.invoiceB);
    expect(secondId).not.toBeNull();
    expect(secondId).not.toBe(firstId);

    const versions = await prisma.documentArtifact.findMany({
      where: { kind: "INVOICE", subjectId: ids.invoiceB },
      orderBy: { version: "asc" },
      select: { version: true, sha256: true, html: true },
    });
    expect(versions.map((row) => row.version)).toEqual([1, 2]);
    expect(versions[0].sha256).not.toBe(versions[1].sha256);
    expect(versions[0].html).toContain("PAID");
    expect(versions[1].html).toContain("REFUNDED");
  });
});
