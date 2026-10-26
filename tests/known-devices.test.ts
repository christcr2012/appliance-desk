import { createHash } from "node:crypto";
import { describe, it, expect, vi, beforeEach } from "vitest";

// The domain modules are imported dynamically inside the tests (after the fakes below are ready). A static
// import here would load them — and the mocked prisma — before this file's top-level code has run.
const hashDeviceCookie = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

// Unit tests with fakes (AGENTS.md section 4): the database is an in-memory stand-in behind the same calls the
// domain code makes, and the fake's $transaction hands the callback the same tx. The real sign-in flow through
// the library is covered by tests/trusted-devices-integration.test.ts on throwaway Postgres.

const sendAccountNotice = vi.fn();
const sendCustomerAccountNotice = vi.fn();

vi.mock("@/domains/account", () => ({
  sendAccountNotice: (...args: unknown[]) => sendAccountNotice(...args),
  sendCustomerAccountNotice: (...args: unknown[]) => sendCustomerAccountNotice(...args),
}));

// account-provisioning imports the real auth config; only the email normalizer is needed here.
vi.mock("@/lib/account-provisioning", () => ({
  normalizeAccountEmail: (email: string) => email.trim().toLowerCase(),
}));

type DeviceRow = {
  id: string; userId: string; deviceHash: string; label: string;
  firstSeenAt: Date; lastSeenAt: Date; trustedUntil: Date | null; forgottenAt: Date | null;
};
type VerificationRow = { id: string; identifier: string; value: string; expiresAt: Date; createdAt: Date };

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  for (const [key, expected] of Object.entries(where)) {
    const actual = row[key];
    if (expected !== null && typeof expected === "object") {
      const cond = expected as Record<string, unknown>;
      if ("startsWith" in cond && (typeof actual !== "string" || !actual.startsWith(String(cond.startsWith)))) return false;
      if ("gt" in cond && (!(actual instanceof Date) || !(cond.gt instanceof Date) || actual.getTime() <= cond.gt.getTime())) return false;
      if ("gte" in cond && (!(actual instanceof Date) || !(cond.gte instanceof Date) || actual.getTime() < cond.gte.getTime())) return false;
      if ("not" in cond && cond.not === null && actual === null) return false;
      if ("not" in cond && cond.not !== null && actual === cond.not) return false;
    } else if (actual !== expected) return false;
  }
  return true;
}

