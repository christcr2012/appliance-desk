import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobApplianceResult, JobType } from "@prisma/client";

const m = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock("@/lib/stripe", () => ({ getStripeClient: () => ({}) }));
vi.mock("@/domains/billing/checkout", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/domains/billing/checkout")>()),
  startRecurringBillingForAgreement: m.start,
}));

import { prisma } from "@/lib/prisma";
import { completeJob, runPendingHandoffs, updateJobStatus, getJobCompletionScope, JobCompletionConflictError } from "@/domains/jobs";
import { JobVersionError } from "@/domains/jobs/scheduling";
import { executeAgreedTermination } from "@/domains/agreements/termination-execution";
import { businessDateFromKey } from "@/lib/business-date";
import { openCustodyEpisodeInTx, findCustodyInvariantViolations } from "@/domains/inventory/custody";

// Completing a job with a result for every appliance (Batch C, P2-B), real Postgres.
const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("completeJob", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ownerId = `jc-owner-${tag}`;
  const staffId = `jc-staff-${tag}`;
  const userId = `jc-user-${tag}`;¶»§q«^