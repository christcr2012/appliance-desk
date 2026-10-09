import { randomUUID } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const role = vi.hoisted(() => ({ current: "OWNER" }));
vi.mock("@/lib/session", () => ({
  requireRole: vi.fn(async (...allowed: string[]) => {
    if (!allowed.includes(role.current)) throw new Error("Forbidden");
    return { user: { id: "w0b-test-owner", role: role.current } };
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { prisma } from "@/lib/prisma";
import PendingDeliveryFeesPage from "@/app/desk/sales-tax/delivery-fees/page";
import { retryPendingDeliveryFees } from "@/app/desk/sales-tax/delivery-fees/actions";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";
const suffix = randomUUID();
const keyDecision = "w0b-decision-" + suffix;
const keyRate = "w0b-rate-" + suffix;
let userId = "", customerId = "";
const invoiceIds: string[] = [];
const date = (value: string) => new Date(value + "T12:00:00.000Z");

describe.skipIf(!enabled)("W-0B pending delivery fee review (Postgres)", () => {
  beforeAll(async () => {
    const user = await prisma.user.create({ data: {
      email: "w0b-" + suffix + "@example.test", name: "W0B Rental Customer",
      role: "CUSTOMER", passwordHash: "test-only",
    } });
    userId = user.id;
    const customer = await prisma.customer.create({ data: { userId, companyName: "W0B Test Customer", referralCode: "W0B-" + suffix.slice(0, 8) } });
    customerId = customer.id;
    const invoice1 = await prisma.invoice.create({ data: { customerId, amountDueCents: 0 } });
    const invoice2 = await prisma.invoice.create({ data: { customerId, amountDueCents: 0 } });
    invoiceIds.push(invoice1.id, invoice2.id);
    await prisma.retailDeliveryFeeRecord.createMany({ data: [
      { saleKey: keyDecision, invoiceId: invoice1.id, status: "PENDING_DECISION",
        deliveredOn: date("2026-07-02"), saleOn: date("2026-07-01") },
      { saleKey: keyRate, invoiceId: invoice2.id, status: "PENDING_RATE",
        deliveredOn: date("2026-07-05"), saleOn: date("2026-07-04") },
    ] });
  });
  afterAll(async () => {
    await prisma.retailDeliveryFeeRecord.deleteMany({ where: { saleKey: { in: [keyDecision, keyRate] } } });
    if (invoiceIds.length) await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    if (customerId) await prisma.customer.delete({ where: { id: customerId } });
    if (userId) await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("lists separate decision and rate groups with oldest dates and setup links", async () => {
    role.current = "OWNER";
    const html = renderToStaticMarkup(await PendingDeliveryFeesPage());
    expect(html).toContain("Waiting for your decision");
    expect(html).toContain("Waiting for this year");
    expect(html).toContain("2026-07-02");
    expect(html).toContain("2026-07-05");
    expect(html).toContain("W0B Test Customer");
    expect(html).toContain("/desk/sales-tax/setup#fee");
    expect(html).toContain("/desk/sales-tax/setup#fee-rates");
  });

  it("rechecks without changing unresolved records and reports still waiting", async () => {
    role.current = "OWNER";
    const state = await retryPendingDeliveryFees({ error: "", success: "" }, new FormData());
    expect(state.error).toBe("");
    expect(state.success).toMatch(/still waiting/);
    const saved = await prisma.retailDeliveryFeeRecord.findMany({
      where: { saleKey: { in: [keyDecision, keyRate] } },
      select: { status: true },
    });
    expect(saved.map(row => row.status).sort()).toEqual(["PENDING_DECISION", "PENDING_RATE"]);
  });

  it("rejects staff both for the page and the recovery action", async () => {
    role.current = "STAFF";
    await expect(PendingDeliveryFeesPage()).rejects.toThrow("Forbidden");
    const state = await retryPendingDeliveryFees({ error: "", success: "" }, new FormData());
    expect(state.error).not.toBe("");
    role.current = "OWNER";
  });
});
