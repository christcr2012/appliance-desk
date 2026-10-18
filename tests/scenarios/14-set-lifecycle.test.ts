// PLAN scenario 14 (BATCH-F WU-F3): a priced washer-and-dryer set is delivered under a signed, paid agreement. The customer is done
// with one machine, so the rest is repriced by the owner's rule (the single-machine price, never more than before, with the days
// credited), then the other machine comes back and the rental ends early on the owner's chosen terms. Both machines go through
// pickup, inspection and cleaning to available. Money is integer cents; Stripe is faked.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const tag = randomUUID().replaceAll("-", "");
const fake = vi.hoisted(() => ({ lineId: "", price: 0, updates: [] as Array<{ id: string; params: unknown }>, params: null as { customer?: unknown; add_invoice_items?: Array<{ price_data?: { unit_amount?: number }; metadata?: Record<string, string> }> } | null }));
vi.mock("@/lib/stripe", () => ({
  getStripeClient: () => ({
    products: { create: async () => ({ id: `prod_s14_${tag}` }) },
    subscriptions: {
      create: async (params: NonNullable<typeof fake.params>) => {
        fake.params = params;
        return { id: `sub_s14_${tag}`, latest_invoice: `in_s14_${tag}` };
      },
      retrieve: async () => ({
        id: `sub_s14_${tag}`, status: "active", cancel_at: null,
        items: { data: [{ id: "si_s14", price: { unit_amount: fake.price, product: { id: `prod_s14_${tag}`, metadata: { rentalLineId: fake.lineId } } }, tax_rates: [] }] },
      }),
      update: async (id: string, params: { items?: Array<{ price_data?: { unit_amount?: number } }> }) => {
        fake.updates.push({ id, params });
        const next = params.items?.[0]?.price_data?.unit_amount;
        if (typeof next === "number") fake.price = next;
        return { id };
      },
    },
    invoices: {
      retrieve: async () => ({ id: `in_s14_${tag}`, livemode: false, billing_reason: "subscription_create", currency: "usd", customer: fake.params?.customer, status: "open", parent: { subscription_details: { subscription: `sub_s14_${tag}` } } }),
      listLineItems: async () => ({ has_more: false, data: (fake.params?.add_invoice_items ?? []).map((row, i) => ({ id: `il_s14_${tag}_${i}`, livemode: false, invoice: `in_s14_${tag}`, amount: row.price_data?.unit_amount, metadata: row.metadata })) }),
    },
  }),
}));
vi.mock("@/lib/email", () => ({ sendEmail: async () => ({ sent: true }) }));
let owner = "";
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => ({ user: { id: owner, role: "OWNER", archivedAt: null } }) } } }));
vi.mock("@/domains/security/two-factor", () => ({ twoFactorEnrollmentRequired: async () => false }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { prisma } from "@/lib/prisma";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { completeJob } from "@/domains/jobs";
import { markSetMachineDone, planSetMachineDone } from "@/domains/billing/set-machine-done";
import { applyEarlyReturn, previewEarlyReturn, type EarlyReturnChoice } from "@/domains/agreements/early-return";
import { getInspectionChecklist, recordApplianceInspection } from "@/domains/inventory/guided-actions";
import { markCleaningDone } from "@/domains/inventory/cleaning";
import { createSyntheticW22V2Order } from "../helpers/w22-v2-order";
import { deliverMachines, reviewSignAndPay, purgeScenarioQueues } from "../helpers/scenario-order";
const scenarioStartedAt = new Date();

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && url.pathname === "/appliance_desk_test" && ["localhost", "127.0.0.1"].includes(url.hostname);
const day = businessDateKey(new Date());

describe.skipIf(!enabled)("scenario 14: the life of a washer-and-dryer set", () => {
  let cleanup: (() => Promise<void>) | undefined;
  const extraJobs: string[] = [];
  beforeAll(async () => {
    owner = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
  });
  afterAll(async () => {
    await purgeScenarioQueues(scenarioStartedAt);
    await cleanup?.();
  });

  async function pickUp(agreementId: string, applianceId: string, label: string) {
    const job = await prisma.job.create({ data: { type: "REMOVAL", status: "IN_PROGRESS", customerId: (await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: agreementId } })).customerId, agreementId, appliances: { create: [{ applianceId }] } } });
    extraJobs.push(job.id);
    await completeJob(owner, { jobId: job.id, expectedVersion: job.version, completionKey: `s14-${label}-${tag}`, performedOn: businessDateFromKey(day), completionNotes: null, results: [{ applianceId, result: "RETURNED" as const }] });
    return job.id;
  }

  it("delivers the set, reprices after one machine is done, ends early on the owner's terms and returns both machines to available", async () => {
    const fixture = await createSyntheticW22V2Order();
    cleanup = fixture.cleanup;
    const { agreementId, jobId } = await reviewSignAndPay(fixture, 0, "s14");
    const agreement = await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: agreementId }, include: { lines: true } });
    const line = agreement.lines[0];
    expect(line.monthlyPriceCents).toBe(6000); // the package price from the signed quote
    fake.lineId = line.id;
    fake.price = line.monthlyPriceCents;
    const { applianceIds: [washer, dryer] } = await deliverMachines(fixture, agreementId, jobId, 2, "s14");
    const custody = await prisma.applianceCustodyEpisode.findMany({ where: { applianceId: { in: [washer, dryer] } } });
    expect(custody.map((c) => c.endedOn)).toEqual([null, null]);
    expect((await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: agreementId } })).stripeSubscriptionId).toBe(`sub_s14_${tag}`);

    // The customer is done with the dryer: it comes back and the owner marks it done. The rest is repriced by the owner's rule.
    await pickUp(agreementId, dryer, "dryer");
    const decided = businessDateFromKey(day)!;
    const plan = await planSetMachineDone(dryer, decided);
    expect(plan).toMatchObject({ eligible: true, oldPriceCents: 6000 });
    const newPrice = (plan as { newPriceCents: number }).newPriceCents;
    expect(newPrice).toBeLessThanOrEqual(6000); // never more than today
    const done = await markSetMachineDone(owner, { applianceId: dryer, decidedOn: decided });
    expect(done.message).toContain("a month");
    expect((await prisma.rentalLine.findUniqueOrThrow({ where: { id: line.id } })).monthlyPriceCents).toBe(newPrice);
    const amendment = await prisma.rentalLineAmendment.findFirstOrThrow({ where: { rentalLineId: line.id } });
    expect(amendment).toMatchObject({ previousMonthlyPriceCents: 6000, newMonthlyPriceCents: newPrice });
    expect(fake.updates).toHaveLength(1);
    expect(fake.price).toBe(newPrice);
    expect(await prisma.providerOperation.findUniqueOrThrow({ where: { idempotencyKey: `subscription-line-reprice-${amendment.id}` } })).toMatchObject({ status: "SUCCEEDED" });
    // The dryer's custody closed, the washer's did not; the dryer is waiting for inspection, the washer is still rented.
    expect((await prisma.applianceCustodyEpisode.findFirstOrThrow({ where: { applianceId: dryer } })).endedOn).not.toBeNull();
    expect((await prisma.applianceCustodyEpisode.findFirstOrThrow({ where: { applianceId: washer } })).endedOn).toBeNull();
    expect((await prisma.appliance.findUniqueOrThrow({ where: { id: dryer } })).status).toBe("AWAITING_INSPECTION");
    expect((await prisma.appliance.findUniqueOrThrow({ where: { id: washer } })).status).toBe("RENTED");
    // Doing it twice changes nothing.
    await expect(markSetMachineDone(owner, { applianceId: dryer, decidedOn: decided })).rejects.toThrow();
    expect((await prisma.rentalLineAmendment.count({ where: { rentalLineId: line.id } }))).toBe(1);

    // The washer comes back too: the whole rental is back before its agreed end, so the owner's early-ending terms apply.
    await pickUp(agreementId, washer, "washer");
    expect((await prisma.appliance.findUniqueOrThrow({ where: { id: washer } })).status).toBe("AWAITING_INSPECTION");
    let ended = await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: agreementId } });
    if (ended.status === "ACTIVE") {
      // Stripe's first-invoice event is what normally records the next billing date; the scenario records it the same way.
      await prisma.rentalAgreement.update({ where: { id: agreementId }, data: { nextBillingDate: new Date(Date.now() + 20 * 86_400_000) } });
      const choice: EarlyReturnChoice = { billing: "END_AT_PICKUP", unusedDays: "KEEP", feeCents: 0 };
      const preview = await previewEarlyReturn(agreementId, choice);
      await applyEarlyReturn(owner, agreementId, choice, preview);
      ended = await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: agreementId } });
    }
    expect(ended.status).toBe("ENDED");
    expect(await prisma.earlyReturnResolution.count({ where: { agreementId } })).toBeLessThanOrEqual(1);
    expect(await prisma.applianceCustodyEpisode.count({ where: { applianceId: { in: [washer, dryer] }, endedOn: null } })).toBe(0);

    // Inspection and cleaning put both machines back on the shelf; nothing is skipped.
    const checklist = await getInspectionChecklist();
    for (const id of [dryer, washer]) {
      expect((await recordApplianceInspection(owner, id, { expectedChecklistVersionId: checklist.versionId, answers: checklist.items.map(() => true), condition: "Good" })).passed).toBe(true);
      expect((await prisma.appliance.findUniqueOrThrow({ where: { id } })).status).toBe("CLEANING");
      expect((await markCleaningDone(owner, id)).changed).toBe(true);
      expect((await prisma.appliance.findUniqueOrThrow({ where: { id } })).status).toBe("AVAILABLE");
      const trail = await prisma.auditLog.findMany({ where: { entityType: "Appliance", entityId: id, action: "appliance.unit.status" }, orderBy: { createdAt: "asc" } });
      expect(trail.map((row) => (row.newValue as { status: string }).status)).toEqual(expect.arrayContaining(["AWAITING_INSPECTION", "CLEANING", "AVAILABLE"]));
    }
    // No work item or visit was left half done.
    expect(await prisma.job.count({ where: { id: { in: extraJobs }, status: { not: "COMPLETED" } } })).toBe(0);
  });
});
