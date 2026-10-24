import type { Prisma } from "@prisma/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { initializeTestingSettings } from "../prisma/testing-settings";

beforeEach(() => {
  vi.stubEnv("APP_ENV", "testing"); vi.stubEnv("TEST_DATA_SEED", "synthetic-only"); vi.stubEnv("VERCEL", "");
  vi.stubEnv("TEST_DATABASE_HOST", "ep-example.c-1.aws.neon.tech");
  vi.stubEnv("DATABASE_URL", "postgresql://appliance_desk_testing:fixture@ep-example.c-1.aws.neon.tech/appliance_desk");
  vi.stubEnv("DIRECT_URL", "postgresql://appliance_desk_testing:fixture@ep-example.c-1.aws.neon.tech/appliance_desk");
  vi.stubEnv("STRIPE_SECRET_KEY", "");
});
afterEach(() => vi.unstubAllEnvs());

it("initializes the migration-created singleton once and preserves later operator edits", async () => {
  let marker: { id: string } | null = null;
  const settings = { publicBusinessName: "Migration default", shortTermLeaseElection: "UNDECIDED" };
  const update = vi.fn(async ({ data }: { data: Partial<typeof settings> }) => Object.assign(settings, data));
  const db = {
    businessSettings: { update },
    auditLog: { findFirst: vi.fn(async () => marker), create: vi.fn(async () => { marker = { id: "seeded" }; return marker; }) },
  } as unknown as Pick<Prisma.TransactionClient, "businessSettings" | "auditLog">;
  await initializeTestingSettings(db, "fixture-actor");
  expect(settings).toMatchObject({ publicBusinessName: expect.stringContaining("TEST DATA"), shortTermLeaseElection: "COLLECT_ON_RENTALS" });
  settings.shortTermLeaseElection = "PAY_ON_ACQUISITION";
  settings.publicBusinessName = "Operator's test edit";
  await initializeTestingSettings(db, "fixture-actor");
  expect(update).toHaveBeenCalledOnce();
  expect(settings).toMatchObject({ publicBusinessName: "Operator's test edit", shortTermLeaseElection: "PAY_ON_ACQUISITION" });
});

it("turns off required two-step sign-in once in testing and keeps a later operator choice", async () => {
  const { initializeTestingSignIn } = await import("../prisma/testing-settings");
  let marker: { id: string } | null = null;
  const settings: { twoFactorRequiredRoles: unknown } = { twoFactorRequiredRoles: ["OWNER", "ADMIN"] };
  const update = vi.fn(async ({ data }: { data: typeof settings }) => Object.assign(settings, data));
  const db = {
    businessSettings: { update },
    auditLog: { findFirst: vi.fn(async () => marker), create: vi.fn(async () => { marker = { id: "seeded" }; return marker; }) },
  } as unknown as Pick<Prisma.TransactionClient, "businessSettings" | "auditLog">;
  await initializeTestingSignIn(db, "fixture-actor");
  expect(settings.twoFactorRequiredRoles).toEqual([]);
  settings.twoFactorRequiredRoles = ["OWNER"];
  await initializeTestingSignIn(db, "fixture-actor");
  expect(update).toHaveBeenCalledOnce();
  expect(settings.twoFactorRequiredRoles).toEqual(["OWNER"]);
});

it("refuses to touch sign-in settings outside the testing app", async () => {
  const { initializeTestingSignIn } = await import("../prisma/testing-settings");
  vi.stubEnv("APP_ENV", "");
  const update = vi.fn();
  const db = { businessSettings: { update }, auditLog: { findFirst: vi.fn(), create: vi.fn() } } as unknown as
    Pick<Prisma.TransactionClient, "businessSettings" | "auditLog">;
  await expect(initializeTestingSignIn(db, "fixture-actor")).rejects.toThrow();
  expect(update).not.toHaveBeenCalled();
});

it("explains a seed failure with its step but never prints provider messages", async () => {
  const { describeSeedFailure, SeedStageError } = await import("../prisma/testing-settings");
  expect(describeSeedFailure(new SeedStageError("creating the test owner login",
    new Error("TEST_OWNER_PASSWORD must be at least 16 characters.")))).toBe(
    "creating the test owner login: TEST_OWNER_PASSWORD must be at least 16 characters.");
  const providerError = Object.assign(new Error("login failed for role with password hunter2"), { name: "PrismaClientKnownRequestError", code: "P1001" });
  const text = describeSeedFailure(new SeedStageError("adding the fictional fixtures", providerError));
  expect(text).toContain("adding the fictional fixtures: PrismaClientKnownRequestError (code P1001)");
  expect(text).not.toContain("hunter2");
  expect(describeSeedFailure("odd")).toContain("starting the seed: string");
});
