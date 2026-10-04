import { beforeEach, describe, expect, it, vi } from "vitest";
import { businessDateEnd, businessDateFromKey } from "@/lib/business-date";

// What a completed job does to billing (src/domains/billing/pickup-billing-events.ts),
// run against a fake transaction: the agreement, settings, assignments and
// waiting items are fixed and every write is captured.

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/stripe", () => ({ getStripeClient: () => ({}) }));
vi.mock("@/lib/team-actor", () => ({ assertActiveTeamActor: vi.fn() }));

import {
  jobServiceDate,
  parsePerformedOn,
  recordItemsNotDelivered,
  recordLateDeliveries,
  recordLateReturnOnRemoval,
} from "@/domains/billing/pickup-billing-events";

const day = (key: string) => businessDateFromKey(key)!;
const afternoon = (key: string) => new Date(day(key).getTime() + 15.5 * 3_600_000);

type Writes = {
  invoices: unknown[];
  credits: unknown[];
  pendingCreated: unknown[];
  pendingUpdates: unknown[];
  audits: Array<{ action: string }>;
  locks: number;
};

function fakeTx(input: {
  agreement: Record<string, unknown> | null;
  settings?: Record<string, unknown> | null;
  assignments: Array<Record<string, unknown>>;
  pending?: Array<Record<string, unknown>>;
}) {
  const writes: Writes = { invoices: [], credits: [], pendingCreated: [], pendingUpdates: [], audits: [], locks: 0 };
  const tx = {
    rentalAgreement: { findUnique: vi.fn(async () => input.agreement) },
    businessSettings: { findUnique: vi.fn(async () => input.settings ?? null) },
    applianceAssignment: { findMany: vi.fn(async () => input.assignments) },
    pendingDelivery: {
      findMany: vi.fn(async () => input.pending ?? []),
      findUnique: vi.fn(async () => null),
      create: vi.fn(async (args: { data: unknown }) => {
        writes.pendingCreated.push(args.data);
        return { id: `pd-${writes.pendingCreated.length}` };
      }),
      update: vi.fn(async (args: unknown) => {
        writes.pendingUpdates.push(args);
        return {};
      }),
    },
    invoice: {
      create: vi.fn(async (args: { data: unknown }) => {
        writes.invoices.push(args.data);
        return { id: `inv-${writes.invoices.length}` };
      }),
    },
    customerCredit: {
      create: vi.fn(async (args: { data: unknown }) => {
        writes.credits.push(args.data);
        return { id: `credit-${writes.credits.length}` };
      }),
    },
    auditLog: {
      create: vi.fn(async (args: { data: { action: string } }) => {
        writes.audits.push(args.data);
        return {};
      }),
    },
    $queryRaw: vi.fn(async () => {
      writes.locks += 1;
      return [{ id: "cust-1" }];
    }),
  };
  return { tx, writes };
}

const line = (id: string, monthlyPriceCents: number, applianceIds: string[]) => ({
  id,
  monthlyPriceCents,
  assignments: applianceIds.map((applianceId) => ({ applianceId })),
});

const assignment = (id: string, applianceId: string, rentalLine: ReturnType<typeof line>, name: string) => ({
  id,
  applianceId,
  unassignedAt: null,
  rentalLine,
  appliance: { assetNumber: applianceId.toUpperCase(), applianceType: { name } },
});

beforeEach(() => vi.clearAllMocks());

describe("the date a job's work happened", () => {
  it("prefers the date staff recorded, then the scheduled date, then completion", () => {
    const performedOn = day("2026-10-14");
    const scheduledAt = afternoon("2026-10-13");
    const completedAt = afternoon("2026-10-16");
    expect(jobServiceDate({ performedOn, scheduledAt, completedAt })).toBe(performedOn);
    expect(jobServiceDate({ performedOn: null, scheduledAt, completedAt })).toBe(scheduledAt);
    expect(jobServiceDate({ performedOn: null, scheduledAt: null, completedAt })).toBe(completedAt);
  });

  it("parses the typed date as a Colorado date and rejects nonsense", () => {
    expect(parsePerformedOn("2026-10-14")).toEqual({ ok: true, value: day("2026-10-14") });
    expect(parsePerformedOn("")).toEqual({ ok: true, value: null });
    expect(parsePerformedOn(undefined)).toEqual({ ok: true, value: null });
    expect(parsePerformedOn("2026-02-30")).toMatchObject({ ok: false });
    expect(parsePerformedOn("yesterday")).toMatchObject({ ok: false });
  });
});

