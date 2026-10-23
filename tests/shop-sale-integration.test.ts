import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createShopSale, cancelShopSale, SaleTaxBlockedError } from "@/domains/sales";
import { WALK_IN_EMAIL } from "@/domains/sales/walk-in";
import { PartOperationConflictError, findPartLedgerMismatches } from "@/domains/purchasing/ledger";
import { getCustomers, getCustomersCount, getCustomersPage } from "@/domains/customers";
import { seedTaxReadyContext } from "./helpers/tax-ready";

// Batch M, M-1C: a shop sale is a local invoice with stock taken out, taxed by where the goods go.
const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(target.hostname)
  && target.pathname === "/appliance_desk_test";
const key = () => `sale-${randomUUID()}`;

describe.skipIf(!enabled)("shop sales on real Postgres", () => {
  const tag = randomUUID().slice(0, 8);
  const shopJurisdictionId = `sale-shop-${tag}`;
  const shopLocationId = `sale-shop-loc-${tag}`;
  const userId = `sale-user-${tag}`;
  const customerId = `sale-cust-${tag}`;
  const addressId = `sale-addr-${tag}`;
  let ownerId: string;
  let deliveryTax: Awaited<ReturnType<typeof seedTaxReadyContext>>;
  let previousShopLocations: string[] = [];
  let originalElection: "UNDECIDED" | "PAY_ON_ACQUISITION" | "COLLECT_ON_RENTALS" = "UNDECIDED";

  const newPart = async (opts: { quantity?: number; price?: number | null; sellable?: boolean } = {}) => {
    const id = (await prisma.partRecord.create({
      data: {
        modelNumber: `SALE-${tag}-${randomUUID().slice(0, 6)}`, partNumber: tag, partName: "Dryer hose",
        quantityOnHand: 0, sellable: opts.sellable ?? true, retailPriceCents: opts.price === undefined ? 1000 : opts.price,
      },
    })).id;
    if (opts.quantity) {
      await prisma.$transaction(async (tx) => {
        const { applyPartMovementsInTx } = await import("@/domains/purchasing/ledger");
        await applyPartMovementsInTx(tx, ownerId, key(), [{ partRecordId: id, kind: "ADJUSTMENT", quantityDelta: opts.quantity!, unitCostCents: null }]);
      });
    }
    return id;
  };
  const stock = async (id: string) => (await prisma.partRecord.findUniqueOrThrow({ where: { id } })).quantityOnHand;

  beforeAll(async () => {
    ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    originalElection = (await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" }, select: { shortTermLeaseElection: true } })).shortTermLeaseElection;
    await prisma.user.create({ data: { id: userId, email: `${tag}-sale@example.test`, name: "Sale Customer", role: "CUSTOMER", emailVerified: true } });
    await prisma.customer.create({ data: { id: customerId, userId, referralCode: `S${tag.slice(0, 18)}` } });
    await prisma.serviceAddress.create({ data: { id: addressId, customerId, line1: "9 Delivery Rd", city: "Greeley", zip: "80631" } });
    // The customer's address is taxed at 8%; the shop at 5%.
    deliveryTax = await seedTaxReadyContext(addressId, { rateMilliPercent: 8000 });
    previousShopLocations = (await prisma.addressTaxLocation.findMany({ where: { forBusinessLocation: true, isCurrent: true }, select: { id: true } })).map((r) => r.id);
    await prisma.addressTaxLocation.updateMany({ where: { id: { in: previousShopLocations } }, data: { isCurrent: false } });
    await prisma.taxJurisdiction.create({ data: { id: shopJurisdictionId, code: `SALE-${tag}`, name: "Shop City", level: "CITY", administration: "STATE_COLLECTED", reviewStatus: "REVIEWED" } });
    await prisma.taxRateVersion.create({ data: { jurisdictionId: shopJurisdictionId, rateMilliPercent: 5000, effectiveFrom: new Date("2020-01-01T07:00:00Z"), source: "MANUAL" } });
    for (const category of ["MERCHANDISE", "DELIVERY", "INSTALLATION"] as const) {
      await prisma.taxabilityRule.create({ data: { jurisdictionId: shopJurisdictionId, category, taxability: "TAXABLE", reason: "test" } });
    }
    await prisma.addressTaxLocation.create({
      data: { id: shopLocationId, forBusinessLocation: true, isCurrent: true, status: "VERIFIED", source: "MANUAL", lookedUpAt: new Date(), jurisdictions: { create: [{ jurisdictionId: shopJurisdictionId }] } },
    });
  });

  afterAll(async () => {
    // Sales keep tax evidence that points at these rate rows, so the fixtures stay (tagged); only the shared
    // settings are put back: the shop's current tax address and the rental election.
    await prisma.addressTaxLocation.update({ where: { id: shopLocationId }, data: { isCurrent: false } });
    await prisma.addressTaxLocation.updateMany({ where: { id: { in: previousShopLocations } }, data: { isCurrent: true } });
    await prisma.addressTaxLocation.updateMany({ where: { serviceAddressId: addressId }, data: { isCurrent: false } });
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { shortTermLeaseElection: originalElection } });
  });

  it("a pickup is taxed at the shop's areas, takes stock once, and a retry changes nothing", async () => {
    const part = await newPart({ quantity: 10 });
    const input = { operationKey: key(), customerId: null, walkInName: "Dave", location: "PICKUP" as const, items: [{ partRecordId: part, quantity: 3, unitPriceCents: 1000 }] };
    const first = await createShopSale(ownerId, input);
    expect(first).toMatchObject({ subtotalCents: 3000, taxCents: 150, amountDueCents: 3150, replayed: false });
    expect(await stock(part)).toBe(7);

    const again = await createShopSale(ownerId, input);
    expect(again).toMatchObject({ invoiceId: first.invoiceId, replayed: true });
    expect(await stock(part)).toBe(7);

    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: first.invoiceId }, include: { lineItems: true, taxLines: true, customer: true } });
    expect(invoice).toMatchObject({ status: "OPEN", saleKind: "SHOP_SALE", saleLocation: "PICKUP", walkInName: "Dave" });
    expect(invoice.customer.isWalkIn).toBe(true);
    expect(invoice.lineItems.find((l) => l.kind === "MERCHANDISE")).toMatchObject({ amountCents: 3000, quantity: 3, partRecordId: part });
    expect(invoice.taxLines).toHaveLength(1);
    expect(invoice.taxLines[0]).toMatchObject({ category: "MERCHANDISE", taxCents: 150, jurisdictionId: shopJurisdictionId });

    const movement = await prisma.partStockMovement.findFirstOrThrow({ where: { partRecordId: part, kind: "SALE" } });
    expect(movement).toMatchObject({ quantityDelta: -3, invoiceLineId: invoice.lineItems.find((l) => l.kind === "MERCHANDISE")!.id });
    expect(await findPartLedgerMismatches(prisma, [part])).toEqual([]);

    await expect(createShopSale(ownerId, { ...input, items: [{ partRecordId: part, quantity: 2, unitPriceCents: 1000 }] })).rejects.toBeInstanceOf(PartOperationConflictError);
    expect(await stock(part)).toBe(7);
  });

  it("a delivered sale is taxed at the customer's address, including the delivery charge", async () => {
    const part = await newPart({ quantity: 5 });
    const sale = await createShopSale(ownerId, {
      operationKey: key(), customerId, location: "DELIVERED", serviceAddressId: addressId,
      items: [{ partRecordId: part, quantity: 2, unitPriceCents: 2500 }], deliveryChargeCents: 1000,
    });
    // 5000 + 1000 delivery at 8%
    expect(sale).toMatchObject({ subtotalCents: 6000, taxCents: 480, amountDueCents: 6480 });
    const lines = await prisma.invoiceTaxLine.findMany({ where: { invoiceId: sale.invoiceId } });
    expect(lines.map((l) => l.category).sort()).toEqual(["DELIVERY", "MERCHANDISE"]);
    expect(lines.every((l) => l.jurisdictionId === deliveryTax.jurisdictionId)).toBe(true);
  });

  it("refuses, and saves nothing, when stock is short, the item is not for sale, or the price is lowered without a reason", async () => {
    const few = await newPart({ quantity: 1 });
    await expect(createShopSale(ownerId, { operationKey: key(), customerId: null, location: "PICKUP", items: [{ partRecordId: few, quantity: 2, unitPriceCents: 1000 }] })).rejects.toThrow(/Only 1/);
    const notForSale = await newPart({ quantity: 5, sellable: false });
    await expect(createShopSale(ownerId, { operationKey: key(), customerId: null, location: "PICKUP", items: [{ partRecordId: notForSale, quantity: 1, unitPriceCents: 1000 }] })).rejects.toThrow(/Sell to customers/);
    await expect(createShopSale(ownerId, { operationKey: key(), customerId: null, location: "PICKUP", items: [{ partRecordId: few, quantity: 1, unitPriceCents: 500 }] })).rejects.toThrow(/Say why/);
    const ok = await createShopSale(ownerId, { operationKey: key(), customerId: null, location: "PICKUP", items: [{ partRecordId: few, quantity: 1, unitPriceCents: 500, priceReason: "Scratched box" }] });
    expect(ok.subtotalCents).toBe(500);
    expect(await stock(few)).toBe(0);
    expect(await stock(notForSale)).toBe(5);
    await expect(createShopSale(ownerId, { operationKey: key(), customerId: null, location: "PICKUP", items: [{ partRecordId: few, quantity: 1, unitPriceCents: 500, priceReason: "x" }] })).rejects.toThrow(/Only 0/);
  });

  it("walk-ins are pickup only; a delivery needs a customer and one of their own addresses", async () => {
    const part = await newPart({ quantity: 3 });
    await expect(createShopSale(ownerId, { operationKey: key(), customerId: null, location: "DELIVERED", items: [{ partRecordId: part, quantity: 1, unitPriceCents: 1000 }] })).rejects.toThrow(/customer with an address/);
    await expect(createShopSale(ownerId, { operationKey: key(), customerId, location: "DELIVERED", serviceAddressId: "nope", items: [{ partRecordId: part, quantity: 1, unitPriceCents: 1000 }] })).rejects.toThrow(/doesn't belong/);
    await expect(createShopSale(ownerId, { operationKey: key(), customerId, location: "PICKUP", items: [{ partRecordId: part, quantity: 1, unitPriceCents: 1000 }], installationChargeCents: 500 })).rejects.toThrow(/pickup sale has no/);
    expect(await stock(part)).toBe(3);
  });

  it("uncertain tax refuses the whole sale with plain reasons and leaves stock and invoices alone", async () => {
    const part = await newPart({ quantity: 4 });
    await prisma.taxabilityRule.update({ where: { jurisdictionId_category: { jurisdictionId: shopJurisdictionId, category: "MERCHANDISE" } }, data: { taxability: "UNDECIDED" } });
    const before = await prisma.invoice.count({ where: { saleKind: "SHOP_SALE" } });
    try {
      await expect(createShopSale(ownerId, { operationKey: key(), customerId: null, location: "PICKUP", items: [{ partRecordId: part, quantity: 1, unitPriceCents: 1000 }] }))
        .rejects.toBeInstanceOf(SaleTaxBlockedError);
    } finally {
      await prisma.taxabilityRule.update({ where: { jurisdictionId_category: { jurisdictionId: shopJurisdictionId, category: "MERCHANDISE" } }, data: { taxability: "TAXABLE" } });
    }
    expect(await stock(part)).toBe(4);
    expect(await prisma.invoice.count({ where: { saleKind: "SHOP_SALE" } })).toBe(before);
  });

  it("two first sales at once create exactly one built-in walk-in customer with no login", async () => {
    const part = await newPart({ quantity: 6 });
    await Promise.all([1, 2, 3].map(() => createShopSale(ownerId, { operationKey: key(), customerId: null, location: "PICKUP", items: [{ partRecordId: part, quantity: 1, unitPriceCents: 1000 }] })));
    const walkIns = await prisma.customer.findMany({ where: { isWalkIn: true }, include: { user: { include: { accounts: true } } } });
    expect(walkIns).toHaveLength(1);
    expect(walkIns[0]!.archivedAt).not.toBeNull();
    expect(walkIns[0]!.user).toMatchObject({ email: WALK_IN_EMAIL, role: "CUSTOMER", passwordHash: null });
    expect(walkIns[0]!.user.accounts).toHaveLength(0);
    expect(await stock(part)).toBe(3);
    await expect(prisma.customer.create({ data: { userId: (await prisma.user.create({ data: { email: `${tag}-w2@customers.invalid`, role: "CUSTOMER" } })).id, isWalkIn: true, referralCode: `W${tag}2` } })).rejects.toThrow();
  });

  it("the walk-in customer never appears in customer lists or counts, but its sales appear in the Sales list", async () => {
    const part = await newPart({ quantity: 2 });
    await createShopSale(ownerId, { operationKey: key(), customerId: null, walkInName: "Pat", location: "PICKUP", items: [{ partRecordId: part, quantity: 1, unitPriceCents: 1000 }] });
    const walkIn = await prisma.customer.findFirstOrThrow({ where: { isWalkIn: true } });
    expect((await getCustomers()).some((c) => c.id === walkIn.id)).toBe(false);
    const total = await getCustomersCount();
    const pages = await getCustomersPage(0, total + 5);
    expect(pages.some((c) => c.id === walkIn.id)).toBe(false);
    expect(pages.length).toBe(total);
  });

  it("cancelling an unpaid sale voids it and restocks; a paid sale is refused; a second cancel changes nothing", async () => {
    const part = await newPart({ quantity: 5 });
    const sale = await createShopSale(ownerId, { operationKey: key(), customerId: null, walkInName: "Lee", location: "PICKUP", items: [{ partRecordId: part, quantity: 3, unitPriceCents: 1000 }] });
    expect(await stock(part)).toBe(2);
    await expect(cancelShopSale(ownerId, sale.invoiceId, "  ")).rejects.toThrow(/why/);
    const done = await cancelShopSale(ownerId, sale.invoiceId, "Customer changed their mind");
    expect(done).toMatchObject({ restocked: 3, alreadyCancelled: false });
    expect(await stock(part)).toBe(5);
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: sale.invoiceId } });
    expect(invoice).toMatchObject({ status: "VOID", amountDueCents: 0 });
    expect(await cancelShopSale(ownerId, sale.invoiceId, "again")).toMatchObject({ alreadyCancelled: true, restocked: 0 });
    expect(await stock(part)).toBe(5);
    expect(await findPartLedgerMismatches(prisma, [part])).toEqual([]);

    const paid = await createShopSale(ownerId, { operationKey: key(), customerId: null, location: "PICKUP", items: [{ partRecordId: part, quantity: 1, unitPriceCents: 1000 }] });
    await prisma.invoice.update({ where: { id: paid.invoiceId }, data: { amountPaidCents: 500, status: "PARTIALLY_PAID" } });
    await expect(cancelShopSale(ownerId, paid.invoiceId, "oops")).rejects.toThrow(/paid/);
    expect(await stock(part)).toBe(4);
  });
});
