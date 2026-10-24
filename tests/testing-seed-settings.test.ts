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