const fake = (() => {
  const users = new Map<string, { id: string; email: string; role: string }>();
  const devices = new Map<string, DeviceRow>();
  const verifications = new Map<string, VerificationRow>();
  const audit: Record<string, unknown>[] = [];
  let settings = { trustedDeviceDays: 30 };
  let seq = 0;
  const nextId = () => `fake-${++seq}`;
  const tx: Record<string, unknown> = {
    $queryRaw: async () => [],
    user: {
      findUnique: async ({ where }: { where: Record<string, unknown> }) => {
        if (typeof where.id === "string") return users.get(where.id) ?? null;
        if (typeof where.email === "string") return [...users.values()].find((u) => u.email === where.email) ?? null;
        return null;
      },
    },
    knownDevice: {
      findUnique: async ({ where }: { where: { userId_deviceHash: { userId: string; deviceHash: string } } }) =>
        devices.get(`${where.userId_deviceHash.userId}:${where.userId_deviceHash.deviceHash}`) ?? null,
      count: async ({ where }: { where: { userId: string } }) =>
        [...devices.values()].filter((d) => d.userId === where.userId).length,
      upsert: async ({ where, create, update }: {
        where: { userId_deviceHash: { userId: string; deviceHash: string } };
        create: { userId: string; deviceHash: string; label: string };
        update: Partial<DeviceRow>;
      }) => {
        const key = `${where.userId_deviceHash.userId}:${where.userId_deviceHash.deviceHash}`;
        const existing = devices.get(key);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row: DeviceRow = {
          id: nextId(), firstSeenAt: new Date(), lastSeenAt: new Date(), trustedUntil: null, forgottenAt: null, ...create,
        };
        devices.set(key, row);
        return row;
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<DeviceRow> }) => {
        let count = 0;
        for (const row of devices.values()) if (matches(row as unknown as Record<string, unknown>, where)) { Object.assign(row, data); count++; }
        return { count };
      },
    },
    verification: {
      findFirst: async ({ where, orderBy }: { where: Record<string, unknown>; orderBy?: { createdAt: string } }) => {
        const rows = [...verifications.values()].filter((r) => matches(r as unknown as Record<string, unknown>, where));
        if (orderBy?.createdAt === "desc") rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return rows[0] ?? null;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<VerificationRow> }) => {
        const row = verifications.get(where.id);
        if (!row) throw new Error("verification row not found");
        Object.assign(row, data);
        return row;
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<VerificationRow> }) => {
        let count = 0;
        for (const row of verifications.values()) if (matches(row as unknown as Record<string, unknown>, where)) { Object.assign(row, data); count++; }
        return { count };
      },
      deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
        let count = 0;
        for (const [key, row] of [...verifications.entries()]) {
          if (matches(row as unknown as Record<string, unknown>, where)) { verifications.delete(key); count++; }
        }
        return { count };
      },
    },
    businessSettings: {
      findUnique: async () => ({ ...settings }),
      upsert: async ({ update }: { update: Partial<typeof settings> }) => {
        settings = { ...settings, ...update };
        return settings;
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        audit.push(data);
        return data;
      },
    },
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(tx),
  };
  return {
    tx, users, devices, verifications, audit,
    setDays: (days: number) => { settings.trustedDeviceDays = days; },
    reset: () => {
      users.clear();
      devices.clear();
      verifications.clear();
      audit.length = 0;
      settings = { trustedDeviceDays: 30 };
      users.set("owner-1", { id: "owner-1", email: "owner@test", role: "OWNER" });
      users.set("customer-1", { id: "customer-1", email: "customer@test", role: "CUSTOMER" });
    },
    seedDevice: (userId: string, cookie: string, trustedUntil: Date | null) => {
      const row: DeviceRow = {
        id: nextId(), userId, deviceHash: hashDeviceCookie(cookie), label: "iPhone · Safari",
        firstSeenAt: new Date(), lastSeenAt: new Date(), trustedUntil, forgottenAt: null,
      };
      devices.set(`${userId}:${row.deviceHash}`, row);
      return row;
    },
    seedTrustRow: (identifier: string, userId: string, expiresAt: Date) => {
      // Created at the fixed test time, so the "newest row" clamp (rows made in the last minute) finds it.
      const row: VerificationRow = { id: nextId(), identifier, value: userId, expiresAt, createdAt: NOW };
      verifications.set(row.id, row);
      return row;
    },
  };
})();

vi.mock("@/lib/prisma", () => ({ prisma: fake.tx }));

const CHROME = "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17) Safari/604.1";
const NOW = new Date("2026-10-25T12:00:00Z");

beforeEach(() => {
  fake.reset();
  sendAccountNotice.mockReset();
  sendCustomerAccountNotice.mockReset();
  sendAccountNotice.mockResolvedValue("SENT");
  sendCustomerAccountNotice.mockResolvedValue("SENT");
});

