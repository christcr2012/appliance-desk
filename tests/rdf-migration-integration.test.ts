import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { businessDateFromKey } from "@/lib/business-date";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";
const day = (key: string) => businessDateFromKey(key)!;

describe.skipIf(!enabled)("T-6C1 RDF migration integrity (real PostgreSQL)", () => {
  it("persists an unready record, blocks unsupported parents and amount-less READY state", async () => {
    const tag = randomUUID();
    const recordId = "rdf-" + tag;
    const invoiceId = "rdf-invoice-" + tag;
    const userId = "rdf-user-" + tag;
    const customerId = "rdf-customer-" + tag;
    let seedOk = false;
    try {
      await prisma.user.create({
        data: { id: userId, email: "rdf-" + tag + "@example.test", name: "RDF fixture",
          role: "OWNER", passwordHash: "test-only" },
      });
      await prisma.customer.create({ data: { id: customerId, userId, referralCode: "RDF-" + tag } });
      await prisma.invoice.create({
        data: { id: invoiceId, customerId, amountDueCents: 0 },
      });
      seedOk = true;
      const pending = await prisma.retailDeliveryFeeRecord.create({
        data: {
          id: recordId, saleKey: "retail:" + invoiceId, invoiceId,
          deliveredOn: day("2026-10-01"), status: "PENDING_RATE",
        },
      });
      expect(pending.status).toBe("PENDING_RATE");
      await expect(prisma.retailDeliveryFeeRecord.create({
        data: {
          saleKey: "retail:" + invoiceId + ":no-rate", invoiceId,
          deliveredOn: day("2026-10-01"), status: "READY",
        },
      })).rejects.toThrow();
      await expect(prisma.retailDeliveryFeeRecord.create({
        data: {
          saleKey: "retail:" + invoiceId + ":bad-parent",
          deliveredOn: day("2026-10-01"), status: "NOT_DUE",
        },
      })).rejects.toThrow();
      await expect(prisma.retailDeliveryFeeRecord.create({
        data: {
          saleKey: "retail:" + invoiceId + ":negative", invoiceId,
          deliveredOn: day("2026-10-01"),
          status: "PENDING_DECISION", amountCents: -1,
        },
      })).rejects.toThrow();
      expect(await prisma.retailDeliveryFeeRecord.count({ where: { id: recordId } })).toBe(1);
    } finally {
      if (seedOk) {
        await prisma.retailDeliveryFeeRecord.deleteMany({ where: { invoiceId } });
        await prisma.invoice.deleteMany({ where: { id: invoiceId } });
      }
      await prisma.customer.deleteMany({ where: { id: customerId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
  });

  it("keeps the schema additive and enforces versioned amount constraints", async () => {
    const constraints = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT conname AS name FROM pg_constraint
      WHERE conrelid IN ('"RetailDeliveryFeeRecord"'::regclass, '"RetailDeliveryFeeRate"'::regclass)
      ORDER BY conname
    `;
    const names = constraints.map(row => row.name);
    for (const expected of [
      "RetailDeliveryFeeRecord_parent_check",
      "RetailDeliveryFeeRecord_nonnegative_amount",
      "RetailDeliveryFeeRecord_ready_requires_evidence",
      "RetailDeliveryFeeRate_amount_nonnegative",
    ]) expect(names).toContain(expected);
    expect(Prisma.ModelName.RetailDeliveryFeeRecord).toBe("RetailDeliveryFeeRecord");
  });
});