describe("late return (rule 1)", () => {
  const base = {
    id: "agr-1",
    customerId: "cust-1",
    status: "ENDED",
    endDate: businessDateEnd("2026-10-10"),
    billingStartedAt: afternoon("2026-03-10"),
    paidInFullInAdvance: false,
    taxRateMilliPercent: 7_375,
  };

  it("bills 3 late days per item on one open invoice, each as its own labeled line, with the agreement's tax", async () => {
    const { tx, writes } = fakeTx({ agreement: base, assignments: [assignment("as-1", "w1", line("line-w", 4_500, ["w1"]), "Washer")] });
    const result = await recordLateReturnOnRemoval(tx as never, {
      userId: "owner",
      jobId: "job-1",
      agreementId: "agr-1",
      applianceIds: ["w1"],
      pickupDate: afternoon("2026-10-14"),
    });

    expect(result.lateReturnInvoiceId).toBe("inv-1");
    expect(writes.locks).toBe(1); // the customer's ledger was locked first
    const invoice = writes.invoices[0] as {
      status: string;
      subtotalCents: number;
      taxCents: number;
      amountDueCents: number;
      lineItems: { createMany: { data: Array<Record<string, unknown>> } };
    };
    expect(invoice.status).toBe("OPEN");
    expect(invoice.subtotalCents).toBe(450);
    expect(invoice.taxCents).toBe(33); // 7.375% of $4.50 = $0.3319 → $0.33
    expect(invoice.amountDueCents).toBe(483);
    expect(invoice.lineItems.createMany.data).toEqual([
      { kind: "LATE_RETURN", description: "Late return – Washer #W1 – 3 days", amountCents: 450, quantity: 1, rentalLineId: "line-w" },
      { kind: "TAX", description: "Sales tax", amountCents: 33, quantity: 1, rentalLineId: null },
    ]);
    expect(writes.credits).toHaveLength(0);
    expect(writes.audits[0].action).toBe("billing.late_return_invoiced");
  });

  it("a pickup after the end date is a late return even while the agreement is still marked ACTIVE, and gets no credit", async () => {
    const { tx, writes } = fakeTx({
      agreement: { ...base, status: "ACTIVE" },
      assignments: [assignment("as-1", "w1", line("line-w", 4_500, ["w1"]), "Washer")],
    });
    const result = await recordLateReturnOnRemoval(tx as never, {
      userId: "owner",
      jobId: "job-1",
      agreementId: "agr-1",
      applianceIds: ["w1"],
      pickupDate: afternoon("2026-10-14"),
    });
    expect(result.lateReturnInvoiceId).toBe("inv-1");
    expect(result.lateReturnCents).toBe(483);
    expect(writes.credits).toHaveLength(0);
    expect(result.creditIds).toEqual([]);
  });

  it("uses the pickup date it is given, not the moment the button was pressed", async () => {
    const { tx, writes } = fakeTx({ agreement: base, assignments: [assignment("as-1", "w1", line("line-w", 4_500, ["w1"]), "Washer")] });
    // Recorded on Oct 20, but the truck went on Oct 12: one late day (Oct 11), not nine.
    const result = await recordLateReturnOnRemoval(tx as never, {
      userId: "owner",
      jobId: "job-1",
      agreementId: "agr-1",
      applianceIds: ["w1"],
      pickupDate: day("2026-10-12"),
    });
    expect(result.lateReturnCents).toBeGreaterThan(0);
    expect((writes.invoices[0] as { subtotalCents: number }).subtotalCents).toBe(150);
  });

  it("bills nothing and writes no invoice for an on-time pickup, or when the agreement has no end date", async () => {
    for (const agreement of [base, { ...base, status: "ACTIVE", endDate: null }]) {
      const { tx, writes } = fakeTx({ agreement, assignments: [assignment("as-1", "w1", line("line-w", 4_500, ["w1"]), "Washer")] });
      const result = await recordLateReturnOnRemoval(tx as never, {
        userId: "owner",
        jobId: "job-1",
        agreementId: "agr-1",
        applianceIds: ["w1"],
        pickupDate: afternoon("2026-10-11"),
      });
      expect(result.lateReturnInvoiceId).toBeNull();
      expect(writes.invoices).toHaveLength(0);
      expect(writes.locks).toBe(0);
    }
  });
});

