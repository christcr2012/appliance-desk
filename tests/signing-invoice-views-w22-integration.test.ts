import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getInvoiceDetail } from "@/domains/billing/invoice-detail";
import { SIGNING_FIRST_INVOICE_DESCRIPTION } from "@/domains/billing/signing-first-invoice-application";

const db = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && db.pathname === "/appliance_desk_test" &&
  ["localhost", "127.0.0.1"].includes(db.hostname);

// This is a disposable database READ/PRESENTATION fixture, not provider
// acceptance or permission to manufacture signing receipts/credits in product.
describe.skipIf(!enabled)("W-22D12 first-invoice readback and tenant isolation", () => {
  const token = randomUUID().replaceAll("-", "");
  let a: string, b: string, aUser: string, bUser: string;
  let first: string, pending: string, sibling: string, foreign: string, draft: string;
  const agreementIds: string[] = [];
  const addressIds: string[] = [];
  const invoiceIds: string[] = [];

  beforeAll(async () => {
    async function customer(suffix: string) {
      const user = await prisma.user.create({
        data: { email: "w22-d12-" + suffix + "-" + token + "@example.test", name: suffix, role: "CUSTOMER", emailVerified: true },
      });
      const c = await prisma.customer.create({
        data: { userId: user.id, referralCode: ("W22D12" + suffix + token).slice(0, 40) },
      });
      return { c: c.id, user: user.id };
    }
    const own = await customer("A");
    const other = await customer("B");
    a = own.c; b = other.c; aUser = own.user; bUser = other.user;

    async function agreement(customerId: string, number: number) {
      const address = await prisma.serviceAddress.create({
        data: { customerId, line1: number + " Invoice Test St", city: "Greeley", state: "CO", zip: "80631" },
      });
      addressIds.push(address.id);
      const rental = await prisma.rentalAgreement.create({ data: {
        customerId, serviceAddressId: address.id, status: "ACTIVE",
      } });
      agreementIds.push(rental.id);
      return rental.id;
    }
    const a1 = await agreement(a, 100);
    const a2 = await agreement(a, 200);
    const b1 = await agreement(b, 300);
    async function invoice(customerId: string, agreementId: string, kind: "credited" | "pending", status = "OPEN") {
      const credited = kind === "credited";
      const inv = await prisma.invoice.create({ data: {
        customerId, agreementId, status: status as "OPEN" | "DRAFT",
        stripeInvoiceId: "in_w22d12_" + randomUUID().replaceAll("-", ""),
        subtotalCents: credited ? 0 : 6000,
        taxCents: 480, amountDueCents: credited ? 480 : 6480,
        lineItems: { create: [
          { kind: "RENTAL", description: "First month's rental", amountCents: 6000 },
          ...(credited ? [{ kind: "CREDIT" as const, description: SIGNING_FIRST_INVOICE_DESCRIPTION, amountCents: -6000 }] : []),
          { kind: "TAX" as const, description: "Sales tax", amountCents: 480 },
        ] },
      } });
      invoiceIds.push(inv.id);
      return inv.id;
    }
    first = await invoice(a, a1, "credited");
    pending = await invoice(a, a1, "pending");
    sibling = await invoice(a, a2, "pending");
    foreign = await invoice(b, b1, "pending");
    draft = await invoice(a, a1, "pending", "DRAFT");
  });

  afterAll(async () => {
    if (!a) return;
    await prisma.payment.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    await prisma.rentalAgreement.deleteMany({ where: { id: { in: agreementIds } } });
    await prisma.serviceAddress.deleteMany({ where: { id: { in: addressIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: [a, b] } } });
    await prisma.user.deleteMany({ where: { id: { in: [aUser, bUser] } } });
  });

  it("shows exactly one matching mirrored signing line without deducting it from already-net amount due again", async () => {
    const detail = await getInvoiceDetail(first, { customerId: a });
    expect(detail).not.toBeNull();
    expect(detail).toMatchObject({
      status: "OPEN", subtotalCents: 0, taxCents: 480,
      amountDueCents: 480, amountPaidCents: 0, balanceCents: 480,
      propertyAddress: expect.stringContaining("100 Invoice Test St"),
    });
    expect(detail?.lineItems.filter(l => l.kind === "CREDIT")).toEqual([
      expect.objectContaining({ amountCents: -6000, description: SIGNING_FIRST_INVOICE_DESCRIPTION }),
    ]);
    expect(detail?.lineItems.reduce((sum, l) => sum + l.amountCents, 0)).toBe(480);
    expect(detail?.isLocalInvoice).toBe(false);
  });

  it("records actual separate invoice payment, without applying the signing credit a second time", async () => {
    await prisma.payment.create({ data: { invoiceId: first, amountCents: 480, method: "card", status: "SUCCEEDED" } });
    await prisma.invoice.update({ where: { id: first }, data: { amountPaidCents: 480, status: "PAID" } });
    const detail = await getInvoiceDetail(first, { customerId: a });
    expect(detail).toMatchObject({ amountDueCents: 480, amountPaidCents: 480, balanceCents: 0, status: "PAID" });
    expect(detail?.lineItems.filter(l => l.kind === "CREDIT")).toHaveLength(1);
    expect(detail?.payments).toEqual([expect.objectContaining({ amountCents: 480, status: "SUCCEEDED" })]);
  });

  it("does not infer signing credit or paid state from a pending or sibling invoice", async () => {
    for (const id of [pending, sibling]) {
      const detail = await getInvoiceDetail(id, { customerId: a });
      expect(detail).toMatchObject({ amountDueCents: 6480, amountPaidCents: 0, balanceCents: 6480, status: "OPEN" });
      expect(detail?.lineItems.some(l => l.kind === "CREDIT")).toBe(false);
    }
    expect((await getInvoiceDetail(sibling, { customerId: a }))?.propertyAddress).toContain("200 Invoice Test St");
  });

  it("hides other tenants and drafts, including direct-URL guesses", async () => {
    expect(await getInvoiceDetail(foreign, { customerId: a })).toBeNull();
    expect(await getInvoiceDetail(first, { customerId: b })).toBeNull();
    expect(await getInvoiceDetail(draft, { customerId: a })).toBeNull();
    expect((await getInvoiceDetail(draft))?.status).toBe("DRAFT");
    expect((await getInvoiceDetail(foreign, { customerId: b }))?.customer.id).toBe(b);
  });
});
