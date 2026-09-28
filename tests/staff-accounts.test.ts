import { describe, it, expect, vi, beforeEach } from "vitest";

// Staff permissions framework (Task #66, docs/DECISIONS.md 2026-09-28) —
// src/domains/staff's account lifecycle: create (same discarded-random-
// password + activation-email pattern as a customer account, see
// tests/customer-direct-create.test.ts), deactivate (revokes sessions +
// marks archivedAt so requireSession rejects it — src/lib/session.ts),
// and reactivate.

const userFindUnique = vi.fn();
const userUpdate = vi.fn();
const userFindUniqueOrThrow = vi.fn();
const sessionDeleteMany = vi.fn();
const auditLogCreate = vi.fn();
const signUpEmail = vi.fn();
const requestPasswordReset = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => userFindUnique(...args),
      update: (...args: unknown[]) => userUpdate(...args),
      findUniqueOrThrow: (...args: unknown[]) => userFindUniqueOrThrow(...args),
    },
    session: { deleteMany: (...args: unknown[]) => sessionDeleteMany(...args) },
    auditLog: { create: (...args: unknown[]) => auditLogCreate(...args) },
    $transaction: async (ops: unknown[]) => Promise.all(ops),
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      signUpEmail: (...args: unknown[]) => signUpEmail(...args),
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
    userUpdate.mockReset().mockResolvedValue({ id: "staff-1", role: "STAFF" });
    auditLogCreate.mockReset().mockResolvedValue({});
    signUpEmail.mockReset().mockResolvedValue({ user: { id: "staff-1" } });
    requestPasswordReset.mockReset().mockResolvedValue({ status: true });
  });

  it("creates the account with a discarded random password, sets role STAFF, and emails an activation link", async () => {
    const result = await createStaffAccount("owner-1", {
      name: "Jamie Driver",
      email: "jamie@example.com",
    });

    expect(signUpEmail).toHaveBeenCalledTimes(1);
    const signUpArgs = signUpEmail.mock.calls[0][0];
    expect(signUpArgs.body.email).toBe("jamie@example.com");
    expect(typeof signUpArgs.body.password).toBe("string");
    expect(signUpArgs.body.password.length).toBeGreaterThan(20);

    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "staff-1" },
      data: { role: "STAFF", emailVerified: true },
    });
    expect(result.activationEmailSent).toBe(true);
  });

  it("refuses to reuse an email that's already in use by any account", async () => {
    userFindUnique.mockResolvedValue({ id: "existing-1", role: "CUSTOMER" });

    await expect(
      createStaffAccount("owner-1", { name: "Jamie Driver", email: "jamie@example.com" }),
    ).rejects.toThrow(/already in use/i);
    expect(signUpEmail).not.toHaveBeenCalled();
  });

  it("logs a staff.create audit entry", async () => {
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
