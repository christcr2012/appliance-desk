import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { POST } from "@/app/api/auth/[...all]/route";
import { createCustomerDirectly } from "@/domains/customers";
import { convertLeadToCustomer } from "@/domains/leads";

const target = new URL(
  process.env.DATABASE_URL ?? "postgresql://localhost/unset",
);
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(target.hostname) &&
  target.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("invite-only account provisioning", () => {
  const tag = randomUUID();
  const cleanupUserIds: string[] = [];
  const cleanupLeadIds: string[] = [];
  const cleanupCustomerIds: string[] = [];
  let ownerId: string;

  beforeAll(async () => {
    ownerId = (
      await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })
    ).id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { entityId: { in: [...cleanupLeadIds, ...cleanupCustomerIds] } },
    });
    await prisma.serviceAddress.deleteMany({
      where: { customerId: { in: cleanupCustomerIds } },
    });
    await prisma.customer.deleteMany({
      where: { id: { in: cleanupCustomerIds } },
    });
    await prisma.lead.deleteMany({ where: { id: { in: cleanupLeadIds } } });
    await prisma.account.deleteMany({ where: { userId: { in: cleanupUserIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: cleanupUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: cleanupUserIds } } });
  });

  it("rejects the real anonymous Better Auth email-signup route and creates no User", async () => {
    const email = `anonymous-signup-${tag}@example.test`;
    const request = new Request(
      "http://localhost:3000/api/auth/sign-up/email",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          email,
          password: "Anonymous-Password-That-Must-Not-Work-123!",
          name: "Anonymous Signup",
        }),
      },
    );

    const response = await POST(request);
    expect(response.ok).toBe(false);
    expect(
      await prisma.user.findUnique({ where: { email } }),
    ).toBeNull();
  });

  it("direct customer creation refuses a legacy unattached CUSTOMER credential instead of adopting it", async () => {
    const email = `unattached-direct-${tag}@example.test`;
    const user = await prisma.user.create({
      data: {
        email,
        name: "Unattached Direct",
        role: "CUSTOMER",
        emailVerified: true,
      },
    });
    cleanupUserIds.push(user.id);

    await expect(
      createCustomerDirectly(ownerId, {
        name: "Real Direct Customer",
        email,
        isBusiness: false,
        isPropertyManager: false,
        addresses: [
          { line1: "1 Security Way", city: "Greeley", zip: "80631" },
        ],
      }),
    ).rejects.toThrow(/unattached login/i);

    expect(
      await prisma.customer.findUnique({ where: { userId: user.id } }),
    ).toBeNull();
  });

  it("lead conversion rolls back its claim when the matching CUSTOMER login is unattached", async () => {
    const email = `unattached-lead-${tag}@example.test`;
    const user = await prisma.user.create({
      data: {
        email,
        name: "Unattached Lead",
        role: "CUSTOMER",
        emailVerified: true,
      },
    });
    cleanupUserIds.push(user.id);
    const lead = await prisma.lead.create({
      data: {
        contactName: "Real Lead Customer",
        phone: "9705550100",
        email,
      },
    });
    cleanupLeadIds.push(lead.id);

    await expect(convertLeadToCustomer(ownerId, lead.id)).rejects.toThrow(
      /unattached login/i,
    );

    const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after.status).toBe("NEW");
    expect(after.convertedCustomerId).toBeNull();
    expect(
      await prisma.customer.findUnique({ where: { userId: user.id } }),
    ).toBeNull();
  });

  it("trusted direct provisioning still creates a real credential account and business records atomically", async () => {
    const email = `trusted-direct-${tag}@example.test`;
    const result = await createCustomerDirectly(ownerId, {
      name: "Trusted Customer",
      email,
      phone: "9705550101",
      isBusiness: false,
      isPropertyManager: false,
      addresses: [
        { line1: "2 Security Way", city: "Greeley", zip: "80631" },
      ],
    });

    cleanupCustomerIds.push(result.customer.id);
    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      include: { accounts: true },
    });
    cleanupUserIds.push(user.id);

    expect(user.role).toBe("CUSTOMER");
    expect(user.emailVerified).toBe(true);
    expect(user.accounts).toHaveLength(1);
    expect(user.accounts[0]).toMatchObject({
      providerId: "credential",
      accountId: user.id,
    });
    expect(user.accounts[0]?.password).toBeTruthy();
    expect(result.serviceAddresses).toHaveLength(1);
    expect(
      await prisma.auditLog.count({
        where: { entityId: result.customer.id, action: "customer.create" },
      }),
    ).toBe(1);
  });
});
