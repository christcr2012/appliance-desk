import { sendPasswordEmail } from "@/lib/password-email";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Staff permissions framework (Task #66, docs/DECISIONS.md 2026-09-28) —
// src/domains/staff's account lifecycle: create (same discarded-random-
// password + activation-email pattern as a customer account, see
// tests/customer-direct-create.test.ts), deactivate (revokes sessions +
// marks archivedAt so requireSession rejects it — src/lib/session.ts),
// and reactivate.

const userFindUnique = vi.fn();
const userCreate = vi.fn();
const userUpdate = vi.fn();
const userFindUniqueOrThrow = vi.fn();
const sessionDeleteMany = vi.fn();
const auditLogCreate = vi.fn();
const hashPassword = vi.fn();
const requestPasswordReset = vi.fn();

function makeTx() {
  return {
    user: {
      findUnique: (...args: unknown[]) => userFindUnique(...args),
      create: (...args: unknown[]) => userCreate(...args),
      update: (...args: unknown[]) => userUpdate(...args),
      findUniqueOrThrow: (...args: unknown[]) => userFindUniqueOrThrow(...args),
    },
    session: { deleteMany: (...args: unknown[]) => sessionDeleteMany(...args) },
    auditLog: { create: (...args: unknown[]) => auditLogCreate(...args) },
  };
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => userFindUnique(...args),
      update: (...args: unknown[]) => userUpdate(...args),
      findUniqueOrThrow: (...args: unknown[]) => userFindUniqueOrThrow(...args),
    },
    session: { deleteMany: (...args: unknown[]) => sessionDeleteMany(...args) },
    auditLog: { create: (...args: unknown[]) => auditLogCreate(...args) },
    $transaction: async (arg: unknown) =>
      typeof arg === "function"
        ? (arg as (tx: ReturnType<typeof makeTx>) => unknown)(makeTx())
        : Promise.all(arg as unknown[]),
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    $context: Promise.resolve({
      password: { hash: (...args: unknown[]) => hashPassword(...args) },
    }),
    api: {
      requestPasswordReset: (...args: unknown[]) => requestPasswordReset(...args),
    },
  },
}));

import {
  createStaffAccount,
  deactivateStaffAccount,
  reactivateStaffAccount,
} from "@/domains/staff";

describe("createStaffAccount", () => {
  beforeEach(() => {
    userFindUnique.mockReset().mockResolvedValue(null);
    userCreate.mockReset().mockResolvedValue({
      id: "staff-1",
      email: "jamie@example.com",
      name: "Jamie Driver",
      role: "STAFF",
    });
    userUpdate.mockReset().mockResolvedValue({ id: "staff-1", role: "STAFF" });
    auditLogCreate.mockReset().mockResolvedValue({});
    hashPassword.mockReset().mockResolvedValue("native-hash");
    requestPasswordReset.mockReset().mockImplementation(async ({ body }) => {
      await sendPasswordEmail({ to: body.email, subject: "Setup", text: "Setup" });
      return { status: true };
    });
  });

  it("creates the credential account transactionally with a discarded random password and emails an activation link", async () => {
    const result = await createStaffAccount("owner-1", {
      name: "Jamie Driver",
      email: "jamie@example.com",
    });

    expect(hashPassword).toHaveBeenCalledTimes(1);
    expect(typeof hashPassword.mock.calls[0][0]).toBe("string");
    expect(hashPassword.mock.calls[0][0].length).toBeGreaterThan(20);

    expect(userCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: "jamie@example.com",
        name: "Jamie Driver",
        role: "STAFF",
        emailVerified: true,
        accounts: {
          create: expect.objectContaining({
            providerId: "credential",
            password: "native-hash",
          }),
        },
      }),
    });
    expect(requestPasswordReset).toHaveBeenCalledWith({
      body: { email: "jamie@example.com", redirectTo: "/reset-password" },
    });
    expect(result.account.id).toBe("staff-1");
    expect(result.activationEmailSent).toBe(true);
  });

  it("refuses to reuse an email that's already in use by any account", async () => {
    userFindUnique.mockResolvedValue({ id: "existing-1", role: "CUSTOMER" });

    await expect(
      createStaffAccount("owner-1", { name: "Jamie Driver", email: "jamie@example.com" }),
    ).rejects.toThrow(/already in use/i);
    expect(userCreate).not.toHaveBeenCalled();
    expect(hashPassword).not.toHaveBeenCalled();
    expect(requestPasswordReset).not.toHaveBeenCalled();
  });

  it("logs a staff.create audit entry before sending the activation email", async () => {
    await createStaffAccount("owner-1", { name: "Jamie Driver", email: "jamie@example.com" });

    expect(auditLogCreate).toHaveBeenCalledWith({
      data: {
        userId: "owner-1",
        action: "staff.create",
        entityType: "User",
        entityId: "staff-1",
        newValue: { email: "jamie@example.com", name: "Jamie Driver" },
      },
    });
    expect(auditLogCreate.mock.invocationCallOrder[0]).toBeLessThan(
      requestPasswordReset.mock.invocationCallOrder[0],
    );
  });
});

describe("deactivateStaffAccount", () => {
  beforeEach(() => {
    userFindUniqueOrThrow.mockReset().mockResolvedValue({ id: "staff-1", role: "STAFF" });
    userUpdate.mockReset().mockResolvedValue({});
    sessionDeleteMany.mockReset().mockResolvedValue({ count: 1 });
    auditLogCreate.mockReset().mockResolvedValue({});
  });

  it("marks the account archived and deletes its live sessions in one transaction", async () => {
    await deactivateStaffAccount("owner-1", "staff-1");

    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "staff-1" },
      data: { archivedAt: expect.any(Date) },
    });
    expect(sessionDeleteMany).toHaveBeenCalledWith({ where: { userId: "staff-1" } });
  });

  it("logs a staff.deactivate audit entry", async () => {
    await deactivateStaffAccount("owner-1", "staff-1");

    expect(auditLogCreate).toHaveBeenCalledWith({
      data: {
        userId: "owner-1",
        action: "staff.deactivate",
        entityType: "User",
        entityId: "staff-1",
      },
    });
  });

  it("refuses to deactivate an account that isn't a staff login (e.g. a customer)", async () => {
    userFindUniqueOrThrow.mockResolvedValue({ id: "cust-1", role: "CUSTOMER" });

    await expect(deactivateStaffAccount("owner-1", "cust-1")).rejects.toThrow(
      /isn't a staff login/i,
    );
    expect(userUpdate).not.toHaveBeenCalled();
  });
});

describe("reactivateStaffAccount", () => {
  beforeEach(() => {
    userFindUniqueOrThrow.mockReset().mockResolvedValue({ id: "staff-1", role: "STAFF" });
    userUpdate.mockReset().mockResolvedValue({});
    auditLogCreate.mockReset().mockResolvedValue({});
  });

  it("clears archivedAt", async () => {
    await reactivateStaffAccount("owner-1", "staff-1");

    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "staff-1" },
      data: { archivedAt: null },
    });
  });
});

vi.mock("@/lib/email", () => ({ sendEmail: vi.fn().mockResolvedValue({ sent: true }) }));