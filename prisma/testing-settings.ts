import type { Prisma } from "@prisma/client";
import { assertTestingSeedEnvironment } from "../src/lib/testing-environment";

/** The initial migration already inserts BusinessSettings. A durable marker,
 * under the seed transaction's advisory lock, distinguishes first fixture
 * initialization from later redeployments and operator edits. */
export async function initializeTestingSettings(
  tx: Pick<Prisma.TransactionClient, "businessSettings" | "auditLog">,
  actorId: string,
): Promise<void> {
  assertTestingSeedEnvironment();
  const identity = { action: "testing.seed.settings.v1", entityType: "TestingEnvironment", entityId: "synthetic-fixtures" };
  if (await tx.auditLog.findFirst({ where: identity, select: { id: true } })) return;
  await tx.businessSettings.update({ where: { id: "singleton" }, data: {
    publicBusinessName: "Robinson Appliance Rentals — TEST DATA",
    publicPhone: "+13035550100", publicEmail: "testing@example.test",
    publicAddress: "Fictional testing address — not a business location",
    shortTermLeaseElection: "COLLECT_ON_RENTALS",
  } });
  await tx.auditLog.create({ data: { ...identity, userId: actorId,
    newValue: { synthetic: true, reason: "Fictional testing setup; not business or CPA approval" },
  } });
}

/** Testing app only, once: two-step sign-in starts NOT required so agents can
 * sign in as the fictional test owner with TEST_OWNER_PASSWORD and do hosted
 * checks without anyone's phone (Chris, 2026-10-24: agents do all testing).
 * The business app is untouched; an operator may turn it back on in testing
 * Settings and later deployments never undo that choice. */
export async function initializeTestingSignIn(
  tx: Pick<Prisma.TransactionClient, "businessSettings" | "auditLog">,
  actorId: string,
): Promise<void> {
  assertTestingSeedEnvironment();
  const identity = { action: "testing.seed.sign_in.v1", entityType: "TestingEnvironment", entityId: "synthetic-fixtures" };
  if (await tx.auditLog.findFirst({ where: identity, select: { id: true } })) return;
  await tx.businessSettings.update({ where: { id: "singleton" }, data: { twoFactorRequiredRoles: [] } });
  await tx.auditLog.create({ data: { ...identity, userId: actorId,
    newValue: { synthetic: true, twoFactorRequiredRoles: [], reason: "Testing app only: agents sign in without a phone" },
  } });
}

/** Wraps a failure with the seed step it happened in. */
export class SeedStageError extends Error {
  constructor(readonly stage: string, readonly original: unknown) {
    super(stage);
    this.name = "SeedStageError";
  }
}

// Messages this repository writes itself; they never contain credentials.
const SAFE_MESSAGES = [
  "TEST_OWNER_PASSWORD must be at least 16 characters.",
  "Synthetic seeding is enabled only in the isolated testing environment.",
  "Testing refuses live Stripe credentials.",
  "The independently verified testing database host is required.",
  "Testing configuration is restricted to its verified Vercel project.",
  "Testing database credentials are missing or invalid.",
  "Testing must use its dedicated database, role and verified endpoint.",
];

/** One build-log line saying what failed, without printing provider messages
 * (which can echo connection details). Only our own fixed messages, the error
 * type and a database error code are shown. */
export function describeSeedFailure(error: unknown): string {
  const stage = error instanceof SeedStageError ? error.stage : "starting the seed";
  const cause = error instanceof SeedStageError ? error.original : error;
  if (cause instanceof Error && SAFE_MESSAGES.includes(cause.message)) return `${stage}: ${cause.message}`;
  const name = cause instanceof Error ? cause.name : typeof cause;
  const code = (cause as { code?: unknown } | null)?.code;
  const safeCode = typeof code === "string" && /^[A-Z0-9_]{1,12}$/.test(code) ? ` (code ${code})` : "";
  return `${stage}: ${name}${safeCode}. Check the testing project's settings; nothing secret is printed here.`;
}
