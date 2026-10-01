import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { hashPassword, verifyPassword } from "better-auth/crypto";
const reset = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ auth: {
  $context: Promise.resolve({ password: { hash: (password: string) => hashPassword(password) } }),
  api: { requestPasswordReset: reset },
} }));
import { prisma } from "@/lib/prisma";
import { convertLeadToCustomer, updateLeadStatus } from "@/domains/leads";

// Disposable CI Postgres only; never creates fixtures or attempts rollback on Neon.
const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(url.hostname)
  && url.pathname === "/appliance_desk_test";
describe.skipIf(!enabled)("lead conversion atomic recovery", () => {
  const tag = randomUUID();
  const leadIds: string[] = [];
  let ownerId: string;
  const emails = [0, 1, 2].map(i => `conversion-${tag}-${i}@example.com`);
  beforeAll(async () => {
    ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    for (const email of emails) {
      const lead = await prisma.lead.create({ data: { contactName: "Conversion fixture", email: email.toUpperCase(), phone: "5551234567", status: "NEW" } });
      leadIds.push(lead.id);
    }
    reset.mockImplementation(async ({ body }) => {
      // Sending is permitted only after both the customer and conversion commit.
      expect(await prisma.customer.count({ where: { user: { email: body.email } } })).toBe(1);
      expect(await prisma.lead.count({ where: { email: { equals: body.email, mode: "insensitive" }, status: "CONVERTED" } })).toBe(1);
    });
  });
  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: leadIds } } });
    await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
    await prisma.customer.deleteMany({ where: { user: { email: { in: emails } } } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
  });
  it("overlapping new-account conversions commit one credential/customer and send once", async () => {
    reset.mockClear();
    const results = await Promise.allSettled([
      convertLeadToCustomer(ownerId, leadIds[0]), convertLeadToCustomer(ownerId, leadIds[0]),
    ]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(reset).toHaveBeenCalledTimes(1);
    const account = await prisma.user.findUniqueOrThrow({ where: { email: emails[0] }, include: { accounts: true } });
    expect(account.role).toBe("CUSTOMER");
    expect(account.accounts).toHaveLength(1);
    expect(account.accounts[0]).toMatchObject({ providerId: "credential", accountId: account.id });
    expect(await verifyPassword({ hash: account.accounts[0].password!, password: "an unrelated password" })).toBe(false);
    expect(await prisma.customer.count({ where: { userId: account.id } })).toBe(1);
  });
  it("an audit failure rolls back the claimed lead, account and customer without an email", async () => {
    reset.mockClear();
    await expect(convertLeadToCustomer(`missing-${tag}`, leadIds[1])).rejects.toThrow();
    expect(await prisma.user.count({ where: { email: emails[1] } })).toBe(0);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadIds[1] } })).status).toBe("NEW");
    expect(reset).not.toHaveBeenCalled();
    await convertLeadToCustomer(ownerId, leadIds[1]);
    expect(reset).toHaveBeenCalledTimes(1);
  });
  it("reopening a lost lead clears the persisted reason", async () => {
    await updateLeadStatus(ownerId, leadIds[2], "LOST", "No longer needed");
    await updateLeadStatus(ownerId, leadIds[2], "CONTACTED");
    expect(await prisma.lead.findUniqueOrThrow({ where: { id: leadIds[2] } })).toMatchObject({ status: "CONTACTED", lostReason: null });
  });
});