describe("late delivery on a 2-item agreement (rule 2)", () => {
  // The washer arrived Oct 1 and billing for the whole $60 set started then;
  // the dryer was marked not delivered and arrives Oct 11.
  const active = {
    id: "agr-2",
    customerId: "cust-1",
    status: "ACTIVE",
    endDate: null,
    billingStartedAt: afternoon("2026-10-01"),
    paidInFullInAdvance: false,
    taxRateMilliPercent: 0,
  };
  const setLine = line("line-set", 6_000, ["w1", "d1"]);
  const waitingDryer = { id: "pd-1", applianceId: "d1", rentalLineId: "line-set", originalDeliveryDate: day("2026-10-01") };

  it("records an item that was not on the first delivery, billed from that visit's date", async () => {
    const { tx, writes } = fakeTx({ agreement: active, assignments: [assignment("as-d", "d1", setLine, "Dryer")] });
    const result = await recordItemsNotDelivered(tx as never, {
      userId: "staff",
      jobId: "job-1",
      agreementId: "agr-2",
      applianceIds: ["d1"],
      deliveryDate: day("2026-10-01"),
    });
    expect(result.pendingDeliveryIds).toEqual(["pd-1"]);
    expect(writes.pendingCreated[0]).toMatchObject({
      agreementId: "agr-2",
      rentalLineId: "line-set",
      applianceId: "d1",
      originalJobId: "job-1",
      originalDeliveryDate: day("2026-10-01"),
    });
    expect(writes.credits).toHaveLength(0);
    expect(writes.audits[0].action).toBe("billing.item_not_delivered");
  });

  it("when the item arrives 10 days later, the whole agreement stays billed and a 10-day credit is recorded for the next bill", async () => {
    const { tx, writes } = fakeTx({
      agreement: active,
      assignments: [assignment("as-d", "d1", setLine, "Dryer")],
      pending: [waitingDryer],
    });
    const result = await recordLateDeliveries(tx as never, {
      userId: "staff",
      jobId: "job-2",
      agreementId: "agr-2",
      applianceIds: ["d1"],
      deliveryDate: day("2026-10-11"),
    });
    expect(result.creditIds).toEqual(["credit-1"]);
    expect(result.creditCents).toBe(1_000);
    expect(writes.invoices).toHaveLength(0); // nothing is re-billed; the subscription bills the whole agreement
    expect(writes.credits[0]).toMatchObject({
      customerId: "cust-1",
      amountCents: 1_000,
      remainingCents: 1_000,
      reason: "Credit – Dryer #D1 delivered late – 10 days",
      sourceType: "LATE_DELIVERY",
      sourceId: "pd-1",
      side: "CUSTOMER",
      authorizedByUserId: "staff",
    });
    expect(writes.pendingUpdates).toEqual([
      { where: { id: "pd-1" }, data: { deliveredOn: day("2026-10-11"), deliveredJobId: "job-2" } },
      { where: { id: "pd-1" }, data: { creditId: "credit-1" } },
    ]);
    expect(writes.audits[0].action).toBe("billing.late_delivery_credit");
  });

  it("an appliance with nothing waiting is just delivered: no credit, no record", async () => {
    const { tx, writes } = fakeTx({ agreement: active, assignments: [assignment("as-w", "w1", setLine, "Washer")], pending: [] });
    const result = await recordLateDeliveries(tx as never, {
      userId: "staff",
      jobId: "job-1",
      agreementId: "agr-2",
      applianceIds: ["w1"],
      deliveryDate: day("2026-10-01"),
    });
    expect(result.creditIds).toEqual([]);
    expect(writes.credits).toHaveLength(0);
    expect(tx.rentalAgreement.findUnique).not.toHaveBeenCalled();
  });

  it("gives no automatic credit when billing never started or the rental was prepaid, but still closes the waiting item", async () => {
    for (const agreement of [
      { ...active, billingStartedAt: null },
      { ...active, paidInFullInAdvance: true },
    ]) {
      const { tx, writes } = fakeTx({ agreement, assignments: [assignment("as-d", "d1", setLine, "Dryer")], pending: [waitingDryer] });
      const result = await recordLateDeliveries(tx as never, {
        userId: "staff",
        jobId: "job-2",
        agreementId: "agr-2",
        applianceIds: ["d1"],
        deliveryDate: day("2026-10-11"),
      });
      expect(writes.pendingUpdates).toHaveLength(1);
      expect(writes.credits).toHaveLength(0);
      expect(result.creditIds).toEqual([]);
      expect(result.notes[0]).toMatch(/no (credit|automatic credit)/);
    }
  });

  it("uses the owner's saved proration basis", async () => {
    const { tx, writes } = fakeTx({
      agreement: active,
      settings: { lateDeliveryProrationBasis: "ACTUAL_DAYS_IN_MONTH" },
      assignments: [assignment("as-d", "d1", setLine, "Dryer")],
      pending: [waitingDryer],
    });
    await recordLateDeliveries(tx as never, {
      userId: "staff",
      jobId: "job-2",
      agreementId: "agr-2",
      applianceIds: ["d1"],
      deliveryDate: day("2026-10-11"),
    });
    // 10 missing days at $30 ÷ 31 → $9.68
    expect(writes.credits[0]).toMatchObject({ amountCents: 968, reason: "Credit – Dryer #D1 delivered late – 10 days" });
  });
});