describe("noteCompletedSignIn", () => {
  it("records the first sign-in and sends nothing", async () => {
    const { noteCompletedSignIn } = await import("@/domains/security/sign-in-guard");
    expect(await noteCompletedSignIn("owner-1", CHROME, "device-a")).toBe("first");
    expect(sendAccountNotice).not.toHaveBeenCalled();
    expect(fake.devices.size).toBe(1);
  });

  it("recognises the same device cookie even when the browser label changes", async () => {
    const { noteCompletedSignIn } = await import("@/domains/security/sign-in-guard");
    expect(await noteCompletedSignIn("owner-1", CHROME, "device-a")).toBe("first");
    expect(await noteCompletedSignIn("owner-1", IPHONE, "device-a")).toBe("known");
    expect(sendAccountNotice).not.toHaveBeenCalled();
    expect(fake.devices.size).toBe(1);
  });

  it("notices a new device once, and a second phone of the same kind is new", async () => {
    const { noteCompletedSignIn } = await import("@/domains/security/sign-in-guard");
    await noteCompletedSignIn("owner-1", CHROME, "device-a");
    expect(await noteCompletedSignIn("owner-1", IPHONE, "device-b")).toBe("new");
    expect(sendAccountNotice).toHaveBeenCalledTimes(1);
    expect(sendAccountNotice).toHaveBeenCalledWith("owner-1", "new_device", { extra: "iPhone · Safari" });
    expect(await noteCompletedSignIn("owner-1", IPHONE, "device-b")).toBe("known");
    expect(await noteCompletedSignIn("owner-1", IPHONE, "device-c")).toBe("new");
    expect(sendAccountNotice).toHaveBeenCalledTimes(2);
  });

  it("notices a customer through the customer notice, and skips unknown people", async () => {
    const { noteCompletedSignIn } = await import("@/domains/security/sign-in-guard");
    expect(await noteCompletedSignIn("customer-1", CHROME, "device-a")).toBe("first");
    expect(await noteCompletedSignIn("customer-1", IPHONE, "device-b")).toBe("new");
    expect(sendCustomerAccountNotice).toHaveBeenCalledTimes(1);
    expect(sendCustomerAccountNotice).toHaveBeenCalledWith("customer-1", "new_device", { extra: "iPhone · Safari" });
    expect(sendAccountNotice).not.toHaveBeenCalled();
    expect(await noteCompletedSignIn("no-such-user", CHROME, "device-a")).toBe("skipped");
  });

  it("falls back to the device label when no cookie is given", async () => {
    const { noteCompletedSignIn } = await import("@/domains/security/sign-in-guard");
    expect(await noteCompletedSignIn("owner-1", CHROME, null)).toBe("first");
    expect(await noteCompletedSignIn("owner-1", CHROME, null)).toBe("known");
    expect(await noteCompletedSignIn("owner-1", IPHONE, null)).toBe("new");
  });
});

describe("enforceTrustedDeviceGate", () => {
  it("leaves a remembered device alone", async () => {
    const { enforceTrustedDeviceGate } = await import("@/domains/security/trusted-devices");
    fake.seedDevice("owner-1", "device-a", new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000));
    fake.seedTrustRow("trust-device-abc", "owner-1", new Date(NOW.getTime() + 90 * 24 * 60 * 60 * 1000));
    await enforceTrustedDeviceGate({
      email: "owner@test", trustCookieValue: "sometoken!trust-device-abc", deviceCookie: "device-a", now: NOW,
    });
    expect(fake.verifications.size).toBe(1);
  });

  it("removes the trust row when the remembered-until date passed", async () => {
    const { enforceTrustedDeviceGate } = await import("@/domains/security/trusted-devices");
    fake.seedDevice("owner-1", "device-a", new Date(NOW.getTime() - 24 * 60 * 60 * 1000));
    fake.seedTrustRow("trust-device-abc", "owner-1", new Date(NOW.getTime() + 90 * 24 * 60 * 60 * 1000));
    await enforceTrustedDeviceGate({
      email: "owner@test", trustCookieValue: "sometoken!trust-device-abc", deviceCookie: "device-a", now: NOW,
    });
    expect(fake.verifications.size).toBe(0);
  });

  it("removes the trust row when the device cookie is missing", async () => {
    const { enforceTrustedDeviceGate } = await import("@/domains/security/trusted-devices");
    fake.seedDevice("owner-1", "device-a", new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000));
    fake.seedTrustRow("trust-device-abc", "owner-1", new Date(NOW.getTime() + 90 * 24 * 60 * 60 * 1000));
    await enforceTrustedDeviceGate({
      email: "owner@test", trustCookieValue: "sometoken!trust-device-abc", deviceCookie: null, now: NOW,
    });
    expect(fake.verifications.size).toBe(0);
  });

  it("does nothing without a trust cookie, for a malformed one, for an expired row, or for another person's row", async () => {
    const { enforceTrustedDeviceGate } = await import("@/domains/security/trusted-devices");
    fake.seedDevice("owner-1", "device-a", new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000));
    fake.seedTrustRow("trust-device-abc", "owner-1", new Date(NOW.getTime() + 90 * 24 * 60 * 60 * 1000));
    fake.seedTrustRow("trust-device-old", "owner-1", new Date(NOW.getTime() - 1000));
    fake.seedTrustRow("trust-device-other", "customer-1", new Date(NOW.getTime() + 90 * 24 * 60 * 60 * 1000));
    await enforceTrustedDeviceGate({ email: "owner@test", trustCookieValue: null, deviceCookie: "device-a", now: NOW });
    await enforceTrustedDeviceGate({ email: "owner@test", trustCookieValue: "garbage", deviceCookie: "device-a", now: NOW });
    await enforceTrustedDeviceGate({ email: "owner@test", trustCookieValue: "token!trust-device-old", deviceCookie: "device-a", now: NOW });
    await enforceTrustedDeviceGate({ email: "owner@test", trustCookieValue: "token!trust-device-other", deviceCookie: "device-a", now: NOW });
    expect(fake.verifications.size).toBe(3);
  });

  it("never throws when the database fails", async () => {
    const { enforceTrustedDeviceGate } = await import("@/domains/security/trusted-devices");
    const findFirst = (fake.tx.verification as { findFirst: unknown }).findFirst;
    (fake.tx.verification as { findFirst: unknown }).findFirst = async () => { throw new Error("database down"); };
    try {
      await expect(enforceTrustedDeviceGate({
        email: "owner@test", trustCookieValue: "token!trust-device-abc", deviceCookie: "device-a", now: NOW,
      })).resolves.toBeUndefined();
    } finally {
      (fake.tx.verification as { findFirst: unknown }).findFirst = findFirst;
    }
  });
});

describe("shouldStripTrustDevice", () => {
  it("leaves a request that does not ask to remember alone", async () => {
    const { shouldStripTrustDevice } = await import("@/domains/security/trusted-devices");
    expect(await shouldStripTrustDevice({ trustDevice: false, sessionUserId: null, twoFactorCookieValue: null })).toBe(false);
    expect(await shouldStripTrustDevice({ trustDevice: undefined, sessionUserId: null, twoFactorCookieValue: null })).toBe(false);
  });

  it("strips when remembering is off, without needing to know who is signing in", async () => {
    const { shouldStripTrustDevice } = await import("@/domains/security/trusted-devices");
    fake.setDays(0);
    expect(await shouldStripTrustDevice({ trustDevice: true, sessionUserId: null, twoFactorCookieValue: null })).toBe(true);
  });

  it("strips for a customer and not for a team member", async () => {
    const { shouldStripTrustDevice } = await import("@/domains/security/trusted-devices");
    fake.seedTrustRow("2fa-owner", "owner-1", new Date(NOW.getTime() + 600_000));
    fake.seedTrustRow("2fa-customer", "customer-1", new Date(NOW.getTime() + 600_000));
    expect(await shouldStripTrustDevice({ trustDevice: true, sessionUserId: null, twoFactorCookieValue: "2fa-owner" })).toBe(false);
    expect(await shouldStripTrustDevice({ trustDevice: true, sessionUserId: null, twoFactorCookieValue: "2fa-customer" })).toBe(true);
    expect(await shouldStripTrustDevice({ trustDevice: true, sessionUserId: "owner-1", twoFactorCookieValue: null })).toBe(false);
    expect(await shouldStripTrustDevice({ trustDevice: true, sessionUserId: "customer-1", twoFactorCookieValue: null })).toBe(true);
  });

  it("does not strip when the person cannot be worked out, and never throws", async () => {
    const { shouldStripTrustDevice } = await import("@/domains/security/trusted-devices");
    expect(await shouldStripTrustDevice({ trustDevice: true, sessionUserId: null, twoFactorCookieValue: "2fa-unknown" })).toBe(false);
    const findUnique = (fake.tx.businessSettings as { findUnique: unknown }).findUnique;
    (fake.tx.businessSettings as { findUnique: unknown }).findUnique = async () => { throw new Error("database down"); };
    try {
      await expect(shouldStripTrustDevice({ trustDevice: true, sessionUserId: null, twoFactorCookieValue: null })).resolves.toBe(false);
    } finally {
      (fake.tx.businessSettings as { findUnique: unknown }).findUnique = findUnique;
    }
  });
});

describe("completeSignInFollowUp", () => {
  it("sets the device cookie when missing and records the device", async () => {
    const { completeSignInFollowUp } = await import("@/domains/security/sign-in-guard");
    const setDeviceCookie = vi.fn();
    await completeSignInFollowUp({
      userId: "owner-1", userAgent: CHROME, trustDeviceRequested: false, trustCookiePresented: false,
      deviceCookie: null, setDeviceCookie, now: NOW,
    });
    expect(setDeviceCookie).toHaveBeenCalledTimes(1);
    expect(setDeviceCookie.mock.calls[0]![0]).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(fake.devices.size).toBe(1);
  });

  it("remembers a ticked device for the owner's days and clamps the library row to the same date", async () => {
    const { completeSignInFollowUp } = await import("@/domains/security/sign-in-guard");
    const row = fake.seedTrustRow("trust-device-new", "owner-1", new Date(NOW.getTime() + 90 * 24 * 60 * 60 * 1000));
    await completeSignInFollowUp({
      userId: "owner-1", userAgent: IPHONE, trustDeviceRequested: true, trustCookiePresented: false,
      deviceCookie: "device-a", setDeviceCookie: () => undefined, now: NOW,
    });
    const device = [...fake.devices.values()][0]!;
    expect(device.trustedUntil).toEqual(new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000));
    expect(row.expiresAt).toEqual(new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000));
  });

  it("forgets everything when remembering is off", async () => {
    const { completeSignInFollowUp } = await import("@/domains/security/sign-in-guard");
    fake.setDays(0);
    fake.seedDevice("owner-1", "device-a", new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000));
    fake.seedTrustRow("trust-device-new", "owner-1", new Date(NOW.getTime() + 90 * 24 * 60 * 60 * 1000));
    await completeSignInFollowUp({
      userId: "owner-1", userAgent: IPHONE, trustDeviceRequested: true, trustCookiePresented: false,
      deviceCookie: "device-a", setDeviceCookie: () => undefined, now: NOW,
    });
    expect(fake.verifications.size).toBe(0);
    expect([...fake.devices.values()][0]!.trustedUntil).toBeNull();
    expect(fake.audit.some((row) => row.action === "security.trusted_devices_forgotten")).toBe(true);
  });

  it("clamps a rotated trust row to the device's remembered-until date, never extending it", async () => {
    const { completeSignInFollowUp } = await import("@/domains/security/sign-in-guard");
    const rememberedUntil = new Date(NOW.getTime() + 10 * 24 * 60 * 60 * 1000);
    fake.seedDevice("owner-1", "device-a", rememberedUntil);
    const row = fake.seedTrustRow("trust-device-rotated", "owner-1", new Date(NOW.getTime() + 90 * 24 * 60 * 60 * 1000));
    await completeSignInFollowUp({
      userId: "owner-1", userAgent: IPHONE, trustDeviceRequested: false, trustCookiePresented: true,
      deviceCookie: "device-a", setDeviceCookie: () => undefined, now: NOW,
    });
    expect(row.expiresAt).toEqual(rememberedUntil);
    expect([...fake.devices.values()][0]!.trustedUntil).toEqual(rememberedUntil);
  });

  it("never fails the sign-in when the follow-up itself fails", async () => {
    const { completeSignInFollowUp } = await import("@/domains/security/sign-in-guard");
    await expect(completeSignInFollowUp({
      userId: "owner-1", userAgent: CHROME, trustDeviceRequested: false, trustCookiePresented: false,
      deviceCookie: null, setDeviceCookie: () => { throw new Error("cookies unavailable"); }, now: NOW,
    })).resolves.toBeUndefined();
    const upsert = (fake.tx.knownDevice as { upsert: unknown }).upsert;
    (fake.tx.knownDevice as { upsert: unknown }).upsert = async () => { throw new Error("database down"); };
    try {
      await expect(completeSignInFollowUp({
        userId: "owner-1", userAgent: CHROME, trustDeviceRequested: false, trustCookiePresented: false,
        deviceCookie: "device-a", setDeviceCookie: () => undefined, now: NOW,
      })).resolves.toBeUndefined();
    } finally {
      (fake.tx.knownDevice as { upsert: unknown }).upsert = upsert;
    }
  });
});
